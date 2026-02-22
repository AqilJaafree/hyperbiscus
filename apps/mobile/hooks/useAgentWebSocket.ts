/**
 * useAgentWebSocket — bidirectional connection to the agent WebSocket server.
 *
 * Reconnects automatically on disconnect (2s backoff).
 * Provides:
 *   connected      — WS is currently open
 *   agentConfig    — static session config (from "connected" message)
 *   lastTick       — most recent monitoring tick
 *   history        — last 50 ticks (newest first)
 *   chatMessages   — full chat thread (user / agent / action messages)
 *   chatPending    — true while agent is thinking
 *   actionFlows    — map of actionId → steps[], updated live during action
 *   sendChat(msg)  — send a chat message to the agent
 *   sendAction(a)  — trigger an agent action (e.g. "add_liquidity")
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

export interface PositionSnapshot {
  activeBin: number;
  positionMinBin: number;
  positionMaxBin: number;
  isInRange: boolean;
  feeX: string;
  feeY: string;
}

export interface ChatMessage {
  role: "user" | "agent" | "action" | "position";
  message: string;
  timestamp: string;
  /** Present when role === "action" */
  actionId?: string;
  /** Present when role === "position" */
  position?: PositionSnapshot;
}

export interface ActionStep {
  actionId: string;
  step: number;
  total: number;
  label: string;
  status: "pending" | "success" | "error";
  txSignature?: string;
  txUrl?: string;
  detail?: string;
}

/** Map from actionId to the latest state of each step (keyed by step number) */
export type ActionFlows = Record<string, Record<number, ActionStep>>;


export function useAgentWebSocket(url: string, token: string = "") {
  const [connected, setConnected] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [lastTick, setLastTick] = useState<TickData | null>(null);
  const [history, setHistory] = useState<TickData[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [actionFlows, setActionFlows] = useState<ActionFlows>({});

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
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
            const deduped = prev.filter((t) => t.timestamp !== tick.timestamp);
            return [tick, ...deduped].slice(0, UI.MAX_HISTORY_ITEMS);
          });

        } else if (msg.type === "chat_thinking") {
          setChatPending(true);
          setStreamingText("");

        } else if (msg.type === "chat_token") {
          // First token arrives — hide spinner, start showing live text
          setChatPending(false);
          setStreamingText((prev) => prev + (msg.token as string));

        } else if (msg.type === "chat_response") {
          setChatPending(false);
          setStreamingText("");
          setChatMessages((prev) => {
            const next: ChatMessage[] = [
              ...prev,
              { role: "agent", message: msg.message, timestamp: msg.timestamp },
            ];
            if (msg.position) {
              next.push({
                role: "position",
                message: "",
                timestamp: msg.timestamp,
                position: msg.position,
              });
            }
            return next;
          });

        } else if (msg.type === "action_step") {
          const step: ActionStep = {
            actionId: msg.actionId,
            step: msg.step,
            total: msg.total,
            label: msg.label,
            status: msg.status,
            txSignature: msg.txSignature,
            txUrl: msg.txUrl,
            detail: msg.detail,
          };

          // Upsert into actionFlows map
          setActionFlows((prev) => ({
            ...prev,
            [step.actionId]: {
              ...(prev[step.actionId] ?? {}),
              [step.step]: step,
            },
          }));

          // On first step arriving, add an "action" entry to the chat thread.
          // Derive display label from actionId: "add_liq_1234" → "add_liquidity"
          if (step.step === 1 && step.status === "pending") {
            const actionLabel = step.actionId.startsWith("add_liq_")
              ? "add_liquidity"
              : step.actionId.replace(/_\d+$/, "");
            setChatMessages((prev) => [
              ...prev,
              {
                role: "action",
                message: actionLabel,
                timestamp: msg.timestamp,
                actionId: step.actionId,
              },
            ]);
          }
        }
      } catch {
        // ignore malformed messages
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
    setChatMessages((prev) => [
      ...prev,
      { role: "user", message, timestamp: new Date().toISOString() },
    ]);
    ws.send(JSON.stringify({ type: "chat", message }));
  }, []);

  const sendAction = useCallback((action: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "action", action }));
  }, []);

  return {
    connected,
    agentConfig,
    lastTick,
    history,
    chatMessages,
    chatPending,
    streamingText,
    actionFlows,
    sendChat,
    sendAction,
  };
}
