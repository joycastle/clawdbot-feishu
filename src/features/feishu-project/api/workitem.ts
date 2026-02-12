/**
 * 工作项 API - CRUD、搜索
 */

import { request, buildPath, buildQuery, type RequestContext } from './base.js';
import type {
  ApiResponse,
  WorkItem,
  WorkItemDetail,
  WorkItemType,
  FieldValuePair,
  SearchParams,
  ExpandOptions,
  OperationRecord,
  Pagination,
} from './types.js';

// ============ 工作项类型 ============

/**
 * 获取空间下所有工作项类型
 */
export async function getWorkItemTypes(
  ctx: RequestContext,
  projectKey: string
): Promise<ApiResponse<WorkItemType[]>> {
  return request(ctx, 'GET', `/${projectKey}/work_item/all-types`);
}

/**
 * 获取工作项类型详情
 */
export async function getWorkItemTypeInfo(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string
): Promise<ApiResponse<WorkItemType>> {
  const path = buildPath('/:project_key/work_item/type/:work_item_type_key', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'GET', path);
}

/**
 * 更新工作项类型
 */
export async function updateWorkItemTypeInfo(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  data: { name?: string; is_disable?: number }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/type/:work_item_type_key', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'PUT', path, data);
}

// ============ 工作项 CRUD ============

/**
 * 创建工作项
 */
export async function createWorkItem(
  ctx: RequestContext,
  projectKey: string,
  data: {
    work_item_type_key: string;
    name: string;
    template_id?: number;
    field_value_pairs?: FieldValuePair[];
  }
): Promise<ApiResponse<number>> {
  // 飞书 API 返回 data 直接是 work_item_id 数字
  return request(ctx, 'POST', `/${projectKey}/work_item/create`, data);
}

/**
 * 更新工作项
 */
export async function updateWorkItem(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  data: {
    update_fields?: FieldValuePair[];
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'PUT', path, data);
}

/**
 * 删除工作项
 */
export async function deleteWorkItem(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'DELETE', path);
}

/**
 * 批量查询工作项
 */
export async function getWorkItemsByIds(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemIds: number[],
  expand?: ExpandOptions
): Promise<ApiResponse<WorkItemDetail[]>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/query', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'POST', path, {
    work_item_ids: workItemIds,
    expand,
  });
}

/**
 * 终止/恢复工作项
 */
export async function abortWorkItem(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  abort: boolean
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/abort', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'PUT', path, { is_abort: abort });
}

/**
 * 冻结工作项
 */
export async function freezeWorkItem(
  ctx: RequestContext,
  workItemId: number,
  freeze: boolean
): Promise<ApiResponse<void>> {
  return request(ctx, 'PUT', '/work_item/freeze', {
    work_item_id: workItemId,
    is_freeze: freeze,
  });
}

// ============ 工作项搜索 ============

/**
 * 获取工作项列表（非跨空间，简单筛选）
 */
export async function filterWorkItems(
  ctx: RequestContext,
  projectKey: string,
  params: {
    work_item_type_key?: string;
    created_at?: { start?: number; end?: number };
    updated_at?: { start?: number; end?: number };
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: WorkItem[]; pagination: Pagination }>> {
  return request(ctx, 'POST', `/${projectKey}/work_item/filter`, params);
}

/**
 * 获取工作项列表（跨空间）
 */
export async function filterAcrossProject(
  ctx: RequestContext,
  params: {
    project_keys?: string[];
    work_item_type_keys?: string[];
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: WorkItem[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/work_items/filter_across_project', params);
}

/**
 * 复杂参数搜索（单空间）
 */
export async function searchByParams(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  params: SearchParams
): Promise<ApiResponse<{ items: WorkItemDetail[]; pagination: Pagination }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/search/params', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 全文搜索
 */
export async function compositiveSearch(
  ctx: RequestContext,
  params: {
    query: string;
    project_keys?: string[];
    work_item_type_keys?: string[];
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: WorkItem[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/compositive_search', params);
}

/**
 * 极简链路搜索（替代 GeneralSearch）
 */
export async function universalSearch(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_type_key?: string;
    search_params?: SearchParams;
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: WorkItemDetail[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/view_search/universal_search', params);
}

/**
 * 三合一搜索能力
 */
export async function integrateSearch(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_type_key?: string;
    page_num?: number;
    page_size?: number;
    expand?: ExpandOptions;
  }
): Promise<ApiResponse<{ items: WorkItemDetail[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/view_search/integrate_search', params);
}

// ============ 批量操作 ============

/**
 * 批量更新工作项（异步）
 */
export async function batchUpdateWorkItems(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_type_key: string;
    work_item_ids: number[];
    update_fields: FieldValuePair[];
  }
): Promise<ApiResponse<{ task_id: string }>> {
  return request(ctx, 'POST', '/work_item/batch_update', params);
}

/**
 * 查询任务执行结果（用于批量操作）
 */
export async function queryTaskResult(
  ctx: RequestContext,
  taskId: string
): Promise<ApiResponse<{ status: string; success_count?: number; fail_count?: number }>> {
  return request(ctx, 'GET', `/task_result${buildQuery({ task_id: taskId })}`);
}

// ============ 操作记录 ============

/**
 * 查询工作项操作记录
 */
export async function getWorkItemOpRecord(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_id: number;
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ records: OperationRecord[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/op_record/work_item/list', params);
}

// ============ 元信息 ============

/**
 * 获取创建工作项元信息（字段配置等）
 */
export async function getWorkItemMetaData(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string
): Promise<ApiResponse<{ fields: unknown[]; templates: unknown[] }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/meta', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'GET', path);
}
