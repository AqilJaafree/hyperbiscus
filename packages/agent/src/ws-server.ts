/**
 * ws-server.ts — WebSocket server broadcasting agent tick data to the mobile app.
 *
 * Runs on port 18789 (matching the MimiClaw ESP32 WebSocket server port).
 * Mobile connects via: ws://<laptop-ip>:18789
 *
 * Messages:
 *   → "connected"  — sent on client connect; includes static session config
 *   → "tick"       — sent after every agent tick; includes live position data
 */

import { WebSocketServer, WebSocket } from "ws";
import { AgentConfig } from "./config";
import { SolanaContext } from "./solana";

export const WS_PORT = 18789;

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

export type WsMessage = ConnectedMessage | TickMessage;

export function startWsServer(config: AgentConfig, ctx: SolanaContext): {
  broadcast: (msg: TickMessage) => void;
} {
  const wss = new WebSocketServer({ port: WS_PORT });

  const connectedPayload: ConnectedMessage = {
    type: "connected",
    sessionPda: config.sessionPda.toBase58(),
    monitorPda: ctx.monitorPda.toBase58(),
    lbPair: config.lbPair.toBase58(),
    positionPubkey: config.positionPubkey.toBase58(),
    intervalMs: config.checkIntervalMs,
  };

  wss.on("connection", (ws) => {
    console.log(`[ws] client connected (total: ${wss.clients.size})`);
    ws.send(JSON.stringify(connectedPayload));

    ws.on("close", () => {
      console.log(`[ws] client disconnected (total: ${wss.clients.size})`);
    });
  });

  wss.on("listening", () => {
    console.log(`[ws] server listening on ws://localhost:${WS_PORT}`);
  });

  function broadcast(msg: TickMessage) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  return { broadcast };
}
