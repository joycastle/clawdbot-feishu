/**
 * Video Cache — dual-layer cache for bitable video → GCS mapping.
 *
 * Layer 1: fileToken → gcsUri  (skip download entirely if same attachment)
 * Layer 2: md5 → gcsUri        (skip upload if same content from different source)
 *
 * Cache is persisted to a JSON file and auto-cleaned every 7 days.
 */
 
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
 
// ─── Types ───────────────────────────────────────────────────────────────────
 
export interface CacheEntry {
  gcsUri: string;
  size: number;
  mimeType: string;
  cachedAt: number; // epoch ms
}
 
export interface VideoCacheData {
  /** fileToken → CacheEntry */
  byFileToken: Record<string, CacheEntry>;
  /** md5 hex → CacheEntry */
  byMd5: Record<string, CacheEntry>;
  /** Last cleanup timestamp */
  lastCleanup: number;
}
 
// ─── Constants ───────────────────────────────────────────────────────────────
 
const CACHE_DIR = join(process.env.HOME ?? "/tmp", ".clawdbot");
const CACHE_FILE = join(CACHE_DIR, "video-cache.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
 
// ─── In-memory state ─────────────────────────────────────────────────────────
 
let cache: VideoCacheData | null = null;
 
function emptyCache(): VideoCacheData {
  return { byFileToken: {}, byMd5: {}, lastCleanup: Date.now() };
}
 
// ─── Load / Save ─────────────────────────────────────────────────────────────
 
export async function loadVideoCache(): Promise<VideoCacheData> {
  if (cache) return cache;
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = await readFile(CACHE_FILE, "utf-8");
      cache = JSON.parse(raw) as VideoCacheData;
      cache.byFileToken ??= {};
      cache.byMd5 ??= {};
      cache.lastCleanup ??= Date.now();
    } else {
      cache = emptyCache();
    }
  } catch {
    cache = emptyCache();
  }
  return cache;
}
 
export async function saveVideoCache(): Promise<void> {
  if (!cache) return;
  try {
    if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    console.error("[video-cache] Failed to save cache:", err);
  }
}
 
// ─── Lookup ──────────────────────────────────────────────────────────────────
 
/** Check fileToken cache. Returns gcsUri if found and not expired. */
export async function lookupByFileToken(fileToken: string): Promise<CacheEntry | null> {
  const c = await loadVideoCache();
  const entry = c.byFileToken[fileToken];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    delete c.byFileToken[fileToken];
    return null;
  }
  return entry;
}
 
/** Check MD5 cache. Returns gcsUri if found and not expired. */
export async function lookupByMd5(md5: string): Promise<CacheEntry | null> {
  const c = await loadVideoCache();
  const entry = c.byMd5[md5];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    delete c.byMd5[md5];
    return null;
  }
  return entry;
}
 
// ─── Store ───────────────────────────────────────────────────────────────────
 
/** Add entries to both cache layers. */
export async function cacheVideoMapping(params: {
  fileToken: string;
  md5: string;
  gcsUri: string;
  size: number;
  mimeType: string;
}): Promise<void> {
  const c = await loadVideoCache();
  const entry: CacheEntry = {
    gcsUri: params.gcsUri,
    size: params.size,
    mimeType: params.mimeType,
    cachedAt: Date.now(),
  };
  c.byFileToken[params.fileToken] = entry;
  c.byMd5[params.md5] = entry;
  await saveVideoCache();
}
 
/** Add fileToken → existing gcsUri mapping (when md5 cache hit). */
export async function cacheFileTokenAlias(fileToken: string, entry: CacheEntry): Promise<void> {
  const c = await loadVideoCache();
  c.byFileToken[fileToken] = entry;
  await saveVideoCache();
}
 
// ─── Cleanup ─────────────────────────────────────────────────────────────────
 
/** Remove all expired entries. Returns number of entries removed. */
export async function cleanupExpiredEntries(): Promise<number> {
  const c = await loadVideoCache();
  const now = Date.now();
  let removed = 0;
 
  for (const [k, v] of Object.entries(c.byFileToken)) {
    if (now - v.cachedAt > CACHE_TTL_MS) {
      delete c.byFileToken[k];
      removed++;
    }
  }
  for (const [k, v] of Object.entries(c.byMd5)) {
    if (now - v.cachedAt > CACHE_TTL_MS) {
      delete c.byMd5[k];
      removed++;
    }
  }
  c.lastCleanup = now;
  await saveVideoCache();
  return removed;
}
 
/** Check if cleanup is due (>= 7 days since last). */
export async function isCleanupDue(): Promise<boolean> {
  const c = await loadVideoCache();
  return Date.now() - c.lastCleanup >= CACHE_TTL_MS;
}
 
/** Full reset — clear all cache entries. */
export async function resetVideoCache(): Promise<void> {
  cache = emptyCache();
  await saveVideoCache();
}
 
/** Get all GCS URIs currently in cache (for bulk GCS cleanup). */
export async function getAllCachedGcsUris(): Promise<string[]> {
  const c = await loadVideoCache();
  const uris = new Set<string>();
  for (const v of Object.values(c.byFileToken)) uris.add(v.gcsUri);
  for (const v of Object.values(c.byMd5)) uris.add(v.gcsUri);
  return [...uris];
}
