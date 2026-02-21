/**
 * index.ts — Entry point for the DeFi agent.
 *
 * Starts the monitoring loop: runs one agent tick immediately, then repeats
 * every CHECK_INTERVAL_MS seconds. Each tick calls Claude (ReAct loop) which
 * reads the DLMM position off-chain and submits an on-chain update_lp_status.
 *
 * Usage:
 *   cp .env.example .env && edit .env
 *   pnpm start
 *
 * The agent prints structured output to stdout and appends decisions to
 * MEMORY.md — mirroring how MimiClaw persists memory to ESP32 SPIFFS flash.
 */

import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config";
import { buildSolanaContext } from "./solana";
import { runTick } from "./agent";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          hyperbiscus — DeFi Agent (laptop mode)          ║");
  console.log("║          Simulating MimiClaw ESP32-S3 agent              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const ctx = await buildSolanaContext(config);

  console.log(`\n[init] session key : ${config.sessionKeypair.publicKey.toBase58()}`);
  console.log(`[init] session PDA : ${config.sessionPda.toBase58()}`);
  console.log(`[init] monitor PDA : ${ctx.monitorPda.toBase58()}`);
  console.log(`[init] lb_pair     : ${config.lbPair.toBase58()}`);
  console.log(`[init] position    : ${config.positionPubkey.toBase58()}`);
  console.log(`[init] interval    : ${config.checkIntervalMs / 1000}s`);
  console.log(`[init] model       : ${config.claudeModel}`);
  console.log(`\n[agent] Starting monitoring loop...\n`);

  let tickNumber = 0;

  const tick = async () => {
    tickNumber++;
    try {
      await runTick(client, config, ctx, tickNumber);
    } catch (err: any) {
      console.error(`[tick ${tickNumber}] ERROR:`, err.message);
    }
  };

  // Run first tick immediately, then repeat on interval
  await tick();
  setInterval(tick, config.checkIntervalMs);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
