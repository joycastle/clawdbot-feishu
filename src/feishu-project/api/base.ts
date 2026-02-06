/**
 * API 基础模块 - 公共请求方法
 */

import type { ApiResponse } from './types.js';

const BASE_URL = 'https://project.feishu.cn/open_api';

export interface RequestContext {
  getToken: () => Promise<string>;
  userKey: string;
}

/**
 * 发起 API 请求
 */
export async function request<T>(
  ctx: RequestContext,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const token = await ctx.getToken();

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-PLUGIN-TOKEN': token,
      'X-USER-KEY': ctx.userKey,
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const resp = await fetch(url, options);
  return resp.json();
}

/**
 * 构建带路径参数的 URL
 */
export function buildPath(template: string, params: Record<string, string>): string {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  return path;
}

/**
 * 构建查询字符串
 */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return entries.length > 0 ? `?${entries.join('&')}` : '';
}
