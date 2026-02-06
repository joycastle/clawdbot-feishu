/**
 * 飞书项目 HTTP API
 * 监听 localhost:18791，供 Agent 调用
 *
 * API:
 *   GET  /status              - 检查服务状态和配置
 *   GET  /projects            - 获取项目列表
 *   GET  /types               - 获取工作项类型 (?projectKey=xxx)
 *   GET  /fields              - 获取字段定义 (?projectKey=xxx&typeKey=xxx)
 *   GET  /workitems           - 查询工作项列表 (?projectKey=xxx&typeKey=xxx&...)
 *   GET  /workitem/:id        - 获取工作项详情 (?projectKey=xxx&typeKey=xxx)
 *   POST /workitem            - 创建工作项
 *   PUT  /workitem/:id        - 更新工作项
 *   POST /workitem/:id/comment - 添加评论
 *   GET  /workitem/:id/comments - 获取评论列表
 */

import * as http from 'node:http';
import { FeishuProjectClient } from './feishu-project/client.js';
import type { FeishuConfig } from './types.js';

const PORT = 18791;
let server: http.Server | null = null;
let client: FeishuProjectClient | null = null;

// 默认项目 Key（可通过查询参数覆盖）
let defaultProjectKey = '62b29e862be43458fc1ef6b2';

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

function parseJson(body: string): Record<string, unknown> | null {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return null;
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!client) {
    errorResponse(res, 'Client not initialized', 503);
    return;
  }

  const ctx = client.getContext();
  const projectKey = (query.projectKey as string) || defaultProjectKey;

  try {
    // GET /status
    if (path === '/status' && req.method === 'GET') {
      const stats = client.getCacheStats();
      jsonResponse(res, {
        ok: true,
        defaultProjectKey,
        cache: stats,
      });
      return;
    }

    // GET /projects
    if (path === '/projects' && req.method === 'GET') {
      const projects = await client.getProjects();
      jsonResponse(res, { projects: Array.from(projects.values()) });
      return;
    }

    // GET /types
    if (path === '/types' && req.method === 'GET') {
      const types = await client.getWorkItemTypes(projectKey);
      jsonResponse(res, { projectKey, types });
      return;
    }

    // GET /fields
    if (path === '/fields' && req.method === 'GET') {
      const typeKey = query.typeKey as string;
      const resp = await client.field.getProjectFields(ctx, projectKey, typeKey ? { work_item_type_key: typeKey } : undefined);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, fields: resp.data });
      return;
    }

    // GET /workitems
    if (path === '/workitems' && req.method === 'GET') {
      const typeKey = (query.typeKey as string) || 'issue';
      const pageNum = parseInt(query.pageNum as string, 10) || 1;
      const pageSize = parseInt(query.pageSize as string, 10) || 20;

      const resp = await client.workitem.filterWorkItems(ctx, projectKey, {
        work_item_type_key: typeKey,
        page_num: pageNum,
        page_size: pageSize,
      });

      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, ...resp.data });
      return;
    }

    // GET /workitem/:id
    const workitemMatch = path.match(/^\/workitem\/(\d+)$/);
    if (workitemMatch && req.method === 'GET') {
      const workItemId = parseInt(workitemMatch[1], 10);
      const typeKey = (query.typeKey as string) || 'issue';

      const resp = await client.workitem.getWorkItemsByIds(ctx, projectKey, typeKey, [workItemId]);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      const item = resp.data?.[0];
      if (!item) {
        errorResponse(res, 'Work item not found', 404);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, workItem: item });
      return;
    }

    // POST /workitem
    if (path === '/workitem' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const typeKey = (body.typeKey as string) || (query.typeKey as string) || 'issue';
      const name = body.name as string;
      if (!name) {
        errorResponse(res, 'name is required');
        return;
      }

      const resp = await client.workitem.createWorkItem(ctx, projectKey, {
        work_item_type_key: typeKey,
        name,
        template_id: body.templateId as string,
        field_value_pairs: body.fields as Array<{ field_key: string; field_value: unknown }>,
      });

      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true, workItemId: resp.data?.work_item_id }, 201);
      return;
    }

    // PUT /workitem/:id
    if (workitemMatch && req.method === 'PUT') {
      const workItemId = parseInt(workitemMatch[1], 10);
      const typeKey = (query.typeKey as string) || 'issue';
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const resp = await client.workitem.updateWorkItem(ctx, projectKey, typeKey, workItemId, {
        update_fields: body.fields as Array<{ field_key: string; field_value: unknown }>,
      });

      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // GET /workitem/:id/comments
    const commentsMatch = path.match(/^\/workitem\/(\d+)\/comments$/);
    if (commentsMatch && req.method === 'GET') {
      const workItemId = parseInt(commentsMatch[1], 10);
      const typeKey = (query.typeKey as string) || 'issue';

      const resp = await client.comment.listComments(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, workItemId, comments: resp.data?.comments });
      return;
    }

    // POST /workitem/:id/comment
    const commentMatch = path.match(/^\/workitem\/(\d+)\/comment$/);
    if (commentMatch && req.method === 'POST') {
      const workItemId = parseInt(commentMatch[1], 10);
      const typeKey = (query.typeKey as string) || 'issue';
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const content = body.content as string;
      if (!content) {
        errorResponse(res, 'content is required');
        return;
      }

      const resp = await client.comment.createComment(ctx, projectKey, typeKey, workItemId, { content });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true, commentId: resp.data?.comment_id }, 201);
      return;
    }

    errorResponse(res, 'Not found', 404);
  } catch (err) {
    errorResponse(res, err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export function startFeishuProjectApi(feishuCfg: FeishuConfig | undefined, log?: (...args: unknown[]) => void): void {
  if (server) {
    log?.('[FeishuProjectAPI] Server already running');
    return;
  }

  const pluginId = feishuCfg?.projectPluginId;
  const pluginSecret = feishuCfg?.projectPluginSecret;
  const userKey = feishuCfg?.projectUserKey;

  if (!pluginId || !pluginSecret || !userKey) {
    log?.('[FeishuProjectAPI] Missing projectPluginId, projectPluginSecret, or projectUserKey - not starting');
    return;
  }

  client = new FeishuProjectClient({
    pluginId,
    pluginSecret,
    userKey,
  });

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log?.('[FeishuProjectAPI] Request error:', err);
      errorResponse(res, 'Internal error', 500);
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    log?.(`[FeishuProjectAPI] Listening on http://127.0.0.1:${PORT}`);
  });

  server.on('error', (err) => {
    log?.(`[FeishuProjectAPI] Server error: ${err.message}`);
  });
}

export function stopFeishuProjectApi(): void {
  if (server) {
    server.close();
    server = null;
    client = null;
  }
}
