# @hyperbiscus/agent

Autonomous DeFi monitoring agent — laptop simulation of the MimiClaw ESP32-S3 hardware agent.

Monitors a Meteora DLMM concentrated liquidity position every 30 seconds, checkpoints LP status on Solana via MagicBlock Ephemeral Rollup, and provides a bidirectional WebSocket interface for the companion mobile app.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   agent process                     │
│                                                     │
│  Monitoring loop (every 30s)                        │
│    checkLpPosition() ── Solana RPC read             │
│    submitUpdateLpStatus() ── base-layer TX          │
│    broadcast(tick) ── WebSocket push                │
│                                                     │
│  WebSocket server :18789                            │
│    ← chat { message }  → Claude ReAct loop         │
│    ← action { add_liquidity } → MagicBlock ER flow │
│    → tick / chat_response / action_step             │
│                                                     │
│  MagicBlock ER flow (add_liquidity)                 │
│    delegate_session → ER → execute_action           │
│    commitSession → undelegateSession → checkpoint   │
└─────────────────────────────────────────────────────┘
         ↕ WebSocket (ws://LAN_IP:18789)
┌─────────────────────────────────────────────────────┐
│               @hyperbiscus/mobile                   │
│   Chat · Position · Skills · Settings tabs          │
└─────────────────────────────────────────────────────┘
```

### Source files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point — starts WS server, runs tick loop |
| `src/agent.ts` | Monitoring tick: read LP position + checkpoint |
| `src/chat.ts` | Claude ReAct chat handler (streaming) |
| `src/actions.ts` | `add_liquidity` MagicBlock ER transaction flow |
| `src/tools.ts` | Claude tool definitions + executors |
| `src/ws-server.ts` | WebSocket server, auth, message routing |
| `src/solana.ts` | Anchor program setup + `update_lp_status` TX |
| `src/config.ts` | Environment variable loading + validation |
| `src/memory.ts` | SOUL.md / MEMORY.md persistence helpers |
| `src/constants.ts` | Shared on-chain program constants |

---

## Setup

### 1. Prerequisites

- Node.js 20+ and pnpm
- A funded Solana devnet wallet (`solana airdrop 2`)
- An Anthropic API key
- A deployed `defi_agent` Anchor program (see `packages/contracts`)
- A Meteora DLMM position on devnet (LbPair + position pubkey)

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — required fields:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (sk-ant-…) |
| `SESSION_KEYPAIR_PATH` | Path to session keypair JSON (`~/.config/solana/id.json`) |
| `SESSION_PDA` | AgentSession PDA address (from `anchor test` output) |
| `LB_PAIR` | Meteora DLMM LbPair address |
| `POSITION_PUBKEY` | DLMM position account to monitor |

Optional fields (all have defaults):

| Variable | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `MAGICBLOCK_RPC_URL` | `https://devnet.magicblock.app/` | MagicBlock ER RPC |
| `CHECK_INTERVAL_MS` | `30000` | Monitoring tick interval (ms) |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | Anthropic model |
| `WS_SECRET` | _(empty — open access)_ | Optional WebSocket auth token |

### 3. Run

```bash
# From monorepo root
pnpm --filter @hyperbiscus/agent start

# Or from this directory
pnpm start
```

The agent logs each tick to stdout and broadcasts to connected WebSocket clients. The WebSocket server listens on `ws://0.0.0.0:18789`.

---

## WebSocket API

### Authentication

If `WS_SECRET` is set, the first message from the client must be:

```json
{ "type": "auth", "token": "<WS_SECRET>" }
```

Clients that do not send a valid token within 5 seconds are disconnected.

### Inbound messages (mobile → agent)

```jsonc
// Chat with the agent
{ "type": "chat", "message": "What's the current position status?" }

// Trigger an action
{ "type": "action", "action": "add_liquidity" }
```

### Outbound messages (agent → mobile)

```jsonc
// Sent on connect — static session config
{ "type": "connected", "sessionPda": "...", "lbPair": "...", "intervalMs": 30000, ... }

// After every monitoring tick
{ "type": "tick", "tickNumber": 1, "activeBin": 8442, "isInRange": true, "feeX": "0", "feeY": "1234", "txSignature": "...", ... }

// Chat is being processed
{ "type": "chat_thinking" }

// Streaming token from Claude
{ "type": "chat_token", "token": "The " }

// Final chat reply
{ "type": "chat_response", "message": "The position is in range.", "timestamp": "...", "position": { ... } }

// Live step update during an action flow
{ "type": "action_step", "actionId": "add_liq_...", "step": 2, "total": 5, "label": "...", "status": "success", "txSignature": "...", "txUrl": "..." }
```

---

## Agent memory

- **SOUL.md** — static personality + rules, loaded fresh each tick/chat
- **MEMORY.md** — append-only log; last 30 entries are included in every Claude context window as untrusted background

Memory entries are sanitized before persistence to prevent prompt injection via user chat messages.

---

## Security notes

- `WS_SECRET` should always be set when the agent is reachable over LAN
- The session keypair signs Solana transactions — keep it out of version control
- Claude is given only `check_lp_position` during chat (not `update_lp_status`)
- The WS server enforces a 64 KB max payload and 4096-character chat message limit
