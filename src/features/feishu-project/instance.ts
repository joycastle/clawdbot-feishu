/**
 * 飞书项目客户端单例
 * 从 channel 配置读取凭证
 */

import { FeishuProjectClient } from './client.js';

let clientInstance: FeishuProjectClient | null = null;

export interface ProjectConfig {
  projectPluginId?: string;
  projectPluginSecret?: string;
  projectUserKey?: string;
}

/**
 * 初始化飞书项目客户端
 * @param config 从 channel.feishu 配置读取的项目相关配置
 */
export function initProjectClient(config: ProjectConfig): FeishuProjectClient | null {
  if (!config.projectPluginId || !config.projectPluginSecret) {
    console.log('[FeishuProject] Missing projectPluginId or projectPluginSecret, client not initialized');
    return null;
  }

  if (!config.projectUserKey) {
    console.log('[FeishuProject] Missing projectUserKey, client not initialized');
    return null;
  }

  clientInstance = new FeishuProjectClient({
    pluginId: config.projectPluginId,
    pluginSecret: config.projectPluginSecret,
    userKey: config.projectUserKey,
  });

  console.log('[FeishuProject] Client initialized');
  return clientInstance;
}

/**
 * 获取飞书项目客户端实例
 */
export function getProjectClient(): FeishuProjectClient | null {
  return clientInstance;
}

/**
 * 重置客户端实例（用于测试或重新初始化）
 */
export function resetProjectClient(): void {
  clientInstance = null;
}
