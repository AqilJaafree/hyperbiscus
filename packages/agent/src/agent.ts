/**
 * agent.ts — Main agent tick logic: ReAct loop with Claude tool calling.
 *
 * Each tick:
 *   1. Build context from SOUL.md (system) + recent MEMORY.md (user context)
 *   2. Send to Claude with check_lp_position + update_lp_status tools
 *   3. Execute tool calls until Claude reaches end_turn
 *   4. Append Claude's summary to MEMORY.md
 *   5. Return TickResult for broadcasting over WebSocket
 *
 * This mirrors MimiClaw's ReAct loop running on the ESP32-S3 in C.
 * On the real device this same logic runs every 30s via the cron scheduler.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { AgentConfig } from "./config";
import { SolanaContext } from "./solana";
import { TickMessage } from "./ws-server";
import {
  TOOL_DEFINITIONS,
  buildToolExecutors,
  executeTool,
} from "./tools";
import { loadSoul, loadRecentMemory, appendMemory } from "./memory";

export async function runTick(
  client: Anthropic,
  config: AgentConfig,
  ctx: SolanaContext,
  tickNumber: number,
): Promise<TickMessage> {
  const soul = loadSoul();
  const recentMemory = loadRecentMemory();
  const executors = buildToolExecutors(config, ctx);
  const timestamp = new Date().toISOString();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`[tick ${tickNumber}] ${timestamp}`);
  console.log(`${"─".repeat(60)}`);

  // Capture tool outputs for broadcasting
  let checkResult: any = null;
  let txResult: any = null;

  const messages: MessageParam[] = [
    {
      role: "user",
      content:
        `Tick ${tickNumber} — ${timestamp}\n\n` +
        `Recent memory:\n${recentMemory}\n\n` +
        `Check the LP position and update the on-chain status.`,
    },
  ];

  let summary = "";

  // ReAct loop — continues until Claude stops calling tools
  while (true) {
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: soul,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      summary = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("")
        .trim();

      if (summary) {
        console.log(`\n[agent] ${summary}`);
        appendMemory(summary);
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`  → tool: ${block.name}`, JSON.stringify(block.input));

        let resultContent: string;
        try {
          const result = await executeTool(block.name, block.input, executors);
          resultContent = JSON.stringify(result);
          console.log(`  ← ${block.name}:`, resultContent);

          // Capture outputs for WS broadcast
          if (block.name === "check_lp_position") checkResult = result;
          if (block.name === "update_lp_status") txResult = result;
        } catch (err: any) {
          resultContent = JSON.stringify({ error: err.message });
          console.error(`  ← ${block.name} ERROR:`, err.message);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultContent,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    console.warn(`[agent] unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  return {
    type: "tick",
    tickNumber,
    timestamp,
    activeBin: checkResult?.activeBin ?? null,
    positionMinBin: checkResult?.positionMinBin ?? null,
    positionMaxBin: checkResult?.positionMaxBin ?? null,
    isInRange: checkResult?.isInRange ?? null,
    feeX: checkResult?.feeX ?? null,
    feeY: checkResult?.feeY ?? null,
    txSignature: txResult?.signature ?? null,
    explorerUrl: txResult?.explorer ?? null,
    summary,
    error: null,
  };
}
