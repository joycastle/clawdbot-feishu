/**
 * 飞书项目 API 客户端
 */

import type {
  PluginTokenResponse,
  Project,
  ProjectDetail,
  WorkItemType,
  ApiResponse,
} from './types.js';

const BASE_URL = 'https://project.feishu.cn/open_api';

// 默认 token 提前刷新时间（秒）
const TOKEN_REFRESH_BUFFER = 300;

export interface FeishuProjectClientOptions {
  pluginId: string;
  pluginSecret: string;
  userKey: string;
}

export class FeishuProjectClient {
  private pluginId: string;
  private pluginSecret: string;
  private userKey: string;

  // Token 管理
  private pluginToken: string | null = null;
  private tokenExpiresAt: number = 0;

  // 缓存：项目列表 (project_key -> Project)
  private projectCache: Map<string, Project> = new Map();
  private projectCacheTime: number = 0;
  private readonly PROJECT_CACHE_TTL = 3600 * 1000; // 1小时

  // 缓存：项目详情 (project_key -> ProjectDetail)
  private projectDetailCache: Map<string, ProjectDetail> = new Map();
  private projectDetailCacheTime: Map<string, number> = new Map();
  private readonly DETAIL_CACHE_TTL = 1800 * 1000; // 30分钟

  // 缓存：工作项类型 (project_key -> WorkItemType[])
  private workItemTypesCache: Map<string, WorkItemType[]> = new Map();
  private workItemTypesCacheTime: Map<string, number> = new Map();
  private readonly TYPES_CACHE_TTL = 3600 * 1000; // 1小时

  constructor(options: FeishuProjectClientOptions) {
    this.pluginId = options.pluginId;
    this.pluginSecret = options.pluginSecret;
    this.userKey = options.userKey;
  }

  /**
   * 获取有效的 Plugin Token
   * 自动处理过期刷新
   */
  async getPluginToken(): Promise<string> {
    const now = Date.now();

    // Token 有效且未过期
    if (this.pluginToken && now < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER * 1000) {
      return this.pluginToken;
    }

    // 刷新 Token
    const resp = await fetch(`${BASE_URL}/authen/plugin_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plugin_id: this.pluginId,
        plugin_secret: this.pluginSecret,
        type: 0, // plugin token
      }),
    });

    const data: PluginTokenResponse = await resp.json();

    if (data.error?.code !== 0 && data.error?.code !== undefined) {
      throw new Error(`Failed to get plugin token: ${data.error.msg}`);
    }

    if (!data.data?.token) {
      throw new Error('No token in response');
    }

    this.pluginToken = data.data.token;
    this.tokenExpiresAt = now + data.data.expire_time * 1000;

    console.log(`[FeishuProject] Token refreshed, expires in ${data.data.expire_time}s`);
    return this.pluginToken;
  }

  /**
   * 发起 API 请求
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const token = await this.getPluginToken();

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-PLUGIN-TOKEN': token,
        'X-USER-KEY': this.userKey,
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
   * 获取项目列表
   * 带缓存，返回 project_key -> Project 映射
   */
  async getProjects(forceRefresh = false): Promise<Map<string, Project>> {
    const now = Date.now();

    // 缓存有效
    if (!forceRefresh && this.projectCache.size > 0 && now - this.projectCacheTime < this.PROJECT_CACHE_TTL) {
      return this.projectCache;
    }

    const resp = await this.request<Project[]>('GET', '/projects');

    if (resp.err_code !== 0) {
      throw new Error(`Failed to get projects: ${resp.err_msg}`);
    }

    // 更新缓存
    this.projectCache.clear();
    for (const project of resp.data || []) {
      this.projectCache.set(project.project_key, project);
    }
    this.projectCacheTime = now;

    console.log(`[FeishuProject] Cached ${this.projectCache.size} projects`);
    return this.projectCache;
  }

  /**
   * 根据 project_key 获取项目
   */
  async getProject(projectKey: string): Promise<Project | undefined> {
    const projects = await this.getProjects();
    return projects.get(projectKey);
  }

  /**
   * 获取项目详情
   * 带缓存
   */
  async getProjectDetail(projectKey: string, forceRefresh = false): Promise<ProjectDetail> {
    const now = Date.now();
    const cacheTime = this.projectDetailCacheTime.get(projectKey) || 0;

    // 缓存有效
    if (!forceRefresh && now - cacheTime < this.DETAIL_CACHE_TTL) {
      const cached = this.projectDetailCache.get(projectKey);
      if (cached) return cached;
    }

    const resp = await this.request<ProjectDetail>('GET', `/projects/detail?project_key=${projectKey}`);

    if (resp.err_code !== 0) {
      throw new Error(`Failed to get project detail: ${resp.err_msg}`);
    }

    if (!resp.data) {
      throw new Error('No project detail in response');
    }

    // 更新缓存
    this.projectDetailCache.set(projectKey, resp.data);
    this.projectDetailCacheTime.set(projectKey, now);

    return resp.data;
  }

  /**
   * 获取项目下的工作项类型
   * 带缓存
   */
  async getWorkItemTypes(projectKey: string, forceRefresh = false): Promise<WorkItemType[]> {
    const now = Date.now();
    const cacheTime = this.workItemTypesCacheTime.get(projectKey) || 0;

    // 缓存有效
    if (!forceRefresh && now - cacheTime < this.TYPES_CACHE_TTL) {
      const cached = this.workItemTypesCache.get(projectKey);
      if (cached) return cached;
    }

    const resp = await this.request<WorkItemType[]>('GET', `/${projectKey}/work_item/all-types`);

    if (resp.err_code !== 0) {
      throw new Error(`Failed to get work item types: ${resp.err_msg}`);
    }

    const types = resp.data || [];

    // 更新缓存
    this.workItemTypesCache.set(projectKey, types);
    this.workItemTypesCacheTime.set(projectKey, now);

    console.log(`[FeishuProject] Cached ${types.length} work item types for ${projectKey}`);
    return types;
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.projectCache.clear();
    this.projectCacheTime = 0;
    this.projectDetailCache.clear();
    this.projectDetailCacheTime.clear();
    this.workItemTypesCache.clear();
    this.workItemTypesCacheTime.clear();
    console.log('[FeishuProject] Cache cleared');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { projects: number; details: number; types: number } {
    return {
      projects: this.projectCache.size,
      details: this.projectDetailCache.size,
      types: this.workItemTypesCache.size,
    };
  }
}
