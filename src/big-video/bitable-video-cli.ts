#!/usr/bin/env npx tsx
/**
 * Bitable Video CLI — standalone entry point for video analysis.
 *
 * The LLM agent recognizes user intent naturally, then invokes this CLI
 * with structured arguments.
 *
 * Modes:
 *   --upload-only   Find video + upload to GCS, return metadata (no analysis).
 *                   Use this to get cost estimate before user confirmation.
 *   --analyze-only  Analyze an already-uploaded GCS URI directly.
 *   (default)       Full pipeline: find → upload → analyze.
 *
 * Usage:
 *   npx tsx bitable-video-cli.ts --target latest --prompt "请分析"
 *   npx tsx bitable-video-cli.ts --target latest --upload-only
 *   npx tsx bitable-video-cli.ts --analyze-only --gcs-uri "gs://..." --prompt "请分析"
 *
 * Output: JSON to stdout
 * Logs go to stderr so they don't pollute the JSON output.
 */

import fs from "node:fs";
import os from "node:os";
import { handleBitableVideoRequest } from "./bitable-video-handler.js";
import { handleUploadOnly } from "./bitable-video-handler.js";
import type { VideoCommand } from "./bitable-video.js";
import { analyzeVideoFromGcs } from "../video-analyze.js";

const args = process.argv.slice(2);
let targetArg: string | undefined;
let promptArg: string | undefined;
let uploadOnly = false;
let analyzeOnly = false;
let gcsUriArg: string | undefined;
let mimeTypeArg: string | undefined;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--target" || args[i] === "-t") && args[i + 1]) {
    targetArg = args[i + 1];
    i++;
  } else if ((args[i] === "--prompt" || args[i] === "-p") && args[i + 1]) {
    promptArg = args[i + 1];
    i++;
  } else if (args[i] === "--upload-only") {
    uploadOnly = true;
  } else if (args[i] === "--analyze-only") {
    analyzeOnly = true;
  } else if (args[i] === "--gcs-uri" && args[i + 1]) {
    gcsUriArg = args[i + 1];
    i++;
  } else if (args[i] === "--mime-type" && args[i + 1]) {
    mimeTypeArg = args[i + 1];
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`Usage:`);
    console.log(`  Full pipeline:  npx tsx bitable-video-cli.ts --target <latest|number> [--prompt "text"]`);
    console.log(`  Upload only:    npx tsx bitable-video-cli.ts --target <latest|number> --upload-only`);
    console.log(`  Analyze only:   npx tsx bitable-video-cli.ts --analyze-only --gcs-uri "gs://..." [--prompt "text"] [--mime-type "video/mp4"]`);
    process.exit(0);
  }
}

const configPath = process.env.CLAWDBOT_CONFIG || `${os.homedir()}/.clawdbot/clawdbot.json`;

if (!fs.existsSync(configPath)) {
  console.error(`Error: config not found at ${configPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const prompt = promptArg || "请分析这个视频的内容";

try {
  if (analyzeOnly) {
    // ── Analyze-only mode: call Gemini on an existing GCS URI ──
    if (!gcsUriArg) {
      console.error("Error: --analyze-only requires --gcs-uri");
      process.exit(1);
    }

    console.error(`[bitable-video] Analyze-only mode: ${gcsUriArg}`);
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
  } else if (uploadOnly) {
    // ── Upload-only mode: find + upload, no analysis ──
    if (!targetArg) {
      console.error("Error: --upload-only requires --target");
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
      command: { target, prompt },
      log: (msg: string) => console.error(msg),
    });

    console.log(JSON.stringify(result));
  } else {
    // ── Full pipeline mode ──
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

    const command: VideoCommand = { target, prompt };

    const result = await handleBitableVideoRequest({
      cfg,
      command,
      log: (msg: string) => console.error(msg),
    });

    console.log(JSON.stringify({
      text: result.text,
      cacheHit: result.cacheHit,
      gcsUri: result.gcsUri,
      durationMs: result.analysis.durationMs,
      estimatedCostUsd: result.analysis.estimatedCostUsd,
      model: result.analysis.model,
      usage: result.analysis.usage,
    }));
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}
