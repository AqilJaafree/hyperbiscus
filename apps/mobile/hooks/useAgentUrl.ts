/**
 * useAgentUrl — persist and retrieve the agent WebSocket URL.
 * Defaults to localhost for simulator testing.
 */

import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@hyperbiscus/agent-url";
export const DEFAULT_URL = "ws://localhost:18789";

export function useAgentUrl() {
  const [url, setUrlState] = useState<string>(DEFAULT_URL);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((stored) => {
      if (stored) setUrlState(stored);
      setLoaded(true);
    });
  }, []);

  async function setUrl(newUrl: string) {
    setUrlState(newUrl);
    await AsyncStorage.setItem(KEY, newUrl);
  }

  return { url, setUrl, loaded };
}
