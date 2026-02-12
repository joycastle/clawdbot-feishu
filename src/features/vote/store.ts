/**
 * Vote store — file-based persistence and concurrency control for vote data.
 *
 * Responsibilities:
 *   - VoteData type definition
 *   - Load / save poll state to JSON files
 *   - Per-poll mutex to prevent concurrent updates
 *   - Cleanup of stale poll files
 */

import { existsSync } from "fs";
import { mkdir, readFile, writeFile, readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { getStateDir } from "../../utils/paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Serialized vote state */
export interface VoteData {
  pollId: string;
  question: string;
  options: string[];
  /** { openId: optionIndex } for single-select, { openId: number[] } for multi */
  voters: Record<string, number | number[]>;
  multiSelect: boolean;
  anonymous: boolean;
  closed: boolean;
  creatorOpenId: string;
  messageId: string;
  chatId: string;
  createdAt: number;
  /** Total number of eligible voters (group members). 0 = unknown. */
  totalMembers: number;
}

// ─── File Persistence ────────────────────────────────────────────────────────

const VOTE_DIR = join(getStateDir(), "vote-data");

async function ensureVoteDir(): Promise<void> {
  if (!existsSync(VOTE_DIR)) {
    await mkdir(VOTE_DIR, { recursive: true });
  }
}

function voteFilePath(pollId: string): string {
  return join(VOTE_DIR, `${pollId}.json`);
}

export async function saveVoteData(data: VoteData): Promise<void> {
  await ensureVoteDir();
  await writeFile(voteFilePath(data.pollId), JSON.stringify(data, null, 2), "utf-8");
}

export async function loadVoteData(pollId: string): Promise<VoteData | null> {
  try {
    const filePath = voteFilePath(pollId);
    if (!existsSync(filePath)) return null;
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ─── Mutex ───────────────────────────────────────────────────────────────────

const locks = new Map<string, Promise<void>>();

export async function withLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next);
  try {
    await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Remove poll files older than maxAgeMs (defaults to 30 days).
 * Returns the number of files removed.
 */
export async function cleanupOldPolls(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  log?: (msg: string) => void,
): Promise<number> {
  await ensureVoteDir();
  const files = await readdir(VOTE_DIR);
  const now = Date.now();
  let removed = 0;

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const filePath = join(VOTE_DIR, file);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > maxAgeMs) {
        await unlink(filePath);
        removed++;
      }
    } catch (err) {
      log?.(`vote-store: cleanup error for ${file}: ${String(err)}`);
    }
  }

  if (removed > 0) {
    log?.(`vote-store: cleaned up ${removed} old poll file(s)`);
  }
  return removed;
}
