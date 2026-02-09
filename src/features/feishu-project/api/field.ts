/**
 * 字段 API - 字段、类型、业务线
 */

import { request, buildPath, type RequestContext } from './base.js';
import type {
  ApiResponse,
  FieldDefinition,
  Business,
} from './types.js';

/**
 * 获取空间字段
 */
export async function getProjectFields(
  ctx: RequestContext,
  projectKey: string,
  params?: {
    work_item_type_key?: string;
  }
): Promise<ApiResponse<FieldDefinition[]>> {
  return request(ctx, 'POST', `/${projectKey}/field/all`, params || {});
}

/**
 * 创建自定义字段
 */
export async function createField(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  params: {
    field_name: string;
    field_type_key: string;
    field_alias?: string;
    is_required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }
): Promise<ApiResponse<{ field_key: string }>> {
  const path = buildPath('/:project_key/field/:work_item_type_key/create', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 更新自定义字段
 */
export async function updateField(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  params: {
    field_key: string;
    field_name?: string;
    is_required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/field/:work_item_type_key', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'PUT', path, params);
}

/**
 * 获取空间下业务线
 */
export async function getBusinesses(
  ctx: RequestContext,
  projectKey: string
): Promise<ApiResponse<Business[]>> {
  return request(ctx, 'GET', `/${projectKey}/business/all`);
}

/**
 * 增量更新复合字段
 */
export async function updateCompoundFieldValue(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_id: number;
    work_item_type_key: string;
    field_key: string;
    field_value: unknown;
    operate: 'add' | 'remove' | 'replace';
  }
): Promise<ApiResponse<void>> {
  return request(ctx, 'POST', '/work_item/field_value/update_compound_field', params);
}
