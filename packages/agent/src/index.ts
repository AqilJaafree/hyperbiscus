/**
 * index.ts — Entry point for the DeFi agent.
 *
 * Starts the WebSocket server on port 18789, then runs the monitoring loop:
 * one agent tick immediately, then repeating every CHECK_INTERVAL_MS seconds.
 * Each tick result is broadcast to all connected WebSocket clients (mobile app).
 *
 * Usage:
 *   cp .env.example .env && edit .env
 *   pnpm start
 */

import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config";
import { buildSolanaContext } from "./solana";
import { runTick } from "./agent";
import { startWsServer, WS_PORT } from "./ws-server";

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
  console.log(`[init] magicblock  : ${config.magicblockRpcUrl}`);

  // Start WebSocket server — mobile app connects here
  const { broadcast } = startWsServer(config, ctx, client);
  console.log(`[init] websocket   : ws://localhost:${WS_PORT}`);
  console.log(`\n[agent] Starting monitoring loop...\n`);

  let tickNumber = 0;

  const tick = async () => {
    tickNumber++;
    try {
      const result = await runTick(config, ctx, tickNumber);
      broadcast(result);
    } catch (err: any) {
      console.error(`[tick ${tickNumber}] ERROR:`, err.message);
      broadcast({
        type: "tick",
        tickNumber,
        timestamp: new Date().toISOString(),
        activeBin: null,
        positionMinBin: null,
        positionMaxBin: null,
        isInRange: null,
        feeX: null,
        feeY: null,
        txSignature: null,
        explorerUrl: null,
        summary: "",
        error: err.message,
      });
    }
  };

  await tick();
  setInterval(tick, config.checkIntervalMs);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
