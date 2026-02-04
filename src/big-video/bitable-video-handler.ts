/**
 * Bitable Video Handler — orchestrates the full pipeline:
 *
 *   1. Fetch record from bitable
 *   2. Check fileToken cache → if hit, skip download + upload
 *   3. Stream download from bitable → pipe directly to GCS (no temp file)
 *   4. Update fileToken cache
 *   5. Call Gemini via GCS URI
 *   6. Return analysis result
 *
 * Periodic cleanup: every 7 days, clear cache + GCS bucket.
 */

import {
  findVideoRecord,
  downloadBitableAttachment,
  type VideoCommand,
} from "./bitable-video.js";
import {
  streamUploadToGcs,
  clearGcsBucket,
  initGcsConfig,
} from "./gcs-upload.js";
import {
  lookupByFileToken,
  cacheVideoMapping,
  isCleanupDue,
  resetVideoCache,
} from "./video-cache.js";
import { analyzeVideoFromGcs, setCredentialsPath, type VideoAnalysisResult } from "../video-analyze.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BitableVideoResult {
  text: string;
  cacheHit: boolean;
  gcsUri: string;
  analysis: VideoAnalysisResult;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handleBitableVideoRequest(params: {
  cfg: any;
  command: VideoCommand;
  log?: (msg: string) => void;
}): Promise<BitableVideoResult> {
  const { cfg, command } = params;
  const log = params.log ?? console.log;

  // Initialize config from feishu channel settings
  initGcsConfig(cfg);
  const feishuCfg = cfg?.channels?.feishu as Record<string, unknown> | undefined;
  if (feishuCfg?.gcsCredentialsPath) setCredentialsPath(feishuCfg.gcsCredentialsPath as string);

  try {
    if (await isCleanupDue()) {
      log("[bitable-video] Cleanup is due, running periodic cleanup...");
      await runPeriodicCleanup(log);
    }
  } catch (err) {
    log(`[bitable-video] Cleanup check failed (non-fatal): ${err}`);
  }

  log(`[bitable-video] Finding video: target=${command.target}`);
  const found = await findVideoRecord({ cfg, target: command.target });

  if (!found) {
    const msg = command.target === "latest"
      ? "多维表格里没有找到视频附件。请先上传视频到表格。"
      : `多维表格里没有找到编号 ${command.target} 的视频。请检查编号是否正确。`;
    throw new Error(msg);
  }

  const { record, attachment } = found;
  log(`[bitable-video] Found record #${record.autoNumber}: ${attachment.name} (${formatSize(attachment.size)})`);

  // ── Cache check ──
  const ftCache = await lookupByFileToken(attachment.file_token);
  if (ftCache) {
    log(`[bitable-video] Cache hit (fileToken): ${ftCache.gcsUri}`);
    const analysis = await analyzeVideoFromGcs(ftCache.gcsUri, ftCache.mimeType, {
      prompt: command.prompt,
      log,
    });
    return { text: analysis.text, cacheHit: true, gcsUri: ftCache.gcsUri, analysis };
  }

  // ── Stream download → GCS (no temp file) ──
  log(`[bitable-video] Downloading from bitable...`);
  const { stream, contentType } = await downloadBitableAttachment({
    cfg,
    fileToken: attachment.file_token,
  });

  const mimeType = contentType || attachment.type || "video/mp4";
  const objectName = `video/${attachment.file_token}-${attachment.name}`;

  log(`[bitable-video] Streaming to GCS (no temp file)...`);
  const uploadResult = await streamUploadToGcs(stream, {
    mimeType,
    objectName,
    totalSize: attachment.size,
  });
  log(`[bitable-video] Uploaded: ${uploadResult.gcsUri} (${formatSize(uploadResult.size)})`);

  // ── Update cache ──
  await cacheVideoMapping({
    fileToken: attachment.file_token,
    gcsUri: uploadResult.gcsUri,
    size: uploadResult.size,
    mimeType,
  });

  // ── Analyze with Gemini ──
  log(`[bitable-video] Analyzing with Gemini...`);
  const analysis = await analyzeVideoFromGcs(uploadResult.gcsUri, mimeType, {
    prompt: command.prompt,
    log,
  });

  return { text: analysis.text, cacheHit: false, gcsUri: uploadResult.gcsUri, analysis };
}

// ─── Upload-Only Handler ─────────────────────────────────────────────────────

export interface UploadOnlyResult {
  gcsUri: string;
  mimeType: string;
  size: number;
  fileName: string;
  recordNumber: number | string;
  cacheHit: boolean;
}

/**
 * Upload-only mode: find video + upload to GCS, return metadata without analysis.
 * Used for cost estimation before user confirmation.
 */
export async function handleUploadOnly(params: {
  cfg: any;
  command: VideoCommand;
  log?: (msg: string) => void;
}): Promise<UploadOnlyResult> {
  const { cfg, command } = params;
  const log = params.log ?? console.log;

  // Initialize config from feishu channel settings
  initGcsConfig(cfg);
  const feishuCfg = cfg?.channels?.feishu as Record<string, unknown> | undefined;
  if (feishuCfg?.gcsCredentialsPath) setCredentialsPath(feishuCfg.gcsCredentialsPath as string);

  log(`[bitable-video] Upload-only: finding video target=${command.target}`);
  const found = await findVideoRecord({ cfg, target: command.target });

  if (!found) {
    const msg = command.target === "latest"
      ? "多维表格里没有找到视频附件。请先上传视频到表格。"
      : `多维表格里没有找到编号 ${command.target} 的视频。请检查编号是否正确。`;
    throw new Error(msg);
  }

  const { record, attachment } = found;
  log(`[bitable-video] Found record #${record.autoNumber}: ${attachment.name} (${formatSize(attachment.size)})`);

  // Check cache
  const ftCache = await lookupByFileToken(attachment.file_token);
  if (ftCache) {
    log(`[bitable-video] Cache hit (fileToken): ${ftCache.gcsUri}`);
    return {
      gcsUri: ftCache.gcsUri,
      mimeType: ftCache.mimeType,
      size: ftCache.size,
      fileName: attachment.name,
      recordNumber: record.autoNumber,
      cacheHit: true,
    };
  }

  // Stream upload
  log(`[bitable-video] Streaming to GCS...`);
  const { stream, contentType } = await downloadBitableAttachment({
    cfg,
    fileToken: attachment.file_token,
  });

  const mimeType = contentType || attachment.type || "video/mp4";
  const objectName = `video/${attachment.file_token}-${attachment.name}`;

  const uploadResult = await streamUploadToGcs(stream, {
    mimeType,
    objectName,
    totalSize: attachment.size,
  });
  log(`[bitable-video] Uploaded: ${uploadResult.gcsUri}`);

  // Cache
  await cacheVideoMapping({
    fileToken: attachment.file_token,
    gcsUri: uploadResult.gcsUri,
    size: uploadResult.size,
    mimeType,
  });

  return {
    gcsUri: uploadResult.gcsUri,
    mimeType,
    size: uploadResult.size,
    fileName: attachment.name,
    recordNumber: record.autoNumber,
    cacheHit: false,
  };
}

// ─── Periodic Cleanup ────────────────────────────────────────────────────────

async function runPeriodicCleanup(log: (msg: string) => void): Promise<void> {
  try {
    const gcsDeleted = await clearGcsBucket();
    log(`[bitable-video] GCS cleanup: deleted ${gcsDeleted} objects`);

    await resetVideoCache();
    log(`[bitable-video] Cache cleared`);
  } catch (err) {
    log(`[bitable-video] Cleanup error: ${err}`);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
