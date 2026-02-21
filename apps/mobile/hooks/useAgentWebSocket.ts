/**
 * useAgentWebSocket — bidirectional connection to the agent WebSocket server.
 *
 * Reconnects automatically on disconnect (2s backoff).
 * Provides:
 *   connected      — WS is currently open
 *   agentConfig    — static session config (from "connected" message)
 *   lastTick       — most recent monitoring tick
 *   history        — last 50 ticks (newest first)
 *   chatMessages   — full chat thread (user + agent messages)
 *   chatPending    — true while agent is thinking
 *   sendChat(msg)  — send a message to the agent
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { UI, WEBSOCKET } from "@/constants/config";

export interface AgentConfig {
  sessionPda: string;
  monitorPda: string;
  lbPair: string;
  positionPubkey: string;
  intervalMs: number;
}

export interface TickData {
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

export interface ChatMessage {
  role: "user" | "agent";
  message: string;
  timestamp: string;
}


export function useAgentWebSocket(url: string, token: string = "") {
  const [connected, setConnected] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [lastTick, setLastTick] = useState<TickData | null>(null);
  const [history, setHistory] = useState<TickData[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatPending, setChatPending] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
      // Send auth token if configured — server expects this as first message
      if (token) ws.send(JSON.stringify({ type: "auth", token }));
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onmessage = (event) => {
      if (unmounted.current) return;
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === "connected") {
          setAgentConfig({
            sessionPda: msg.sessionPda,
            monitorPda: msg.monitorPda,
            lbPair: msg.lbPair,
            positionPubkey: msg.positionPubkey,
            intervalMs: msg.intervalMs,
          });

        } else if (msg.type === "tick") {
          const tick: TickData = {
            tickNumber: msg.tickNumber,
            timestamp: msg.timestamp,
            activeBin: msg.activeBin,
            positionMinBin: msg.positionMinBin,
            positionMaxBin: msg.positionMaxBin,
            isInRange: msg.isInRange,
            feeX: msg.feeX,
            feeY: msg.feeY,
            txSignature: msg.txSignature,
            explorerUrl: msg.explorerUrl,
            summary: msg.summary,
            error: msg.error,
          };
          setLastTick(tick);
          setHistory((prev) => {
            // deduplicate by timestamp to avoid key collisions on reconnect
            const deduped = prev.filter((t) => t.timestamp !== tick.timestamp);
            return [tick, ...deduped].slice(0, UI.MAX_HISTORY_ITEMS);
          });

        } else if (msg.type === "chat_thinking") {
          setChatPending(true);

        } else if (msg.type === "chat_response") {
          setChatPending(false);
          setChatMessages((prev) => [
            ...prev,
            {
              role: "agent",
              message: msg.message,
              timestamp: msg.timestamp,
            },
          ]);
        }
      } catch {
        // ignore malformed
      }
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setConnected(false);
      setChatPending(false);
      reconnectTimer.current = setTimeout(connect, WEBSOCKET.RECONNECT_DELAY_MS);
    };

    ws.onerror = () => { ws.close(); };
  }, [url, token]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const sendChat = useCallback((message: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Optimistically add user message to thread
    setChatMessages((prev) => [
      ...prev,
      { role: "user", message, timestamp: new Date().toISOString() },
    ]);

    ws.send(JSON.stringify({ type: "chat", message }));
  }, []);

  return {
    connected,
    agentConfig,
    lastTick,
    history,
    chatMessages,
    chatPending,
    sendChat,
  };
}
