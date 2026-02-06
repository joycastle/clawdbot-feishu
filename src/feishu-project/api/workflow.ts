/**
 * 工作流 API - 流程、节点、状态流转
 */

import { request, buildPath, type RequestContext } from './base.js';
import type {
  ApiResponse,
  WorkflowInfo,
  WorkflowNode,
  StateInfo,
} from './types.js';

/**
 * 获取工作流
 */
export async function getWorkFlow(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number
): Promise<ApiResponse<WorkflowInfo>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/workflow/query', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, {});
}

/**
 * 状态流转
 */
export async function updateStateFlow(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    node_id: string;
    target_state_key: string;
    fields?: { field_key: string; field_value: unknown }[];
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/workflow/:work_item_type_key/:work_item_id/node/state_change', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 节点完成/回滚
 */
export async function updateNodeState(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  nodeId: string,
  params: {
    operate: 'finish' | 'rollback';
    fields?: { field_key: string; field_value: unknown }[];
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/workflow/:work_item_type_key/:work_item_id/node/:node_id/operate', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
    node_id: nodeId,
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 更新节点
 */
export async function updateWorkflowNode(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  nodeId: string,
  params: {
    name?: string;
    owners?: string[]; // user_keys
    schedule_begin_time?: number;
    schedule_finish_time?: number;
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/workflow/:work_item_type_key/:work_item_id/node/:node_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
    node_id: nodeId,
  });
  return request(ctx, 'PUT', path, params);
}

/**
 * 更新节点实际开始/结束时间
 */
export async function actualTimeUpdate(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_id: number;
    work_item_type_key: string;
    node_id: string;
    actual_begin_time?: number;
    actual_finish_time?: number;
  }
): Promise<ApiResponse<void>> {
  return request(ctx, 'POST', '/work_item/actual_time/update', params);
}

/**
 * 获取节点/状态流转所需必填信息
 */
export async function getWorkItemTransRequiredItem(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_id: number;
    work_item_type_key: string;
    node_id: string;
    target_state_key?: string;
  }
): Promise<ApiResponse<{ required_fields: unknown[] }>> {
  return request(ctx, 'POST', '/work_item/transition_required_info/get', params);
}
