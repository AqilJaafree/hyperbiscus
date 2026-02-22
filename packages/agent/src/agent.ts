/**
 * agent.ts — API-free monitoring tick.
 *
 * No Claude API calls per tick. The logic is fully deterministic:
 *   1. Read LP position state from Solana RPC (no TX)
 *   2. Submit on-chain status checkpoint (session key signs)
 *   3. Build a simple summary string
 *   4. Append summary to MEMORY.md (provides context for chat)
 *
 * Claude is only invoked for user-initiated chat messages (see chat.ts).
 * This matches the intended ESP32-S3 architecture where the microcontroller
 * runs the monitoring loop in C without any LLM API calls.
 */

import { checkLpPosition } from "@hyperbiscus/shared";
import { AgentConfig } from "./config";
import { DELEGATION_PROGRAM_ID } from "./constants";
import { SolanaContext, submitUpdateLpStatus } from "./solana";
import { TickMessage } from "./ws-server";
import { appendMemory } from "./memory";

export async function runTick(
  config: AgentConfig,
  ctx: SolanaContext,
  tickNumber: number,
): Promise<TickMessage> {
  const timestamp = new Date().toISOString();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`[tick ${tickNumber}] ${timestamp}`);
  console.log(`${"─".repeat(60)}`);

  // 1. Read current LP position from Solana RPC — no API call
  const status = await checkLpPosition(
    ctx.connection,
    config.lbPair,
    config.positionPubkey,
    "devnet",
  );

  const { activeBin, positionMinBin, positionMaxBin, isInRange, feeX, feeY } =
    status;

  console.log(
    `  position: bin ${activeBin} in [${positionMinBin}, ${positionMaxBin}]` +
      ` → ${isInRange ? "IN RANGE ✓" : "OUT OF RANGE ⚠"}`,
  );
  console.log(`  fees: X=${feeX.toString()} Y=${feeY.toString()}`);

  // 2. Submit on-chain checkpoint — skip if session is still delegated to ER
  let sig: string | null = null;
  const sessionInfo = await ctx.connection.getAccountInfo(config.sessionPda);
  const isDelegated = sessionInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;

  if (isDelegated) {
    console.log(`  [skip] session still delegated to MagicBlock ER — skipping update_lp_status`);
  } else {
    sig = await submitUpdateLpStatus(ctx, activeBin, feeX, feeY);
    console.log(`  tx: ${sig}`);
  }

  // 3. Build a deterministic summary and persist to MEMORY.md
  //    (last 30 entries are fed to Claude as context when the user chats)
  const rangeLabel = isInRange ? "in range" : "OUT OF RANGE";
  const delegatedNote = isDelegated ? " [ER delegated — checkpoint skipped]" : "";
  const summary =
    `Tick #${tickNumber}: bin ${activeBin} ${rangeLabel}` +
    ` [${positionMinBin}–${positionMaxBin}],` +
    ` fees X=${feeX.toString()} Y=${feeY.toString()}${delegatedNote}.`;

  appendMemory(summary);
  console.log(`  [agent] ${summary}`);

  return {
    type: "tick",
    tickNumber,
    timestamp,
    activeBin,
    positionMinBin,
    positionMaxBin,
    isInRange,
    feeX: feeX.toString(),
    feeY: feeY.toString(),
    txSignature: sig,
    explorerUrl: sig ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : null,
    summary,
    error: null,
  };
}
