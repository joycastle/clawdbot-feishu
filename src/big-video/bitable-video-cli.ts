#!/usr/bin/env npx tsx
/**
 * Bitable Video CLI — standalone entry point for video analysis.
 *
 * Instead of hard-coded regex parsing in bot.ts, the LLM agent recognizes
 * user intent naturally, then invokes this CLI with structured arguments.
 *
 * Usage:
 *   npx tsx src/big-video/bitable-video-cli.ts --target latest --prompt "请分析这个视频的内容"
 *   npx tsx src/big-video/bitable-video-cli.ts --target 3 --prompt "帮我看看这个视频讲了什么"
 *
 * Arguments:
 *   --target   "latest" or a record number (required)
 *   --prompt   Analysis prompt text (optional, has sensible default)
 *
 * Output: JSON to stdout with { text, cacheHit, gcsUri, durationMs, estimatedCostUsd }
 * Logs go to stderr so they don't pollute the JSON output.
 */
 
import fs from "node:fs";
import os from "node:os";
import { handleBitableVideoRequest } from "./bitable-video-handler.js";
import type { VideoCommand } from "./bitable-video.js";
import { sendMessageFeishu } from "../send.js";
 
const args = process.argv.slice(2);
let targetArg: string | undefined;
let promptArg: string | undefined;
let notifyTo: string | undefined;
let notifyReplyTo: string | undefined;
 
for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--target" || args[i] === "-t") && args[i + 1]) {
    targetArg = args[i + 1];
    i++;
  } else if ((args[i] === "--prompt" || args[i] === "-p") && args[i + 1]) {
    promptArg = args[i + 1];
    i++;
  } else if (args[i] === "--notify-to" && args[i + 1]) {
    notifyTo = args[i + 1];
    i++;
  } else if (args[i] === "--notify-reply-to" && args[i + 1]) {
    notifyReplyTo = args[i + 1];
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(
      `Usage: npx tsx bitable-video-cli.ts --target <latest|number> [--prompt "text"] [--notify-to "<chatId|user:openId|chat:chatId>"] [--notify-reply-to "<messageId>"]`,
    );
    console.log(`  --target, -t   "latest" or a record auto-number (required)`);
    console.log(`  --prompt, -p   Analysis prompt (default: "请分析这个视频的内容")`);
    console.log(`  --notify-to    Where to send progress updates (optional)`);
    console.log(`  --notify-reply-to  Reply-to message_id for progress updates (optional)`);
    process.exit(0);
  }
}
 
if (!targetArg) {
  console.error("Error: --target is required (use 'latest' or a number)");
  process.exit(1);
}
 
const targetArgValue = targetArg as string;
 
const target: "latest" | number =
  targetArgValue === "latest" ? "latest" : parseInt(targetArgValue, 10);
 
if (typeof target === "number" && isNaN(target)) {
  console.error(`Error: invalid target "${targetArgValue}" — must be "latest" or an integer`);
  process.exit(1);
}
 
const prompt = promptArg || "请分析这个视频的内容";
 
const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.clawdbot/clawdbot.json`;
 
if (!fs.existsSync(configPath)) {
  console.error(`Error: config not found at ${configPath}`);
  process.exit(1);
}
 
const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
 
const command: VideoCommand = { target, prompt };
 
try {
  const notify =
    notifyTo && notifyReplyTo
      ? async (msg: string) => {
          await sendMessageFeishu({
            cfg,
            to: notifyTo,
            text: msg,
            replyToMessageId: notifyReplyTo,
          });
        }
      : undefined;
 
  const result = await handleBitableVideoRequest({
    cfg,
    command,
    log: (msg: string) => console.error(msg),
    notify,
  });
 
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
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}
