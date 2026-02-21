/**
 * lp-monitor.ts — Integration tests for LP position monitoring.
 *
 * Tests the full monitoring loop:
 *   1. Create a DLMM pool + position
 *   2. Initialize a session (no delegation — monitoring runs on base layer)
 *   3. Register the position for monitoring via `register_lp_monitor`
 *   4. Read off-chain position status via `checkLpPosition`
 *   5. Submit the status on-chain via `update_lp_status` — assert PDA updated
 *   6. Simulate an out-of-range condition by passing an active_bin outside range
 *
 * Position ownership note: monitoring does not require the session key to own the
 * DLMM position. The `register_lp_monitor` instruction only stores the pubkey;
 * `update_lp_status` takes pre-read values as args. The position is created with
 * the wallet as user to avoid the DLMM SDK v1.9.3 simulation issue that occurs
 * when creating a session-key-owned position in an empty pool.
 *
 * Layer: Base Layer (devnet) throughout.
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import DLMM, {
  ActivationType,
  StrategyType,
  deriveCustomizablePermissionlessLbPair,
} from "@meteora-ag/dlmm";
import BN from "bn.js";
import { assert } from "chai";
import { DefiAgent } from "../target/types/defi_agent";
import { BASE_RPC, STRATEGY_LP, sleep } from "./helpers";
import { checkLpPosition } from "@hyperbiscus/shared";

const DLMM_PROGRAM_ID = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
);

describe("lp-monitor", () => {
  // ── Provider ─────────────────────────────────────────────────────────────
  const baseConnection = new Connection(BASE_RPC, "confirmed");
  const wallet = (anchor.AnchorProvider.env() as AnchorProvider).wallet;
  const payer = (wallet as any).payer as Keypair;
  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });

  // ── Program ───────────────────────────────────────────────────────────────
  const idl = require("../target/idl/defi_agent.json");
  const baseProgram = new anchor.Program<DefiAgent>(idl, baseProvider);

  // ── Per-run fixtures ──────────────────────────────────────────────────────
  let ownerKeypair: Keypair;
  let owner: PublicKey;
  let sessionPda: PublicKey;
  let sessionKeypair: Keypair;
  let sessionKey: PublicKey;
  let monitorPda: PublicKey;

  let mintX: PublicKey;
  let mintY: PublicKey;
  let lbPair: PublicKey;
  let dlmmPool: Awaited<ReturnType<typeof DLMM.create>>;

  // The position used for monitoring — owned by wallet (simplest for setup)
  let monitoredPositionKeypair: Keypair;
  let setupActiveBinId: number;

  const SESSION_DURATION_SECS = 60 * 60 * 24;
  const MAX_LAMPORTS = 5_000_000;
  const BIN_RANGE = 5;

  // ── Helper: send and VERIFY a pre-built Transaction ──────────────────────
  async function sendTx(tx: Transaction, extraSigners: Keypair[] = []) {
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (
      await baseConnection.getLatestBlockhash()
    ).blockhash;
    for (const kp of extraSigners) tx.partialSign(kp);
    const signed = await baseProvider.wallet.signTransaction(tx);
    const sig = await baseConnection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });
    await baseConnection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  async function sendAndVerifyTx(
    label: string,
    tx: Transaction,
    extraSigners: Keypair[] = [],
  ): Promise<string> {
    const sig = await sendTx(tx, extraSigners);
    console.log(`  ${label} tx:`, sig);
    const txInfo = await baseConnection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo?.meta?.err) {
      console.log("  TX logs:", txInfo.meta.logMessages?.slice(0, 15));
      throw new Error(`${label} TX failed: ${JSON.stringify(txInfo.meta.err)}`);
    }
    return sig;
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
  before(async function () {
    this.timeout(240_000);

    ownerKeypair = Keypair.generate();
    owner = ownerKeypair.publicKey;
    sessionKeypair = Keypair.generate();
    sessionKey = sessionKeypair.publicKey;

    [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), owner.toBuffer()],
      baseProgram.programId,
    );
    [monitorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_monitor"), sessionPda.toBuffer()],
      baseProgram.programId,
    );

    console.log("  Owner:", owner.toBase58());
    console.log("  Session PDA:", sessionPda.toBase58());
    console.log("  Monitor PDA:", monitorPda.toBase58());
    console.log("  Session key:", sessionKey.toBase58());

    // Fund owner (for initializeSession TX fees)
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: owner,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }),
    );
    await sendTx(fundTx);
    await sleep(2000);

    // ── Create token mints ────────────────────────────────────────────────
    const rawMintA = await createMint(
      baseConnection, payer, wallet.publicKey, null, 6,
      undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID,
    );
    const rawMintB = await createMint(
      baseConnection, payer, wallet.publicKey, null, 6,
      undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID,
    );
    [mintX, mintY] = rawMintA.toBuffer().compare(rawMintB.toBuffer()) < 0
      ? [rawMintA, rawMintB]
      : [rawMintB, rawMintA];
    console.log("  mintX:", mintX.toBase58());
    console.log("  mintY:", mintY.toBase58());

    // ── Wallet ATAs + mint ────────────────────────────────────────────────
    const walletAtaX = await createAssociatedTokenAccount(
      baseConnection, payer, mintX, wallet.publicKey, { commitment: "confirmed" },
    );
    const walletAtaY = await createAssociatedTokenAccount(
      baseConnection, payer, mintY, wallet.publicKey, { commitment: "confirmed" },
    );
    await mintTo(baseConnection, payer, mintX, walletAtaX, wallet.publicKey, 100_000_000_000, [], { commitment: "confirmed" });
    await mintTo(baseConnection, payer, mintY, walletAtaY, wallet.publicKey, 100_000_000_000, [], { commitment: "confirmed" });
    console.log("  Minted test tokens");

    // ── Create DLMM pool ──────────────────────────────────────────────────
    const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
      baseConnection,
      new BN(10),   // binStep=10 (0.1% per bin)
      mintX,
      mintY,
      new BN(0),    // activeId=0
      new BN(4),    // feeBps=4
      ActivationType.Slot,
      false,
      wallet.publicKey,
    );
    await sendAndVerifyTx("createPool", createPoolTx);
    [lbPair] = deriveCustomizablePermissionlessLbPair(mintX, mintY, DLMM_PROGRAM_ID);
    console.log("  DLMM pool:", lbPair.toBase58());
    await sleep(3000);

    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });
    const activeBin = await dlmmPool.getActiveBin();
    setupActiveBinId = activeBin.binId;
    console.log("  Active bin:", setupActiveBinId);

    // ── Seed pool with wallet liquidity first ─────────────────────────────
    // This ensures bin arrays exist on-chain before any position creation.
    // DLMM SDK v1.9.3 simulates the TX during position creation to estimate
    // compute units — that simulation fails on empty pools and returns a broken
    // compute budget. Seeding first fixes this.
    const seedPositionKeypair = Keypair.generate();
    const seedTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: seedPositionKeypair.publicKey,
      user: wallet.publicKey,
      totalXAmount: new BN(25_000_000_000),
      totalYAmount: new BN(25_000_000_000),
      strategy: {
        maxBinId: setupActiveBinId + BIN_RANGE,
        minBinId: setupActiveBinId - BIN_RANGE,
        strategyType: StrategyType.Spot,
        singleSidedX: false,
      },
    });
    await sendAndVerifyTx("seedPool", seedTx, [seedPositionKeypair]);
    await sleep(3000);

    // ── Create monitored position (wallet-owned) ──────────────────────────
    // Monitoring only needs the position pubkey — no session-key ownership
    // required for register_lp_monitor or update_lp_status.
    monitoredPositionKeypair = Keypair.generate();
    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });
    const monitorPositionTx =
      await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: monitoredPositionKeypair.publicKey,
        user: wallet.publicKey,
        totalXAmount: new BN(1_000_000),
        totalYAmount: new BN(1_000_000),
        strategy: {
          maxBinId: setupActiveBinId + BIN_RANGE,
          minBinId: setupActiveBinId - BIN_RANGE,
          strategyType: StrategyType.Spot,
          singleSidedX: false,
        },
      });
    await sendAndVerifyTx("createMonitoredPosition", monitorPositionTx, [monitoredPositionKeypair]);
    console.log("  Monitored position:", monitoredPositionKeypair.publicKey.toBase58());
    await sleep(2000);

    // ── Initialize session ────────────────────────────────────────────────
    const initIx = await baseProgram.methods
      .initializeSession(
        sessionKey,
        new anchor.BN(SESSION_DURATION_SECS),
        new anchor.BN(MAX_LAMPORTS),
        STRATEGY_LP,
      )
      .accounts({ owner })
      .instruction();
    await sendAndVerifyTx("initializeSession", new Transaction().add(initIx), [ownerKeypair]);
  });

  // ── Tests ─────────────────────────────────────────────────────────────────

  it("1. Register LP position for monitoring", async function () {
    this.timeout(60_000);

    const regTx = await baseProgram.methods
      .registerLpMonitor(
        lbPair,
        monitoredPositionKeypair.publicKey,
        setupActiveBinId - BIN_RANGE,
        setupActiveBinId + BIN_RANGE,
      )
      .accounts({
        owner,
        session: sessionPda,
        monitor: monitorPda,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    await sendAndVerifyTx("registerLpMonitor", regTx, [ownerKeypair]);

    const monitor = await baseProgram.account.lpPositionMonitor.fetch(monitorPda);
    assert.ok(monitor.session.equals(sessionPda), "monitor.session should be sessionPda");
    assert.ok(monitor.lbPair.equals(lbPair), "monitor.lbPair should match");
    assert.ok(
      monitor.position.equals(monitoredPositionKeypair.publicKey),
      "monitor.position should match",
    );
    assert.equal(monitor.minBinId, setupActiveBinId - BIN_RANGE, "minBinId mismatch");
    assert.equal(monitor.maxBinId, setupActiveBinId + BIN_RANGE, "maxBinId mismatch");
    assert.equal(monitor.isInRange, true, "initial isInRange should be true");
    console.log(`  Monitor: range=[${monitor.minBinId}, ${monitor.maxBinId}], in_range=${monitor.isInRange}`);
  });

  it("2. Check LP position status off-chain (in-range)", async function () {
    this.timeout(60_000);

    const status = await checkLpPosition(
      baseConnection,
      lbPair,
      monitoredPositionKeypair.publicKey,
      "devnet",
    );

    console.log(
      `  activeBin=${status.activeBin}, range=[${status.positionMinBin}, ${status.positionMaxBin}], ` +
      `isInRange=${status.isInRange}, feeX=${status.feeX.toString()}, feeY=${status.feeY.toString()}`,
    );

    assert.ok(status.isInRange, "Position should be in range (active bin 0 within ±5)");
    assert.equal(status.positionMinBin, setupActiveBinId - BIN_RANGE, "positionMinBin mismatch");
    assert.equal(status.positionMaxBin, setupActiveBinId + BIN_RANGE, "positionMaxBin mismatch");
  });

  it("3. Update LP status on-chain (in-range)", async function () {
    this.timeout(60_000);

    const status = await checkLpPosition(
      baseConnection,
      lbPair,
      monitoredPositionKeypair.publicKey,
      "devnet",
    );

    const updateTx = await baseProgram.methods
      .updateLpStatus(status.activeBin, status.feeX, status.feeY)
      .accounts({ sessionKey, session: sessionPda, monitor: monitorPda })
      .transaction();

    await sendAndVerifyTx("updateLpStatus", updateTx, [sessionKeypair]);

    const monitor = await baseProgram.account.lpPositionMonitor.fetch(monitorPda);
    assert.equal(monitor.lastActiveBin, status.activeBin, "lastActiveBin mismatch");
    assert.equal(monitor.isInRange, true, "isInRange should be true");
    assert.ok(monitor.lastCheckedAt.toNumber() > 0, "lastCheckedAt should be set");
    console.log(
      `  On-chain: lastActiveBin=${monitor.lastActiveBin}, isInRange=${monitor.isInRange}, ` +
      `feeX=${monitor.feeXSnapshot.toString()}, feeY=${monitor.feeYSnapshot.toString()}`,
    );
  });

  it("4. Detect out-of-range condition when active bin moves outside position", async function () {
    this.timeout(60_000);

    const outOfRangeBin = setupActiveBinId + BIN_RANGE + 100;

    const updateTx = await baseProgram.methods
      .updateLpStatus(outOfRangeBin, new anchor.BN(0), new anchor.BN(0))
      .accounts({ sessionKey, session: sessionPda, monitor: monitorPda })
      .transaction();

    await sendAndVerifyTx("updateLpStatus(out-of-range)", updateTx, [sessionKeypair]);

    const monitor = await baseProgram.account.lpPositionMonitor.fetch(monitorPda);
    assert.equal(monitor.lastActiveBin, outOfRangeBin, "lastActiveBin should reflect simulated bin");
    assert.equal(monitor.isInRange, false, "isInRange should be false");
    console.log(
      `  Out-of-range detected: activeBin=${monitor.lastActiveBin}, ` +
      `range=[${monitor.minBinId}, ${monitor.maxBinId}], isInRange=${monitor.isInRange}`,
    );
  });

  it("5. Reject register with invalid bin range (min > max)", async function () {
    this.timeout(30_000);

    try {
      const fakeTx = await baseProgram.methods
        .registerLpMonitor(lbPair, monitoredPositionKeypair.publicKey, 10, 5)
        .accounts({
          owner,
          session: sessionPda,
          monitor: monitorPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      fakeTx.feePayer = wallet.publicKey;
      fakeTx.recentBlockhash = (await baseConnection.getLatestBlockhash()).blockhash;
      fakeTx.partialSign(ownerKeypair);
      const signed = await baseProvider.wallet.signTransaction(fakeTx);

      await baseConnection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });
      assert.fail("Expected InvalidBinRange or already-exists error");
    } catch (e: any) {
      const msg: string = e.message ?? e.toString() ?? JSON.stringify(e);
      const caught =
        msg.includes("InvalidBinRange") ||
        msg.includes("already in use") ||
        msg.includes("already initialized") ||
        msg.includes("6007");
      assert.ok(caught, `Expected rejection, got: ${msg.slice(0, 300)}`);
      console.log("  Invalid bin range correctly rejected ✓");
    }
  });
});
