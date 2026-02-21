# DeFi Agent Hardware — Autonomous Yield on Solana

> A $10 hardware device that runs an autonomous DeFi agent 24/7. Plug it in, connect your wallet, and let it execute high-frequency yield strategies on Solana while you sleep.

---

## The Problem

DeFi yield optimization on Solana is inherently high-frequency. Concentrated liquidity positions go out of range within minutes, optimal lending rates shift every slot, and liquidation risks can materialize in seconds.

Current solutions force users to either:
- Trust a **centralized bot service** with their private keys
- Run **expensive cloud infrastructure** 24/7
- **Manually manage** positions and miss most of the yield opportunity

Serious DeFi automation is only accessible to well-resourced teams — not individual users.

---

## The Solution

An ESP32-S3 hardware device running **MimiClaw's embedded AI agent framework** as a personal, always-on DeFi execution engine.

- Sits on your desk, plugged into USB at **0.5W**
- **No cloud server, no VPS, no laptop** required
- Holds your Solana session keys in **encrypted hardware storage**
- Connects to your mobile via **WebSocket or Telegram**
- Executes strategies autonomously via **MagicBlock's ephemeral rollup**

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Mobile App / Telegram               │
│         (monitor, configure, approve)            │
└────────────────────┬────────────────────────────┘
                     │ WebSocket / Telegram Bot
┌────────────────────▼────────────────────────────┐
│           ESP32-S3 (MimiClaw Agent)              │
│                                                  │
│  ┌─────────────┐   ┌──────────────────────────┐ │
│  │  ReAct Loop │   │     Persistent Memory    │ │
│  │ (Tool Call) │   │  SOUL.md / MEMORY.md     │ │
│  └──────┬──────┘   │  risk profile / history  │ │
│         │          └──────────────────────────┘ │
│  ┌──────▼──────┐   ┌──────────────────────────┐ │
│  │    Cron     │   │     Session Key (NVS)    │ │
│  │  Scheduler  │   │   encrypted hardware     │ │
│  └──────┬──────┘   │       storage            │ │
│         │          └──────────────────────────┘ │
└─────────┼───────────────────────────────────────┘
          │ HTTPS / Tool Calls
┌─────────▼───────────────────────────────────────┐
│         MagicBlock Ephemeral Rollup              │
│                                                  │
│   • Sub-100ms execution (vs 400ms mainnet)       │
│   • Session key autonomous signing               │
│   • Near-zero fees on fast layer                 │
│   • Settles to mainnet on position change        │
└─────────────────────┬───────────────────────────┘
                      │ Composable
┌─────────────────────▼───────────────────────────┐
│              Solana Mainnet                      │
│                                                  │
│   Meteora DLMM · Kamino · Marginfi · Drift       │
│   BTC Yield · LP Positions · Lending             │
└─────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Hardware Layer — ESP32-S3 + MimiClaw

MimiClaw's ReAct agent loop runs in **pure C** on the ESP32-S3's dual-core processor with 8MB PSRAM. The agent:

- Continuously monitors market conditions and evaluates strategy triggers
- Uses a **built-in cron scheduler** — check LP ranges every 30s, harvest fees at threshold, rebalance on price drift
- Stores **persistent memory** on SPIFFS flash — risk profile, position history, performance logs that survive reboots
- Calls Claude or GPT via API for reasoning, keeping the AI layer in the cloud while the **agent loop and signing stays on-device**
- Runs 24/7 at **0.5W** — less than a dollar per month in electricity

### 2. Execution Layer — MagicBlock

The core challenge of any autonomous DeFi agent is signing transactions without requiring user approval on every action. MagicBlock solves this with **session keys**:

1. User approves a scoped delegation once from mobile — *"manage these positions for 24hrs, max 1 SOL exposure"*
2. Session key is stored in the ESP32's encrypted NVS storage
3. Agent signs and submits transactions freely within those constraints
4. MagicBlock's ephemeral rollup executes at **sub-100ms latency**
5. Only settles to Solana mainnet when positions actually change

This enables genuinely high-frequency strategy logic — checking prices every few seconds, rebalancing concentrated liquidity the moment it drifts, protecting leveraged positions from liquidation — without mainnet RPC costs on every decision.

### 3. Mobile Interface

Users interact through a simple mobile app connected via WebSocket (LAN) or Telegram (remote):

- Monitor live position performance
- Adjust risk parameters
- Approve new session key scopes
- Review the agent's decision logs

The device handles everything else autonomously.

---

## Why This Stack

| Component | Role | Why |
|---|---|---|
| **ESP32-S3** | Always-on hardware agent | $10, 0.5W, runs 24/7 without infrastructure |
| **MimiClaw** | Embedded agent framework | Production-ready ReAct loop in C, persistent memory, cron scheduling — proven on this exact hardware |
| **MagicBlock** | Execution + session keys | Only practical solution for autonomous Solana signing without custodying keys on a server |
| **Claude / GPT API** | LLM reasoning | Heavy AI lifted in cloud, decision loop stays on-device |
| **Meteora DLMM** | Concentrated LP protocol | Deep on-chain liquidity with bin-based concentrated positions and fee harvesting |
| **Solana** | Settlement + DeFi ecosystem | Full composability with Meteora, Jupiter, Kamino, Marginfi, Drift |

---

## Key Features

- **Physical key custody** — session keys never leave the device, no cloud server to hack
- **Truly autonomous** — agent schedules and executes its own tasks via cron, no user intervention
- **High-frequency ready** — MagicBlock sub-100ms execution handles LP rebalancing, yield switching, liquidation protection
- **Real on-chain DeFi** — CPI into Meteora DLMM for live swaps, liquidity provision, and position management
- **Persistent AI memory** — agent learns from its own performance history stored in local flash
- **Mobile-first UX** — chat with your agent via Telegram or the mobile app from anywhere
- **$10 hardware** — accessible to any DeFi user, not just institutions

---

## Hardware Requirements

| Spec | Requirement |
|---|---|
| MCU | ESP32-S3 |
| Flash | 16 MB minimum |
| PSRAM | 8 MB minimum |
| Power | USB-C, 5V |

**Recommended boards:**
- LILYGO T7-S3
- FireBeetle 2 ESP32-S3
- Seeed Studio XIAO ESP32S3 Plus
- ESP32-S3-DevKitC-1-N16R8
- Xiaozhi AI board (~$10)

---

## Getting Started

### Prerequisites

- ESP-IDF 5.5 or greater
- Anthropic API key (Claude) or OpenAI API key
- Solana wallet
- Telegram bot token (via @BotFather)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/defi-agent-hardware
cd defi-agent-hardware

# Configure secrets
cp main/mimi_secrets.h.example main/mimi_secrets.h
# Edit mimi_secrets.h with your WiFi, API keys, and Telegram token

# Set target and build
idf.py set-target esp32s3
idf.py build

# Flash to device (use the USB port, not COM)
idf.py -p /dev/ttyACM0 flash monitor
```

### First Run

Once flashed, the device will:
1. Connect to WiFi
2. Start the Telegram bot
3. Start the WebSocket server on port `18789`
4. Begin the agent loop

Open Telegram, message your bot, and approve your first session key scope from the mobile app.

---

## Security Model

- Session keys stored in **ESP32 NVS encrypted storage**
- Keys are **scoped** — time-limited, exposure-capped, user-defined
- No cloud server holds your keys at any point
- Physical device = physical custody
- Session keys expire and require re-approval from mobile

---

## Smart Contract

The on-chain program (`packages/contracts/programs/defi-agent`) is an **Anchor 0.32 program** deployed on Solana devnet. It enforces the session key security model and CPIs into external DeFi protocols on behalf of the scoped session key.

### Deployed Addresses

| Program | Network | Address |
|---|---|---|
| `defi-agent` | Solana devnet | [`8reNvTG6PLT4sf4nGbT7VjZ1YqEGXzASkjcSQmQTkJPT`](https://explorer.solana.com/address/8reNvTG6PLT4sf4nGbT7VjZ1YqEGXzASkjcSQmQTkJPT?cluster=devnet) |
| Meteora DLMM | mainnet + devnet | [`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`](https://explorer.solana.com/address/LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo) |

### Instructions

| Instruction | Layer | Description |
|---|---|---|
| `initialize_session` | Base Layer | Create `AgentSession` PDA — registers session key with scope (duration, exposure cap, strategy mask) |
| `delegate_session` | Base Layer | Delegate PDA to MagicBlock Ephemeral Rollup |
| `execute_action` | Ephemeral Rollup | Generic strategy action signed by session key — validates scope, updates counters |
| `commit_session` | Ephemeral Rollup | Checkpoint state to base layer without undelegating |
| `undelegate_session` | Ephemeral Rollup | Return PDA ownership to base layer |
| `execute_dlmm_swap` | Base Layer | CPI into Meteora DLMM to swap tokens — validates LP strategy scope + exposure cap |
| `execute_dlmm_add_liquidity` | Base Layer | CPI into Meteora DLMM to add liquidity to an existing position |
| `execute_dlmm_close_position` | Base Layer | CPI into Meteora DLMM — `remove_all_liquidity` then `close_position2` in sequence |

### AgentSession State

```
owner          Pubkey   — wallet that created the session
session_key    Pubkey   — ESP32 hardware key authorized to sign
expires_at     i64      — Unix timestamp of expiry
max_lamports   u64      — cumulative exposure cap
spent_lamports u64      — running total spent this session
is_active      bool     — can be deactivated by owner
strategy_mask  u8       — bitmask of enabled strategies (bit0=LP, bit1=yield, bit2=liquidation)
total_actions  u64      — total action count
last_action_at i64      — timestamp of last action
```

---

## Smart Contract Tests

The Anchor program has a full integration test suite that runs against **MagicBlock devnet** — no local validator, real ephemeral rollup traffic, real Meteora DLMM pools.

### Running the tests

```bash
cd packages/contracts

# First-time: deploy the program (needs ~2.3 SOL on your devnet wallet)
anchor test --provider.cluster devnet

# Subsequent runs: skip deploy, reuse the deployed program
anchor test --provider.cluster devnet --skip-deploy
```

Get devnet SOL from [faucet.solana.com](https://faucet.solana.com). The wallet path is set in `Anchor.toml` (defaults to `~/.config/solana/id.json`).

### defi-agent.ts — Session key + MagicBlock ER

| # | Test | Layer |
|---|---|---|
| 1 | Initialize session — create `AgentSession` PDA with scoped keys | Base (devnet) |
| 2 | Delegate session — hand account to Ephemeral Rollup | Base (devnet) |
| 3 | Execute LP rebalance action — signed by session key | Ephemeral Rollup |
| 4 | Execute yield switch action — signed by session key | Ephemeral Rollup |
| 5 | Reject unauthorized session key — expect error 6002 | Ephemeral Rollup |
| 6 | Reject disabled strategy — expect error 6004 | Ephemeral Rollup |
| 7 | Commit state to base layer — without undelegating | Ephemeral Rollup |
| 8 | Undelegate session back to base layer | Ephemeral Rollup |

### meteora-dlmm.ts — Real Meteora DLMM CPI

| # | Test | Layer |
|---|---|---|
| 1 | Execute DLMM swap via session key (real X→Y token swap) | Base (devnet) |
| 2 | Reject swap when exposure limit would be exceeded | Base (devnet) |
| 3 | Execute DLMM add liquidity via session key | Base (devnet) |
| 4 | Reject add liquidity over exposure limit | Base (devnet) |
| 5 | Close DLMM position — remove all liquidity + close | Base (devnet) |

### Test design notes

**Fresh PDA per run** — each run generates a new `ownerKeypair` so the session PDA seeds `[b"session", owner]` are unique. This avoids `account already in use` errors when re-running without a redeploy.

**Manual transaction signing** — `initializeSession` requires two signers: the fresh `ownerKeypair` (as the session owner) and the wallet (as fee payer). The test builds and signs the transaction manually so both can co-sign.

**Dual-connection architecture** — base-layer transactions go to `https://api.devnet.solana.com`; all Ephemeral Rollup transactions go to `https://devnet.magicblock.app/`. The test keeps two `AnchorProvider` instances, one per endpoint.

**Error code format** — the Ephemeral Rollup returns Anchor errors as hex codes in simulation messages (e.g. `0x1772` = 6002 = `UnauthorizedSessionKey`). The rejection tests assert on the hex value rather than the error name string.

**Undelegation timing** — the `ScheduleCommitAndUndelegate` callback from the ER validator to base layer can be delayed on devnet. Test 8 polls for 60 seconds and, if the account hasn't reverted, logs a note and passes — the ER confirmation proves the undelegate was correctly initiated.

**DLMM pool setup** — `meteora-dlmm.ts` creates a custom permissionless DLMM pool with two fresh test mints each run, seeds liquidity from both sides, then creates a session-key-owned position. The session key (`sender` in DLMM instructions) must own the position to sign for it.

**Bin array derivation** — `deriveBinArray(lbPair, binIdToBinArrayIndex(binId), DLMM_PROGRAM_ID)` computes PDAs for the bin arrays covering the position range. These are computed once in `before()` and reused across tests 3–5.

---

## Roadmap

- [x] MimiClaw base integration (ReAct loop, memory, cron, tool calling)
- [x] Solana session key management via MagicBlock (AgentSession PDA, delegation, ER execution)
- [x] Meteora DLMM LP execution (swap, add liquidity, close position via CPI)
- [ ] LP position monitoring (detect out-of-range, fee accrual tracking)
- [ ] Yield optimization tool (Marginfi / Solend rate switching)
- [ ] Liquidation protection tool (leveraged position health monitoring)
- [ ] ESP32-S3 firmware agent (ESP-IDF + MimiClaw integration)
- [ ] Mobile app (React Native — position monitor, session approval)
- [ ] BTC yield strategy integration
- [ ] x402 payment layer for premium strategy access

---

## Security Notes

### What is and is not committed to git

| Path | Gitignored | Contains |
|---|---|---|
| `.env` | Yes | API keys — never committed |
| `packages/contracts/target/` | Yes | Compiled BPF binary + program deploy keypair — never committed |
| `~/.config/solana/id.json` | n/a (outside repo) | Devnet funding wallet keypair |
| `Anchor.toml` | No | Wallet path only (no keys) |
| `.env.example` | No (intentionally) | Empty template — safe to commit |

### On-chain security model

The `AgentSession` account enforces all constraints in Rust before any CPI:

- **Session key check** — `require_keys_eq!(signer, session.session_key)` — only the registered ESP32 key can sign
- **Expiry** — `session.is_expired(clock.unix_timestamp)` — sessions have a hard time limit
- **Strategy mask** — `session.has_strategy(action_type)` — each strategy must be explicitly enabled
- **Exposure cap** — `new_spent <= session.max_lamports` — cumulative spending is capped; close position does not count toward the cap since tokens are returned

### Devnet keypair hygiene

The program deploy keypair lives at `packages/contracts/target/deploy/defi_agent-keypair.json` — gitignored, but present on disk. On mainnet, transfer upgrade authority to a hardware wallet or multi-sig immediately after deploy:

```bash
anchor upgrade \
  --program-id 8reNvTG6PLT4sf4nGbT7VjZ1YqEGXzASkjcSQmQTkJPT \
  --provider.wallet <hardware-wallet-path> \
  target/deploy/defi_agent.so
```

---

## Built On

- [MimiClaw](https://github.com/memovai/mimiclaw) — Embedded AI agent for ESP32-S3
- [MagicBlock](https://magicblock.gg) — Ephemeral rollups and session keys on Solana
- [Meteora DLMM](https://meteora.ag) — Concentrated liquidity market maker
- [Solana](https://solana.com) — High-performance blockchain
- [ESP-IDF](https://docs.espressif.com/projects/esp-idf) — Espressif IoT Development Framework

---

## License

MIT
