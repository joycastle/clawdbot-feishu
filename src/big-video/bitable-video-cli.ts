#!/usr/bin/env npx tsx
/**
 * Bitable Video CLI — standalone entry point for video analysis.
 *
 * Two-step flow enforced by design (no full-pipeline shortcut):
 *
 *   Step 1 (default): Find video + upload to GCS → return metadata + cost estimate.
 *     npx tsx bitable-video-cli.ts --target latest
 *     npx tsx bitable-video-cli.ts --target 3
 *
 *   Step 2 (analyze): Analyze an already-uploaded GCS URI with Gemini.
 *     npx tsx bitable-video-cli.ts --analyze --gcs-uri "gs://..." --prompt "请分析"
 *
 * The agent MUST show cost estimate to the user and get confirmation
 * between Step 1 and Step 2. There is no way to skip this.
 *
 * Output: JSON to stdout. Logs go to stderr.
 */

import fs from "node:fs";
import os from "node:os";
import { handleUploadOnly } from "./bitable-video-handler.js";
import { analyzeVideoFromGcs } from "../video-analyze.js";
import { estimateMediaCost, formatFileSize } from "../cost-estimator.js";
import { initGcsConfig } from "./gcs-upload.js";
import { setCredentialsPath } from "../video-analyze.js";

const args = process.argv.slice(2);
let targetArg: string | undefined;
let promptArg: string | undefined;
let analyzeMode = false;
let gcsUriArg: string | undefined;
let mimeTypeArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--target" || args[i] === "-t") && args[i + 1]) {
    targetArg = args[i + 1];
    i++;
  } else if ((args[i] === "--prompt" || args[i] === "-p") && args[i + 1]) {
    promptArg = args[i + 1];
    i++;
  } else if (args[i] === "--analyze") {
    analyzeMode = true;
  } else if (args[i] === "--gcs-uri" && args[i + 1]) {
    gcsUriArg = args[i + 1];
    i++;
  } else if (args[i] === "--mime-type" && args[i + 1]) {
    mimeTypeArg = args[i + 1];
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`Usage:`);
    console.log(`  Step 1 (upload):  npx tsx bitable-video-cli.ts --target <latest|number>`);
    console.log(`  Step 2 (analyze): npx tsx bitable-video-cli.ts --analyze --gcs-uri "gs://..." --prompt "text"`);
    console.log(`\nStep 1 returns cost estimate. Agent must confirm with user before Step 2.`);
    process.exit(0);
  }
}

const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.clawdbot/clawdbot.json`;

if (!fs.existsSync(configPath)) {
  console.error(`Error: config not found at ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Initialize config
initGcsConfig(cfg);
const feishuCfg = cfg?.channels?.feishu as Record<string, unknown> | undefined;
if (feishuCfg?.gcsCredentialsPath) setCredentialsPath(feishuCfg.gcsCredentialsPath as string);

try {
  if (analyzeMode) {
    // ── Step 2: Analyze an already-uploaded GCS URI ──
    if (!gcsUriArg) {
      console.error("Error: --analyze requires --gcs-uri");
      process.exit(1);
    }
    const prompt = promptArg || "请分析这个视频的内容";

    console.error(`[bitable-video] Analyze mode: ${gcsUriArg}`);
    const analysis = await analyzeVideoFromGcs(gcsUriArg, mimeTypeArg || "video/mp4", {
      prompt,
      log: (msg: string) => console.error(msg),
    });

    console.log(JSON.stringify({
      text: analysis.text,
      gcsUri: gcsUriArg,
      durationMs: analysis.durationMs,
      estimatedCostUsd: analysis.estimatedCostUsd,
      model: analysis.model,
      usage: analysis.usage,
    }));
  } else {
    // ── Step 1: Upload + return metadata with cost estimate ──
    if (!targetArg) {
      console.error("Error: --target is required (use 'latest' or a number)");
      process.exit(1);
    }

    const target: "latest" | number =
      targetArg === "latest" ? "latest" : parseInt(targetArg, 10);

    if (typeof target === "number" && isNaN(target)) {
      console.error(`Error: invalid target "${targetArg}"`);
      process.exit(1);
    }

    const result = await handleUploadOnly({
      cfg,
      command: { target, prompt: "" },
      log: (msg: string) => console.error(msg),
    });

    // Compute cost estimate for the video
    const costEstimate = estimateMediaCost({
      fileSizeBytes: result.size,
      mediaType: "video",
    });

    console.log(JSON.stringify({
      // Upload result
      gcsUri: result.gcsUri,
      mimeType: result.mimeType,
      size: result.size,
      sizeDisplay: formatFileSize(result.size),
      fileName: result.fileName,
      recordNumber: result.recordNumber,
      cacheHit: result.cacheHit,
      // Cost estimate
      estimatedCostUsd: costEstimate.estimatedCostUsd,
      costDisplay: costEstimate.costDisplay,
      estimatedDurationSec: costEstimate.estimatedDurationSec,
      durationDisplay: costEstimate.durationDisplay,
      model: costEstimate.model,
      pricingBasis: costEstimate.pricingBasis,
    }));
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}
