/**
 * Message deduplication with persistent disk storage.
 *
 * - In-memory Map for fast O(1) lookups (TTL + max size eviction)
 * - Async JSON file persistence — survives restarts and WebSocket reconnects
 * - 24-hour TTL, up to 10,000 file entries (oldest evicted when full)
 * - Non-blocking: disk errors fall back to memory-only mode
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;

type DedupRecord = Record<string, number>; // messageId → timestamp ms

function resolveStateDirFromEnv(): string {
  const override =
    process.env.CLAWDBOT_STATE_DIR?.trim() || process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".clawdbot");
}

function resolveDedupeFilePath(namespace: string): string {
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveStateDirFromEnv(), "feishu", "dedup", `${safe}.json`);
}

class DedupStore {
  private memory = new Map<string, number>();
  private readonly filePath: string;
  private flushPromise: Promise<void> | null = null;

  constructor(namespace: string) {
    this.filePath = resolveDedupeFilePath(namespace);
  }

  /** Load persisted entries into memory on startup. Returns count loaded. */
  async warmup(log?: (...args: unknown[]) => void): Promise<number> {
    const now = Date.now();
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as DedupRecord;
      let loaded = 0;
      for (const [id, ts] of Object.entries(data)) {
        if (typeof ts === "number" && now - ts < DEDUP_TTL_MS) {
          this.memory.set(id, ts);
          loaded++;
          if (this.memory.size >= MEMORY_MAX_SIZE) break;
        }
      }
      log?.(`feishu-dedup: loaded ${loaded} entries from disk`);
      return loaded;
    } catch {
      // File doesn't exist or is corrupt — start fresh
      return 0;
    }
  }

  /**
   * Check if a messageId was already seen, and record it if not.
   * Returns true if it's a duplicate (already seen), false if it's new.
   */
  checkAndRecord(messageId: string): boolean {
    const trimmed = messageId.trim();
    if (!trimmed) return false;

    const now = Date.now();

    // Prune expired entries if memory is getting large
    if (this.memory.size >= MEMORY_MAX_SIZE) {
      for (const [id, ts] of this.memory) {
        if (now - ts > DEDUP_TTL_MS) this.memory.delete(id);
        if (this.memory.size < MEMORY_MAX_SIZE) break;
      }
    }

    if (this.memory.has(trimmed)) return true;

    this.memory.set(trimmed, now);
    this.scheduleFlush();
    return false;
  }

  private scheduleFlush(): void {
    if (this.flushPromise) return; // Already flushing
    this.flushPromise = this.flush().finally(() => {
      this.flushPromise = null;
    });
  }

  private async flush(): Promise<void> {
    const now = Date.now();

    // Start from existing disk data to preserve entries not in memory
    const data: DedupRecord = {};
    try {
      const raw = await fs.promises.readFile(this.filePath, "utf-8");
      const existing = JSON.parse(raw) as DedupRecord;
      for (const [id, ts] of Object.entries(existing)) {
        if (typeof ts === "number" && now - ts < DEDUP_TTL_MS) {
          data[id] = ts;
        }
      }
    } catch {
      // Missing or corrupt — start fresh
    }

    // Merge in-memory entries (override if present)
    for (const [id, ts] of this.memory) {
      if (now - ts < DEDUP_TTL_MS) data[id] = ts;
    }

    // Evict oldest if over the file entry limit (keep newest first)
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const trimmed: DedupRecord = {};
    for (const [id, ts] of entries.slice(0, FILE_MAX_ENTRIES)) {
      trimmed[id] = ts;
    }

    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.writeFile(this.filePath, JSON.stringify(trimmed), "utf-8");
    } catch {
      // Non-fatal — dedup continues to work in-memory
    }
  }
}

// Module-level store for the default "global" namespace
const defaultStore = new DedupStore("global");

/**
 * Warm up the dedup cache from disk on startup.
 * Call this once before processing any messages.
 */
export async function warmupDedupFromDisk(log?: (...args: unknown[]) => void): Promise<number> {
  return defaultStore.warmup(log);
}

/**
 * Check if a messageId was already seen, and record it if not.
 * Returns true if duplicate (should be skipped), false if new.
 */
export function isDuplicateMessage(messageId: string): boolean {
  return defaultStore.checkAndRecord(messageId);
}
