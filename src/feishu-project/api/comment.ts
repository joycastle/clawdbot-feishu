/**
 * 评论 API
 */

import { request, buildPath, buildQuery, type RequestContext } from './base.js';
import type {
  ApiResponse,
  Comment,
  FileComment,
  RichTextContent,
  Pagination,
} from './types.js';

/**
 * 创建评论
 */
export async function createComment(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    content: string;
    rich_text?: RichTextContent[];
    reply_to?: string; // 回复的评论 ID
  }
): Promise<ApiResponse<{ comment_id: string }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/comment/create', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 分页查询评论
 */
export async function listComments(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params?: {
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ comments: Comment[]; pagination: Pagination }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/comments', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  const query = buildQuery(params || {});
  return request(ctx, 'GET', path + query);
}

/**
 * 更新评论
 */
export async function updateComment(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  commentId: string,
  params: {
    content: string;
    rich_text?: RichTextContent[];
  }
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/comment/:comment_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
    comment_id: commentId,
  });
  return request(ctx, 'PUT', path, params);
}

/**
 * 删除评论
 */
export async function deleteComment(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  commentId: string
): Promise<ApiResponse<void>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/comment/:comment_id', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
    comment_id: commentId,
  });
  return request(ctx, 'DELETE', path);
}

// ============ 附件评论 ============

/**
 * 创建附件评论
 */
export async function createFileComment(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params: {
    content: string;
    file_key: string;
    rich_text?: RichTextContent[];
  }
): Promise<ApiResponse<{ comment_id: string }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/file_comment/create', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  return request(ctx, 'POST', path, params);
}

/**
 * 分页查询附件评论
 */
export async function listFileComments(
  ctx: RequestContext,
  projectKey: string,
  workItemTypeKey: string,
  workItemId: number,
  params?: {
    page_num?: number;
    page_size?: number;
  }
): Promise<ApiResponse<{ comments: FileComment[]; pagination: Pagination }>> {
  const path = buildPath('/:project_key/work_item/:work_item_type_key/:work_item_id/file_comments', {
    project_key: projectKey,
    work_item_type_key: workItemTypeKey,
    work_item_id: String(workItemId),
  });
  const query = buildQuery(params || {});
  return request(ctx, 'GET', path + query);
}
