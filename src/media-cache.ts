/**
 * media-cache — In-memory mapping from Feishu media keys to local file paths.
 *
 * Two-level structure: messageId → imageKey → localPath
 * When bot.ts downloads images, it registers them under the source messageId.
 * Tools can look up by messageId + imageKey to reuse already-downloaded files.
 *
 * Entries are consumed on lookup (use-once) to avoid unbounded memory growth.
 */

interface CacheEntry {
  localPath: string;
  contentType?: string;
}

// messageId → (imageKey → CacheEntry)
const cache = new Map<string, Map<string, CacheEntry>>();

/**
 * Register a downloaded media file under a message.
 * Called by bot.ts after saving a media file to disk.
 */
export function registerMedia(messageId: string, imageKey: string, localPath: string, contentType?: string): void {
  let msgMap = cache.get(messageId);
  if (!msgMap) {
    msgMap = new Map();
    cache.set(messageId, msgMap);
  }
  msgMap.set(imageKey, { localPath, contentType });
}

/**
 * Look up a media key under a specific message, return the local file path,
 * and remove the entry. Each entry is consumed once.
 */
export function lookupMedia(messageId: string, imageKey: string): { localPath: string; contentType?: string } | null {
  const msgMap = cache.get(messageId);
  if (!msgMap) return null;
  const entry = msgMap.get(imageKey);
  if (!entry) return null;
  msgMap.delete(imageKey);
  if (msgMap.size === 0) cache.delete(messageId);
  return { localPath: entry.localPath, contentType: entry.contentType };
}

/**
 * Check if a specific message has any cached image entries (non-destructive).
 */
export function hasImageMedia(messageId: string): boolean {
  return cache.has(messageId) && cache.get(messageId)!.size > 0;
}
