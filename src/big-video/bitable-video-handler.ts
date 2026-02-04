/**
 * Bitable Video Handler — two-step pipeline (upload + analyze separated):
 *
 *   Step 1 (handleUploadOnly):
 *     Find record → check cache → stream to GCS → return metadata.
 *     Agent then shows cost estimate to user and waits for confirmation.
 *
 *   Step 2 (analyzeVideoFromGcs — called directly by CLI):
 *     Analyze an already-uploaded GCS URI with Gemini.
 *
 * No full-pipeline shortcut exists. This enforces cost confirmation.
 *
 * Periodic cleanup: every 15 days, clear cache + GCS bucket.
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
import { setCredentialsPath } from "../video-analyze.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UploadOnlyResult {
  gcsUri: string;
  mimeType: string;
  size: number;
  fileName: string;
  recordNumber: number | string;
  cacheHit: boolean;
}

// ─── Upload-Only Handler ─────────────────────────────────────────────────────

/**
 * Find video + upload to GCS, return metadata without analysis.
 * This is the ONLY entry point for bitable video processing.
 * Analysis must be triggered separately after user confirms cost.
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

  // Stream download → GCS (no temp file)
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
  log(`[bitable-video] Uploaded: ${uploadResult.gcsUri} (${formatSize(uploadResult.size)})`);

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
