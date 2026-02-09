/**
 * 飞书项目 HTTP API - 完整版
 * 监听 localhost:18791，供 Agent 调用
 * 暴露所有 SDK 能力（68 个 API）
 *
 * 通用参数：?projectKey=xxx&typeKey=xxx（默认 projectKey=62b29e862be43458fc1ef6b2, typeKey=issue）
 */

import * as http from 'node:http';
import { FeishuProjectClient } from './feishu-project/client.js';
import type { FeishuConfig } from './types.js';

const PORT = 18793;
let server: http.Server | null = null;
let client: FeishuProjectClient | null = null;

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

    if (path === '/status' && req.method === 'GET') {
      const stats = client.getCacheStats();
      jsonResponse(res, { ok: true, defaultProjectKey, cache: stats });
      return;
    }

    if (path === '/projects' && req.method === 'GET') {
      const projects = await client.getProjects();
      jsonResponse(res, { projects: Array.from(projects.values()) });
      return;
    }

    if (path === '/project' && req.method === 'GET') {
      const resp = await client.project.getProjectDetail(ctx, projectKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { project: resp.data });
      return;
    }

    if (path === '/types' && req.method === 'GET') {
      const types = await client.getWorkItemTypes(projectKey);
      jsonResponse(res, { projectKey, types });
      return;
    }

    if (path === '/type' && req.method === 'GET') {
      const resp = await client.workitem.getWorkItemTypeInfo(ctx, projectKey, typeKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { projectKey, typeKey, typeInfo: resp.data });
      return;
    }

    if (path === '/type' && req.method === 'PUT') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.updateWorkItemTypeInfo(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 字段 ====================

    if (path === '/fields' && req.method === 'GET') {
      const resp = await client.field.getProjectFields(ctx, projectKey, typeKey ? { work_item_type_key: typeKey } : undefined);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { projectKey, typeKey, fields: resp.data });
      return;
    }

    if (path === '/field' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.field.createField(ctx, projectKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, data: resp.data }, 201);
      return;
    }

    if (path === '/field' && req.method === 'PUT') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.field.updateField(ctx, projectKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    if (path === '/field/compound' && req.method === 'PUT') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.field.updateCompoundFieldValue(ctx, projectKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    if (path === '/businesses' && req.method === 'GET') {
      const resp = await client.field.getBusinesses(ctx, projectKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { businesses: resp.data });
      return;
    }

    // ==================== 工作项 ====================

    // GET /workitems - 获取工作项列表
    // 使用 search/params 接口（比 filter 更稳定）
    if (path === '/workitems' && req.method === 'GET') {
      const pageNum = parseInt(query.pageNum as string, 10) || 1;
      const pageSize = parseInt(query.pageSize as string, 10) || 20;
      const resp = await client.workitem.searchByParams(ctx, projectKey, typeKey, {
        page_num: pageNum,
        page_size: pageSize,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      // 兼容旧格式：items -> workItems
      const data = resp.data as any;
      jsonResponse(res, { 
        projectKey, 
        typeKey, 
        workItems: data || [],
        pagination: { page_num: pageNum, page_size: pageSize }
      });
      return;
    }

    if (path === '/workitems/across' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.filterAcrossProject(ctx, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // POST /search - 搜索工作项
    // 支持两种方式:
    //   1. 简单模式: { keyword: "xxx", typeKey: "story" } -> 按名称模糊搜索
    //   2. 高级模式: { search_group: {...}, typeKey: "story" } -> 完整搜索条件
    if (path === '/search' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      
      const workItemTypeKey = body.typeKey as string || typeKey;
      
      // 构建搜索参数
      let searchGroup = body.search_group;
      if (!searchGroup && body.keyword) {
        // 简单模式：用 ~ 做名称模糊匹配
        searchGroup = {
          conjunction: 'AND',
          search_params: [
            { param_key: 'name', value: body.keyword as string, operator: '~' }
          ],
          search_groups: []
        };
      }
      
      const resp = await client.workitem.searchByParams(ctx, projectKey, workItemTypeKey, {
        search_group: searchGroup,
        page_num: body.pageNum as number || 1,
        page_size: body.pageSize as number || 20,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { projectKey, typeKey: workItemTypeKey, ...resp.data });
      return;
    }

    if (path === '/search/composite' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.compositiveSearch(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    if (path === '/search/universal' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.universalSearch(ctx, projectKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    if (path === '/search/integrate' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.integrateSearch(ctx, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // GET /workitem/:id
    const workitemMatch = path.match(/^\/workitem\/(\d+)$/);
    if (workitemMatch && req.method === 'GET') {
      const workItemId = parseInt(workitemMatch[1], 10);
      const resp = await client.workitem.getWorkItemsByIds(ctx, projectKey, typeKey, [workItemId]);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      const item = resp.data?.[0];
      if (!item) { errorResponse(res, 'Work item not found', 404); return; }
      jsonResponse(res, { projectKey, typeKey, workItem: item });
      return;
    }

    // POST /workitem
    if (path === '/workitem' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const itemTypeKey = (body.typeKey as string) || typeKey;
      const name = body.name as string;
      if (!name) { errorResponse(res, 'name is required'); return; }
      const resp = await client.workitem.createWorkItem(ctx, projectKey, {
        work_item_type_key: itemTypeKey,
        name,
        template_id: body.templateId as string,
        field_value_pairs: body.fields as Array<{ field_key: string; field_value: unknown }>,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, workItemId: resp.data?.work_item_id }, 201);
      return;
    }

    // PUT /workitem/:id
    if (workitemMatch && req.method === 'PUT') {
      const workItemId = parseInt(workitemMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.updateWorkItem(ctx, projectKey, typeKey, workItemId, {
        update_fields: body.fields as Array<{ field_key: string; field_value: unknown }>,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /workitem/:id
    if (workitemMatch && req.method === 'DELETE') {
      const workItemId = parseInt(workitemMatch[1], 10);
      const resp = await client.workitem.deleteWorkItem(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // POST /workitem/:id/abort
    const abortMatch = path.match(/^\/workitem\/(\d+)\/abort$/);
    if (abortMatch && req.method === 'POST') {
      const workItemId = parseInt(abortMatch[1], 10);
      const resp = await client.workitem.abortWorkItem(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // POST /workitem/:id/freeze
    const freezeMatch = path.match(/^\/workitem\/(\d+)\/freeze$/);
    if (freezeMatch && req.method === 'POST') {
      const workItemId = parseInt(freezeMatch[1], 10);
      const body = parseJson(await readBody(req));
      const resp = await client.workitem.freezeWorkItem(ctx, projectKey, typeKey, workItemId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // GET /workitem/:id/metadata
    const metadataMatch = path.match(/^\/workitem\/(\d+)\/metadata$/);
    if (metadataMatch && req.method === 'GET') {
      const workItemId = parseInt(metadataMatch[1], 10);
      const resp = await client.workitem.getWorkItemMetaData(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { metadata: resp.data });
      return;
    }

    // GET /workitem/:id/oprecord
    const oprecordMatch = path.match(/^\/workitem\/(\d+)\/oprecord$/);
    if (oprecordMatch && req.method === 'GET') {
      const workItemId = parseInt(oprecordMatch[1], 10);
      const resp = await client.workitem.getWorkItemOpRecord(ctx, projectKey, typeKey, workItemId, {
        page_num: parseInt(query.pageNum as string, 10) || 1,
        page_size: parseInt(query.pageSize as string, 10) || 50,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { records: resp.data });
      return;
    }

    // POST /workitems/batch
    if (path === '/workitems/batch' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workitem.batchUpdateWorkItems(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, taskId: resp.data?.job_id });
      return;
    }

    // GET /task/:id
    const taskMatch = path.match(/^\/task\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') {
      const taskId = taskMatch[1];
      const resp = await client.workitem.queryTaskResult(ctx, projectKey, typeKey, taskId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { task: resp.data });
      return;
    }

    // ==================== 评论 ====================

    // GET /workitem/:id/comments
    const commentsMatch = path.match(/^\/workitem\/(\d+)\/comments$/);
    if (commentsMatch && req.method === 'GET') {
      const workItemId = parseInt(commentsMatch[1], 10);
      const resp = await client.comment.listComments(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { workItemId, comments: resp.data?.comments });
      return;
    }

    // POST /workitem/:id/comment
    const commentMatch = path.match(/^\/workitem\/(\d+)\/comment$/);
    if (commentMatch && req.method === 'POST') {
      const workItemId = parseInt(commentMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const content = body.content as string;
      if (!content) { errorResponse(res, 'content is required'); return; }
      const resp = await client.comment.createComment(ctx, projectKey, typeKey, workItemId, { content });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, commentId: resp.data?.comment_id }, 201);
      return;
    }

    // PUT /comment/:id
    const updateCommentMatch = path.match(/^\/comment\/([^/]+)$/);
    if (updateCommentMatch && req.method === 'PUT') {
      const commentId = updateCommentMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.comment.updateComment(ctx, projectKey, typeKey, workItemId, commentId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /comment/:id
    if (updateCommentMatch && req.method === 'DELETE') {
      const commentId = updateCommentMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const resp = await client.comment.deleteComment(ctx, projectKey, typeKey, workItemId, commentId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // GET /workitem/:id/filecomments
    const fileCommentsMatch = path.match(/^\/workitem\/(\d+)\/filecomments$/);
    if (fileCommentsMatch && req.method === 'GET') {
      const workItemId = parseInt(fileCommentsMatch[1], 10);
      const resp = await client.comment.listFileComments(ctx, projectKey, typeKey, workItemId, {
        file_key: query.fileKey as string,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { comments: resp.data });
      return;
    }

    // POST /workitem/:id/filecomment
    const fileCommentMatch = path.match(/^\/workitem\/(\d+)\/filecomment$/);
    if (fileCommentMatch && req.method === 'POST') {
      const workItemId = parseInt(fileCommentMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.comment.createFileComment(ctx, projectKey, typeKey, workItemId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, data: resp.data }, 201);
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
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { workItemId, subtasks: resp.data });
      return;
    }

    // GET /subtask/:id
    const getSubtaskMatch = path.match(/^\/subtask\/([^/]+)$/);
    if (getSubtaskMatch && req.method === 'GET') {
      const subtaskId = getSubtaskMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const resp = await client.subtask.getSubTask(ctx, projectKey, typeKey, workItemId, subtaskId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { subtask: resp.data });
      return;
    }

    // POST /workitem/:id/subtask
    const createSubtaskMatch = path.match(/^\/workitem\/(\d+)\/subtask$/);
    if (createSubtaskMatch && req.method === 'POST') {
      const workItemId = parseInt(createSubtaskMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const name = body.name as string;
      if (!name) { errorResponse(res, 'name is required'); return; }
      const resp = await client.subtask.createSubTask(ctx, projectKey, typeKey, workItemId, {
        name,
        owner: body.owner as string,
        note: body.note as string,
        role_owners: body.roleOwners as any,
        schedules: body.schedules as any,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, subtaskId: resp.data?.id }, 201);
      return;
    }

    // PUT /subtask/:id
    if (getSubtaskMatch && req.method === 'PUT') {
      const subtaskId = getSubtaskMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.subtask.updateSubTask(ctx, projectKey, typeKey, workItemId, subtaskId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /subtask/:id
    if (getSubtaskMatch && req.method === 'DELETE') {
      const subtaskId = getSubtaskMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const resp = await client.subtask.deleteSubTask(ctx, projectKey, typeKey, workItemId, subtaskId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // POST /subtask/:id/modify
    const modifySubtaskMatch = path.match(/^\/subtask\/([^/]+)\/modify$/);
    if (modifySubtaskMatch && req.method === 'POST') {
      const subtaskId = modifySubtaskMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.subtask.modifySubTask(ctx, projectKey, typeKey, workItemId, subtaskId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 关联关系 ====================

    // POST /workitem/:typeKey/:id/search_by_relation
    // 查询某个工作项（如版本）关联的其他工作项
    // 例: POST /workitem/version/6479555049/search_by_relation
    //     body: { "relationKey": "planning_version", "targetTypeKey": "story" }
    const searchByRelationMatch = path.match(/^\/workitem\/([^/]+)\/(\d+)\/search_by_relation$/);
    if (searchByRelationMatch && req.method === 'POST') {
      const sourceTypeKey = searchByRelationMatch[1];
      const workItemId = searchByRelationMatch[2];
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      
      const relationKey = body.relationKey as string || 'planning_version';
      const targetTypeKey = body.targetTypeKey as string || 'story';
      
      // 直接调用飞书项目 API
      const token = await client!.getPluginToken();
      const resp = await fetch(
        `https://project.feishu.cn/open_api/${projectKey}/work_item/${sourceTypeKey}/${workItemId}/search_by_relation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PLUGIN-TOKEN': token,
            'X-USER-KEY': client!.getContext().userKey,
          },
          body: JSON.stringify({
            relation_key: relationKey,
            relation_work_item_type_key: targetTypeKey,
          }),
        }
      );
      
      const data = await resp.json() as any;
      if (data.err_code) {
        errorResponse(res, data.err_msg || 'API error', 400);
        return;
      }
      
      jsonResponse(res, {
        projectKey,
        sourceType: sourceTypeKey,
        sourceId: workItemId,
        relationKey,
        targetType: targetTypeKey,
        items: data.data || [],
        total: (data.data || []).length,
      });
      return;
    }

    // 便捷端点: GET /version/:id/stories (查版本关联的需求)
    const versionStoriesMatch = path.match(/^\/version\/(\d+)\/stories$/);
    if (versionStoriesMatch && req.method === 'GET') {
      const versionId = versionStoriesMatch[1];
      const token = await client!.getPluginToken();
      const resp = await fetch(
        `https://project.feishu.cn/open_api/${projectKey}/work_item/version/${versionId}/search_by_relation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PLUGIN-TOKEN': token,
            'X-USER-KEY': client!.getContext().userKey,
          },
          body: JSON.stringify({
            relation_key: 'planning_version',
            relation_work_item_type_key: 'story',
          }),
        }
      );
      const data = await resp.json() as any;
      if (data.err_code) { errorResponse(res, data.err_msg, 400); return; }
      jsonResponse(res, { versionId, stories: data.data || [], total: (data.data || []).length });
      return;
    }

    // 便捷端点: GET /version/:id/issues (查版本关联的缺陷)
    const versionIssuesMatch = path.match(/^\/version\/(\d+)\/issues$/);
    if (versionIssuesMatch && req.method === 'GET') {
      const versionId = versionIssuesMatch[1];
      const token = await client!.getPluginToken();
      const resp = await fetch(
        `https://project.feishu.cn/open_api/${projectKey}/work_item/version/${versionId}/search_by_relation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PLUGIN-TOKEN': token,
            'X-USER-KEY': client!.getContext().userKey,
          },
          body: JSON.stringify({
            relation_key: 'planning_version',
            relation_work_item_type_key: 'issue',
          }),
        }
      );
      const data = await resp.json() as any;
      if (data.err_code) { errorResponse(res, data.err_msg, 400); return; }
      jsonResponse(res, { versionId, issues: data.data || [], total: (data.data || []).length });
      return;
    }

    // GET /workitem/:id/relations
    const relationsMatch = path.match(/^\/workitem\/(\d+)\/relations$/);
    if (relationsMatch && req.method === 'GET') {
      const workItemId = parseInt(relationsMatch[1], 10);
      const resp = await client.relation.getWorkItemRelation(ctx, projectKey, typeKey, workItemId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { workItemId, relations: resp.data });
      return;
    }

    // POST /workitem/:id/relation
    const createRelationMatch = path.match(/^\/workitem\/(\d+)\/relation$/);
    if (createRelationMatch && req.method === 'POST') {
      const workItemId = parseInt(createRelationMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.relation.createWorkItemRelation(ctx, projectKey, typeKey, workItemId, {
        relation_type_key: body.relationTypeKey as string,
        target_work_item_id: body.targetId as number,
        target_work_item_type_key: body.targetTypeKey as string,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, relationId: resp.data?.relation_id }, 201);
      return;
    }

    // PUT /relation/:id
    const updateRelationMatch = path.match(/^\/relation\/([^/]+)$/);
    if (updateRelationMatch && req.method === 'PUT') {
      const relationId = updateRelationMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.relation.updateWorkItemRelation(ctx, projectKey, typeKey, workItemId, relationId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /relation/:id
    if (updateRelationMatch && req.method === 'DELETE') {
      const relationId = updateRelationMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const resp = await client.relation.deleteWorkItemRelation(ctx, projectKey, typeKey, workItemId, relationId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // POST /relations/search
    if (path === '/relations/search' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.relation.searchWorkItemsRelation(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // POST /relations/story
    if (path === '/relations/story' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.relation.createStoryRelations(ctx, projectKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, data: resp.data }, 201);
      return;
    }

    // GET /relations/story
    if (path === '/relations/story' && req.method === 'GET') {
      const resp = await client.relation.queryStoryRelations(ctx, projectKey, {
        work_item_id: parseInt(query.workItemId as string, 10),
        work_item_type_key: query.workItemTypeKey as string,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // GET /relations/project
    if (path === '/relations/project' && req.method === 'GET') {
      const resp = await client.relation.queryProjectRelation(ctx, projectKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // POST /relations/project/instance
    if (path === '/relations/project/instance' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.relation.createProjectRelationInstances(ctx, projectKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, data: resp.data }, 201);
      return;
    }

    // GET /relations/project/instance
    if (path === '/relations/project/instance' && req.method === 'GET') {
      const resp = await client.relation.queryProjectRelationInstance(ctx, projectKey, {
        project_relation_id: query.relationId as string,
        page_num: parseInt(query.pageNum as string, 10) || 1,
        page_size: parseInt(query.pageSize as string, 10) || 50,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // DELETE /relations/project/instance/:id
    const deleteProjectRelInstanceMatch = path.match(/^\/relations\/project\/instance\/([^/]+)$/);
    if (deleteProjectRelInstanceMatch && req.method === 'DELETE') {
      const instanceId = deleteProjectRelInstanceMatch[1];
      const resp = await client.relation.deleteProjectRelationInstance(ctx, projectKey, instanceId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 工作流 ====================

    if (path === '/workflow' && req.method === 'GET') {
      const resp = await client.workflow.getWorkFlow(ctx, projectKey, typeKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { workflow: resp.data });
      return;
    }

    // POST /workitem/:id/transition
    const transitionMatch = path.match(/^\/workitem\/(\d+)\/transition$/);
    if (transitionMatch && req.method === 'POST') {
      const workItemId = parseInt(transitionMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const nodeId = body.nodeId as string;
      if (!nodeId) { errorResponse(res, 'nodeId is required'); return; }
      const resp = await client.workflow.updateNodeState(ctx, projectKey, typeKey, workItemId, {
        node_id: nodeId,
        fields: body.fields as any,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // GET /workitem/:id/trans-required
    const transRequiredMatch = path.match(/^\/workitem\/(\d+)\/trans-required$/);
    if (transRequiredMatch && req.method === 'GET') {
      const workItemId = parseInt(transRequiredMatch[1], 10);
      const resp = await client.workflow.getWorkItemTransRequiredItem(ctx, projectKey, typeKey, workItemId, {
        node_id: query.nodeId as string,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, resp.data);
      return;
    }

    // PUT /workflow/stateflow
    if (path === '/workflow/stateflow' && req.method === 'PUT') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workflow.updateStateFlow(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // PUT /workflow/node
    if (path === '/workflow/node' && req.method === 'PUT') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workflow.updateWorkflowNode(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // PUT /workflow/actualtime
    if (path === '/workflow/actualtime' && req.method === 'PUT') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.workflow.actualTimeUpdate(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
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
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { workItemId, records: resp.data });
      return;
    }

    // POST /workitem/:id/manhour
    const createManhourMatch = path.match(/^\/workitem\/(\d+)\/manhour$/);
    if (createManhourMatch && req.method === 'POST') {
      const workItemId = parseInt(createManhourMatch[1], 10);
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const workTime = body.workTime as number;
      if (!workTime) { errorResponse(res, 'workTime (minutes) required'); return; }
      const resp = await client.manhour.createWorkingHourRecord(ctx, projectKey, typeKey, workItemId, {
        work_time: workTime,
        work_date: body.workDate as number,
        work_description: body.description as string,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, recordId: resp.data?.id }, 201);
      return;
    }

    // PUT /manhour/:id
    const updateManhourMatch = path.match(/^\/manhour\/([^/]+)$/);
    if (updateManhourMatch && req.method === 'PUT') {
      const recordId = updateManhourMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.manhour.updateWorkingHourRecord(ctx, projectKey, typeKey, workItemId, recordId, {
        work_time: body.workTime as number,
        work_date: body.workDate as number,
        work_description: body.description as string,
      });
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // DELETE /manhour/:id
    if (updateManhourMatch && req.method === 'DELETE') {
      const recordId = updateManhourMatch[1];
      const workItemId = parseInt(query.workItemId as string, 10);
      if (!workItemId) { errorResponse(res, 'workItemId required'); return; }
      const resp = await client.manhour.deleteWorkingHourRecord(ctx, projectKey, typeKey, workItemId, recordId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 模板 ====================

    if (path === '/templates' && req.method === 'GET') {
      const resp = await client.template.listTemplateConf(ctx, projectKey, typeKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { templates: resp.data });
      return;
    }

    const templateMatch = path.match(/^\/template\/([^/]+)$/);
    if (templateMatch && req.method === 'GET') {
      const templateId = templateMatch[1];
      const resp = await client.template.getTemplateDetail(ctx, projectKey, typeKey, templateId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { template: resp.data });
      return;
    }

    if (path === '/template' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.template.createTemplateDetail(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, data: resp.data }, 201);
      return;
    }

    if (templateMatch && req.method === 'PUT') {
      const templateId = templateMatch[1];
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.template.updateTemplateDetail(ctx, projectKey, typeKey, templateId, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    if (templateMatch && req.method === 'DELETE') {
      const templateId = templateMatch[1];
      const resp = await client.template.deleteTemplateDetail(ctx, projectKey, typeKey, templateId);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    // ==================== 流程角色 ====================

    if (path === '/roles' && req.method === 'GET') {
      const resp = await client.template.getRoleConfDetails(ctx, projectKey, typeKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { roles: resp.data });
      return;
    }

    if (path === '/role' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.template.createFlowRole(ctx, projectKey, typeKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true, data: resp.data }, 201);
      return;
    }

    const roleMatch = path.match(/^\/role\/([^/]+)$/);
    if (roleMatch && req.method === 'PUT') {
      const roleKey = roleMatch[1];
      const body = parseJson(await readBody(req));
      if (!body) { errorResponse(res, 'Invalid JSON'); return; }
      const resp = await client.template.updateFlowRole(ctx, projectKey, typeKey, roleKey, body as any);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
      jsonResponse(res, { success: true });
      return;
    }

    if (roleMatch && req.method === 'DELETE') {
      const roleKey = roleMatch[1];
      const resp = await client.template.deleteFlowRole(ctx, projectKey, typeKey, roleKey);
      if (resp.err_code !== 0) { errorResponse(res, resp.err_msg, 400); return; }
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
    log?.('[FeishuProjectAPI] Missing config - not starting');
    return;
  }

  client = new FeishuProjectClient({ pluginId, pluginSecret, userKey });

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
