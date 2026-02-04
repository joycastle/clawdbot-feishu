#!/usr/bin/env npx tsx
/**
 * Bitable Video CLI — standalone entry point for video analysis.
 *
 * Instead of hard-coded regex parsing in bot.ts, the LLM agent recognizes
 * user intent naturally, then invokes this CLI with structured arguments.
 *
 * Usage:
 *   npx tsx src/bitable-video-cli.ts --target latest --prompt "请分析这个视频的内容"
 *   npx tsx src/bitable-video-cli.ts --target 3 --prompt "帮我看看这个视频讲了什么"
 *
 * Arguments:
 *   --target   "latest" or a record number (required)
 *   --prompt   Analysis prompt text (optional, has sensible default)
 *
 * Output: JSON to stdout with { text, cacheHit, gcsUri, durationMs, estimatedCostUsd }
 * Logs go to stderr so they don't pollute the JSON output.
 */

import fs from "fs";
import { handleBitableVideoRequest } from "./bitable-video-handler.js";
import type { VideoCommand } from "./bitable-video.js";

// ─── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let targetArg: string | undefined;
let promptArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--target" || args[i] === "-t") && args[i + 1]) {
    targetArg = args[i + 1];
    i++;
  } else if ((args[i] === "--prompt" || args[i] === "-p") && args[i + 1]) {
    promptArg = args[i + 1];
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`Usage: npx tsx bitable-video-cli.ts --target <latest|number> [--prompt "text"]`);
    console.log(`  --target, -t   "latest" or a record auto-number (required)`);
    console.log(`  --prompt, -p   Analysis prompt (default: "请分析这个视频的内容")`);
    process.exit(0);
  }
}

if (!targetArg) {
  console.error("Error: --target is required (use 'latest' or a number)");
  process.exit(1);
}

const target: "latest" | number =
  targetArg === "latest" ? "latest" : parseInt(targetArg, 10);

if (typeof target === "number" && isNaN(target)) {
  console.error(`Error: invalid target "${targetArg}" — must be "latest" or an integer`);
  process.exit(1);
}

const prompt = promptArg || "请分析这个视频的内容";

// ─── Load Clawdbot config ────────────────────────────────────────────────────

const configPath = process.env.CLAWDBOT_CONFIG || "/home/ubuntu/.clawdbot/clawdbot.json";

if (!fs.existsSync(configPath)) {
  console.error(`Error: config not found at ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// ─── Run pipeline ────────────────────────────────────────────────────────────

const command: VideoCommand = { target, prompt };

try {
  const result = await handleBitableVideoRequest({
    cfg,
    command,
    log: (msg: string) => console.error(msg), // logs → stderr
  });

  // Output structured result to stdout
  const output = {
    text: result.text,
    cacheHit: result.cacheHit,
    gcsUri: result.gcsUri,
    durationMs: result.analysis.durationMs,
    estimatedCostUsd: result.analysis.estimatedCostUsd,
    model: result.analysis.model,
    usage: result.analysis.usage,
  };

  console.log(JSON.stringify(output));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  // Output error as JSON too, so caller can parse it
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}
