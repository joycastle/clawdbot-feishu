/**
 * Webhook security guards for Feishu HTTP webhook mode.
 *
 * - FixedWindowRateLimiter: per-key request count in sliding time windows
 * - installBodyLimitGuard: reject requests that are too large or too slow
 * - applyBasicWebhookRequestGuards: method/content-type/rate-limit checks
 */

import * as http from "node:http";

// ─── Fixed Window Rate Limiter ───────────────────────────────────────────────

type RateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
  /** Max number of distinct keys to track; oldest evicted when exceeded. */
  maxTrackedKeys?: number;
};

type WindowEntry = { count: number; windowStart: number };

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxTrackedKeys: number;

  constructor(opts: RateLimiterOptions) {
    this.windowMs = opts.windowMs;
    this.maxRequests = opts.maxRequests;
    this.maxTrackedKeys = opts.maxTrackedKeys ?? 4_096;
  }

  /**
   * Check if `key` is rate-limited at `nowMs`.
   * Records the request as a side-effect; returns true if limit exceeded.
   */
  isRateLimited(key: string, nowMs = Date.now()): boolean {
    let entry = this.windows.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      // Start a new window for this key
      if (!entry && this.windows.size >= this.maxTrackedKeys) {
        // Evict the oldest key to stay within the cap
        const oldest = this.windows.keys().next().value;
        if (oldest !== undefined) this.windows.delete(oldest);
      }
      entry = { count: 1, windowStart: nowMs };
      this.windows.set(key, entry);
      return false;
    }
    entry.count += 1;
    return entry.count > this.maxRequests;
  }

  clear(): void {
    this.windows.clear();
  }

  size(): number {
    return this.windows.size;
  }
}

// ─── Body Size + Timeout Guard ───────────────────────────────────────────────

/** Max incoming body size: 1 MB */
export const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
/** Max time to receive the full request body: 30 s */
export const WEBHOOK_BODY_TIMEOUT_MS = 30_000;

export type BodyGuard = {
  isTripped: () => boolean;
  dispose: () => void;
};

type BodyGuardOptions = {
  maxBytes?: number;
  timeoutMs?: number;
};

/**
 * Install a body-size and timeout guard on `req`.
 * - If the body exceeds `maxBytes`, responds 413 and destroys the socket.
 * - If the body isn't fully received within `timeoutMs`, responds 408.
 * Check `guard.isTripped()` before forwarding to the actual handler.
 * Always call `guard.dispose()` in a finally block.
 */
export function installBodyLimitGuard(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: BodyGuardOptions = {},
): BodyGuard {
  const maxBytes = opts.maxBytes ?? WEBHOOK_MAX_BODY_BYTES;
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_BODY_TIMEOUT_MS;

  let tripped = false;
  let totalBytes = 0;

  const trip = (statusCode: number, message: string) => {
    if (tripped) return;
    tripped = true;
    req.destroy();
    if (!res.headersSent) {
      res.writeHead(statusCode, { "Content-Type": "text/plain" });
      res.end(message);
    }
  };

  const timer = setTimeout(() => {
    trip(408, "Request Timeout");
  }, timeoutMs);

  const onData = (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      trip(413, "Payload Too Large");
    }
  };

  const onEnd = () => clearTimeout(timer);
  const onClose = () => clearTimeout(timer);

  req.on("data", onData);
  req.on("end", onEnd);
  req.on("close", onClose);

  return {
    isTripped: () => tripped,
    dispose: () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("close", onClose);
    },
  };
}

// ─── Basic Request Guards ────────────────────────────────────────────────────

type RequestGuardOptions = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  rateLimiter: FixedWindowRateLimiter;
  rateLimitKey: string;
  nowMs?: number;
  requireJsonContentType?: boolean;
};

/**
 * Apply basic webhook request guards: method, content-type, rate limit.
 * Returns true if the request should proceed; false if already rejected.
 */
export function applyBasicWebhookRequestGuards(opts: RequestGuardOptions): boolean {
  const { req, res, rateLimiter, rateLimitKey, requireJsonContentType = false } = opts;
  const nowMs = opts.nowMs ?? Date.now();

  // Only accept POST
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return false;
  }

  // Content-Type check
  if (requireJsonContentType) {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.writeHead(415, { "Content-Type": "text/plain" });
      res.end("Unsupported Media Type");
      return false;
    }
  }

  // Rate limit check
  if (rateLimiter.isRateLimited(rateLimitKey, nowMs)) {
    res.writeHead(429, { "Content-Type": "text/plain" });
    res.end("Too Many Requests");
    return false;
  }

  return true;
}
