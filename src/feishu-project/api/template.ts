/**
 * 模板 API - 流程类型、流程角色
 */

import { request, buildPath, type RequestContext } from './base.js';
import type {
  ApiResponse,
  Template,
  FlowRole,
} from './types.js';

// ============ 流程类型 ============

/**
 * 获取工作项下的流程类型
 */
export async function listTemplateConf(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string
): Promise<ApiResponse<Template[]>> {
  const path = buildPath('/:project_key/template_list/:work_item_type_key', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'GET', path);
}

/**
 * 获取流程类型配置详情
 */
export async function getTemplateDetail(
  ctx: RequestContext,
  projectKey: string,
  templateId: string
): Promise<ApiResponse<Template>> {
  const path = buildPath('/:project_key/template_detail/:template_id', {
    project_key: projectKey,
    template_id: templateId,
  });
  return request(ctx, 'GET', path);
}

/**
 * 创建流程类型配置
 */
export async function createTemplateDetail(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_type_key: string;
    template_name: string;
    workflow_id?: string;
  }
): Promise<ApiResponse<{ template_id: string }>> {
  return request(ctx, 'POST', '/template/v2/create_template', params);
}

/**
 * 更新流程类型配置
 */
export async function updateTemplateDetail(
  ctx: RequestContext,
  params: {
    project_key: string;
    template_id: string;
    template_name?: string;
    is_disabled?: boolean;
  }
): Promise<ApiResponse<void>> {
  return request(ctx, 'PUT', '/template/v2/update_template', params);
}

/**
 * 删除流程类型配置
 */
export async function deleteTemplateDetail(
  ctx: RequestContext,
  projectKey: string,
  templateId: string
): Promise<ApiResponse<void>> {
  const path = buildPath('/template/v2/delete_template/:project_key/:template_id', {
    project_key: projectKey,
    template_id: templateId,
  });
  return request(ctx, 'DELETE', path);
}

// ============ 流程角色 ============

/**
 * 获取流程角色配置详情
 */
export async function getRoleConfDetails(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string
): Promise<ApiResponse<FlowRole[]>> {
  const path = buildPath('/:project_key/flow_roles/:work_item_type_key', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'GET', path);
}

/**
 * 创建流程角色
 */
export async function createFlowRole(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  params: {
    role_name: string;
    role_type?: number;
    members?: string[]; // user_keys
  }
): Promise<ApiResponse<{ role_id: string }>> {
  const path = buildPath('/:project_key/flow_roles/:work_item_type_key/create_role', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 更新流程角色
 */
export async function updateFlowRole(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  params: {
    role_id: string;
    role_name?: string;
    members?: string[];
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/flow_roles/:work_item_type_key/update_role', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 删除流程角色
 */
export async function deleteFlowRole(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  roleId: string
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/flow_roles/:work_item_type_key/delete_role', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
  });
  return request(ctx, 'POST', path, { role_id: roleId });
}
