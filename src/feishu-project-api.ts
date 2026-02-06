/**
 * 飞书项目 HTTP API
 * 监听 localhost:18791，供 Agent 调用
 *
 * API:
 *   === 基础 ===
 *   GET  /status              - 检查服务状态和配置
 *   GET  /projects            - 获取项目列表
 *   GET  /types               - 获取工作项类型 (?projectKey=xxx)
 *   GET  /fields              - 获取字段定义 (?projectKey=xxx&typeKey=xxx)
 *
 *   === 工作项 ===
 *   GET  /workitems           - 查询工作项列表 (?projectKey=xxx&typeKey=xxx&pageNum&pageSize)
 *   GET  /workitem/:id        - 获取工作项详情 (?projectKey=xxx&typeKey=xxx)
 *   POST /workitem            - 创建工作项
 *   PUT  /workitem/:id        - 更新工作项
 *   DELETE /workitem/:id      - 删除工作项
 *   POST /search              - 搜索工作项（通用搜索）
 *
 *   === 评论 ===
 *   GET  /workitem/:id/comments - 获取评论列表
 *   POST /workitem/:id/comment  - 添加评论
 *   DELETE /comment/:id         - 删除评论
 *
 *   === 子任务 ===
 *   GET  /workitem/:id/subtasks  - 获取子任务列表
 *   POST /workitem/:id/subtask   - 创建子任务
 *   PUT  /subtask/:id            - 更新子任务
 *   DELETE /subtask/:id          - 删除子任务
 *
 *   === 关联关系 ===
 *   GET  /workitem/:id/relations - 获取关联关系
 *   POST /workitem/:id/relation  - 创建关联关系
 *   DELETE /relation/:id         - 删除关联关系
 *
 *   === 工作流 ===
 *   GET  /workflow             - 获取工作流定义 (?projectKey=xxx&typeKey=xxx)
 *   POST /workitem/:id/transition - 状态流转
 *
 *   === 工时 ===
 *   GET  /workitem/:id/manhours  - 获取工时记录
 *   POST /workitem/:id/manhour   - 添加工时记录
 *   PUT  /manhour/:id            - 更新工时记录
 *   DELETE /manhour/:id          - 删除工时记录
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
  const typeKey = (query.typeKey as string) || 'issue';

  try {
    // ==================== 基础 ====================

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
      const resp = await client.field.getProjectFields(ctx, projectKey, typeKey ? { work_item_type_key: typeKey } : undefined);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, fields: resp.data });
      return;
    }

    // ==================== 工作项 ====================

    // GET /workitems
    if (path === '/workitems' && req.method === 'GET') {
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

    // POST /search - 通用搜索
    if (path === '/search' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const resp = await client.workitem.searchByParams(ctx, projectKey, {
        work_item_type_key: body.typeKey as string || typeKey,
        search_key: body.keyword as string,
        page_num: body.pageNum as number || 1,
        page_size: body.pageSize as number || 20,
      });

      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, ...resp.data });
      return;
    }

    // GET /workitem/:id
    const workitemMatch = path.match(/^\/workitem\/(\d+)$/);
    if (workitemMatch && req.method === 'GET') {
      const workItemId = parseInt(workitemMatch[1], 10);

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

      const itemTypeKey = (body.typeKey as string) || typeKey;
      const name = body.name as string;
      if (!name) {
        errorResponse(res, 'name is required');
        return;
      }

      const resp = await client.workitem.createWorkItem(ctx, projectKey, {
        work_item_type_key: itemTypeKey,
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

    // DELETE /workitem/:id
    if (workitemMatch && req.method === 'DELETE') {
      const workItemId = parseInt(workitemMatch[1], 10);

      const resp = await client.workitem.deleteWorkItem(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 评论 ====================

    // GET /workitem/:id/comments
    const commentsMatch = path.match(/^\/workitem\/(\d+)\/comments$/);
    if (commentsMatch && req.method === 'GET') {
      const workItemId = parseInt(commentsMatch[1], 10);

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

    // DELETE /comment/:id
    const deleteCommentMatch = path.match(/^\/comment\/([^/]+)$/);
    if (deleteCommentMatch && req.method === 'DELETE') {
      const commentId = deleteCommentMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) {
        errorResponse(res, 'workItemId query param is required');
        return;
      }

      const resp = await client.comment.deleteComment(ctx, projectKey, typeKey, workItemId, commentId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 子任务 ====================

    // GET /workitem/:id/subtasks
    const subtasksMatch = path.match(/^\/workitem\/(\d+)\/subtasks$/);
    if (subtasksMatch && req.method === 'GET') {
      const workItemId = parseInt(subtasksMatch[1], 10);

      const resp = await client.subtask.searchSubtask(ctx, projectKey, typeKey, workItemId, {
        page_num: parseInt(query.pageNum as string, 10) || 1,
        page_size: parseInt(query.pageSize as string, 10) || 50,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, workItemId, subtasks: resp.data });
      return;
    }

    // POST /workitem/:id/subtask
    const createSubtaskMatch = path.match(/^\/workitem\/(\d+)\/subtask$/);
    if (createSubtaskMatch && req.method === 'POST') {
      const workItemId = parseInt(createSubtaskMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const name = body.name as string;
      if (!name) {
        errorResponse(res, 'name is required');
        return;
      }

      const resp = await client.subtask.createSubTask(ctx, projectKey, typeKey, workItemId, {
        name,
        owner: body.owner as string,
        note: body.note as string,
        role_owners: body.roleOwners as Array<{ role_key: string; owner: string }>,
        schedules: body.schedules as Array<{ deadline: number; reminder: number }>,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true, subtaskId: resp.data?.id }, 201);
      return;
    }

    // PUT /subtask/:id
    const updateSubtaskMatch = path.match(/^\/subtask\/([^/]+)$/);
    if (updateSubtaskMatch && req.method === 'PUT') {
      const subtaskId = updateSubtaskMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) {
        errorResponse(res, 'workItemId query param is required');
        return;
      }
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const resp = await client.subtask.updateSubTask(ctx, projectKey, typeKey, workItemId, subtaskId, {
        name: body.name as string,
        owner: body.owner as string,
        note: body.note as string,
        done: body.done as boolean,
        role_owners: body.roleOwners as Array<{ role_key: string; owner: string }>,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /subtask/:id
    if (updateSubtaskMatch && req.method === 'DELETE') {
      const subtaskId = updateSubtaskMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) {
        errorResponse(res, 'workItemId query param is required');
        return;
      }

      const resp = await client.subtask.deleteSubTask(ctx, projectKey, typeKey, workItemId, subtaskId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 关联关系 ====================

    // GET /workitem/:id/relations
    const relationsMatch = path.match(/^\/workitem\/(\d+)\/relations$/);
    if (relationsMatch && req.method === 'GET') {
      const workItemId = parseInt(relationsMatch[1], 10);

      const resp = await client.relation.getWorkItemRelation(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, workItemId, relations: resp.data });
      return;
    }

    // POST /workitem/:id/relation
    const createRelationMatch = path.match(/^\/workitem\/(\d+)\/relation$/);
    if (createRelationMatch && req.method === 'POST') {
      const workItemId = parseInt(createRelationMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const relationTypeKey = body.relationTypeKey as string;
      const targetId = body.targetId as number;
      const targetTypeKey = body.targetTypeKey as string;
      if (!relationTypeKey || !targetId || !targetTypeKey) {
        errorResponse(res, 'relationTypeKey, targetId, and targetTypeKey are required');
        return;
      }

      const resp = await client.relation.createWorkItemRelation(ctx, projectKey, typeKey, workItemId, {
        relation_type_key: relationTypeKey,
        target_work_item_id: targetId,
        target_work_item_type_key: targetTypeKey,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true, relationId: resp.data?.relation_id }, 201);
      return;
    }

    // DELETE /relation/:id
    const deleteRelationMatch = path.match(/^\/relation\/([^/]+)$/);
    if (deleteRelationMatch && req.method === 'DELETE') {
      const relationId = deleteRelationMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) {
        errorResponse(res, 'workItemId query param is required');
        return;
      }

      const resp = await client.relation.deleteWorkItemRelation(ctx, projectKey, typeKey, workItemId, relationId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 工作流 ====================

    // GET /workflow
    if (path === '/workflow' && req.method === 'GET') {
      const resp = await client.workflow.getWorkFlow(ctx, projectKey, typeKey);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, workflow: resp.data });
      return;
    }

    // POST /workitem/:id/transition - 状态流转
    const transitionMatch = path.match(/^\/workitem\/(\d+)\/transition$/);
    if (transitionMatch && req.method === 'POST') {
      const workItemId = parseInt(transitionMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const nodeId = body.nodeId as string;
      if (!nodeId) {
        errorResponse(res, 'nodeId is required');
        return;
      }

      const resp = await client.workflow.updateNodeState(ctx, projectKey, typeKey, workItemId, {
        node_id: nodeId,
        fields: body.fields as Array<{ field_key: string; field_value: unknown }>,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 工时 ====================

    // GET /workitem/:id/manhours
    const manhoursMatch = path.match(/^\/workitem\/(\d+)\/manhours$/);
    if (manhoursMatch && req.method === 'GET') {
      const workItemId = parseInt(manhoursMatch[1], 10);

      const resp = await client.manhour.getWorkItemManHourRecords(ctx, projectKey, typeKey, workItemId, {
        page_num: parseInt(query.pageNum as string, 10) || 1,
        page_size: parseInt(query.pageSize as string, 10) || 50,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { projectKey, typeKey, workItemId, records: resp.data });
      return;
    }

    // POST /workitem/:id/manhour
    const createManhourMatch = path.match(/^\/workitem\/(\d+)\/manhour$/);
    if (createManhourMatch && req.method === 'POST') {
      const workItemId = parseInt(createManhourMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const workTime = body.workTime as number;
      if (!workTime) {
        errorResponse(res, 'workTime (minutes) is required');
        return;
      }

      const resp = await client.manhour.createWorkingHourRecord(ctx, projectKey, typeKey, workItemId, {
        work_time: workTime,
        work_date: body.workDate as number,
        work_description: body.description as string,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true, recordId: resp.data?.id }, 201);
      return;
    }

    // PUT /manhour/:id
    const updateManhourMatch = path.match(/^\/manhour\/([^/]+)$/);
    if (updateManhourMatch && req.method === 'PUT') {
      const recordId = updateManhourMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) {
        errorResponse(res, 'workItemId query param is required');
        return;
      }
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const resp = await client.manhour.updateWorkingHourRecord(ctx, projectKey, typeKey, workItemId, recordId, {
        work_time: body.workTime as number,
        work_date: body.workDate as number,
        work_description: body.description as string,
      });
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /manhour/:id
    if (updateManhourMatch && req.method === 'DELETE') {
      const recordId = updateManhourMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) {
        errorResponse(res, 'workItemId query param is required');
        return;
      }

      const resp = await client.manhour.deleteWorkingHourRecord(ctx, projectKey, typeKey, workItemId, recordId);
      if (resp.err_code !== 0) {
        errorResponse(res, resp.err_msg, 400);
        return;
      }
      jsonResponse(res, { success: true });
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
