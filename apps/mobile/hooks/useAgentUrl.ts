/**
 * useAgentUrl — persist and retrieve the agent WebSocket URL.
 * Defaults to localhost for simulator testing.
 */

import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WEBSOCKET } from "@/constants/config";

export function useAgentUrl() {
  const [url, setUrlState] = useState<string>(WEBSOCKET.DEFAULT_URL);
  const [token, setTokenState] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const [storedUrl, storedToken] = await Promise.all([
      AsyncStorage.getItem(WEBSOCKET.STORAGE_KEY),
      AsyncStorage.getItem(WEBSOCKET.TOKEN_STORAGE_KEY),
    ]);
    if (storedUrl) setUrlState(storedUrl);
    if (storedToken) setTokenState(storedToken);
    setLoaded(true);
  }

  useEffect(() => {
    reload();
  }, []);

  async function setUrl(newUrl: string) {
    setUrlState(newUrl);
    await AsyncStorage.setItem(WEBSOCKET.STORAGE_KEY, newUrl);
  }

  async function setToken(newToken: string) {
    setTokenState(newToken);
    await AsyncStorage.setItem(WEBSOCKET.TOKEN_STORAGE_KEY, newToken);
  }

  return { url, setUrl, token, setToken, loaded, reload };
}
