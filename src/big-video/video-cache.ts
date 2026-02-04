/**
 * Video Cache — fileToken → GCS URI mapping.
 *
 * Single-layer cache: fileToken → gcsUri (skip download + upload if same attachment).
 * MD5 layer removed in favor of fully streaming transfer (no temp file).
 *
 * Cache is persisted to a JSON file. Max 500 entries; evicts oldest 100 when full.
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
  /** Last cleanup timestamp */
  lastCleanup: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_DIR = join(process.env.HOME ?? "/tmp", ".clawdbot");
const CACHE_FILE = join(CACHE_DIR, "video-cache.json");
const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000;

/** Maximum entries in the fileToken map */
const MAX_CACHE_SIZE = 1000;
/** Number of entries to evict when cache is full */
const EVICT_COUNT = 100;

// ─── In-memory state ─────────────────────────────────────────────────────────

let cache: VideoCacheData | null = null;

function emptyCache(): VideoCacheData {
  return { byFileToken: {}, lastCleanup: Date.now() };
}

// ─── Load / Save ─────────────────────────────────────────────────────────────

export async function loadVideoCache(): Promise<VideoCacheData> {
  if (cache) return cache;
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = await readFile(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as any;
      cache = {
        byFileToken: parsed.byFileToken ?? {},
        lastCleanup: parsed.lastCleanup ?? Date.now(),
      };
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

// ─── Eviction ────────────────────────────────────────────────────────────────

/**
 * Evict the oldest EVICT_COUNT entries when cache size >= MAX_CACHE_SIZE.
 * Sorts by cachedAt ascending, removes the oldest ones.
 */
function evictIfNeeded(c: VideoCacheData): void {
  const keys = Object.keys(c.byFileToken);
  if (keys.length < MAX_CACHE_SIZE) return;

  // Sort entries by cachedAt ascending (oldest first)
  const sorted = keys
    .map((k) => ({ key: k, cachedAt: c.byFileToken[k].cachedAt }))
    .sort((a, b) => a.cachedAt - b.cachedAt);

  // Remove the oldest EVICT_COUNT
  const toRemove = sorted.slice(0, EVICT_COUNT);
  for (const { key } of toRemove) {
    delete c.byFileToken[key];
  }
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

/** Check fileToken cache. Returns entry if found and not expired. */
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

// ─── Store ───────────────────────────────────────────────────────────────────

/** Add a fileToken → GCS mapping to the cache. Evicts old entries if full. */
export async function cacheVideoMapping(params: {
  fileToken: string;
  gcsUri: string;
  size: number;
  mimeType: string;
}): Promise<void> {
  const c = await loadVideoCache();
  evictIfNeeded(c);
  c.byFileToken[params.fileToken] = {
    gcsUri: params.gcsUri,
    size: params.size,
    mimeType: params.mimeType,
    cachedAt: Date.now(),
  };
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
  return [...uris];
}
