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
  const wss = new WebSocketServer({ port: WS_PORT });
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

  wss.on("connection", (ws) => {
    console.log(`[ws] client connected (total: ${wss.clients.size})`);

    // Send static config immediately
    send(ws, connectedPayload);

    // Send last tick so client has data right away
    if (lastTick) send(ws, lastTick);

    ws.on("message", async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "chat" && typeof msg.message === "string") {
        const userMessage = msg.message.trim();
        if (!userMessage) return;

        console.log(`[chat] user: ${userMessage}`);

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
          console.log(`[chat] agent: ${reply.slice(0, 80)}...`);
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
