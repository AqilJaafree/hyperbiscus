/**
 * helpers.ts — shared constants and utilities for the defi-agent test suite.
 *
 * Mirrors the on-chain constants from programs/defi-agent/src/state/agent_session.rs
 * so the two sources stay in sync.
 */

// ── Strategy bitmask constants ─────────────────────────────────────────────────
export const STRATEGY_LP           = 1 << 0; // Concentrated LP rebalancing
export const STRATEGY_YIELD        = 1 << 1; // Lending yield switching
export const STRATEGY_LIQUIDATION  = 1 << 2; // Leveraged position protection

// ── RPC endpoints ─────────────────────────────────────────────────────────────
export const BASE_RPC =
  process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
export const ER_RPC =
  process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? "https://devnet.magicblock.app/";
export const ER_WS =
  process.env.EPHEMERAL_WS_ENDPOINT ?? "wss://devnet.magicblock.app/";

// ── Utilities ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
