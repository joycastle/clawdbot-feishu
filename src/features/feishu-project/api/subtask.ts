/**
 * 子任务 API
 */

import { request, buildPath, type RequestContext } from './base.js';
import type {
  ApiResponse,
  SubTask,
  Pagination,
} from './types.js';

/**
 * 创建子任务
 */
export async function createSubTask(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    name: string;
    owner?: string; // user_key
    deadline?: number;
    node_id?: string;
  }
): Promise<ApiResponse<{ task_id: string }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/workflow/task', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 获取子任务详情
 */
export async function getSubTask(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number
): Promise<ApiResponse<{ tasks: SubTask[] }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/workflow/task', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'GET', path);
}

/**
 * 更新子任务
 */
export async function updateSubTask(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  nodeId: string,
  taskId: string,
  params: {
    name?: string;
    owner?: string;
    deadline?: number;
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/workflow/:node_id/task/:task_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
    node_id: nodeId,
    task_id: taskId,
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 删除子任务
 */
export async function deleteSubTask(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  taskId: string
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/task/:task_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
    task_id: taskId,
  });
  return request(ctx, 'DELETE', path);
}

/**
 * 子任务完成/回滚
 */
export async function modifySubTask(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    task_id: string;
    operate: 'finish' | 'rollback';
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/subtask/modify', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 搜索子任务（跨空间）
 */
export async function searchSubtask(
  ctx: RequestContext,
  params: {
    project_keys?: string[];
    work_item_type_keys?: string[];
    owner_keys?: string[];
    status?: number[];
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: SubTask[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/work_item/subtask/search', params);
}
