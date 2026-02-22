/**
 * AgentContext — shared WebSocket state across all tabs.
 *
 * A single WS connection is opened at the app level and shared via context,
 * so switching tabs never drops/restarts the connection.
 */

import { createContext, useContext, ReactNode, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  useAgentWebSocket,
  AgentConfig,
  TickData,
  ChatMessage,
  ActionFlows,
} from "@/hooks/useAgentWebSocket";
import { useAgentUrl } from "@/hooks/useAgentUrl";

export interface AgentContextValue {
  // WebSocket state
  connected: boolean;
  agentConfig: AgentConfig | null;
  lastTick: TickData | null;
  history: TickData[];
  chatMessages: ChatMessage[];
  chatPending: boolean;
  streamingText: string;
  actionFlows: ActionFlows;
  sendChat: (msg: string) => void;
  sendAction: (action: string) => void;
  // URL / token management
  url: string;
  setUrl: (url: string) => Promise<void>;
  token: string;
  setToken: (token: string) => Promise<void>;
  reload: () => Promise<void>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const { url, setUrl, token, setToken, reload } = useAgentUrl();
  const ws = useAgentWebSocket(url, token);

  return (
    <AgentContext.Provider value={{ ...ws, url, setUrl, token, setToken, reload }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}

/**
 * Call in any tab screen to reload the URL from AsyncStorage on focus.
 * Needed so Settings changes propagate to the WS connection immediately.
 */
export function useReloadOnFocus() {
  const { reload } = useAgent();
  useFocusEffect(useCallback(() => { reload(); }, []));
}
