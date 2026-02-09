/**
 * 飞书任务 API 服务 (v2)
 * 基于 @larksuiteoapi/node-sdk 的 task v2 API
 */

import * as http from 'http';
import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from './types.js';
import { createFeishuClient } from './client.js';

const PORT = 18794;

let server: http.Server | null = null;
let client: Lark.Client | null = null;

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function errorResponse(res: http.ServerResponse, message: string, status = 400): void {
  jsonResponse(res, { error: message }, status);
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  params.forEach((v, k) => (result[k] = v));
  return result;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!client) {
    errorResponse(res, 'Service not initialized', 503);
    return;
  }

  const url = req.url || '/';
  const method = req.method || 'GET';
  const path = url.split('?')[0];
  const query = parseQuery(url);
  const v2 = client.task.v2;

  try {
    // ==================== 基础 ====================
    
    // GET /status
    if (method === 'GET' && path === '/status') {
      jsonResponse(res, { ok: true, service: 'feishu-task-api', version: 'v2', port: PORT });
      return;
    }

    // ==================== 任务 ====================

    // POST /task - 创建任务
    if (method === 'POST' && path === '/task') {
      const body = await parseBody(req);
      const result = await v2.task.create({
        data: {
          summary: body.summary as string,
          description: body.description as string | undefined,
          due: body.due as { timestamp?: string; is_all_day?: boolean } | undefined,
          members: body.members as Array<{ id?: string; type?: string; role?: string }> | undefined,
          origin: {
            platform_i18n_name: JSON.stringify({ zh_cn: '王总', en_us: 'Wang' }),
          },
          extra: body.extra as string | undefined,
          tasklist_guid: body.tasklist_guid as string | undefined,
          section_guid: body.section_guid as string | undefined,
        },
        params: { user_id_type: 'open_id' },
      });

      if (result.code !== 0) {
        errorResponse(res, result.msg || 'Failed to create task', 400);
        return;
      }
      jsonResponse(res, result.data?.task);
      return;
    }

    // GET /tasks - 列出任务
    if (method === 'GET' && path === '/tasks') {
      const result = await v2.task.list({
        params: {
          page_size: query.page_size ? parseInt(query.page_size) : 20,
          page_token: query.page_token,
          completed: query.completed,
          user_id_type: 'open_id',
        },
      });

      if (result.code !== 0) {
        errorResponse(res, result.msg || 'Failed to list tasks', 400);
        return;
      }
      jsonResponse(res, {
        items: result.data?.items || [],
        page_token: result.data?.page_token,
        has_more: result.data?.has_more,
      });
      return;
    }

    // 任务操作 - /task/:task_guid/...
    const taskMatch = path.match(/^\/task\/([^/]+)(\/.*)?$/);
    if (taskMatch) {
      const taskGuid = taskMatch[1];
      const subPath = taskMatch[2] || '';

      // GET /task/:task_guid - 获取任务详情
      if (method === 'GET' && !subPath) {
        const result = await v2.task.get({
          path: { task_guid: taskGuid },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to get task', 400);
          return;
        }
        jsonResponse(res, result.data?.task);
        return;
      }

      // PATCH /task/:task_guid - 更新任务
      if (method === 'PATCH' && !subPath) {
        const body = await parseBody(req);
        const result = await v2.task.patch({
          path: { task_guid: taskGuid },
          data: {
            task: body as Lark.Task.V2.Task,
            update_fields: body.update_fields as string[],
          },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to update task', 400);
          return;
        }
        jsonResponse(res, result.data?.task);
        return;
      }

      // DELETE /task/:task_guid - 删除任务
      if (method === 'DELETE' && !subPath) {
        const result = await v2.task.delete({
          path: { task_guid: taskGuid },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to delete task', 400);
          return;
        }
        jsonResponse(res, { success: true });
        return;
      }

      // POST /task/:task_guid/complete - 完成任务
      if (method === 'POST' && subPath === '/complete') {
        const result = await v2.task.patch({
          path: { task_guid: taskGuid },
          data: {
            task: { completed_at: String(Math.floor(Date.now() / 1000)) },
            update_fields: ['completed_at'],
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to complete task', 400);
          return;
        }
        jsonResponse(res, { success: true });
        return;
      }

      // POST /task/:task_guid/uncomplete - 取消完成
      if (method === 'POST' && subPath === '/uncomplete') {
        const result = await v2.task.patch({
          path: { task_guid: taskGuid },
          data: {
            task: { completed_at: '0' },
            update_fields: ['completed_at'],
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to uncomplete task', 400);
          return;
        }
        jsonResponse(res, { success: true });
        return;
      }

      // ==================== 子任务 ====================

      // GET /task/:task_guid/subtasks - 获取子任务列表
      if (method === 'GET' && subPath === '/subtasks') {
        const result = await v2.taskSubtask.list({
          path: { task_guid: taskGuid },
          params: {
            page_size: query.page_size ? parseInt(query.page_size) : 20,
            page_token: query.page_token,
            user_id_type: 'open_id',
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to list subtasks', 400);
          return;
        }
        jsonResponse(res, {
          items: result.data?.items || [],
          page_token: result.data?.page_token,
          has_more: result.data?.has_more,
        });
        return;
      }

      // POST /task/:task_guid/subtask - 创建子任务
      if (method === 'POST' && subPath === '/subtask') {
        const body = await parseBody(req);
        const result = await v2.taskSubtask.create({
          path: { task_guid: taskGuid },
          data: {
            summary: body.summary as string,
            description: body.description as string | undefined,
            due: body.due as { timestamp?: string; is_all_day?: boolean } | undefined,
            members: body.members as Array<{ id?: string; type?: string; role?: string }> | undefined,
          },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to create subtask', 400);
          return;
        }
        jsonResponse(res, result.data?.subtask);
        return;
      }

      // ==================== 评论 ====================

      // GET /task/:task_guid/comments - 获取评论列表
      if (method === 'GET' && subPath === '/comments') {
        const result = await v2.comment.list({
          path: { task_guid: taskGuid },
          params: {
            page_size: query.page_size ? parseInt(query.page_size) : 20,
            page_token: query.page_token,
            list_direction: query.direction === 'asc' ? 0 : 1,
            user_id_type: 'open_id',
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to list comments', 400);
          return;
        }
        jsonResponse(res, {
          items: result.data?.items || [],
          page_token: result.data?.page_token,
          has_more: result.data?.has_more,
        });
        return;
      }

      // POST /task/:task_guid/comment - 创建评论
      if (method === 'POST' && subPath === '/comment') {
        const body = await parseBody(req);
        const result = await v2.comment.create({
          path: { task_guid: taskGuid },
          data: {
            content: body.content as string,
          },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to create comment', 400);
          return;
        }
        jsonResponse(res, result.data?.comment);
        return;
      }
    }

    // ==================== 清单 ====================

    // POST /tasklist - 创建清单
    if (method === 'POST' && path === '/tasklist') {
      const body = await parseBody(req);
      const result = await v2.tasklist.create({
        data: {
          name: body.name as string,
        },
        params: { user_id_type: 'open_id' },
      });

      if (result.code !== 0) {
        errorResponse(res, result.msg || 'Failed to create tasklist', 400);
        return;
      }
      jsonResponse(res, result.data?.tasklist);
      return;
    }

    // GET /tasklists - 列出清单
    if (method === 'GET' && path === '/tasklists') {
      const result = await v2.tasklist.list({
        params: {
          page_size: query.page_size ? parseInt(query.page_size) : 20,
          page_token: query.page_token,
          user_id_type: 'open_id',
        },
      });

      if (result.code !== 0) {
        errorResponse(res, result.msg || 'Failed to list tasklists', 400);
        return;
      }
      jsonResponse(res, {
        items: result.data?.items || [],
        page_token: result.data?.page_token,
        has_more: result.data?.has_more,
      });
      return;
    }

    // 清单操作 - /tasklist/:tasklist_guid/...
    const tasklistMatch = path.match(/^\/tasklist\/([^/]+)(\/.*)?$/);
    if (tasklistMatch) {
      const tasklistGuid = tasklistMatch[1];
      const subPath = tasklistMatch[2] || '';

      // GET /tasklist/:tasklist_guid - 获取清单详情
      if (method === 'GET' && !subPath) {
        const result = await v2.tasklist.get({
          path: { tasklist_guid: tasklistGuid },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to get tasklist', 400);
          return;
        }
        jsonResponse(res, result.data?.tasklist);
        return;
      }

      // DELETE /tasklist/:tasklist_guid - 删除清单
      if (method === 'DELETE' && !subPath) {
        const result = await v2.tasklist.delete({
          path: { tasklist_guid: tasklistGuid },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to delete tasklist', 400);
          return;
        }
        jsonResponse(res, { success: true });
        return;
      }

      // GET /tasklist/:tasklist_guid/tasks - 获取清单中的任务
      if (method === 'GET' && subPath === '/tasks') {
        const result = await v2.tasklist.tasks({
          path: { tasklist_guid: tasklistGuid },
          params: {
            page_size: query.page_size ? parseInt(query.page_size) : 20,
            page_token: query.page_token,
            completed: query.completed,
            user_id_type: 'open_id',
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to get tasklist tasks', 400);
          return;
        }
        jsonResponse(res, {
          items: result.data?.items || [],
          page_token: result.data?.page_token,
          has_more: result.data?.has_more,
        });
        return;
      }

      // ==================== 自定义分组 ====================

      // GET /tasklist/:tasklist_guid/sections - 获取分组列表
      if (method === 'GET' && subPath === '/sections') {
        const result = await v2.section.list({
          path: { tasklist_guid: tasklistGuid },
          params: {
            page_size: query.page_size ? parseInt(query.page_size) : 20,
            page_token: query.page_token,
            user_id_type: 'open_id',
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to list sections', 400);
          return;
        }
        jsonResponse(res, {
          items: result.data?.items || [],
          page_token: result.data?.page_token,
          has_more: result.data?.has_more,
        });
        return;
      }

      // POST /tasklist/:tasklist_guid/section - 创建分组
      if (method === 'POST' && subPath === '/section') {
        const body = await parseBody(req);
        const result = await v2.section.create({
          path: { tasklist_guid: tasklistGuid },
          data: {
            name: body.name as string,
            insert_before: body.insert_before as string | undefined,
            insert_after: body.insert_after as string | undefined,
          },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to create section', 400);
          return;
        }
        jsonResponse(res, result.data?.section);
        return;
      }
    }

    // ==================== 分组操作 ====================

    // 分组操作 - /section/:section_guid/...
    const sectionMatch = path.match(/^\/section\/([^/]+)(\/.*)?$/);
    if (sectionMatch) {
      const sectionGuid = sectionMatch[1];
      const subPath = sectionMatch[2] || '';

      // GET /section/:section_guid - 获取分组详情
      if (method === 'GET' && !subPath) {
        const result = await v2.section.get({
          path: { section_guid: sectionGuid },
          params: { user_id_type: 'open_id' },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to get section', 400);
          return;
        }
        jsonResponse(res, result.data?.section);
        return;
      }

      // DELETE /section/:section_guid - 删除分组
      if (method === 'DELETE' && !subPath) {
        const result = await v2.section.delete({
          path: { section_guid: sectionGuid },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to delete section', 400);
          return;
        }
        jsonResponse(res, { success: true });
        return;
      }

      // GET /section/:section_guid/tasks - 获取分组中的任务
      if (method === 'GET' && subPath === '/tasks') {
        const result = await v2.section.tasks({
          path: { section_guid: sectionGuid },
          params: {
            page_size: query.page_size ? parseInt(query.page_size) : 20,
            page_token: query.page_token,
            completed: query.completed,
            user_id_type: 'open_id',
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to get section tasks', 400);
          return;
        }
        jsonResponse(res, {
          items: result.data?.items || [],
          page_token: result.data?.page_token,
          has_more: result.data?.has_more,
        });
        return;
      }
    }

    errorResponse(res, 'Not found', 404);
  } catch (err) {
    errorResponse(res, err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export function startFeishuTaskApi(feishuCfg: FeishuConfig | undefined, log?: (...args: unknown[]) => void): void {
  if (server) {
    log?.('[FeishuTaskAPI] Server already running');
    return;
  }

  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    log?.('[FeishuTaskAPI] Missing appId/appSecret - not starting');
    return;
  }

  try {
    client = createFeishuClient(feishuCfg);
  } catch (err) {
    log?.('[FeishuTaskAPI] Failed to create client:', err);
    return;
  }

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log?.('[FeishuTaskAPI] Request error:', err);
      errorResponse(res, 'Internal error', 500);
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    log?.(`[FeishuTaskAPI] Listening on http://127.0.0.1:${PORT} (v2 API)`);
  });

  server.on('error', (err) => {
    log?.(`[FeishuTaskAPI] Server error: ${err.message}`);
  });
}

export function stopFeishuTaskApi(): void {
  if (server) {
    server.close();
    server = null;
    client = null;
  }
}
