/**
 * useAgentWebSocket — connects to the agent WebSocket server and delivers
 * live tick data to the UI.
 *
 * Reconnects automatically on disconnect (2s backoff).
 * Provides:
 *   connected    — whether the WS is currently open
 *   config       — static session config (from "connected" message)
 *   lastTick     — most recent tick payload
 *   history      — last 50 ticks (newest first)
 */

import { useState, useEffect, useRef, useCallback } from "react";

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

const MAX_HISTORY = 50;
const RECONNECT_DELAY_MS = 2000;

export function useAgentWebSocket(url: string) {
  const [connected, setConnected] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [lastTick, setLastTick] = useState<TickData | null>(null);
  const [history, setHistory] = useState<TickData[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
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
          setHistory((prev) => [tick, ...prev].slice(0, MAX_HISTORY));
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return { connected, agentConfig, lastTick, history };
}
