import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { assert } from "chai";
import { DefiAgent } from "../target/types/defi_agent";

// ── Strategy bitmask constants (mirrors Rust state/agent_session.rs) ──────────
const STRATEGY_LP = 1 << 0;
const STRATEGY_YIELD = 1 << 1;
const STRATEGY_LIQUIDATION = 1 << 2;

const ACTION_LP_REBALANCE = 0;
const ACTION_YIELD_SWITCH = 1;
const ACTION_LIQUIDATION_PROTECT = 2;

// ── MagicBlock program IDs ─────────────────────────────────────────────────────
const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

// ── Connections ────────────────────────────────────────────────────────────────
const BASE_RPC = process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const ER_RPC =
  process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? "https://devnet.magicblock.app/";
const ER_WS =
  process.env.EPHEMERAL_WS_ENDPOINT ?? "wss://devnet.magicblock.app/";

describe("defi-agent", () => {
  // ── Providers ──────────────────────────────────────────────────────────────
  const baseConnection = new Connection(BASE_RPC, "confirmed");
  const erConnection = new Connection(ER_RPC, {
    wsEndpoint: ER_WS,
    commitment: "confirmed",
  });

  const wallet = (anchor.AnchorProvider.env() as AnchorProvider).wallet;
  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });
  const erProvider = new AnchorProvider(erConnection, wallet, {
    commitment: "confirmed",
  });

  // ── Programs (same IDL, different providers) ───────────────────────────────
  const idl = require("../target/idl/defi_agent.json");
  const baseProgram = new Program<DefiAgent>(idl, baseProvider);
  const erProgram = new Program<DefiAgent>(idl, erProvider);

  // ── Test fixtures ──────────────────────────────────────────────────────────
  const owner = wallet.publicKey;

  // Simulates the ESP32 session keypair (in production: derived on device)
  const sessionKeypair = Keypair.generate();
  const sessionKey = sessionKeypair.publicKey;

  const [sessionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("session"), owner.toBuffer()],
    baseProgram.programId,
  );

  const SESSION_DURATION_SECS = 60 * 60 * 24; // 24 hours
  const MAX_LAMPORTS = 1_000_000_000; // 1 SOL
  const STRATEGY_MASK = STRATEGY_LP | STRATEGY_YIELD; // LP + yield enabled

  // ── Helpers ────────────────────────────────────────────────────────────────
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function checkIsDelegated(owner: PublicKey): boolean {
    return owner.equals(DELEGATION_PROGRAM_ID);
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  it("1. Initialize session on base layer", async () => {
    const tx = await baseProgram.methods
      .initializeSession(
        sessionKey,
        new anchor.BN(SESSION_DURATION_SECS),
        new anchor.BN(MAX_LAMPORTS),
        STRATEGY_MASK,
      )
      .accounts({ owner, session: sessionPda })
      .rpc({ commitment: "confirmed" });

    console.log("  initializeSession tx:", tx);

    const session = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.ok(session.isActive, "session should be active");
    assert.ok(session.sessionKey.equals(sessionKey), "session key mismatch");
    assert.equal(session.strategyMask, STRATEGY_MASK);
    assert.equal(session.maxLamports.toNumber(), MAX_LAMPORTS);
    assert.equal(session.spentLamports.toNumber(), 0);
  });

  it("2. Delegate session to Ephemeral Rollup on base layer", async () => {
    const tx = await baseProgram.methods
      .delegateSession(owner)
      .accounts({ payer: owner, agentSession: sessionPda })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("  delegateSession tx:", tx);

    // Wait for ER state propagation (3s recommended by MagicBlock docs)
    await sleep(3000);

    const accountInfo = await baseConnection.getAccountInfo(sessionPda);
    assert.ok(accountInfo, "session PDA should exist");
    assert.ok(
      checkIsDelegated(accountInfo!.owner),
      `account owner should be DELEGATION_PROGRAM_ID, got ${accountInfo!.owner}`,
    );
  });

  it("3. Execute LP rebalance action on Ephemeral Rollup", async () => {
    const actionAmount = 100_000; // 0.0001 SOL notional exposure

    let tx = await erProgram.methods
      .executeAction(ACTION_LP_REBALANCE, new anchor.BN(actionAmount))
      .accounts({ sessionKey, session: sessionPda })
      .transaction();

    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;

    // Session key (ESP32 device key) signs the transaction
    tx.partialSign(sessionKeypair);
    tx = await erProvider.wallet.signTransaction(tx);

    const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await erConnection.confirmTransaction(txHash, "confirmed");
    console.log("  executeAction tx:", txHash);

    // Read state directly from ER
    const session = await erProgram.account.agentSession.fetch(sessionPda);
    assert.equal(session.spentLamports.toNumber(), actionAmount);
    assert.equal(session.totalActions.toNumber(), 1);
  });

  it("4. Execute yield switch action on Ephemeral Rollup", async () => {
    const actionAmount = 50_000;

    let tx = await erProgram.methods
      .executeAction(ACTION_YIELD_SWITCH, new anchor.BN(actionAmount))
      .accounts({ sessionKey, session: sessionPda })
      .transaction();

    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx.partialSign(sessionKeypair);
    tx = await erProvider.wallet.signTransaction(tx);

    const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    await erConnection.confirmTransaction(txHash, "confirmed");
    console.log("  executeAction (yield) tx:", txHash);

    const session = await erProgram.account.agentSession.fetch(sessionPda);
    assert.equal(session.totalActions.toNumber(), 2);
  });

  it("5. Reject unauthorized session key", async () => {
    const rogue = Keypair.generate();

    let tx = await erProgram.methods
      .executeAction(ACTION_LP_REBALANCE, new anchor.BN(1000))
      .accounts({ sessionKey: rogue.publicKey, session: sessionPda })
      .transaction();

    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx.partialSign(rogue);
    tx = await erProvider.wallet.signTransaction(tx);

    try {
      await erConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      assert.fail("Should have thrown UnauthorizedSessionKey error");
    } catch (e: any) {
      assert.include(
        e.message,
        "UnauthorizedSessionKey",
        "Expected UnauthorizedSessionKey error",
      );
    }
  });

  it("6. Reject disabled strategy (liquidation not enabled)", async () => {
    let tx = await erProgram.methods
      .executeAction(ACTION_LIQUIDATION_PROTECT, new anchor.BN(1000))
      .accounts({ sessionKey, session: sessionPda })
      .transaction();

    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx.partialSign(sessionKeypair);
    tx = await erProvider.wallet.signTransaction(tx);

    try {
      await erConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      assert.fail("Should have thrown StrategyNotEnabled error");
    } catch (e: any) {
      assert.include(e.message, "StrategyNotEnabled");
    }
  });

  it("7. Commit state to base layer (without undelegating)", async () => {
    let tx = await erProgram.methods
      .commitSession()
      .accounts({ payer: owner, session: sessionPda })
      .transaction();

    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx = await erProvider.wallet.signTransaction(tx);

    const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });

    // Wait for the commit to propagate back to base layer
    const commitTxHash = await GetCommitmentSignature(txHash, erConnection);
    console.log("  commitSession base layer tx:", commitTxHash);

    // Verify state is visible on base layer
    const session = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.equal(session.totalActions.toNumber(), 2);
    assert.ok(session.isActive, "session should still be active after commit");
  });

  it("8. Undelegate session back to base layer", async () => {
    let tx = await erProgram.methods
      .undelegateSession()
      .accounts({ payer: owner, session: sessionPda })
      .transaction();

    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx = await erProvider.wallet.signTransaction(tx);

    const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });

    const commitTxHash = await GetCommitmentSignature(txHash, erConnection);
    console.log("  undelegateSession base layer tx:", commitTxHash);

    await sleep(3000);

    // Account owner should revert to our program
    const accountInfo = await baseConnection.getAccountInfo(sessionPda);
    assert.ok(accountInfo, "session PDA should still exist");
    assert.ok(
      !checkIsDelegated(accountInfo!.owner),
      "account should no longer be delegated",
    );

    const session = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.ok(!session.isActive, "session should be inactive after undelegation");
  });
});
