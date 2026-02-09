#!/usr/bin/env npx tsx
/**
 * 开发锁 CLI - 供 agent 直接调用
 * 用法：
 *   npx tsx dev-lock-cli.ts status
 *   npx tsx dev-lock-cli.ts enable [ttlMs] [reason]
 *   npx tsx dev-lock-cli.ts disable
 *   npx tsx dev-lock-cli.ts usage
 */

import {
  enableDevLock,
  disableDevLock,
  getDevLockSnapshot,
  getUsageSnapshot,
} from './dev-lock.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'status';

function formatMs(ms: number | null): string {
  if (ms == null) return '永久';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

if (cmd === 'status') {
  const snap = getDevLockSnapshot();
  console.log(JSON.stringify({
    enabled: snap.enabled,
    enabledBy: snap.enabledBy,
    reason: snap.reason,
    remainingMs: snap.remainingMs,
    remaining: formatMs(snap.remainingMs),
  }, null, 2));
} else if (cmd === 'enable') {
  const ttlMs = args[1] ? parseInt(args[1], 10) : 2 * 60 * 60 * 1000; // 默认2小时
  const reason = args.slice(2).join(' ') || null;
  enableDevLock({ enabledBy: 'agent', ttlMs, reason });
  const snap = getDevLockSnapshot();
  console.log(JSON.stringify({
    success: snap.enabled,
    remaining: formatMs(snap.remainingMs),
    reason: snap.reason,
  }, null, 2));
} else if (cmd === 'disable') {
  disableDevLock();
  const snap = getDevLockSnapshot();
  console.log(JSON.stringify({ success: !snap.enabled }, null, 2));
} else if (cmd === 'usage') {
  const usage = getUsageSnapshot({ excludeAdmins: false });
  const usageNoAdmin = getUsageSnapshot({ excludeAdmins: true });
  console.log(JSON.stringify({
    all: usage,
    excludeAdmins: usageNoAdmin,
  }, null, 2));
} else {
  console.error('Unknown command:', cmd);
  process.exit(1);
}
