/**
 * meteora-dlmm.ts — Integration test for execute_dlmm_swap
 *
 * Tests the real on-chain Meteora DLMM CPI from our defi_agent program
 * running on Solana base layer (devnet).
 *
 * Architecture note: DLMM swap requires writing to ~8 pool accounts
 * (reserves, oracle, bin arrays). These are not delegated to MagicBlock ER,
 * so the swap runs on base layer. The session key still authorizes the action
 * (the hardware device's ephemeral key) — that is the core security primitive.
 * ER is used for fast heartbeats (execute_action); DLMM swaps go to base layer.
 *
 * Flow:
 *   1. Create two custom SPL token mints
 *   2. Create a Meteora DLMM pool for those mints
 *   3. Add Y-side liquidity (enables X→Y swap)
 *   4. Initialize a fresh session on base layer (no delegation)
 *   5. Execute a DLMM swap via session key — assert state + token balance updated
 *   6. Reject a swap that would exceed the exposure limit
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, web3 } from "@coral-xyz/anchor";
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
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import DLMM, {
  ActivationType,
  StrategyType,
  deriveEventAuthority,
  deriveCustomizablePermissionlessLbPair,
  deriveBinArray,
  binIdToBinArrayIndex,
} from "@meteora-ag/dlmm";
import BN from "bn.js";
import { assert } from "chai";
import { DefiAgent } from "../target/types/defi_agent";
import { BASE_RPC, STRATEGY_LP, sleep } from "./helpers";

// ── Meteora DLMM ───────────────────────────────────────────────────────────────
const DLMM_PROGRAM_ID = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
);
const ERR_EXPOSURE_LIMIT = "0x1773"; // ExposureLimitExceeded = 6003

describe("meteora-dlmm", () => {
  // ── Provider ───────────────────────────────────────────────────────────────
  const baseConnection = new Connection(BASE_RPC, "confirmed");

  const wallet = (anchor.AnchorProvider.env() as AnchorProvider).wallet;
  // NodeWallet exposes the underlying Keypair as .payer — needed for SPL-token
  // functions that require a raw Keypair signer.
  const payer = (wallet as any).payer as Keypair;

  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });

  // ── Program ────────────────────────────────────────────────────────────────
  const idl = require("../target/idl/defi_agent.json");
  const baseProgram = new anchor.Program<DefiAgent>(idl, baseProvider);

  // ── Per-run fixtures ───────────────────────────────────────────────────────
  let ownerKeypair: Keypair;
  let owner: PublicKey;
  let sessionPda: PublicKey;
  let sessionKeypair: Keypair;
  let sessionKey: PublicKey;

  let mintX: PublicKey;
  let mintY: PublicKey;
  let walletAtaX: PublicKey;  // wallet's ATA (holds liquidity to seed pool)
  let walletAtaY: PublicKey;
  let sessionAtaX: PublicKey; // session key's ATA — the "user_token_in"
  let sessionAtaY: PublicKey; // session key's ATA — the "user_token_out"

  let dlmmPool: Awaited<ReturnType<typeof DLMM.create>>;
  let lbPair: PublicKey;

  const SESSION_DURATION_SECS = 60 * 60 * 24;
  const MAX_LAMPORTS = 2_000_000; // 0.002 SOL exposure cap (covers swap + add_liq)
  const SWAP_AMOUNT_IN = 100_000;  // within cap
  const ADD_LIQ_AMOUNT = 200_000;  // per token; total 400_000 within remaining cap
  const BIN_RANGE = 5;

  let sessionPositionKeypair: Keypair;
  let setupActiveBinId: number; // pool's active bin ID at pool-creation time

  // Derived once in before() — reused across all tests
  let eventAuthority: PublicKey;
  let bitmapExt: PublicKey | null;
  let binArrayLower: PublicKey;
  let binArrayUpper: PublicKey;

  // ── Helper: send a pre-built Transaction ──────────────────────────────────
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

  // ── Setup ──────────────────────────────────────────────────────────────────
  before(async function () {
    this.timeout(180_000);

    ownerKeypair = Keypair.generate();
    owner = ownerKeypair.publicKey;
    sessionKeypair = Keypair.generate();
    sessionKey = sessionKeypair.publicKey;

    [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), owner.toBuffer()],
      baseProgram.programId,
    );

    console.log("  Owner:", owner.toBase58());
    console.log("  Session PDA:", sessionPda.toBase58());
    console.log("  Session key:", sessionKey.toBase58());

    // Fund owner (for initializeSession TX fees)
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: owner,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: sessionKey,
        // 0.15 SOL: position rent ~0.058 SOL + tx fees + buffer for add_liq test
        lamports: 0.15 * LAMPORTS_PER_SOL,
      }),
    );
    await sendTx(fundTx);
    await sleep(2000);

    // ── Create two SPL token mints (wallet is authority) ───────────────────
    // DLMM canonically orders mints by pubkey buffer (smaller = tokenX).
    const rawMintA = await createMint(
      baseConnection, payer, wallet.publicKey, null, 6,
      undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID,
    );
    const rawMintB = await createMint(
      baseConnection, payer, wallet.publicKey, null, 6,
      undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID,
    );
    // Sort: tokenX < tokenY (DLMM convention: smaller pubkey buffer = mintX)
    [mintX, mintY] = rawMintA.toBuffer().compare(rawMintB.toBuffer()) < 0
      ? [rawMintA, rawMintB]
      : [rawMintB, rawMintA];
    console.log("  mintX (tokenX):", mintX.toBase58());
    console.log("  mintY (tokenY):", mintY.toBase58());

    // ── Create ATAs (wallet + session key) ────────────────────────────────
    walletAtaX = await createAssociatedTokenAccount(
      baseConnection, payer, mintX, wallet.publicKey,
      { commitment: "confirmed" },
    );
    walletAtaY = await createAssociatedTokenAccount(
      baseConnection, payer, mintY, wallet.publicKey,
      { commitment: "confirmed" },
    );
    sessionAtaX = await createAssociatedTokenAccount(
      baseConnection, payer, mintX, sessionKey,
      { commitment: "confirmed" },
    );
    sessionAtaY = await createAssociatedTokenAccount(
      baseConnection, payer, mintY, sessionKey,
      { commitment: "confirmed" },
    );

    // ── Mint tokens ───────────────────────────────────────────────────────
    // Wallet gets liquidity to seed the pool; session key gets token X to swap
    await mintTo(baseConnection, payer, mintX, walletAtaX,  wallet.publicKey, 100_000_000_000, [], { commitment: "confirmed" }); // 100k
    await mintTo(baseConnection, payer, mintY, walletAtaY,  wallet.publicKey, 100_000_000_000, [], { commitment: "confirmed" });
    await mintTo(baseConnection, payer, mintX, sessionAtaX, wallet.publicKey, 10_000_000,      [], { commitment: "confirmed" }); // 10
    console.log("  Minted test tokens");

    // ── Create Meteora DLMM pool ──────────────────────────────────────────
    // binStep=10 (0.1% per bin); feeBps=4 → baseFactor=4000 (devnet preset)
    // Formula: baseFactor = feeBps * 10000 / binStep = 4 * 10000 / 10 = 4000
    // activeId=0 → price ≈ 1:1 for equal-decimal 6-dec tokens
    const activeId = new BN(0);
    const binStep = new BN(10);
    const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
      baseConnection,
      binStep,
      mintX,
      mintY,
      activeId,
      new BN(4),               // feeBps=4 → baseFactor=4000 (existing devnet preset)
      ActivationType.Slot,
      false,                   // hasAlphaVault
      wallet.publicKey,        // creatorKey
    );
    const poolSig = await sendTx(createPoolTx);
    console.log("  createPool tx:", poolSig);

    // Derive pool address deterministically — no RPC wait needed
    [lbPair] = deriveCustomizablePermissionlessLbPair(mintX, mintY, DLMM_PROGRAM_ID);
    console.log("  DLMM pool (derived):", lbPair.toBase58());
    await sleep(3000); // let the tx finalize before loading

    // Load pool instance
    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });

    // ── Add symmetric liquidity (X above active, Y below) ─────────────────
    // With StrategyType.Spot + singleSidedX=false:
    //   Bins above active (1..+BIN_RANGE): X-side → receives X tokens
    //   Bins at/below active (0..-BIN_RANGE): Y-side → receives Y tokens
    //
    // Session key has X tokens. For X→Y swap (swapForY=true), DLMM traverses
    // from active bin (0) downward and finds Y at bins 0 to -BIN_RANGE.
    const positionKeypair = Keypair.generate();
    const activeBin = await dlmmPool.getActiveBin();
    setupActiveBinId = activeBin.binId;

    // Compute static PDAs once — reused across all tests
    [eventAuthority] = deriveEventAuthority(DLMM_PROGRAM_ID);
    bitmapExt = dlmmPool.binArrayBitmapExtension?.publicKey ?? null;
    const lowerIdx = binIdToBinArrayIndex(new BN(setupActiveBinId - BIN_RANGE));
    const upperIdx = binIdToBinArrayIndex(new BN(setupActiveBinId + BIN_RANGE));
    [binArrayLower] = deriveBinArray(lbPair, lowerIdx, DLMM_PROGRAM_ID);
    [binArrayUpper] = deriveBinArray(lbPair, upperIdx, DLMM_PROGRAM_ID);
    console.log("  binArrayLower:", binArrayLower.toBase58(), "(idx", lowerIdx.toString(), ")");
    console.log("  binArrayUpper:", binArrayUpper.toBase58(), "(idx", upperIdx.toString(), ")");

    const addLiqTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: wallet.publicKey,
      totalXAmount: new BN(25_000_000_000), // wallet provides X for bins 1..+5
      totalYAmount: new BN(25_000_000_000), // wallet provides Y for bins -5..0
      strategy: {
        maxBinId: activeBin.binId + BIN_RANGE, // +5
        minBinId: activeBin.binId - BIN_RANGE, // -5
        strategyType: StrategyType.Spot,
        singleSidedX: false,
      },
    });
    const liqSig = await sendTx(addLiqTx, [positionKeypair]);
    console.log("  addLiquidity tx:", liqSig);
    await sleep(3000);

    // ── Mint Y tokens to session key (needed for add liquidity test) ───────
    await mintTo(
      baseConnection, payer, mintY, sessionAtaY,
      wallet.publicKey, 5_000_000, [], { commitment: "confirmed" },
    );

    // ── Create a DLMM position owned by session key ────────────────────────
    // This position is used by executeDlmmAddLiquidity (our CPI wrapper).
    // The session key must be the DLMM position owner so it can act as `sender`.
    sessionPositionKeypair = Keypair.generate();
    const sessionPositionTx =
      await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: sessionPositionKeypair.publicKey,
        user: sessionKey,
        totalXAmount: new BN(1_000_000), // seed X into bins above active
        totalYAmount: new BN(1_000_000), // seed Y into bins at/below active
        strategy: {
          maxBinId: activeBin.binId + BIN_RANGE,
          minBinId: activeBin.binId - BIN_RANGE,
          strategyType: StrategyType.Spot,
          singleSidedX: false,
        },
      });
    const sessionPosLiqSig = await sendTx(sessionPositionTx, [
      sessionKeypair,
      sessionPositionKeypair,
    ]);
    console.log("  session initPosition+addLiq tx:", sessionPosLiqSig);
    await sleep(2000);

    // ── Initialize session on base layer (no delegation for DLMM tests) ───
    // DLMM swap requires writing to non-delegated pool accounts, so the swap
    // runs on base layer. Session key still authorizes (hardware security model).
    const initIx = await baseProgram.methods
      .initializeSession(
        sessionKey,
        new anchor.BN(SESSION_DURATION_SECS),
        new anchor.BN(MAX_LAMPORTS),
        STRATEGY_LP,
      )
      .accounts({ owner })
      .instruction();

    const initTx = new Transaction().add(initIx);
    const initSig = await sendTx(initTx, [ownerKeypair]);
    console.log("  initializeSession tx:", initSig);
  });

  // ── Tests ──────────────────────────────────────────────────────────────────

  it("1. Execute DLMM swap via session key on base layer", async function () {
    this.timeout(60_000);

    // Refresh pool state and fetch bin arrays for the swap
    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });
    // swapForY=true: we are swapping X→Y (spending X to get Y)
    // SDK traverses from active bin downward to find Y liquidity at bins 0..-5
    const binArrays = await dlmmPool.getBinArrayForSwap(true);
    console.log("  Bin arrays for swap:", binArrays.map(ba => ba.publicKey.toBase58()));

    const binArrayRemaining = binArrays.map((ba) => ({
      pubkey: ba.publicKey,
      isWritable: true,
      isSigner: false,
    }));

    const preBalX = (await getAccount(baseConnection, sessionAtaX)).amount;

    // Build TX via .transaction() and sign manually.
    // (Anchor .rpc() with extra signers can trigger "Unknown action" on NodeWallet.)
    const swapTx = await baseProgram.methods
      .executeDlmmSwap(
        new anchor.BN(SWAP_AMOUNT_IN),
        new anchor.BN(0), // min_amount_out=0: accept any output (test only)
      )
      .accounts({
        sessionKey,
        session: sessionPda,
        lbPair,
        binArrayBitmapExtension: bitmapExt,
        reserveX: dlmmPool.lbPair.reserveX,
        reserveY: dlmmPool.lbPair.reserveY,
        userTokenIn: sessionAtaX,
        userTokenOut: sessionAtaY,
        tokenXMint: dlmmPool.lbPair.tokenXMint,
        tokenYMint: dlmmPool.lbPair.tokenYMint,
        oracle: dlmmPool.lbPair.oracle,
        // dlmmProgram is auto-resolved from the address constraint in the IDL
        eventAuthority,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(binArrayRemaining)
      .transaction();

    // session_key (ESP32 hardware key) signs; wallet pays fees
    const txSig = await sendTx(swapTx, [sessionKeypair]);
    console.log("  executeDlmmSwap tx:", txSig);

    // Verify TX actually succeeded (confirmTransaction doesn't throw on instruction errors)
    const txInfo = await baseConnection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo?.meta?.err) {
      console.log("  TX meta.err:", JSON.stringify(txInfo.meta.err));
      console.log("  TX logs:", txInfo.meta.logMessages?.slice(0, 10));
      throw new Error(`executeDlmmSwap TX failed: ${JSON.stringify(txInfo.meta.err)}`);
    }

    // Verify session state
    const session = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.equal(
      session.spentLamports.toNumber(),
      SWAP_AMOUNT_IN,
      "spentLamports should equal amount_in",
    );
    assert.equal(session.totalActions.toNumber(), 1, "totalActions should be 1");

    // Verify token X balance decreased
    const postBalX = (await getAccount(baseConnection, sessionAtaX)).amount;
    assert.ok(postBalX < preBalX, "Token X balance should have decreased after swap");
    console.log(`  Token X: ${preBalX} → ${postBalX}`);
  });

  it("2. Reject DLMM swap when exposure limit would be exceeded", async function () {
    this.timeout(30_000);

    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });
    // swapForY=true: X→Y direction (same as test 1)
    const binArrays = await dlmmPool.getBinArrayForSwap(true);
    const binArrayRemaining = binArrays.map((ba) => ({
      pubkey: ba.publicKey,
      isWritable: true,
      isSigner: false,
    }));

    // MAX_LAMPORTS + 1 always exceeds the cap regardless of whether test 1 passed.
    // If test 1 passed: new_spent = 100_000 + 1_000_001 = 1_100_001 > 1_000_000 ✓
    // If test 1 failed: new_spent = 0 + 1_000_001 = 1_000_001 > 1_000_000 ✓
    const overLimit = MAX_LAMPORTS + 1;

    const overTx = await baseProgram.methods
      .executeDlmmSwap(new anchor.BN(overLimit), new anchor.BN(0))
      .accounts({
        sessionKey,
        session: sessionPda,
        lbPair,
        binArrayBitmapExtension: bitmapExt,
        reserveX: dlmmPool.lbPair.reserveX,
        reserveY: dlmmPool.lbPair.reserveY,
        userTokenIn: sessionAtaX,
        userTokenOut: sessionAtaY,
        tokenXMint: dlmmPool.lbPair.tokenXMint,
        tokenYMint: dlmmPool.lbPair.tokenYMint,
        oracle: dlmmPool.lbPair.oracle,
        eventAuthority,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(binArrayRemaining)
      .transaction();

    overTx.feePayer = wallet.publicKey;
    overTx.recentBlockhash = (await baseConnection.getLatestBlockhash()).blockhash;
    overTx.partialSign(sessionKeypair);
    const signedOverTx = await baseProvider.wallet.signTransaction(overTx);

    try {
      // skipPreflight: false → simulation catches ExposureLimitExceeded before broadcast
      await baseConnection.sendRawTransaction(signedOverTx.serialize(), {
        skipPreflight: false,
      });
      assert.fail("Expected ExposureLimitExceeded but transaction succeeded");
    } catch (e: any) {
      const msg: string = e.message ?? e.toString() ?? JSON.stringify(e);
      const hasExposureErr =
        msg.includes("ExposureLimitExceeded") ||
        msg.includes(ERR_EXPOSURE_LIMIT) ||
        msg.includes("6003");
      assert.ok(
        hasExposureErr,
        `Expected ExposureLimitExceeded error, got: ${msg.slice(0, 200)}`,
      );
      console.log("  ExposureLimitExceeded correctly rejected ✓");
    }

    // Verify session state is unchanged
    const sessionAfter = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.equal(
      sessionAfter.totalActions.toNumber(),
      1,
      "totalActions should still be 1 (swap was rejected)",
    );
    assert.equal(
      sessionAfter.spentLamports.toNumber(),
      SWAP_AMOUNT_IN,
      "spentLamports should be unchanged after rejected swap",
    );
  });

  it("3. Execute DLMM add liquidity via session key on base layer", async function () {
    this.timeout(60_000);

    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });

    // LiquidityParameterByStrategy — Anchor IDL camelCase fields.
    // strategyType uses Anchor enum encoding: { variantName: {} }
    // parameteres: typo preserved from Meteora IDL (64-byte extra params, all 0 for Spot)
    const liquidityParam = {
      amountX: new BN(ADD_LIQ_AMOUNT),
      amountY: new BN(ADD_LIQ_AMOUNT),
      activeId: setupActiveBinId,
      maxActiveBinSlippage: 15,
      strategyParameters: {
        minBinId: setupActiveBinId - BIN_RANGE,
        maxBinId: setupActiveBinId + BIN_RANGE,
        strategyType: { spotBalanced: {} }, // StrategyType.SpotBalanced (index 3)
        parameteres: new Array(64).fill(0), // [u8; 64] extra params (Meteora typo)
      },
    };

    const addLiqTx = await baseProgram.methods
      .executeDlmmAddLiquidity(liquidityParam)
      .accounts({
        sessionKey,
        session: sessionPda,
        position: sessionPositionKeypair.publicKey,
        lbPair,
        binArrayBitmapExtension: bitmapExt,
        userTokenX: sessionAtaX,
        userTokenY: sessionAtaY,
        reserveX: dlmmPool.lbPair.reserveX,
        reserveY: dlmmPool.lbPair.reserveY,
        tokenXMint: dlmmPool.lbPair.tokenXMint,
        tokenYMint: dlmmPool.lbPair.tokenYMint,
        binArrayLower,
        binArrayUpper,
        // dlmmProgram auto-resolved from address constraint in IDL
        eventAuthority,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    const txSig = await sendTx(addLiqTx, [sessionKeypair]);
    console.log("  executeDlmmAddLiquidity tx:", txSig);

    // Verify TX succeeded
    const txInfo = await baseConnection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo?.meta?.err) {
      console.log("  TX meta.err:", JSON.stringify(txInfo.meta.err));
      console.log("  TX logs:", txInfo.meta.logMessages?.slice(0, 10));
      throw new Error(`executeDlmmAddLiquidity TX failed: ${JSON.stringify(txInfo.meta.err)}`);
    }

    // Verify session state: totalActions incremented, spentLamports increased
    const session = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.equal(session.totalActions.toNumber(), 2, "totalActions should be 2 after swap + add_liq");
    assert.equal(
      session.spentLamports.toNumber(),
      SWAP_AMOUNT_IN + ADD_LIQ_AMOUNT + ADD_LIQ_AMOUNT,
      "spentLamports should include both swap and add_liq amounts",
    );
    console.log("  spentLamports:", session.spentLamports.toNumber(), "/", MAX_LAMPORTS);
  });

  it("4. Reject DLMM add liquidity when exposure limit would be exceeded", async function () {
    this.timeout(30_000);

    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });

    // amount_x + amount_y = MAX_LAMPORTS * 2 >> remaining cap — always exceeds
    const overLimitParam = {
      amountX: new BN(MAX_LAMPORTS),
      amountY: new BN(MAX_LAMPORTS),
      activeId: setupActiveBinId,
      maxActiveBinSlippage: 15,
      strategyParameters: {
        minBinId: setupActiveBinId - BIN_RANGE,
        maxBinId: setupActiveBinId + BIN_RANGE,
        strategyType: { spotBalanced: {} },
        parameteres: new Array(64).fill(0),
      },
    };

    const overTx = await baseProgram.methods
      .executeDlmmAddLiquidity(overLimitParam)
      .accounts({
        sessionKey,
        session: sessionPda,
        position: sessionPositionKeypair.publicKey,
        lbPair,
        binArrayBitmapExtension: bitmapExt,
        userTokenX: sessionAtaX,
        userTokenY: sessionAtaY,
        reserveX: dlmmPool.lbPair.reserveX,
        reserveY: dlmmPool.lbPair.reserveY,
        tokenXMint: dlmmPool.lbPair.tokenXMint,
        tokenYMint: dlmmPool.lbPair.tokenYMint,
        binArrayLower,
        binArrayUpper,
        eventAuthority,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    overTx.feePayer = wallet.publicKey;
    overTx.recentBlockhash = (await baseConnection.getLatestBlockhash()).blockhash;
    overTx.partialSign(sessionKeypair);
    const signedOverTx = await baseProvider.wallet.signTransaction(overTx);

    try {
      await baseConnection.sendRawTransaction(signedOverTx.serialize(), {
        skipPreflight: false,
      });
      assert.fail("Expected ExposureLimitExceeded but transaction succeeded");
    } catch (e: any) {
      const msg: string = e.message ?? e.toString() ?? JSON.stringify(e);
      const hasExposureErr =
        msg.includes("ExposureLimitExceeded") ||
        msg.includes(ERR_EXPOSURE_LIMIT) ||
        msg.includes("6003");
      assert.ok(
        hasExposureErr,
        `Expected ExposureLimitExceeded error, got: ${msg.slice(0, 200)}`,
      );
      console.log("  ExposureLimitExceeded correctly rejected ✓");
    }

    // Session state should be unchanged
    const sessionAfter = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.equal(
      sessionAfter.totalActions.toNumber(),
      2,
      "totalActions should still be 2",
    );
  });

  it("5. Close DLMM position via session key (remove all liquidity + close)", async function () {
    this.timeout(60_000);

    dlmmPool = await DLMM.create(baseConnection, lbPair, { cluster: "devnet" });

    const preBalX = (await getAccount(baseConnection, sessionAtaX)).amount;
    const preBalY = (await getAccount(baseConnection, sessionAtaY)).amount;

    const closeTx = await baseProgram.methods
      .executeDlmmClosePosition()
      .accounts({
        sessionKey,
        session: sessionPda,
        position: sessionPositionKeypair.publicKey,
        lbPair,
        binArrayBitmapExtension: bitmapExt,
        userTokenX: sessionAtaX,
        userTokenY: sessionAtaY,
        reserveX: dlmmPool.lbPair.reserveX,
        reserveY: dlmmPool.lbPair.reserveY,
        tokenXMint: dlmmPool.lbPair.tokenXMint,
        tokenYMint: dlmmPool.lbPair.tokenYMint,
        binArrayLower,
        binArrayUpper,
        rentReceiver: sessionKey, // session key reclaims position rent
        // dlmmProgram auto-resolved from address constraint in IDL
        eventAuthority,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    const txSig = await sendTx(closeTx, [sessionKeypair]);
    console.log("  executeDlmmClosePosition tx:", txSig);

    // Verify TX succeeded
    const txInfo = await baseConnection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo?.meta?.err) {
      console.log("  TX meta.err:", JSON.stringify(txInfo.meta.err));
      console.log("  TX logs:", txInfo.meta.logMessages?.slice(0, 10));
      throw new Error(`executeDlmmClosePosition TX failed: ${JSON.stringify(txInfo.meta.err)}`);
    }

    // Position account should be closed (null or reassigned to System program)
    const positionInfo = await baseConnection.getAccountInfo(
      sessionPositionKeypair.publicKey,
    );
    assert.ok(
      positionInfo === null || positionInfo.data.length === 0,
      "Position account should be closed after executeDlmmClosePosition",
    );
    console.log("  Position account closed ✓");

    // Token balances should have increased (liquidity returned)
    const postBalX = (await getAccount(baseConnection, sessionAtaX)).amount;
    const postBalY = (await getAccount(baseConnection, sessionAtaY)).amount;
    assert.ok(postBalX >= preBalX, "Token X balance should not decrease after close");
    assert.ok(postBalY >= preBalY, "Token Y balance should not decrease after close");
    console.log(`  Token X: ${preBalX} → ${postBalX}`);
    console.log(`  Token Y: ${preBalY} → ${postBalY}`);

    // Session: totalActions incremented; spentLamports unchanged
    const session = await baseProgram.account.agentSession.fetch(sessionPda);
    assert.equal(session.totalActions.toNumber(), 3, "totalActions should be 3");
    assert.equal(
      session.spentLamports.toNumber(),
      SWAP_AMOUNT_IN + ADD_LIQ_AMOUNT + ADD_LIQ_AMOUNT,
      "spentLamports should be unchanged (close returns tokens, doesn't spend)",
    );
  });
});
