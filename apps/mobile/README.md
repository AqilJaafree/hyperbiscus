# @hyperbiscus/mobile

React Native companion app for the hyperbiscus DeFi agent. Streams live LP position data from the agent over WebSocket and provides a chat interface to talk to the Claude-powered monitoring agent.

Built with **Expo SDK 54** · **expo-router v6** · **React 19** · **React Native 0.81**

---

## Screens

| Tab | Route | Description |
|---|---|---|
| Chat | `/` (index) | Bidirectional chat with the agent; live streaming responses; action flow cards with TX links |
| Position | `/position` | Live LP position dashboard — range meter, fee cards, tick history, add-liquidity action |
| Skills | `/marketplace` | DeFi protocol integrations (Meteora DLMM active; Orca, Raydium, Jupiter coming soon) |
| Settings | `/settings` | Configure WebSocket URL and auth token; connection status indicator |

---

## Setup

### 1. Prerequisites

- Node.js 20+ and pnpm
- Expo CLI: `npm install -g expo-cli` (or use `npx expo`)
- For physical device: **Expo Go** app installed, on the same LAN as the agent laptop
- For Android emulator: Android Studio + AVD with API 33+
- For iOS simulator: Xcode 15+ (macOS only)

### 2. Install dependencies

```bash
# From the monorepo root
pnpm install

# Or from this directory
pnpm install
```

### 3. Start the agent first

The mobile app connects to the agent WebSocket. Start the agent before launching the app:

```bash
pnpm --filter @hyperbiscus/agent start
```

Note your laptop's LAN IP — you will need it in the Settings tab:

```bash
ip addr | grep 192.168
# → inet 192.168.1.42/24 ...
```

### 4. Start the app

```bash
# From monorepo root
pnpm --filter @hyperbiscus/mobile dev

# Or from this directory
pnpm dev
```

Scan the QR code with **Expo Go** (Android/iOS) or press `a` for Android emulator / `i` for iOS simulator.

---

## Connecting to the agent

1. Open the **Settings** tab
2. Tap **Show** next to "Agent WebSocket URL"
3. Enter `ws://192.168.x.x:18789` (your laptop's LAN IP)
4. If `WS_SECRET` is set in the agent `.env`, enter the same value in **Auth Token**
5. Tap **Save & Connect**

The connection status dot (green/red) in the tab bar and Settings screen updates in real time. The app reconnects automatically with a 2-second backoff on disconnect.

---

## Project structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx        # Tab navigator + AgentProvider root
│   ├── index.tsx          # Chat screen
│   ├── position.tsx       # LP position dashboard
│   ├── marketplace.tsx    # Skills marketplace
│   └── settings.tsx       # WebSocket configuration
├── context/
│   └── AgentContext.tsx   # React context wrapping useAgentWebSocket
├── hooks/
│   └── useAgentWebSocket.ts  # WebSocket state machine + message parsing
├── constants/
│   ├── config.ts          # UI + WebSocket constants
│   └── theme.ts           # Color palette
└── utils/
    └── time.ts            # formatTime, timeAgo, shortKey helpers
```

---

## WebSocket message handling

`useAgentWebSocket` (in `hooks/`) manages the full connection lifecycle:

- **`connected`** — session config arrives on connect; updates `agentConfig`
- **`tick`** — updates `lastTick` and appends to `history` (capped at 50)
- **`chat_thinking`** — sets `chatPending = true`, clears `streamingText`
- **`chat_token`** — streams Claude tokens into `streamingText` live
- **`chat_response`** — finalizes the message; optionally appends a position card if `check_lp_position` was called
- **`action_step`** — upserts into `actionFlows` map; adds an action card to chat on step 1

---

## Development notes

- **Safe area**: Screens use `SafeAreaView edges={[]}` — the tab bar handles the bottom inset natively, so screens must not double-count it
- **Keyboard avoiding**: Chat screen uses `behavior="padding"` on both iOS and Android
- **Markdown stripping**: Agent replies are passed through `stripMarkdown()` before render — Claude is instructed to use plain text but this is a belt-and-suspenders guard
- **URL validation**: `Linking.openURL` calls in Position and Settings are guarded — only `https://explorer.solana.com/tx/` URLs are opened from position data
