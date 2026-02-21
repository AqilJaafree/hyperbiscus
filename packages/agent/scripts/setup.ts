/**
 * setup.ts — One-time bootstrap: creates the on-chain state needed to run the agent.
 *
 * Run once before `pnpm start`:
 *   cd packages/agent && pnpm setup
 *
 * What it does:
 *   1. Loads your wallet from SESSION_KEYPAIR_PATH (default: ~/.config/solana/id.json)
 *   2. Generates a fresh ownerKeypair (funds it from wallet) — avoids stuck delegated PDAs
 *   3. Creates two SPL test mints and a Meteora DLMM pool
 *   4. Adds symmetric liquidity so checkLpPosition has real data to read
 *   5. Initializes an AgentSession PDA (owner = ownerKeypair, session_key = wallet)
 *   6. Creates a DLMM position owned by the wallet
 *   7. Registers an LpPositionMonitor PDA
 *   8. Writes SESSION_PDA, LB_PAIR, POSITION_PUBKEY into .env
 *
 * The wallet is the session_key — it signs update_lp_status each tick.
 * The ownerKeypair is ephemeral — only needed for this setup, not the agent loop.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
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
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── Constants ────────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("8reNvTG6PLT4sf4nGbT7VjZ1YqEGXzASkjcSQmQTkJPT");
const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ENV_PATH = path.resolve(__dirname, "../.env");
const SESSION_DURATION_SECS = 60 * 60 * 24 * 7; // 7 days
const MAX_LAMPORTS = 10_000_000; // 0.01 SOL exposure cap for demo
const BIN_RANGE = 5;
const STRATEGY_LP = 1 << 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadWallet(): Keypair {
  const p = (process.env.SESSION_KEYPAIR_PATH ?? "~/.config/solana/id.json")
    .replace("~", os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

function updateEnv(key: string, value: string) {
  let content = fs.readFileSync(ENV_PATH, "utf-8");
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, "utf-8");
}

/**
 * Send and confirm a TX. wallet is always feePayer.
 * extraSigners are additional required signers (e.g. ownerKeypair, positionKeypair).
 */
async function sendTx(
  connection: Connection,
  wallet: Keypair,
  tx: Transaction,
  extraSigners: Keypair[] = [],
): Promise<string> {
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
  // wallet must sign first (feePayer), then extra signers
  const allSigners = [wallet, ...extraSigners];
  const sig = await sendAndConfirmTransaction(connection, tx, allSigners, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const txInfo = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (txInfo?.meta?.err) {
    throw new Error(
      `TX failed: ${JSON.stringify(txInfo.meta.err)}\n` +
        (txInfo.meta.logMessages ?? []).slice(0, 10).join("\n"),
    );
  }
  return sig;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║   hyperbiscus agent — one-time setup          ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet();
  console.log("Wallet (session key):", wallet.publicKey.toBase58());

  const bal = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", (bal / LAMPORTS_PER_SOL).toFixed(4), "SOL");
  if (bal < 0.3 * LAMPORTS_PER_SOL) {
    throw new Error("Need at least 0.3 SOL on devnet. Fund at https://faucet.solana.com");
  }

  // ── Fresh ownerKeypair ───────────────────────────────────────────────────
  // A fresh keypair avoids stuck delegated PDAs from previous test runs.
  // Owner only needs to sign setup TXs — not needed by the agent loop.
  const ownerKeypair = Keypair.generate();
  console.log("\nFresh owner:", ownerKeypair.publicKey.toBase58());

  // Derive PDAs
  const [sessionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("session"), ownerKeypair.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [monitorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_monitor"), sessionPda.toBuffer()],
    PROGRAM_ID,
  );
  console.log("Session PDA:", sessionPda.toBase58());
  console.log("Monitor PDA:", monitorPda.toBase58());

  // Load program
  const idlPath = path.resolve(__dirname, "../../contracts/target/idl/defi_agent.json");
  const idl = require(idlPath);
  const walletAdapter = new anchor.Wallet(wallet);
  const provider = new anchor.AnchorProvider(connection, walletAdapter, { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

  // ── Fund ownerKeypair ────────────────────────────────────────────────────
  // Owner pays rent for AgentSession (~0.001 SOL) and LpPositionMonitor (~0.002 SOL)
  console.log("\nFunding owner...");
  const fundSig = await sendTx(connection, wallet, new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: ownerKeypair.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
  ));
  console.log("  Funded:", fundSig);
  await sleep(2000);

  // ── Create SPL mints ─────────────────────────────────────────────────────
  console.log("\nCreating SPL token mints...");
  const rawMintA = await createMint(
    connection, wallet, wallet.publicKey, null, 6,
    undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID,
  );
  const rawMintB = await createMint(
    connection, wallet, wallet.publicKey, null, 6,
    undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID,
  );
  const [mintX, mintY] = rawMintA.toBuffer().compare(rawMintB.toBuffer()) < 0
    ? [rawMintA, rawMintB] : [rawMintB, rawMintA];
  console.log("  mintX:", mintX.toBase58());
  console.log("  mintY:", mintY.toBase58());

  const walletAtaX = await createAssociatedTokenAccount(
    connection, wallet, mintX, wallet.publicKey, { commitment: "confirmed" },
  );
  const walletAtaY = await createAssociatedTokenAccount(
    connection, wallet, mintY, wallet.publicKey, { commitment: "confirmed" },
  );
  await mintTo(connection, wallet, mintX, walletAtaX, wallet.publicKey, 100_000_000_000, [], { commitment: "confirmed" });
  await mintTo(connection, wallet, mintY, walletAtaY, wallet.publicKey, 100_000_000_000, [], { commitment: "confirmed" });
  console.log("  Minted 100k X + 100k Y to wallet");

  // ── Create DLMM pool ─────────────────────────────────────────────────────
  console.log("\nCreating Meteora DLMM pool...");
  const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
    connection, new BN(10), mintX, mintY, new BN(0), new BN(4),
    ActivationType.Slot, false, wallet.publicKey,
  );
  createPoolTx.feePayer = wallet.publicKey;
  createPoolTx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
  const poolSig = await sendAndConfirmTransaction(connection, createPoolTx, [wallet], {
    commitment: "confirmed", skipPreflight: true,
  });
  console.log("  Pool created:", poolSig);

  const [lbPair] = deriveCustomizablePermissionlessLbPair(mintX, mintY, DLMM_PROGRAM_ID);
  console.log("  LB Pair:", lbPair.toBase58());
  await sleep(3000);

  // ── Add liquidity + create position ──────────────────────────────────────
  console.log("\nAdding liquidity and creating position...");
  const dlmmPool = await DLMM.create(connection, lbPair, { cluster: "devnet" });
  const activeBin = await dlmmPool.getActiveBin();
  console.log("  Active bin:", activeBin.binId);

  const positionKeypair = Keypair.generate();
  console.log("  Position:", positionKeypair.publicKey.toBase58());

  const addLiqTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    user: wallet.publicKey,
    totalXAmount: new BN(25_000_000_000),
    totalYAmount: new BN(25_000_000_000),
    strategy: {
      maxBinId: activeBin.binId + BIN_RANGE,
      minBinId: activeBin.binId - BIN_RANGE,
      strategyType: StrategyType.Spot,
      singleSidedX: false,
    },
  });
  addLiqTx.feePayer = wallet.publicKey;
  addLiqTx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
  addLiqTx.partialSign(positionKeypair);
  const liqSig = await sendAndConfirmTransaction(connection, addLiqTx, [wallet, positionKeypair], {
    commitment: "confirmed", skipPreflight: true,
  });
  console.log("  Liquidity added:", liqSig);
  await sleep(3000);

  // ── Initialize session ───────────────────────────────────────────────────
  // owner = ownerKeypair (fresh keypair, pays rent for session PDA)
  // session_key = wallet (the "ESP32 key" — signs update_lp_status each tick)
  console.log("\nInitializing session...");
  const initIx = await program.methods
    .initializeSession(
      wallet.publicKey,                    // session_key = wallet for demo
      new anchor.BN(SESSION_DURATION_SECS),
      new anchor.BN(MAX_LAMPORTS),
      STRATEGY_LP,
    )
    .accounts({ owner: ownerKeypair.publicKey })
    .instruction();

  // ownerKeypair pays rent (payer = owner in contract) — wallet pays TX fee
  const initTx = new Transaction().add(initIx);
  initTx.feePayer = wallet.publicKey;
  initTx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
  initTx.partialSign(ownerKeypair);
  const initSig = await sendAndConfirmTransaction(connection, initTx, [wallet, ownerKeypair], {
    commitment: "confirmed", skipPreflight: true,
  });
  console.log("  Session initialized:", initSig);
  await sleep(2000);

  // ── Register LP monitor ──────────────────────────────────────────────────
  console.log("\nRegistering LP monitor...");
  const registerIx = await program.methods
    .registerLpMonitor(
      lbPair,
      positionKeypair.publicKey,
      activeBin.binId - BIN_RANGE,
      activeBin.binId + BIN_RANGE,
    )
    .accounts({
      owner: ownerKeypair.publicKey,
      session: sessionPda,
      monitor: monitorPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const regTx = new Transaction().add(registerIx);
  regTx.feePayer = wallet.publicKey;
  regTx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
  regTx.partialSign(ownerKeypair);
  const regSig = await sendAndConfirmTransaction(connection, regTx, [wallet, ownerKeypair], {
    commitment: "confirmed", skipPreflight: true,
  });
  console.log("  LP monitor registered:", regSig);

  // ── Write .env ────────────────────────────────────────────────────────────
  console.log("\nWriting to .env...");
  updateEnv("SESSION_PDA", sessionPda.toBase58());
  updateEnv("LB_PAIR", lbPair.toBase58());
  updateEnv("POSITION_PUBKEY", positionKeypair.publicKey.toBase58());

  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║   Setup complete!                             ║");
  console.log("╠═══════════════════════════════════════════════╣");
  console.log(`║  SESSION_PDA     ${sessionPda.toBase58().slice(0, 20)}...  ║`);
  console.log(`║  LB_PAIR         ${lbPair.toBase58().slice(0, 20)}...  ║`);
  console.log(`║  POSITION_PUBKEY ${positionKeypair.publicKey.toBase58().slice(0, 20)}...  ║`);
  console.log("╠═══════════════════════════════════════════════╣");
  console.log("║   Run the agent:  pnpm start                  ║");
  console.log("╚═══════════════════════════════════════════════╝");
}

main().catch((err) => {
  console.error("\n[setup error]", err.message ?? err);
  process.exit(1);
});
