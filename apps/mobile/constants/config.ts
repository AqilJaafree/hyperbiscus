/**
 * App-wide configuration constants
 */

export const WEBSOCKET = {
  DEFAULT_URL: "ws://localhost:18789",
  RECONNECT_DELAY_MS: 2000,
  STORAGE_KEY: "@hyperbiscus/agent-url",
  TOKEN_STORAGE_KEY: "@hyperbiscus/agent-token",
  AUTH_TIMEOUT_MS: 5000,
} as const;

export const UI = {
  MAX_HISTORY_ITEMS: 50,
  SCROLL_DELAY_MS: 100,
  KEYBOARD_OFFSET_IOS: 90,
} as const;
