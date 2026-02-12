/**
 * 统一路径管理 - 兼容 clawdbot 和 openclaw
 * 
 * 升级到 openclaw 后，目录结构会从 .clawdbot 变为 .openclaw
 * 此模块自动检测当前环境，提供正确的路径
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// 状态目录名优先级（新 -> 旧）
const STATE_DIRS = [".openclaw", ".clawdbot"];
// 配置文件名优先级（新 -> 旧）
const CONFIG_FILES = ["openclaw.json", "clawdbot.json"];
// CLI 命令名
const CLI_NAMES = ["openclaw", "clawdbot"];

/**
 * 获取状态目录路径（~/.openclaw 或 ~/.clawdbot）
 * 优先使用环境变量，然后检测存在的目录
 */
export function getStateDir(): string {
  // 1. 环境变量优先
  const envOverride =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_DATA_DIR?.trim();
  if (envOverride) return envOverride;

  // 2. 检测存在的目录
  const home = os.homedir();
  for (const dir of STATE_DIRS) {
    const fullPath = path.join(home, dir);
    if (fs.existsSync(fullPath)) return fullPath;
  }

  // 3. 默认使用第一个（新版目录）
  return path.join(home, STATE_DIRS[0]);
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  const envOverride = process.env.CLAWDBOT_CONFIG?.trim();
  if (envOverride) return envOverride;

  const stateDir = getStateDir();

  // 检测存在的配置文件
  for (const file of CONFIG_FILES) {
    const fullPath = path.join(stateDir, file);
    if (fs.existsSync(fullPath)) return fullPath;
  }

  // 默认使用第一个
  return path.join(stateDir, CONFIG_FILES[0]);
}

/**
 * 获取凭据目录路径
 */
export function getCredentialsDir(): string {
  return path.join(getStateDir(), "credentials");
}

/**
 * 获取 Google SA 文件路径
 */
export function getGoogleSAPath(): string {
  const envOverride = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (envOverride) return envOverride;
  return path.join(getCredentialsDir(), "google-vertex-sa.json");
}

/**
 * 获取媒体目录路径
 */
export function getMediaDir(): string {
  return path.join(getStateDir(), "media");
}

/**
 * 获取扩展目录路径
 */
export function getExtensionsDir(): string {
  return path.join(getStateDir(), "extensions");
}

/**
 * 获取飞书扩展目录路径
 */
export function getFeishuExtDir(): string {
  // 如果当前文件在扩展目录内，使用实际路径
  const currentDir = __dirname;
  const feishuMatch = currentDir.match(/(.+[/\\]extensions[/\\]feishu)/);
  if (feishuMatch) return feishuMatch[1];

  // 否则使用默认路径
  return path.join(getExtensionsDir(), "feishu");
}

/**
 * 获取当前可用的 CLI 命令名（openclaw 或 clawdbot）
 */
export function getCliCommand(): string {
  const { execSync } = require("child_process");

  for (const cmd of CLI_NAMES) {
    try {
      execSync(`which ${cmd}`, { stdio: "ignore" });
      return cmd;
    } catch {
      // 命令不存在，继续尝试下一个
    }
  }

  // 默认返回新命令名
  return CLI_NAMES[0];
}

/**
 * 获取下载目录（用于临时文件）
 */
export function getDownloadDir(): string {
  const workspace = process.env.CLAWDBOT_WORKSPACE || path.join(os.homedir(), "clawd");
  return path.join(workspace, "download");
}

/**
 * 检测当前是 openclaw 还是 clawdbot 环境
 */
export function isOpenclawEnv(): boolean {
  const stateDir = getStateDir();
  return stateDir.includes(".openclaw");
}

// 导出常用路径作为模块属性
export const paths = {
  get stateDir() { return getStateDir(); },
  get configPath() { return getConfigPath(); },
  get credentialsDir() { return getCredentialsDir(); },
  get googleSAPath() { return getGoogleSAPath(); },
  get mediaDir() { return getMediaDir(); },
  get extensionsDir() { return getExtensionsDir(); },
  get feishuExtDir() { return getFeishuExtDir(); },
  get cliCommand() { return getCliCommand(); },
  get downloadDir() { return getDownloadDir(); },
};

export default paths;
