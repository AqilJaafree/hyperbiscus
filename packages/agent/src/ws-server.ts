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
import Anthropic from "@anthropic-ai/sdk";
import { AgentConfig } from "./config";
import { SolanaContext } from "./solana";
import { handleChat } from "./chat";

export const WS_PORT = 18789;

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

export interface ChatResponseMessage {
  type: "chat_response";
  message: string;
  timestamp: string;
}

export type WsOutbound =
  | ConnectedMessage
  | TickMessage
  | ChatThinkingMessage
  | ChatResponseMessage;

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
  const wss = new WebSocketServer({ port: WS_PORT, maxPayload: 64 * 1024 }); // 64 KB max frame
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
  const secret = config.wsSecret;

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
      }, 5000);
      ws.on("close", () => clearTimeout(authTimeout));
    }

    ws.on("message", async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Handle auth handshake
      if (msg.type === "auth") {
        if (secret && msg.token === secret) {
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
        if (!userMessage || userMessage.length > 4096) return;

        // Log truncated — never log full user message content
        console.log(`[chat] user (${userMessage.length} chars)`);

        // Tell mobile the agent is thinking
        broadcastAll({ type: "chat_thinking" });

        try {
          const reply = await handleChat(
            client,
            config,
            ctx,
            userMessage,
            lastTick,
          );
          console.log(`[chat] agent replied (${reply.length} chars)`);
          broadcastAll({
            type: "chat_response",
            message: reply,
            timestamp: new Date().toISOString(),
          });
        } catch (err: any) {
          console.error("[chat] error:", err.message);
          broadcastAll({
            type: "chat_response",
            message: `Error: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    ws.on("close", () => {
      console.log(`[ws] client disconnected (total: ${wss.clients.size})`);
    });
  });

  wss.on("listening", () => {
    console.log(`[ws] server listening on ws://localhost:${WS_PORT}`);
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
