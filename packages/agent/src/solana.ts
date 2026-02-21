/**
 * solana.ts — Solana connection, Anchor program setup, and transaction helpers.
 *
 * The agent uses base-layer devnet throughout — update_lp_status is a base-layer
 * instruction (DLMM pool accounts are not delegated to the ER).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import * as path from "path";
import { AgentConfig } from "./config";

const PROGRAM_ID = new PublicKey("8reNvTG6PLT4sf4nGbT7VjZ1YqEGXzASkjcSQmQTkJPT");

export interface SolanaContext {
  connection: Connection;
  program: anchor.Program;
  monitorPda: PublicKey;
  config: AgentConfig;
}

export async function buildSolanaContext(config: AgentConfig): Promise<SolanaContext> {
  const connection = new Connection(config.rpcUrl, "confirmed");

  // Load IDL from contracts package (monorepo sibling)
  const idlPath = path.resolve(
    __dirname,
    "../../contracts/target/idl/defi_agent.json",
  );
  const idl = require(idlPath);

  // Build a minimal wallet from the session keypair for the provider
  const wallet = new anchor.Wallet(config.sessionKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);

  // Derive monitor PDA from session PDA
  const [monitorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_monitor"), config.sessionPda.toBuffer()],
    PROGRAM_ID,
  );

  return { connection, program, monitorPda, config };
}

/**
 * Submit an update_lp_status instruction to base-layer devnet.
 * Signed by the session keypair (the "ESP32 key").
 */
export async function submitUpdateLpStatus(
  ctx: SolanaContext,
  activeBin: number,
  feeX: BN,
  feeY: BN,
): Promise<string> {
  const { program, config, monitorPda } = ctx;

  const tx = await program.methods
    .updateLpStatus(activeBin, feeX, feeY)
    .accounts({
      sessionKey: config.sessionKeypair.publicKey,
      session: config.sessionPda,
      monitor: monitorPda,
    })
    .transaction();

  tx.feePayer = config.sessionKeypair.publicKey;
  tx.recentBlockhash = (
    await ctx.connection.getLatestBlockhash()
  ).blockhash;

  const sig = await sendAndConfirmTransaction(
    ctx.connection,
    tx,
    [config.sessionKeypair],
    { commitment: "confirmed", skipPreflight: true },
  );

  // Verify the TX didn't fail silently
  const txInfo = await ctx.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txInfo?.meta?.err) {
    throw new Error(
      `update_lp_status TX failed: ${JSON.stringify(txInfo.meta.err)}\n` +
        txInfo.meta.logMessages?.slice(0, 10).join("\n"),
    );
  }

  return sig;
}
