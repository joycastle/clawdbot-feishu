/**
 * 关联关系 API
 */

import { request, buildPath, type RequestContext } from './base.js';
import type {
  ApiResponse,
  WorkItemRelation,
  StoryRelation,
  Pagination,
} from './types.js';

// ============ 工作项关系 ============

/**
 * 创建工作项关系
 */
export async function createWorkItemRelation(
  ctx: RequestContext,
  params: {
    project_key: string;
    work_item_type_key: string;
    work_item_id: number;
    relation_type: string;
    target_project_key: string;
    target_work_item_type_key: string;
    target_work_item_id: number;
  }
): Promise<ApiResponse<{ relation_id: string }>> {
  return request(ctx, 'POST', '/work_item/relation/create', params);
}

/**
 * 查询工作项关系
 */
export async function getWorkItemRelation(
  ctx: RequestContext,
  projectKey: string,
  params: {
    work_item_id: number;
    work_item_type_key: string;
    relation_types?: string[];
  }
): Promise<ApiResponse<{ relations: WorkItemRelation[] }>> {
  const path = `/${projectKey}/work_item/relation`;
  return request(ctx, 'GET', `${path}?work_item_id=${params.work_item_id}&work_item_type_key=${params.work_item_type_key}`);
}

/**
 * 更新工作项关系
 */
export async function updateWorkItemRelation(
  ctx: RequestContext,
  params: {
    relation_id: string;
    relation_type?: string;
  }
): Promise<ApiResponse<void>> {
  return request(ctx, 'POST', '/work_item/relation/update', params);
}

/**
 * 删除工作项关系
 */
export async function deleteWorkItemRelation(
  ctx: RequestContext,
  relationId: string
): Promise<ApiResponse<void>> {
  return request(ctx, 'DELETE', '/work_item/relation/delete', { relation_id: relationId });
}

/**
 * 获取关联工作项列表
 */
export async function searchWorkItemsRelation(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params?: {
    relation_types?: string[];
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: WorkItemRelation[]; pagination: Pagination }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/search_by_relation', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params || {});
}

// ============ 需求关联 ============

/**
 * 创建需求关联关系
 */
export async function createStoryRelations(
  ctx: RequestContext,
  projectKey: string,
  params: {
    relations: Array<{
      source_work_item_id: number;
      target_work_item_id: number;
      relation_type: string;
    }>;
  }
): Promise<ApiResponse<void>> {
  return request(ctx, 'POST', `/${projectKey}/story_relations/create`, params);
}

/**
 * 查询需求关联关系
 */
export async function queryStoryRelations(
  ctx: RequestContext,
  projectKey: string,
  params: {
    work_item_ids: number[];
    relation_types?: string[];
  }
): Promise<ApiResponse<{ relations: StoryRelation[] }>> {
  return request(ctx, 'POST', `/${projectKey}/story_relations/query`, params);
}

// ============ 空间关联 ============

/**
 * 查询空间关系规则
 */
export async function queryProjectRelation(
  ctx: RequestContext,
  projectKey: string,
  params?: {
    work_item_type_key?: string;
  }
): Promise<ApiResponse<{ rules: unknown[] }>> {
  return request(ctx, 'POST', `/${projectKey}/relation/rules`, params || {});
}

/**
 * 通过空间关联绑定关联工作项
 */
export async function createProjectRelationInstances(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    relation_rule_id: string;
    target_work_item_ids: number[];
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/relation/:work_item_type_key/:work_item_id/batch_bind', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 获取空间关联下的关联工作项列表
 */
export async function queryProjectRelationInstance(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params?: {
    relation_rule_id?: string;
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ items: WorkItemRelation[]; pagination: Pagination }>> {
  const path = buildPath('/:project_key/relation/:work_item_type_key/:work_item_id/work_item_list', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params || {});
}

/**
 * 解绑空间关联工作项
 */
export async function deleteProjectRelationInstance(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    relation_rule_id: string;
    target_work_item_id: number;
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/relation/:work_item_type_key/:work_item_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'DELETE', path, params);
}
