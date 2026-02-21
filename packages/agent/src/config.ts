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
  const resolved = filePath.replace("~", os.homedir());
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
}

export function loadConfig(): AgentConfig {
  return {
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    sessionKeypair: loadKeypair(required("SESSION_KEYPAIR_PATH")),
    sessionPda: new PublicKey(required("SESSION_PDA")),
    lbPair: new PublicKey(required("LB_PAIR")),
    positionPubkey: new PublicKey(required("POSITION_PUBKEY")),
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS ?? "30000"),
    claudeModel: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001",
    wsSecret: process.env.WS_SECRET ?? null,
  };
}
