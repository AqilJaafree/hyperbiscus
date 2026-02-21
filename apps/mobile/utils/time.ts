/**
 * Time formatting utilities
 */

/**
 * Format ISO timestamp as "Xs ago" / "Xm ago" / "Xh ago"
 */
export function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Format ISO timestamp as "HH:MM" time string
 */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Shorten a Solana public key to "AAAA…ZZZZ"
 */
export function shortKey(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
