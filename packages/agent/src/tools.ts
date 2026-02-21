/**
 * tools.ts — Claude tool definitions and executors for the DeFi agent.
 *
 * Tools are the "actions" Claude can take each tick. The agent runs a ReAct
 * loop: reason → call tool → observe result → reason again → done.
 *
 * Available tools:
 *   check_lp_position  — read current position status off-chain (RPC only, no TX)
 *   update_lp_status   — submit on-chain checkpoint (signs with session key)
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { Tool } from "@anthropic-ai/sdk/resources/messages";
import BN from "bn.js";
import { checkLpPosition, LpPositionStatus } from "@hyperbiscus/shared";
import { AgentConfig } from "./config";
import { SolanaContext, submitUpdateLpStatus } from "./solana";

// Last check result — passed to update_lp_status so Claude doesn't re-fetch
let lastStatus: LpPositionStatus | null = null;

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "check_lp_position",
    description:
      "Read the current status of the Meteora DLMM LP position off-chain. " +
      "Returns: activeBin, positionMinBin, positionMaxBin, isInRange, feeX, feeY. " +
      "This is a read-only RPC call — no transaction.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "update_lp_status",
    description:
      "Submit the current LP position status to the on-chain LpPositionMonitor PDA. " +
      "Signed by the session key. Call this after check_lp_position to checkpoint on-chain.",
    input_schema: {
      type: "object" as const,
      properties: {
        active_bin: {
          type: "integer",
          description: "The pool's current active bin (from check_lp_position)",
        },
        fee_x: {
          type: "integer",
          description: "Unclaimed fee token X, raw units (from check_lp_position)",
        },
        fee_y: {
          type: "integer",
          description: "Unclaimed fee token Y, raw units (from check_lp_position)",
        },
      },
      required: ["active_bin", "fee_x", "fee_y"],
    },
  },
];

export interface ToolExecutors {
  check_lp_position: () => Promise<object>;
  update_lp_status: (input: {
    active_bin: number;
    fee_x: number;
    fee_y: number;
  }) => Promise<object>;
}

export function buildToolExecutors(
  config: AgentConfig,
  ctx: SolanaContext,
): ToolExecutors {
  const connection = new Connection(config.rpcUrl, "confirmed");

  return {
    async check_lp_position() {
      const status = await checkLpPosition(
        connection,
        config.lbPair,
        config.positionPubkey,
        "devnet",
      );
      lastStatus = status;
      return {
        activeBin: status.activeBin,
        positionMinBin: status.positionMinBin,
        positionMaxBin: status.positionMaxBin,
        isInRange: status.isInRange,
        feeX: status.feeX.toString(),
        feeY: status.feeY.toString(),
      };
    },

    async update_lp_status({ active_bin, fee_x, fee_y }) {
      const sig = await submitUpdateLpStatus(
        ctx,
        active_bin,
        new BN(fee_x),
        new BN(fee_y),
      );
      return {
        success: true,
        signature: sig,
        explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      };
    },
  };
}

export async function executeTool(
  name: string,
  input: unknown,
  executors: ToolExecutors,
): Promise<object> {
  switch (name) {
    case "check_lp_position":
      return executors.check_lp_position();
    case "update_lp_status": {
      const i = input as Record<string, unknown>;
      if (
        typeof i.active_bin !== "number" ||
        typeof i.fee_x !== "number" ||
        typeof i.fee_y !== "number"
      ) {
        throw new Error(
          "Invalid tool input: active_bin, fee_x, fee_y must be numbers",
        );
      }
      return executors.update_lp_status(
        i as { active_bin: number; fee_x: number; fee_y: number },
      );
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
