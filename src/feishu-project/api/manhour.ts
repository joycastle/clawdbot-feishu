/**
 * 工时 API
 */

import { request, buildPath, type RequestContext } from './base.js';
import type {
  ApiResponse,
  ManHourRecord,
  Pagination,
} from './types.js';

/**
 * 创建实际工时
 */
export async function createWorkingHourRecord(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    work_time: number; // 分钟
    work_date?: number; // 时间戳
    work_description?: string;
  }
): Promise<ApiResponse<{ record_id: string }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/work_hour_record', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 更新实际工时
 */
export async function updateWorkingHourRecord(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    record_id: string;
    work_time?: number;
    work_date?: number;
    work_description?: string;
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/work_hour_record', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'PUT', path, params);
}

/**
 * 删除实际工时
 */
export async function deleteWorkingHourRecord(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  recordId: string
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/work_hour_record', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'DELETE', path, { record_id: recordId });
}

/**
 * 获取工作项的工时记录列表
 */
export async function getWorkItemManHourRecords(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_ids: number[];
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ records: ManHourRecord[]; pagination: Pagination }>> {
  return request(ctx, 'POST', '/work_item/man_hour/records', params);
}
