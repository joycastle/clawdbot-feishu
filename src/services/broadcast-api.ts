/**
 * Session 广播服务
 * 
 * 端口: 18799
 * 
 * API:
 *   GET  /status              - 服务状态
 *   GET  /sessions?hours=24   - 获取最近 n 小时活跃的 session
 *   GET  /usage               - 获取活跃用户/任务状态
 *   POST /send                - 发送到单个 session（异步，立即返回）
 *   POST /broadcast           - 批量发送（异步，立即返回）
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { getUsageSnapshot, getDevLockSnapshot } from '../features/dev-lock.js';

const PORT = 18799;
const GATEWAY_URL = 'http://127.0.0.1:18789';

// 获取 Gateway token
function getGatewayToken(): string {
  const configPath = join(process.env.HOME || '', '.clawdbot', 'clawdbot.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const token = config?.gateway?.auth?.token;
  if (!token) throw new Error('Gateway token not found');
  return token;
}

// 获取活跃 session 列表
function getActiveSessions(hours: number): Array<{ key: string; kind?: string; updatedAt?: number }> {
  try {
    const minutes = hours * 60;
    const result = execSync(`clawdbot sessions --json --active ${minutes}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(result);
    return data.sessions || [];
  } catch {
    return [];
  }
}

// 调用 sessions_send（异步，不等回复）
function sendToSessionAsync(token: string, sessionKey: string, message: string): void {
  fetch(`${GATEWAY_URL}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tool: 'sessions_send',
      args: { sessionKey, message, timeoutSeconds: 30 },
    }),
  }).catch(() => {}); // fire-and-forget
}

// 延迟
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 读取请求 body
async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// JSON 响应
function jsonResponse(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// 请求处理
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // GET /status
    if (path === '/status' && req.method === 'GET') {
      return jsonResponse(res, 200, { ok: true, service: 'broadcast-api', port: PORT });
    }

    // GET /usage - 获取活跃用户/任务状态
    if (path === '/usage' && req.method === 'GET') {
      const usage = getUsageSnapshot({ excludeAdmins: false });
      const usageNoAdmin = getUsageSnapshot({ excludeAdmins: true });
      const devLock = getDevLockSnapshot();
      return jsonResponse(res, 200, {
        ok: true,
        all: usage,
        excludeAdmins: usageNoAdmin,
        devLock: {
          enabled: devLock.enabled,
          enabledBy: devLock.enabledBy,
          reason: devLock.reason,
          remainingMs: devLock.remainingMs,
        },
      });
    }

    // GET /sessions - 获取活跃 session 列表
    if (path === '/sessions' && req.method === 'GET') {
      const hoursParam = url.searchParams.get('hours');
      if (!hoursParam) {
        return jsonResponse(res, 400, { ok: false, error: 'Missing required parameter: hours' });
      }
      const hours = parseInt(hoursParam);
      const sessions = getActiveSessions(hours);
      return jsonResponse(res, 200, {
        ok: true,
        hours,
        count: sessions.length,
        sessions: sessions.map(s => ({
          key: s.key,
          kind: s.kind,
          updatedAt: s.updatedAt,
        })),
      });
    }

    // POST /send - 发送到单个 session（异步）
    if (path === '/send' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const { sessionKey, message } = body;

      if (!sessionKey || !message) {
        return jsonResponse(res, 400, { ok: false, error: 'Missing sessionKey or message' });
      }

      const token = getGatewayToken();
      sendToSessionAsync(token, sessionKey, message);
      
      // 立即返回
      return jsonResponse(res, 200, { ok: true, status: 'queued' });
    }

    // POST /broadcast - 批量发送（异步）
    if (path === '/broadcast' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const { targets, message, delayMs = 200 } = body;

      if (!Array.isArray(targets) || targets.length === 0) {
        return jsonResponse(res, 400, { ok: false, error: 'Missing or empty targets array' });
      }
      if (!message) {
        return jsonResponse(res, 400, { ok: false, error: 'Missing message' });
      }

      const token = getGatewayToken();

      // 后台发送，不阻塞响应
      (async () => {
        for (let i = 0; i < targets.length; i++) {
          sendToSessionAsync(token, targets[i], message);
          if (i < targets.length - 1) {
            await sleep(delayMs);
          }
        }
      })();

      // 立即返回
      return jsonResponse(res, 200, {
        ok: true,
        status: 'queued',
        count: targets.length,
      });
    }

    // 404
    jsonResponse(res, 404, { ok: false, error: 'Not found' });
  } catch (err: any) {
    console.error('[broadcast-api] Error:', err);
    jsonResponse(res, 500, { ok: false, error: err.message || 'Internal error' });
  }
}

// 启动服务
export function startBroadcastApi() {
  const server = createServer(handleRequest);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[broadcast-api] Listening on http://127.0.0.1:${PORT}`);
  });
  return server;
}
