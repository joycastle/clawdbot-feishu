import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "./types.js";

type DevLockState = {
  enabled: boolean;
  enabledAt: number | null;
  enabledBy: string | null;
  reason: string | null;
  ttlMs: number | null;
};

type InFlightEntry = {
  startedAt: number;
  senderId: string;
  isAdmin: boolean;
};

type ActiveEntry = {
  lastSeenAt: number;
  isAdmin: boolean;
};

let devLock: DevLockState = {
  enabled: false,
  enabledAt: null,
  enabledBy: null,
  reason: null,
  ttlMs: null,
};

const inFlight = new Map<string, InFlightEntry>();
const activeUsers = new Map<string, ActiveEntry>();

function normalizeId(id: string | number | null | undefined): string {
  return String(id ?? "").trim().toLowerCase();
}

function resolveAdminAllowFrom(feishuCfg?: FeishuConfig): string[] {
  const direct = feishuCfg?.adminAllowFrom ?? [];
  if (direct.length > 0) {
    return direct.map((x) => normalizeId(x)).filter(Boolean);
  }
  const fallback = (feishuCfg?.allowFrom ?? [])
    .map((x) => normalizeId(x))
    .filter(Boolean);
  if (fallback.includes("*")) return [];
  return fallback;
}

export function isFeishuAdmin(params: {
  cfg: ClawdbotConfig;
  senderId: string;
}): boolean {
  const feishuCfg = params.cfg.channels?.feishu as FeishuConfig | undefined;
  const adminAllowFrom = resolveAdminAllowFrom(feishuCfg);
  if (adminAllowFrom.length === 0) return false;
  const sender = normalizeId(params.senderId);
  if (!sender) return false;
  if (adminAllowFrom.includes("*")) return true;
  return adminAllowFrom.includes(sender);
}

export function markFeishuUserActive(params: { userId: string; isAdmin: boolean; now?: number }): void {
  const now = params.now ?? Date.now();
  const userId = normalizeId(params.userId);
  if (!userId) return;
  activeUsers.set(userId, { lastSeenAt: now, isAdmin: params.isAdmin });
}

function pruneActiveUsers(now: number, windowMs: number): void {
  for (const [id, entry] of activeUsers) {
    if (now - entry.lastSeenAt > windowMs) {
      activeUsers.delete(id);
    }
  }
}

function pruneInFlight(now: number, maxAgeMs: number): void {
  for (const [key, entry] of inFlight) {
    if (now - entry.startedAt > maxAgeMs) {
      inFlight.delete(key);
    }
  }
}

export function startInFlightJob(params: { key: string; senderId: string; isAdmin: boolean; now?: number }): void {
  const now = params.now ?? Date.now();
  const key = normalizeId(params.key);
  const senderId = normalizeId(params.senderId);
  if (!key || !senderId) return;
  inFlight.set(key, { startedAt: now, senderId, isAdmin: params.isAdmin });
}

export function endInFlightJob(key: string): void {
  inFlight.delete(normalizeId(key));
}

export function enableDevLock(params: { enabledBy: string; ttlMs?: number | null; reason?: string | null; now?: number }): void {
  const now = params.now ?? Date.now();
  devLock = {
    enabled: true,
    enabledAt: now,
    enabledBy: normalizeId(params.enabledBy) || null,
    reason: (params.reason ?? "").trim() || null,
    ttlMs: params.ttlMs != null && params.ttlMs > 0 ? params.ttlMs : null,
  };
}

export function disableDevLock(): void {
  devLock = {
    enabled: false,
    enabledAt: null,
    enabledBy: null,
    reason: null,
    ttlMs: null,
  };
}

export function isDevLockEnabled(now: number = Date.now()): boolean {
  if (!devLock.enabled) return false;
  if (!devLock.enabledAt) return false;
  if (devLock.ttlMs == null) return true;
  const expiresAt = devLock.enabledAt + devLock.ttlMs;
  if (now < expiresAt) return true;
  disableDevLock();
  return false;
}

export function getDevLockSnapshot(now: number = Date.now()): {
  enabled: boolean;
  enabledAt: number | null;
  enabledBy: string | null;
  reason: string | null;
  ttlMs: number | null;
  expiresAt: number | null;
  remainingMs: number | null;
} {
  const enabled = isDevLockEnabled(now);
  const enabledAt = enabled ? devLock.enabledAt : null;
  const ttlMs = enabled ? devLock.ttlMs : null;
  const expiresAt = enabled && enabledAt != null && ttlMs != null ? enabledAt + ttlMs : null;
  const remainingMs = expiresAt != null ? Math.max(0, expiresAt - now) : null;
  return {
    enabled,
    enabledAt,
    enabledBy: enabled ? devLock.enabledBy : null,
    reason: enabled ? devLock.reason : null,
    ttlMs,
    expiresAt,
    remainingMs,
  };
}

export function getUsageSnapshot(params: {
  now?: number;
  activeWindowMs?: number;
  excludeAdmins?: boolean;
}): {
  inFlightJobs: number;
  inFlightUsers: number;
  activeUsers: number;
} {
  const now = params.now ?? Date.now();
  const activeWindowMs = params.activeWindowMs ?? 10 * 60 * 1000;
  const excludeAdmins = params.excludeAdmins ?? false;
  pruneActiveUsers(now, activeWindowMs);
  pruneInFlight(now, 60 * 60 * 1000);

  let inFlightJobs = 0;
  const inFlightUserSet = new Set<string>();
  for (const entry of inFlight.values()) {
    if (excludeAdmins && entry.isAdmin) continue;
    inFlightJobs += 1;
    inFlightUserSet.add(entry.senderId);
  }

  let activeUsersCount = 0;
  for (const entry of activeUsers.values()) {
    if (excludeAdmins && entry.isAdmin) continue;
    activeUsersCount += 1;
  }

  return {
    inFlightJobs,
    inFlightUsers: inFlightUserSet.size,
    activeUsers: activeUsersCount,
  };
}

