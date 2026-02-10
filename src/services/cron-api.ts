/**
 * 飞书定时任务 HTTP API
 * 监听 localhost:18797，供 Agent 调用
 * 
 * 功能：
 * - 添加定时任务（延时任务、周期任务）
 * - 查看任务状态
 * - 删除任务
 */

import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 从 node_modules 引用 clawdbot 的 gateway 工具
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const gatewayPath = path.resolve(__dirname, '../../node_modules/clawdbot/dist/agents/tools/gateway.js');
const { callGatewayTool } = require(gatewayPath);

const PORT = 18797;
let server: http.Server | null = null;

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function errorResponse(res: http.ServerResponse, message: string, status = 400): void {
  jsonResponse(res, { error: message }, status);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  
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
      const status = await callGatewayTool('cron.status', {});
      jsonResponse(res, { ok: true, gatewayStatus: status });
      return;
    }

    // GET /list
    if (path === '/list' && req.method === 'GET') {
      const includeDisabled = url.searchParams.get('includeDisabled') === 'true';
      const jobs = await callGatewayTool('cron.list', {}, { includeDisabled });
      jsonResponse(res, jobs);
      return;
    }

    // POST /add
    if (path === '/add' && req.method === 'POST') {
      const body = await readBody(req);
      const params = JSON.parse(body);
      
      if (!params.job) {
        errorResponse(res, 'Missing "job" in request body');
        return;
      }

      // 如果没有指定 agentId，自动注入
      if (!params.job.agentId) {
        params.job.agentId = 'main'; 
      }

      const result = await callGatewayTool('cron.add', {}, params.job);
      jsonResponse(res, result);
      return;
    }

    // POST /remove
    if (path === '/remove' && req.method === 'POST') {
      const body = await readBody(req);
      const params = JSON.parse(body);
      
      if (!params.id) {
        errorResponse(res, 'Missing "id" in request body');
        return;
      }

      const result = await callGatewayTool('cron.remove', {}, { id: params.id });
      jsonResponse(res, result);
      return;
    }

    // POST /run
    if (path === '/run' && req.method === 'POST') {
      const body = await readBody(req);
      const params = JSON.parse(body);
      
      if (!params.id) {
        errorResponse(res, 'Missing "id" in request body');
        return;
      }

      const result = await callGatewayTool('cron.run', {}, { id: params.id });
      jsonResponse(res, result);
      return;
    }

    errorResponse(res, `Not Found: ${path}`, 404);
  } catch (err: any) {
    if (err?.message?.includes('connect ECONNREFUSED')) {
      errorResponse(res, 'Gateway not running (ECONNREFUSED). Please make sure clawdbot is started.', 503);
    } else {
      console.error('[cron-api] Error:', err);
      errorResponse(res, String(err), 500);
    }
  }
}

export async function startCronApi(log?: (msg: string) => void): Promise<void> {
  const logger = log ?? console.log;
  
  if (server) {
    logger('[cron-api] Already running');
    return;
  }

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[cron-api] Unhandled error:', err);
      errorResponse(res, 'Internal server error', 500);
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    logger(`[cron-api] Listening on http://127.0.0.1:${PORT}`);
  });
}

export async function stopCronApi(): Promise<void> {
  if (server) {
    server.close();
    server = null;
    console.log('[cron-api] Stopped');
  }
}
