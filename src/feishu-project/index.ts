/**
 * 飞书项目 API 模块
 * 封装飞书项目（project.feishu.cn）的 Open API 调用
 */

export { FeishuProjectClient } from './client.js';
export { initProjectClient, getProjectClient, resetProjectClient } from './instance.js';
export type {
  PluginTokenResponse,
  Project,
  ProjectDetail,
  WorkItemType,
  ApiResponse,
} from './types.js';
