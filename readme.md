# 🤖 DeFi Agent Hardware — Autonomous Yield on Solana

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
│   Jupiter · Kamino · Marginfi · Drift            │
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
| **Solana** | Settlement + DeFi ecosystem | Full composability with Jupiter, Kamino, Marginfi, Drift |

---

## Key Features

- **Physical key custody** — session keys never leave the device, no cloud server to hack
- **Truly autonomous** — agent schedules and executes its own tasks via cron, no user intervention
- **High-frequency ready** — MagicBlock sub-100ms execution handles LP rebalancing, yield switching, liquidation protection
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

## Roadmap

- [x] MimiClaw base integration (ReAct loop, memory, cron, tool calling)
- [ ] Solana session key management via MagicBlock
- [ ] LP position monitoring tool (Kamino / Orca)
- [ ] Yield optimization tool (Marginfi / Solend rate switching)
- [ ] Liquidation protection tool
- [ ] Mobile app (React Native)
- [ ] BTC yield strategy integration
- [ ] x402 payment layer for premium strategy access

---

## Built On

- [MimiClaw](https://github.com/memovai/mimiclaw) — Embedded AI agent for ESP32-S3
- [MagicBlock](https://magicblock.gg) — Ephemeral rollups and session keys on Solana
- [Solana](https://solana.com) — High-performance blockchain
- [ESP-IDF](https://docs.espressif.com/projects/esp-idf) — Espressif IoT Development Framework

---

## License

MIT