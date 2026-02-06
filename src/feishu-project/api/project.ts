/**
 * 项目/空间 API
 */

import { request, buildQuery, type RequestContext } from './base.js';
import type {
  ApiResponse,
  Project,
  ProjectDetail,
} from './types.js';

/**
 * 获取项目列表
 */
export async function getProjects(
  ctx: RequestContext
): Promise<ApiResponse<Project[]>> {
  return request(ctx, 'GET', '/projects');
}

/**
 * 获取项目详情
 */
export async function getProjectDetail(
  ctx: RequestContext,
  projectKey: string
): Promise<ApiResponse<ProjectDetail>> {
  return request(ctx, 'GET', `/projects/detail${buildQuery({ project_key: projectKey })}`);
}
