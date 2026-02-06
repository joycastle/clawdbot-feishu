/**
 * 飞书项目 API 客户端
 * 
 * 封装 token 管理、缓存、以及所有 API 模块
 */

import type { RequestContext } from './api/base.js';
import type {
  PluginTokenResponse,
  Project,
  ProjectDetail,
  WorkItemType,
} from './api/types.js';

// API 模块
import * as projectApi from './api/project.js';
import * as workitemApi from './api/workitem.js';
import * as workflowApi from './api/workflow.js';
import * as subtaskApi from './api/subtask.js';
import * as relationApi from './api/relation.js';
import * as manhourApi from './api/manhour.js';
import * as fieldApi from './api/field.js';
import * as templateApi from './api/template.js';
import * as commentApi from './api/comment.js';

const BASE_URL = 'https://project.feishu.cn/open_api';
const TOKEN_REFRESH_BUFFER = 300; // 提前 5 分钟刷新

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

  // 缓存
  private projectCache: Map<string, Project> = new Map();
  private projectCacheTime: number = 0;
  private projectDetailCache: Map<string, ProjectDetail> = new Map();
  private projectDetailCacheTime: Map<string, number> = new Map();
  private workItemTypesCache: Map<string, WorkItemType[]> = new Map();
  private workItemTypesCacheTime: Map<string, number> = new Map();

  // 缓存 TTL
  private readonly PROJECT_CACHE_TTL = 3600 * 1000; // 1小时
  private readonly DETAIL_CACHE_TTL = 1800 * 1000; // 30分钟
  private readonly TYPES_CACHE_TTL = 3600 * 1000; // 1小时

  // API 模块
  readonly project: typeof projectApi;
  readonly workitem: typeof workitemApi;
  readonly workflow: typeof workflowApi;
  readonly subtask: typeof subtaskApi;
  readonly relation: typeof relationApi;
  readonly manhour: typeof manhourApi;
  readonly field: typeof fieldApi;
  readonly template: typeof templateApi;
  readonly comment: typeof commentApi;

  constructor(options: FeishuProjectClientOptions) {
    this.pluginId = options.pluginId;
    this.pluginSecret = options.pluginSecret;
    this.userKey = options.userKey;

    // 绑定 API 模块
    this.project = projectApi;
    this.workitem = workitemApi;
    this.workflow = workflowApi;
    this.subtask = subtaskApi;
    this.relation = relationApi;
    this.manhour = manhourApi;
    this.field = fieldApi;
    this.template = templateApi;
    this.comment = commentApi;
  }

  /**
   * 获取请求上下文（供 API 调用使用）
   */
  getContext(): RequestContext {
    return {
      getToken: () => this.getPluginToken(),
      userKey: this.userKey,
    };
  }

  /**
   * 获取有效的 Plugin Token（自动刷新）
   */
  async getPluginToken(): Promise<string> {
    const now = Date.now();

    if (this.pluginToken && now < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER * 1000) {
      return this.pluginToken;
    }

    const resp = await fetch(`${BASE_URL}/authen/plugin_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plugin_id: this.pluginId,
        plugin_secret: this.pluginSecret,
        type: 0,
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

  // ============ 便捷方法（带缓存） ============

  /**
   * 获取项目列表（带缓存）
   */
  async getProjects(forceRefresh = false): Promise<Map<string, Project>> {
    const now = Date.now();

    if (!forceRefresh && this.projectCache.size > 0 && now - this.projectCacheTime < this.PROJECT_CACHE_TTL) {
      return this.projectCache;
    }

    const resp = await this.project.getProjects(this.getContext());

    if (resp.err_code !== 0) {
      throw new Error(`Failed to get projects: ${resp.err_msg}`);
    }

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
   * 获取项目详情（带缓存）
   */
  async getProjectDetail(projectKey: string, forceRefresh = false): Promise<ProjectDetail> {
    const now = Date.now();
    const cacheTime = this.projectDetailCacheTime.get(projectKey) || 0;

    if (!forceRefresh && now - cacheTime < this.DETAIL_CACHE_TTL) {
      const cached = this.projectDetailCache.get(projectKey);
      if (cached) return cached;
    }

    const resp = await this.project.getProjectDetail(this.getContext(), projectKey);

    if (resp.err_code !== 0) {
      throw new Error(`Failed to get project detail: ${resp.err_msg}`);
    }

    if (!resp.data) {
      throw new Error('No project detail in response');
    }

    this.projectDetailCache.set(projectKey, resp.data);
    this.projectDetailCacheTime.set(projectKey, now);

    return resp.data;
  }

  /**
   * 获取工作项类型（带缓存）
   */
  async getWorkItemTypes(projectKey: string, forceRefresh = false): Promise<WorkItemType[]> {
    const now = Date.now();
    const cacheTime = this.workItemTypesCacheTime.get(projectKey) || 0;

    if (!forceRefresh && now - cacheTime < this.TYPES_CACHE_TTL) {
      const cached = this.workItemTypesCache.get(projectKey);
      if (cached) return cached;
    }

    const resp = await this.workitem.getWorkItemTypes(this.getContext(), projectKey);

    if (resp.err_code !== 0) {
      throw new Error(`Failed to get work item types: ${resp.err_msg}`);
    }

    const types = resp.data || [];
    this.workItemTypesCache.set(projectKey, types);
    this.workItemTypesCacheTime.set(projectKey, now);

    console.log(`[FeishuProject] Cached ${types.length} work item types for ${projectKey}`);
    return types;
  }

  // ============ 缓存管理 ============

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
