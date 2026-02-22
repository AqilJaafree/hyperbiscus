/**
 * config.ts — Load and validate agent configuration from environment.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function loadKeypair(filePath: string): Keypair {
  // Canonicalize: expand ~ then resolve to an absolute path
  const resolved = path.resolve(filePath.replace(/^~(?=\/|$)/, os.homedir()));
  // Allowlist: keypair must live within the user's home directory
  const homeDir = os.homedir();
  if (!resolved.startsWith(homeDir + path.sep) && resolved !== homeDir) {
    throw new Error(
      `SESSION_KEYPAIR_PATH must be within your home directory.\n` +
      `  Resolved path: ${resolved}\n` +
      `  Home directory: ${homeDir}`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export interface AgentConfig {
  anthropicApiKey: string;
  rpcUrl: string;
  sessionKeypair: Keypair;
  sessionPda: PublicKey;
  lbPair: PublicKey;
  positionPubkey: PublicKey;
  checkIntervalMs: number;
  claudeModel: string;
  /** Optional shared secret for WebSocket auth. If set, clients must send { type:"auth", token } first. */
  wsSecret: string | null;
  /** WebSocket server bind host. Default: 0.0.0.0 (all interfaces). Set to 127.0.0.1 for localhost-only. */
  wsHost: string;
  /** MagicBlock Ephemeral Rollup RPC endpoint for ER transactions. */
  magicblockRpcUrl: string;
}

export function loadConfig(): AgentConfig {
  return {
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    sessionKeypair: loadKeypair(required("SESSION_KEYPAIR_PATH")),
    sessionPda: new PublicKey(required("SESSION_PDA")),
    lbPair: new PublicKey(required("LB_PAIR")),
    positionPubkey: new PublicKey(required("POSITION_PUBKEY")),
    checkIntervalMs: (() => {
      const v = parseInt(process.env.CHECK_INTERVAL_MS ?? "30000", 10);
      if (!Number.isFinite(v) || v < 5000 || v > 3_600_000) {
        throw new Error("CHECK_INTERVAL_MS must be a number between 5000 and 3600000");
      }
      return v;
    })(),
    claudeModel: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001",
    wsSecret: process.env.WS_SECRET ?? null,
    wsHost: process.env.WS_HOST ?? "0.0.0.0",
    magicblockRpcUrl:
      process.env.MAGICBLOCK_RPC_URL ?? "https://devnet.magicblock.app/",
  };
}
