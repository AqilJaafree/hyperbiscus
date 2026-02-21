/**
 * chat.ts — Handle incoming chat messages from the mobile app.
 *
 * When the user sends a message via the mobile chat screen, the agent:
 *   1. Loads SOUL.md (personality) + recent MEMORY.md (context)
 *   2. Includes the last tick state so Claude knows the current position
 *   3. Lets Claude optionally call check_lp_position for fresh data
 *   4. Returns Claude's reply as a string
 *
 * This mirrors MimiClaw's Telegram bot handler on the ESP32 — same ReAct
 * loop, same memory, triggered by the user instead of the cron scheduler.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { AgentConfig } from "./config";
import { SolanaContext } from "./solana";
import { TickMessage } from "./ws-server";
import { TOOL_DEFINITIONS, buildToolExecutors, executeTool } from "./tools";
import { loadSoul, loadRecentMemory, appendMemory, sanitizeMemoryEntry } from "./memory";

export async function handleChat(
  client: Anthropic,
  config: AgentConfig,
  ctx: SolanaContext,
  userMessage: string,
  lastTick: TickMessage | null,
): Promise<string> {
  const soul = loadSoul();
  const recentMemory = loadRecentMemory();
  const executors = buildToolExecutors(config, ctx);

  // Give Claude the current position state so it can answer without needing
  // to call check_lp_position unless the user asks for fresh data.
  const positionContext = lastTick
    ? `Current position state (from last tick #${lastTick.tickNumber} at ${lastTick.timestamp}):\n` +
      `  active bin: ${lastTick.activeBin}\n` +
      `  range: [${lastTick.positionMinBin}, ${lastTick.positionMaxBin}]\n` +
      `  in range: ${lastTick.isInRange}\n` +
      `  fee X: ${lastTick.feeX}, fee Y: ${lastTick.feeY}\n` +
      `  last checkpoint TX: ${lastTick.txSignature ?? "none"}`
    : "No tick data yet — agent has not completed its first monitoring cycle.";

  const messages: MessageParam[] = [
    {
      role: "user",
      content:
        // Tag memory as untrusted so Claude doesn't treat it as instructions
        `<untrusted_memory>\n${recentMemory}\n</untrusted_memory>\n\n` +
        `${positionContext}\n\n` +
        `User message: ${userMessage}`,
    },
  ];

  let reply = "";
  const MAX_REACT_ITERATIONS = 10;
  let iterations = 0;

  // ReAct loop — Claude may call tools if it needs fresh data
  while (iterations++ < MAX_REACT_ITERATIONS) {
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: soul,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("")
        .trim();
      break;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let resultContent: string;
        try {
          const result = await executeTool(block.name, block.input, executors);
          resultContent = JSON.stringify(result);
        } catch (err: any) {
          resultContent = JSON.stringify({ error: err.message });
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

    break;
  }

  // Append sanitized exchange to memory (sanitizeMemoryEntry strips injection attempts)
  if (reply) {
    appendMemory(`[chat] User: ${sanitizeMemoryEntry(userMessage)}`);
    appendMemory(`[chat] Agent: ${sanitizeMemoryEntry(reply)}`);
  }

  return reply || "I couldn't generate a response. Please try again.";
}
