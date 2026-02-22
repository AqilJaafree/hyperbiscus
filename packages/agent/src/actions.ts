/**
 * actions.ts — User-triggered agent actions with real MagicBlock ER transactions.
 *
 * add_liquidity flow (mirrors the defi-agent test suite):
 *   1. Read LP position from Solana RPC          (base layer read)
 *   2. delegate_session(owner) → base layer TX   (PDA→DELEGATION_PROGRAM ownership)
 *   3. execute_action on Ephemeral Rollup        (ER TX, session key signs)
 *   4. commitSession + undelegateSession on ER   (ER TXs, returns PDA to base layer)
 *   5. update_lp_status checkpoint               (base layer TX)
 *
 * ER RPC: https://devnet.magicblock.app/ (override via MAGICBLOCK_RPC_URL env)
 */

import * as anchor from "@coral-xyz/anchor";
import { randomUUID } from "crypto";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import * as path from "path";
import BN from "bn.js";
import { checkLpPosition } from "@hyperbiscus/shared";
import { AgentConfig } from "./config";
import { DELEGATION_PROGRAM_ID } from "./constants";
import { SolanaContext, submitUpdateLpStatus } from "./solana";

// execute_action type for LP rebalance (matches on-chain enum)
const ACTION_LP_REBALANCE = 0;

// Timing constants for MagicBlock ER lifecycle
const ER_PICKUP_DELAY_MS = 3000;          // wait after delegation for ER to pick up the account
const UNDELEGATION_POLL_INTERVAL_MS = 5000; // interval between base-layer ownership checks
const UNDELEGATION_POLL_ATTEMPTS = 12;      // 12 × 5000ms = 60s before giving up

// Amount passed to execute_action (arbitrary notional, validated on-chain against exposure limit)
const EXECUTE_ACTION_AMOUNT = new BN(100_000);

export interface ActionStep {
  actionId: string;
  step: number;
  total: number;
  label: string;
  status: "pending" | "success" | "error";
  txSignature?: string;
  txUrl?: string;
  detail?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Solana base-layer devnet explorer link */
function explorerUrl(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

/** MagicBlock ER explorer link — uses Solana Explorer's custom cluster pointing to ER RPC */
function erExplorerUrl(sig: string) {
  const rpc = encodeURIComponent("https://devnet.magicblock.app/");
  return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${rpc}`;
}

/**
 * Read the session owner pubkey directly from raw account bytes.
 * Works regardless of whether the account is delegated (owned by DELEGATION_PROGRAM_ID)
 * because we use getAccountInfo() which doesn't check owner.
 * AgentSession layout: [8 discriminator][32 owner][32 session_key]...
 */
async function readSessionOwner(
  connection: Connection,
  sessionPda: PublicKey,
): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(sessionPda);
  if (!info || info.data.length < 40) return null;
  return new PublicKey(info.data.slice(8, 40));
}

/**
 * Build, sign with session wallet (+ optional extra signers), and send an ER TX.
 * Mirrors the sendErTx() helper used in the test suite.
 */
async function sendErTx(
  erConnection: Connection,
  wallet: anchor.Wallet,
  tx: Transaction,
  extraSigners: anchor.web3.Keypair[] = [],
): Promise<string> {
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
  for (const kp of extraSigners) tx.partialSign(kp);
  const signed = await wallet.signTransaction(tx);
  const sig = await erConnection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  await erConnection.confirmTransaction(sig, "confirmed");

  // Verify the instruction did not fail silently (confirmTransaction only checks
  // slot finalization, not instruction success — same pattern as submitUpdateLpStatus)
  const txInfo = await erConnection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txInfo?.meta?.err) {
    throw new Error(
      `ER TX failed on-chain: ${JSON.stringify(txInfo.meta.err)}\n` +
      txInfo.meta.logMessages?.slice(0, 5).join("\n"),
    );
  }

  return sig;
}

// ── Main action ───────────────────────────────────────────────────────────────

export async function handleAddLiquidity(
  config: AgentConfig,
  ctx: SolanaContext,
  onStep: (step: ActionStep) => void,
): Promise<void> {
  const actionId = `add_liq_${randomUUID()}`;
  const TOTAL = 5;

  const emit = (
    step: number,
    label: string,
    status: ActionStep["status"],
    extra: Partial<ActionStep> = {},
  ) => onStep({ actionId, step, total: TOTAL, label, status, ...extra });

  // ── Set up ER connection + Anchor program ──────────────────────────────────
  const erRpc = config.magicblockRpcUrl;
  const erWs = erRpc.replace(/^https/, "wss").replace(/\/$/, "") + "/";
  const erConnection = new Connection(erRpc, {
    wsEndpoint: erWs,
    commitment: "confirmed",
  });

  const sessionWallet = new anchor.Wallet(config.sessionKeypair);
  const erProvider = new anchor.AnchorProvider(erConnection, sessionWallet, {
    commitment: "confirmed",
  });

  const idlPath = path.resolve(
    __dirname,
    "../../contracts/target/idl/defi_agent.json",
  );
  const idl = require(idlPath);
  const erProgram = new anchor.Program(idl, erProvider);

  try {
    // ── Step 1: Read LP position ─────────────────────────────────────────────
    emit(1, "Reading LP position from Solana", "pending");

    const status = await checkLpPosition(
      ctx.connection,
      config.lbPair,
      config.positionPubkey,
      "devnet",
    );

    emit(1, "LP position read", "success", {
      detail:
        `Bin ${status.activeBin} · [${status.positionMinBin}–${status.positionMaxBin}]` +
        ` · ${status.isInRange ? "in range ✓" : "OUT OF RANGE ⚠"}`,
    });

    // ── Step 2: Delegate session to MagicBlock ER ────────────────────────────
    emit(2, "Delegating session to MagicBlock ER", "pending");

    // Check if already delegated (owner = DELEGATION_PROGRAM_ID on base layer)
    const accountInfo = await ctx.connection.getAccountInfo(config.sessionPda);
    const alreadyDelegated =
      accountInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;

    if (alreadyDelegated) {
      emit(2, "Session already delegated to ER", "success", {
        detail: "Session PDA already under MagicBlock ER control",
      });
    } else {
      // Read owner pubkey from raw account bytes (needed as instruction arg)
      const ownerPubkey = await readSessionOwner(
        ctx.connection,
        config.sessionPda,
      );
      if (!ownerPubkey) {
        throw new Error(
          "Could not read session owner from on-chain account — is SESSION_PDA correct?",
        );
      }
      console.log(`  [action] session owner: ${ownerPubkey.toBase58()}`);

      // delegate_session(owner) — Anchor auto-derives all MagicBlock PDAs from IDL
      const delegateSig = await ctx.program.methods
        .delegateSession(ownerPubkey)
        .accounts({ payer: config.sessionKeypair.publicKey })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      // Wait for ER to pick up the newly delegated account
      await sleep(ER_PICKUP_DELAY_MS);

      emit(2, "Session delegated to Ephemeral Rollup", "success", {
        txSignature: delegateSig,
        txUrl: explorerUrl(delegateSig),
        detail: "Session PDA transferred to MagicBlock · ER ready",
      });
    }

    // ── Step 3: Execute action on Ephemeral Rollup ───────────────────────────
    emit(3, "Executing LP action on Ephemeral Rollup", "pending");

    const actionTx = await erProgram.methods
      .executeAction(ACTION_LP_REBALANCE, EXECUTE_ACTION_AMOUNT)
      .accounts({
        sessionKey: config.sessionKeypair.publicKey,
        session: config.sessionPda,
      })
      .transaction();

    // Session keypair is both feePayer and sessionKey signer — one signature covers both
    const erSig = await sendErTx(erConnection, sessionWallet, actionTx);

    emit(3, "LP action confirmed on ER", "success", {
      txSignature: erSig,
      txUrl: erExplorerUrl(erSig),
      detail: `execute_action (LP_REBALANCE) · sub-10ms ER finality`,
    });

    // ── Step 4: Commit state + undelegate back to base layer ─────────────────
    emit(4, "Committing state & undelegating from ER", "pending");

    // commitSession — sync ER state to Solana base layer without undelegating yet
    const commitTx = await erProgram.methods
      .commitSession()
      .accounts({
        payer: config.sessionKeypair.publicKey,
        session: config.sessionPda,
      })
      .transaction();
    const commitSig = await sendErTx(erConnection, sessionWallet, commitTx);
    console.log(`  [action] commitSession ER tx: ${commitSig}`);

    // undelegateSession — return account ownership to our program on base layer
    const undelegateTx = await erProgram.methods
      .undelegateSession()
      .accounts({
        payer: config.sessionKeypair.publicKey,
        session: config.sessionPda,
      })
      .transaction();
    const undelegateSig = await sendErTx(
      erConnection,
      sessionWallet,
      undelegateTx,
    );
    console.log(`  [action] undelegateSession ER tx: ${undelegateSig}`);

    emit(4, "State committed & undelegated from ER", "success", {
      txSignature: undelegateSig,
      txUrl: erExplorerUrl(undelegateSig),
      detail: `commit: ${commitSig.slice(0, 8)}… · undelegate: ${undelegateSig.slice(0, 8)}…`,
    });

    // ── Step 5: Checkpoint LP status on Solana base layer ────────────────────
    emit(5, "Checkpointing LP status on Solana", "pending");

    // Undelegation propagation to base layer can take up to 60s on devnet.
    // Poll until the session account owner reverts to our program.
    let checkpointed = false;
    for (let i = 0; i < UNDELEGATION_POLL_ATTEMPTS; i++) {
      await sleep(UNDELEGATION_POLL_INTERVAL_MS);
      const info = await ctx.connection.getAccountInfo(config.sessionPda);
      if (!info || !info.owner.equals(DELEGATION_PROGRAM_ID)) {
        // Account returned to our program — safe to write
        try {
          const sig = await submitUpdateLpStatus(
            ctx,
            status.activeBin,
            status.feeX,
            status.feeY,
          );
          emit(5, "LP status checkpointed on-chain", "success", {
            txSignature: sig,
            txUrl: explorerUrl(sig),
          });
          checkpointed = true;
        } catch (err: any) {
          emit(5, `Checkpoint failed: ${err.message}`, "error");
          checkpointed = true; // stop polling
        }
        break;
      }
      console.log(
        `  [action] waiting for undelegation propagation… ${((i + 1) * UNDELEGATION_POLL_INTERVAL_MS) / 1000}s`,
      );
    }

    if (!checkpointed) {
      // Known MagicBlock devnet delay — ER TXs confirmed, base-layer propagation slow
      emit(5, "ER flow complete — base-layer sync pending", "success", {
        detail:
          "ER TXs confirmed. Undelegation propagation delayed on devnet (known issue). " +
          "Next monitoring tick will checkpoint once the account is returned.",
      });
    }
  } catch (err: any) {
    console.error("[action] handleAddLiquidity error:", err.message);
    onStep({
      actionId,
      step: -1,
      total: TOTAL,
      label: `Error: ${err.message}`,
      status: "error",
    });
  }
}
