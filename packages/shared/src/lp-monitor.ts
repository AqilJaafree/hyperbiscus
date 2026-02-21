/**
 * lp-monitor.ts — Off-chain LP position monitoring for Meteora DLMM.
 *
 * The ESP32 agent calls `checkLpPosition()` after each cron tick to determine:
 *   • Whether the pool's active bin is still inside the position's bin range
 *   • Current unclaimed fee balances for both tokens
 *
 * Results are then submitted on-chain via the `update_lp_status` instruction
 * so the mobile app can read the latest status from the `LpPositionMonitor` PDA.
 *
 * Architecture: read-only RPC queries — no transactions, no signing.
 *
 * Implementation note: we decode the position account directly by its pubkey
 * rather than using `getPositionsByUserAndLbPair`, which changed behaviour in
 * DLMM SDK v1.9.x and is unreliable for session-key-owned positions.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";

export interface LpPositionStatus {
  /** Pool's current active bin */
  activeBin: number;
  /** Position's configured lower bin boundary */
  positionMinBin: number;
  /** Position's configured upper bin boundary */
  positionMaxBin: number;
  /** True when activeBin ∈ [positionMinBin, positionMaxBin] */
  isInRange: boolean;
  /** Unclaimed fee token X (raw, pending; 0 if not available) */
  feeX: BN;
  /** Unclaimed fee token Y (raw, pending; 0 if not available) */
  feeY: BN;
}

/**
 * Query the current status of a Meteora DLMM LP position.
 *
 * Fetches the position account directly by pubkey and decodes it using the
 * DLMM program's Anchor coder (tries positionV2 then position account type).
 * This avoids the user-based lookup that broke in SDK v1.9.x.
 *
 * @param connection     - Solana RPC connection (base layer)
 * @param lbPair         - The DLMM pool (LbPair) address
 * @param positionPubkey - The DLMM position account to inspect
 * @param cluster        - "devnet" | "mainnet-beta" (passed to DLMM SDK)
 */
export async function checkLpPosition(
  connection: Connection,
  lbPair: PublicKey,
  positionPubkey: PublicKey,
  cluster: "devnet" | "mainnet-beta" = "devnet",
): Promise<LpPositionStatus> {
  const dlmmPool = await DLMM.create(connection, lbPair, { cluster });

  // Fetch active bin + raw position account in parallel
  const [activeBinInfo, positionAccountInfo] = await Promise.all([
    dlmmPool.getActiveBin(),
    connection.getAccountInfo(positionPubkey),
  ]);

  if (!positionAccountInfo) {
    throw new Error(
      `Position account ${positionPubkey.toBase58()} not found on-chain`,
    );
  }

  // Decode the position account via the DLMM program's Anchor coder.
  // Try positionV2 first (DLMM v1.2+), fall back to position (older pools).
  const prog = (dlmmPool as any).program;
  let minBinId = 0;
  let maxBinId = 0;
  let feeX = new BN(0);
  let feeY = new BN(0);

  for (const accountType of ["positionV2", "position"]) {
    try {
      const decoded = prog.coder.accounts.decode(
        accountType,
        positionAccountInfo.data,
      );
      minBinId = decoded.lowerBinId;
      maxBinId = decoded.upperBinId;

      // feeInfos[i].feeXPending / feeYPending — pending fee shares per bin slot
      if (Array.isArray(decoded.feeInfos)) {
        for (const fi of decoded.feeInfos) {
          feeX = feeX.add(new BN(fi.feeXPending?.toString() ?? "0"));
          feeY = feeY.add(new BN(fi.feeYPending?.toString() ?? "0"));
        }
      }
      break;
    } catch (_) {
      continue;
    }
  }

  const activeBin = activeBinInfo.binId;
  const isInRange = activeBin >= minBinId && activeBin <= maxBinId;

  return {
    activeBin,
    positionMinBin: minBinId,
    positionMaxBin: maxBinId,
    isInRange,
    feeX,
    feeY,
  };
}
