/**
 * media-cache — In-memory mapping from Feishu media keys to local file paths.
 *
 * When bot.ts downloads images/media from Feishu, it registers the mapping here.
 * Tools like persona_vote can look up a media key to reuse the already-downloaded
 * local file instead of downloading again from the Feishu API.
 *
 * Entries are consumed on lookup (use-once) to avoid unbounded memory growth.
 */

interface CacheEntry {
  localPath: string;
  contentType?: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * Register a downloaded media file.
 * Called by bot.ts after saving a media file to disk.
 */
export function registerMedia(key: string, localPath: string, contentType?: string): void {
  cache.set(key, { localPath, contentType });
}

/**
 * Look up a media key, return the local file path, and remove the entry.
 * Each entry is consumed once — subsequent lookups for the same key return null.
 */
export function lookupMedia(key: string): { localPath: string; contentType?: string } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  return { localPath: entry.localPath, contentType: entry.contentType };
}
