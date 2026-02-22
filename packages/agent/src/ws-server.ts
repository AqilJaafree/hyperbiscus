/**
 * ws-server.ts — Bidirectional WebSocket server on port 18789.
 *
 * Outbound (agent → mobile):
 *   "connected"     — static session config, sent on client connect
 *   "tick"          — live position data after every monitoring tick
 *   "chat_response" — Claude's reply to a user chat message
 *   "chat_thinking" — sent immediately when a chat message is received
 *
 * Inbound (mobile → agent):
 *   "chat"          — user message to send to the agent
 */

import { WebSocketServer, WebSocket } from "ws";
import { timingSafeEqual } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { AgentConfig } from "./config";
import { SolanaContext } from "./solana";
import { handleChat } from "./chat";
import { handleAddLiquidity, ActionStep } from "./actions";
import { PositionSnapshot } from "./tools";

export const WS_PORT = 18789;
const MAX_CHAT_MESSAGE_LENGTH = 4096; // characters — reject oversized payloads
const AUTH_TIMEOUT_MS = 5000;         // disconnect unauthenticated clients after this
const CHAT_RATE_LIMIT_MS = 3000;      // minimum ms between chat requests per connection

/** Constant-time string comparison — prevents timing oracle on WS_SECRET. */
function tokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Outbound message types ────────────────────────────────────────────────────

export interface ConnectedMessage {
  type: "connected";
  sessionPda: string;
  monitorPda: string;
  lbPair: string;
  positionPubkey: string;
  intervalMs: number;
}

export interface TickMessage {
  type: "tick";
  tickNumber: number;
  timestamp: string;
  activeBin: number | null;
  positionMinBin: number | null;
  positionMaxBin: number | null;
  isInRange: boolean | null;
  feeX: string | null;
  feeY: string | null;
  txSignature: string | null;
  explorerUrl: string | null;
  summary: string;
  error: string | null;
}

export interface ChatThinkingMessage {
  type: "chat_thinking";
}

export interface ChatTokenMessage {
  type: "chat_token";
  token: string;
}

export interface ChatResponseMessage {
  type: "chat_response";
  message: string;
  timestamp: string;
  position?: PositionSnapshot;
}

export interface ActionStepMessage extends ActionStep {
  type: "action_step";
  timestamp: string;
}

export type WsOutbound =
  | ConnectedMessage
  | TickMessage
  | ChatThinkingMessage
  | ChatTokenMessage
  | ChatResponseMessage
  | ActionStepMessage;

// ── Inbound message types ─────────────────────────────────────────────────────

export interface ChatInbound {
  type: "chat";
  message: string;
}

// ── Server ────────────────────────────────────────────────────────────────────

export function startWsServer(
  config: AgentConfig,
  ctx: SolanaContext,
  client: Anthropic,
): {
  broadcast: (msg: TickMessage) => void;
  getLastTick: () => TickMessage | null;
  setLastTick: (tick: TickMessage) => void;
} {
  const wss = new WebSocketServer({ host: config.wsHost, port: WS_PORT, maxPayload: 64 * 1024 }); // 64 KB max frame
  let lastTick: TickMessage | null = null;

  const connectedPayload: ConnectedMessage = {
    type: "connected",
    sessionPda: config.sessionPda.toBase58(),
    monitorPda: ctx.monitorPda.toBase58(),
    lbPair: config.lbPair.toBase58(),
    positionPubkey: config.positionPubkey.toBase58(),
    intervalMs: config.checkIntervalMs,
  };

  function send(ws: WebSocket, msg: WsOutbound) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcastAll(msg: WsOutbound) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // Track which connections have passed auth
  const authenticated = new WeakSet<WebSocket>();
  // Per-connection chat state: busy flag and rate-limit timestamp
  const chatBusy = new WeakSet<WebSocket>();
  const chatCooldown = new WeakMap<WebSocket, number>();
  // Global action lock — prevents concurrent add_liquidity executions
  let actionInFlight = false;

  const secret = config.wsSecret;
  if (!secret) {
    console.warn(
      "[ws] WARNING: WS_SECRET is not set — server accepts unauthenticated connections. " +
      "Set WS_SECRET in .env for LAN or internet-exposed deployments.",
    );
  }

  function isAuthenticated(ws: WebSocket): boolean {
    return !secret || authenticated.has(ws);
  }

  function authorizeAndGreet(ws: WebSocket): void {
    authenticated.add(ws);
    send(ws, connectedPayload);
    if (lastTick) send(ws, lastTick);
  }

  wss.on("connection", (ws) => {
    console.log(`[ws] client connected (total: ${wss.clients.size})`);

    if (!secret) {
      // No secret configured — open access (dev mode)
      authorizeAndGreet(ws);
    } else {
      // Require auth token within 5 s or disconnect
      const authTimeout = setTimeout(() => {
        if (!authenticated.has(ws)) {
          console.warn("[ws] auth timeout — closing unauthenticated connection");
          ws.close(1008, "auth timeout");
        }
      }, AUTH_TIMEOUT_MS);
      ws.on("close", () => clearTimeout(authTimeout));
    }

    ws.on("message", async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Handle auth handshake — ignore if already authenticated
      if (msg.type === "auth") {
        if (authenticated.has(ws)) return;
        if (secret && typeof msg.token === "string" && tokenEqual(msg.token, secret)) {
          authorizeAndGreet(ws);
        } else {
          console.warn("[ws] invalid auth token — closing connection");
          ws.close(1008, "unauthorized");
        }
        return;
      }

      // Reject all other messages from unauthenticated clients
      if (!isAuthenticated(ws)) {
        ws.close(1008, "unauthorized");
        return;
      }

      if (msg.type === "chat" && typeof msg.message === "string") {
        const userMessage = msg.message.trim();
        if (!userMessage || userMessage.length > MAX_CHAT_MESSAGE_LENGTH) return;

        // Rate limit: reject if another chat is in progress or cooldown hasn't elapsed
        if (chatBusy.has(ws)) {
          console.warn("[chat] rejected — previous request still in progress");
          return;
        }
        const cooldownUntil = chatCooldown.get(ws) ?? 0;
        if (Date.now() < cooldownUntil) {
          console.warn(`[chat] rejected — rate limited (${Math.ceil((cooldownUntil - Date.now()) / 1000)}s remaining)`);
          return;
        }

        chatBusy.add(ws);
        chatCooldown.set(ws, Date.now() + CHAT_RATE_LIMIT_MS);

        // Log truncated — never log full user message content
        console.log(`[chat] user (${userMessage.length} chars)`);

        // Tell mobile the agent is thinking
        broadcastAll({ type: "chat_thinking" });

        try {
          let positionSnapshot: PositionSnapshot | undefined;
          const reply = await handleChat(
            client,
            config,
            ctx,
            userMessage,
            lastTick,
            (token) => send(ws, { type: "chat_token", token }),
            (snap) => { positionSnapshot = snap; },
          );
          console.log(`[chat] agent replied (${reply.length} chars)`);
          broadcastAll({
            type: "chat_response",
            message: reply,
            timestamp: new Date().toISOString(),
            ...(positionSnapshot ? { position: positionSnapshot } : {}),
          });
        } catch (err: any) {
          console.error("[chat] error:", err.message);
          broadcastAll({
            type: "chat_response",
            message: `Error: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
        } finally {
          chatBusy.delete(ws);
        }
      }

      if (msg.type === "action" && typeof msg.action === "string") {
        console.log(`[action] ${msg.action}`);
        if (msg.action === "add_liquidity") {
          // Concurrency guard — reject if an action is already in flight
          if (actionInFlight) {
            console.warn("[action] rejected — add_liquidity already in progress");
            return;
          }
          actionInFlight = true;
          handleAddLiquidity(config, ctx, (step) => {
            const out: ActionStepMessage = {
              type: "action_step",
              timestamp: new Date().toISOString(),
              ...step,
            };
            console.log(`[action] step ${step.step}/${step.total} [${step.status}] ${step.label}`);
            broadcastAll(out);
          }).catch((err) => {
            console.error("[action] unhandled error:", err.message);
          }).finally(() => {
            actionInFlight = false;
          });
        }
      }
    });

    ws.on("close", () => {
      console.log(`[ws] client disconnected (total: ${wss.clients.size})`);
    });
  });

  wss.on("listening", () => {
    console.log(`[ws] server listening on ws://${config.wsHost}:${WS_PORT}`);
  });

  return {
    broadcast(tick: TickMessage) {
      lastTick = tick;
      broadcastAll(tick);
    },
    getLastTick: () => lastTick,
    setLastTick: (tick) => { lastTick = tick; },
  };
}
