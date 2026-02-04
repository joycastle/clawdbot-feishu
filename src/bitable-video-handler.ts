/**
 * Bitable Video Handler — orchestrates the full pipeline:
 *
 *   1. Parse user command ("视频：最新/编号X，请...")
 *   2. Fetch record from bitable
 *   3. Check fileToken cache → if hit, skip download + upload
 *   4. Download attachment → stream to /tmp + compute MD5
 *   5. Check MD5 cache → if hit, skip upload
 *   6. Upload to GCS (streaming)
 *   7. Update cache mappings
 *   8. Call Gemini via GCS URI
 *   9. Return analysis result
 *  10. Cleanup /tmp file
 *
 * Periodic cleanup: every 7 days, clear cache + GCS bucket.
 */

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import {
  parseVideoCommand,
  findVideoRecord,
  downloadBitableAttachment,
  type VideoCommand,
  type BitableAttachment,
} from "./bitable-video.js";
import {
  streamToTmpWithMd5,
  uploadToGcs,
  cleanupTmpFile,
  clearGcsBucket,
} from "./gcs-upload.js";
import {
  lookupByFileToken,
  lookupByMd5,
  cacheVideoMapping,
  cacheFileTokenAlias,
  isCleanupDue,
  cleanupExpiredEntries,
  resetVideoCache,
  type CacheEntry,
} from "./video-cache.js";
import { analyzeVideoFromGcs, type VideoAnalysisResult } from "./video-analyze.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BitableVideoResult {
  /** Gemini analysis text */
  text: string;
  /** Cache status */
  cacheHit: "fileToken" | "md5" | "miss";
  /** GCS URI used */
  gcsUri: string;
  /** Gemini analysis metadata */
  analysis: VideoAnalysisResult;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

/**
 * Handle a video analysis request from bitable.
 * This is the main entry point called from bot.ts.
 */
export async function handleBitableVideoRequest(params: {
  cfg: ClawdbotConfig;
  command: VideoCommand;
  log?: (msg: string) => void;
}): Promise<BitableVideoResult> {
  const { cfg, command } = params;
  const log = params.log ?? console.log;

  // Check if periodic cleanup is due
  try {
    if (await isCleanupDue()) {
      log("[bitable-video] Cleanup is due, running periodic cleanup...");
      await runPeriodicCleanup(log);
    }
  } catch (err) {
    log(`[bitable-video] Cleanup check failed (non-fatal): ${err}`);
  }

  // Step 1: Find the video record
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

  // Step 2: Check fileToken cache
  const ftCache = await lookupByFileToken(attachment.file_token);
  if (ftCache) {
    log(`[bitable-video] Cache hit (fileToken): ${ftCache.gcsUri}`);
    const analysis = await analyzeVideoFromGcs(ftCache.gcsUri, ftCache.mimeType, {
      prompt: command.prompt,
      log,
    });
    return { text: analysis.text, cacheHit: "fileToken", gcsUri: ftCache.gcsUri, analysis };
  }

  // Step 3: Download from bitable → /tmp + compute MD5
  log(`[bitable-video] Downloading from bitable...`);
  const { stream, contentType } = await downloadBitableAttachment({
    cfg,
    fileToken: attachment.file_token,
  });

  const { tmpPath, md5, size } = await streamToTmpWithMd5(stream, attachment.name);
  log(`[bitable-video] Downloaded to ${tmpPath} (${formatSize(size)}, md5=${md5})`);

  try {
    // Step 4: Check MD5 cache
    const md5Cache = await lookupByMd5(md5);
    if (md5Cache) {
      log(`[bitable-video] Cache hit (md5): ${md5Cache.gcsUri}`);
      // Add fileToken alias for next time
      await cacheFileTokenAlias(attachment.file_token, md5Cache);
      cleanupTmpFile(tmpPath);

      const analysis = await analyzeVideoFromGcs(md5Cache.gcsUri, md5Cache.mimeType, {
        prompt: command.prompt,
        log,
      });
      return { text: analysis.text, cacheHit: "md5", gcsUri: md5Cache.gcsUri, analysis };
    }

    // Step 5: Upload to GCS
    log(`[bitable-video] Uploading to GCS...`);
    const mimeType = contentType || attachment.type || "video/mp4";
    const uploadResult = await uploadToGcs({
      filePath: tmpPath,
      mimeType,
      objectName: `video/${md5}-${attachment.name}`,
    });
    log(`[bitable-video] Uploaded: ${uploadResult.gcsUri}`);

    // Step 6: Update cache
    await cacheVideoMapping({
      fileToken: attachment.file_token,
      md5,
      gcsUri: uploadResult.gcsUri,
      size,
      mimeType,
    });

    // Step 7: Cleanup /tmp
    cleanupTmpFile(tmpPath);

    // Step 8: Call Gemini
    log(`[bitable-video] Analyzing with Gemini...`);
    const analysis = await analyzeVideoFromGcs(uploadResult.gcsUri, mimeType, {
      prompt: command.prompt,
      log,
    });

    return { text: analysis.text, cacheHit: "miss", gcsUri: uploadResult.gcsUri, analysis };
  } catch (err) {
    // Always cleanup /tmp on error
    cleanupTmpFile(tmpPath);
    throw err;
  }
}

// ─── Periodic Cleanup ────────────────────────────────────────────────────────

/**
 * Run periodic cleanup: clear expired cache entries and GCS objects.
 */
async function runPeriodicCleanup(log: (msg: string) => void): Promise<void> {
  try {
    // Clear GCS bucket
    const gcsDeleted = await clearGcsBucket();
    log(`[bitable-video] GCS cleanup: deleted ${gcsDeleted} objects`);

    // Reset cache
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

/**
 * Check if a message text is a bitable video command.
 */
export function isBitableVideoCommand(text: string): boolean {
  return parseVideoCommand(text) !== null;
}
