/**
 * memory.ts — Persistent agent memory, mirroring MimiClaw's SOUL.md / MEMORY.md pattern.
 *
 * SOUL.md  — static agent personality, loaded once at startup
 * MEMORY.md — append-only log of decisions; last N entries fed to Claude each tick
 */

import * as fs from "fs";
import * as path from "path";

const SOUL_PATH = path.resolve(__dirname, "../SOUL.md");
const MEMORY_PATH = path.resolve(__dirname, "../MEMORY.md");

// Max recent memory lines fed to Claude per tick (keeps prompt small)
const MEMORY_TAIL_LINES = 30;

export function loadSoul(): string {
  return fs.readFileSync(SOUL_PATH, "utf-8");
}

export function loadRecentMemory(): string {
  if (!fs.existsSync(MEMORY_PATH)) return "(no memory yet)";
  const lines = fs.readFileSync(MEMORY_PATH, "utf-8").trim().split("\n");
  return lines.slice(-MEMORY_TAIL_LINES).join("\n");
}

/**
 * Strip characters that could be used for prompt injection before persisting
 * user-supplied text to MEMORY.md (which is replayed into Claude's context).
 */
export function sanitizeMemoryEntry(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")          // flatten newlines/tabs
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "") // strip non-printable control chars
    .replace(/\[system\]/gi, "[user]")    // block fake [system] tags
    .replace(/\[inst\w*\]/gi, "")        // block [instruction] variants
    .trim()
    .slice(0, 500);                       // hard cap per entry
}

export function appendMemory(entry: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${sanitizeMemoryEntry(entry)}\n`;
  fs.appendFileSync(MEMORY_PATH, line, "utf-8");
}
