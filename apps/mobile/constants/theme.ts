/**
 * Shared design tokens for the hyperbiscus mobile app.
 * Dark-mode focused DeFi aesthetic.
 */

export const colors = {
  bg: "#0a0a0a",
  card: "#141414",
  border: "#2a2a2a",
  green: "#00d97e",
  red: "#ff4d4f",
  text: "#e0e0e0",
  muted: "#888",
  dim: "#555",

  // Chat-specific
  user: "#00d97e",
  agent: "#1e1e1e",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const borderRadius = {
  sm: 10,
  md: 12,
  lg: 14,
  xl: 20,
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 15,
  xl: 16,
  xxl: 20,
  xxxl: 28,
} as const;

/**
 * Add alpha transparency to hex color
 * @example withAlpha(colors.green, 0.1) => "#00d97e1a"
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}
