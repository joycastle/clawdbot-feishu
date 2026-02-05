#!/usr/bin/env npx tsx
/**
 * Bitable Video CLI — standalone entry point for video analysis.
 *
 * Two-step flow enforced by design:
 *
 *   Step 1 (default): Find video + upload to GCS + send confirm card.
 *     npx tsx bitable-video-cli.ts --target <latest|number> --prompt "分析需求" \
 *       --to "user:open_id" --reply-to "message_id"
 *     Sends an interactive card with cost estimate + confirm/cancel buttons.
 *     User clicks confirm → card callback in monitor.ts triggers Gemini analysis.
 *     No --analyze mode exists. Analysis only happens via card callback.
 *
 * Output: JSON to stdout. Logs go to stderr.
 */

import fs from "node:fs";
import os from "node:os";
import { handleUploadOnly } from "./bitable-video-handler.js";
import { estimateMediaCost } from "../cost-estimator.js";
import { initGcsConfig } from "./gcs-upload.js";
import { setCredentialsPath } from "../video-analyze.js";

const args = process.argv.slice(2);
let targetArg: string | undefined;
let promptArg: string | undefined;
let toArg: string | undefined;
let replyToArg: string | undefined;
let senderArg: string | undefined;
let urlArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--target" || args[i] === "-t") && args[i + 1]) {
    targetArg = args[i + 1]; i++;
  } else if ((args[i] === "--prompt" || args[i] === "-p") && args[i + 1]) {
    promptArg = args[i + 1]; i++;
  } else if (args[i] === "--to" && args[i + 1]) {
    toArg = args[i + 1]; i++;
  } else if (args[i] === "--reply-to" && args[i + 1]) {
    replyToArg = args[i + 1]; i++;
  } else if (args[i] === "--sender" && args[i + 1]) {
    senderArg = args[i + 1]; i++;
  } else if (args[i] === "--url" && args[i + 1]) {
    urlArg = args[i + 1]; i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`Usage:`);
    console.log(`  npx tsx bitable-video-cli.ts --target <latest|number|row:N> --prompt "text" \\`);
    console.log(`    --to "user:open_id" --reply-to "message_id" --sender "open_id" \\`);
    console.log(`    [--url "https://xxx.feishu.cn/base/APP_TOKEN?table=TABLE_ID"]`);
    console.log(`\nUploads video to GCS and sends a confirm/cancel card.`);
    console.log(`User clicks confirm → Gemini analysis runs automatically via card callback.`);
    process.exit(0);
  }
}

if (!targetArg) {
  console.error("Error: --target is required (use 'latest' or a number)");
  process.exit(1);
}
if (!toArg || !replyToArg) {
  console.error("Error: --to and --reply-to are required for sending confirm card");
  process.exit(1);
}

const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.clawdbot/clawdbot.json`;
if (!fs.existsSync(configPath)) {
  console.error(`Error: config not found at ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const prompt = promptArg || "请分析这个视频的内容";

// Initialize config
initGcsConfig(cfg);
const feishuCfg = cfg?.channels?.feishu as Record<string, unknown> | undefined;
if (feishuCfg?.gcsCredentialsPath) setCredentialsPath(feishuCfg.gcsCredentialsPath as string);

try {
  // Parse target: "latest", a number (auto-number), or "row:N" (position)
  let target: "latest" | number | `row:${number}`;
  if (targetArg === "latest") {
    target = "latest";
  } else if (targetArg!.startsWith("row:")) {
    const rowNum = parseInt(targetArg!.slice(4), 10);
    if (isNaN(rowNum) || rowNum < 1) {
      console.error(`Error: invalid row target "${targetArg}"`);
      process.exit(1);
    }
    target = `row:${rowNum}` as `row:${number}`;
  } else {
    const num = parseInt(targetArg!, 10);
    if (isNaN(num)) {
      console.error(`Error: invalid target "${targetArg}"`);
      process.exit(1);
    }
    target = num;
  }

  // Step 1: Upload video to GCS
  const result = await handleUploadOnly({
    cfg,
    command: { target, prompt, bitableUrl: urlArg },
    log: (msg: string) => console.error(msg),
  });

  // Compute cost estimate
  const costEstimate = estimateMediaCost({
    fileSizeBytes: result.size,
    mediaType: "video",
  });

  // Output upload result as JSON — card sending is done by the caller (main process)
  // so the card belongs to the same WebSocket session that handles callbacks.
  console.log(JSON.stringify({
    ok: true,
    gcsUri: result.gcsUri,
    mimeType: result.mimeType,
    fileName: result.fileName,
    size: result.size,
    recordNumber: result.recordNumber,
    cacheHit: result.cacheHit,
    costDisplay: costEstimate.costDisplay,
    estimatedCostUsd: costEstimate.estimatedCostUsd,
    durationDisplay: costEstimate.durationDisplay,
    model: costEstimate.model,
    pricingBasis: costEstimate.pricingBasis,
    prompt,
  }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}
