#!/usr/bin/env npx tsx
/**
 * 玩家日志分析 CLI
 * 
 * 使用方法:
 *   npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC"
 *   npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 16:33:55 -07:00"
 *   npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 16:33:55 -07:00" --download-only
 *   npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC" --full
 * 
 * 参数:
 *   --pid          玩家 ID
 *   --time         反馈时间 (UTC 或带时区的本地时间)
 *   --env          环境 (production/test/develop, 默认 production)
 *   --download-only 只下载不分析
 *   --full         完整分析模式：文件 > 10MB 时走 GCS + Gemini 完整分析
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';
import { VertexAI } from '@google-cloud/vertexai';
import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

// GCS + Vertex AI 配置
const GCS_BUCKET = 'larkbot-storage';
const GCS_SA_PATH = '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json';
const VERTEX_PROJECT = 'larkbot-485707';
const VERTEX_LOCATION = 'global';

// 从配置文件加载 AWS 凭证
const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '../../config/aws-s3.json');

if (!existsSync(configPath)) {
  console.error('错误: 缺少 AWS 配置文件 config/aws-s3.json');
  console.error('请联系管理员获取凭证配置');
  process.exit(1);
}

const awsConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
const AWS_CONFIG = {
  region: awsConfig.region,
  credentials: {
    accessKeyId: awsConfig.accessKeyId,
    secretAccessKey: awsConfig.secretAccessKey,
  },
};

const BUCKET_NAME = awsConfig.bucket || 'bingo2-client-logan';
const DOWNLOAD_DIR = '/home/ubuntu/clawd/download';

const s3 = new S3Client(AWS_CONFIG);

// 服务器 URL
function getServerUrl(env: string): string {
  const urls: Record<string, string> = {
    production: 'https://bingo2.superbgame.net',
    test: 'https://bingo2-test.superbgame.net',
    develop: 'https://bingo2-dev.superbgame.net',
  };
  return urls[env] || urls.production;
}

// 获取玩家信息
async function getPlayerInfo(pid: string, env: string): Promise<any> {
  const resp = await fetch(`${getServerUrl(env)}/303?name=GetPublicProfileByIDs`, {
    method: 'POST',
    headers: {
      'apikey': 'bingo2-gm',
      'servername': 'gm',
      'uid': 'bingo2',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ Name: pid }),
  });
  const data = await resp.json();
  const user = data.User || {};
  return {
    uid: user.ID,
    nickname: user.Public?.Nickname,
    region: user.Public?.Region,
    level: user.Public?.Level,
  };
}

// 下载日志
async function downloadLogs(uid: string, env: string): Promise<string[]> {
  // 清理并创建下载目录
  if (existsSync(DOWNLOAD_DIR)) {
    rmSync(DOWNLOAD_DIR, { recursive: true });
  }
  mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const prefix = `${env}/logs/ai_help/${uid}`;
  const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix });
  const response = await s3.send(command);

  if (!response.Contents?.length) {
    return [];
  }

  const files: string[] = [];
  for (const obj of response.Contents) {
    if (!obj.Key) continue;
    const filename = basename(obj.Key);
    const localPath = join(DOWNLOAD_DIR, filename);

    const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: obj.Key });
    const { Body } = await s3.send(getCommand);
    if (Body instanceof Readable) {
      await pipeline(Body, createWriteStream(localPath));
      files.push(localPath);
      console.log(`下载: ${filename}`);
    }
  }

  return files.sort();
}

// 解析反馈时间
function parseFeedbackTime(timeStr: string): { dt: Date; tzStr: string | null } {
  timeStr = timeStr.trim();

  // UTC 格式: "2026-02-02 06:08:39 UTC"
  if (timeStr.toUpperCase().includes('UTC')) {
    const cleaned = timeStr.toUpperCase().replace('UTC', '').trim();
    const dt = new Date(cleaned + 'Z');
    return { dt, tzStr: null };
  }

  // 本地时间格式: "2026-02-02 16:33:55 -07:00"
  const tzMatch = timeStr.match(/([+-]\d{2}:\d{2})$/);
  if (tzMatch) {
    const tzStr = tzMatch[1];
    const timePart = timeStr.replace(tzStr, '').trim();
    const dt = new Date(timePart + tzStr.replace(':', ''));
    return { dt, tzStr };
  }

  throw new Error(`无法解析时间格式: ${timeStr}`);
}

// 从日志获取时区
function getTimezoneFromLog(logFile: string): string {
  const content = readFileSync(logFile, 'utf-8');
  const match = content.match(/([+-]\d{2}:\d{2})\s/);
  return match ? match[1] : '+00:00';
}

// 分析日志文件
function analyzeLog(logFile: string): any {
  const content = readFileSync(logFile, 'utf-8');
  const lines = content.split('\n');
  const stat = statSync(logFile);

  const result: any = {
    file: basename(logFile),
    size: stat.size,
    deviceInfo: {},
    critical: [],
    errors: [],
    warnings: [],
  };

  const devicePatterns: Record<string, RegExp> = {
    deviceModel: /deviceModel\s+(.+)/,
    'System Memory': /System Memory:\s+(.+)/,
    BuildVer: /BuildVer:\s+(.+)/,
    ResVer: /ResVer:\s+(.+)/,
    DeviceID: /DeviceID:\s+(.+)/,
  };

  for (const line of lines) {
    // 设备信息
    for (const [key, pattern] of Object.entries(devicePatterns)) {
      if (!result.deviceInfo[key]) {
        const match = line.match(pattern);
        if (match) result.deviceInfo[key] = match[1].trim();
      }
    }

    // 严重问题
    if (line.includes('OnLowMemory') || line.includes('ILRuntimeException') || line.includes('ThreadAbortException')) {
      result.critical.push(line.slice(0, 200));
    }
    // 错误
    else if (line.startsWith('E:')) {
      result.errors.push(line.slice(0, 200));
    }
    // 性能警告
    else if (line.includes('Long frame time')) {
      const match = line.match(/Long frame time:\s*(\d+)ms/);
      if (match && parseInt(match[1]) > 5000) {
        result.warnings.push(line.slice(0, 200));
      }
    }
  }

  return result;
}

// 生成报告
function generateReport(playerInfo: any, analyses: any[], feedbackTime: string, tzStr: string): string {
  const lines: string[] = [];
  lines.push(`## 玩家 ${playerInfo.nickname || 'Unknown'} (${(playerInfo.uid || '').slice(0, 8)}...) 日志分析报告\n`);
  lines.push(`**反馈时间**: ${feedbackTime}`);
  lines.push(`**玩家时区**: ${tzStr}`);
  lines.push(`**地区**: ${playerInfo.region || 'N/A'}`);
  lines.push(`**等级**: ${playerInfo.level || 'N/A'}\n`);

  // 文件列表
  lines.push('### 分析的日志文件\n');
  lines.push('| 文件名 | 大小 |');
  lines.push('|--------|------|');
  for (const a of analyses) {
    const sizeKB = a.size / 1024;
    const sizeStr = sizeKB < 1024 ? `${sizeKB.toFixed(1)}KB` : `${(sizeKB / 1024).toFixed(1)}MB`;
    lines.push(`| \`...${a.file.slice(-35)}\` | ${sizeStr} |`);
  }
  lines.push('');

  // 设备信息
  if (analyses[0]?.deviceInfo) {
    lines.push('### 设备信息\n');
    lines.push('| 项目 | 值 |');
    lines.push('|------|-----|');
    for (const [k, v] of Object.entries(analyses[0].deviceInfo)) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push('');
  }

  // 严重问题
  const allCritical = analyses.flatMap(a => a.critical || []);
  if (allCritical.length) {
    lines.push('### 🔴 严重问题\n');
    for (const c of allCritical.slice(0, 10)) {
      lines.push(`- \`${c.slice(0, 100)}${c.length > 100 ? '...' : ''}\``);
    }
    lines.push('');
  }

  // 性能警告
  const allWarnings = analyses.flatMap(a => a.warnings || []);
  if (allWarnings.length) {
    lines.push('### ⚠️ 性能警告 (Long frame > 5s)\n');
    for (const w of allWarnings.slice(0, 10)) {
      lines.push(`- \`${w.slice(0, 100)}${w.length > 100 ? '...' : ''}\``);
    }
    lines.push('');
  }

  // 结论
  lines.push('### 结论\n');
  if (allCritical.length) {
    lines.push(`发现 **${allCritical.length}** 个严重问题，需要关注。`);
  } else if (allWarnings.length) {
    lines.push(`无严重错误，但有 **${allWarnings.length}** 个性能警告。`);
  } else {
    lines.push('未发现明显问题。');
  }

  return lines.join('\n');
}

// 定位相关日志
function findRelevantLogs(files: string[], feedbackTime: Date, tzStr: string): string[] {
  const relevant: Array<{ file: string; time: Date }> = [];

  for (const f of files) {
    const match = basename(f).match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})$/);
    if (match) {
      const fileTimeStr = match[1].replace(/_/g, ' ').replace(/-/g, (m, i) => (i > 10 ? ':' : '-'));
      const fileTime = new Date(fileTimeStr);

      // 转换反馈时间到玩家本地时间比较
      if (fileTime <= feedbackTime) {
        relevant.push({ file: f, time: fileTime });
      }
    }
  }

  relevant.sort((a, b) => b.time.getTime() - a.time.getTime());
  return relevant.slice(0, 2).map(r => r.file);
}

// 上传文件到 GCS
async function uploadToGCS(localPath: string): Promise<string> {
  const storage = new Storage({
    keyFilename: GCS_SA_PATH,
    projectId: VERTEX_PROJECT,
  });
  const bucket = storage.bucket(GCS_BUCKET);
  const filename = `logs/${Date.now()}_${basename(localPath)}`;
  
  await bucket.upload(localPath, { destination: filename });
  return `gs://${GCS_BUCKET}/${filename}`;
}

// 用 Gemini 完整分析日志
async function analyzeWithGemini(gcsUri: string, playerInfo: any, feedbackTime: string): Promise<string> {
  const vertexAI = new VertexAI({
    project: VERTEX_PROJECT,
    location: VERTEX_LOCATION,
    googleAuthOptions: {
      keyFilename: GCS_SA_PATH,
    },
  });

  const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

  const prompt = `你是一个游戏客户端日志分析专家。请分析这个玩家的日志文件。

玩家信息：
- 昵称: ${playerInfo.nickname || 'Unknown'}
- 地区: ${playerInfo.region || 'N/A'}
- 等级: ${playerInfo.level || 'N/A'}
- 反馈时间: ${feedbackTime}

请完整分析日志内容，重点关注：
1. 设备信息（机型、内存、版本号等）
2. 严重错误（Exception、崩溃、内存不足等）
3. 性能问题（Long frame time、卡顿等）
4. 网络问题（连接失败、超时等）
5. 任何可能与玩家反馈相关的异常

输出格式：
- 设备信息表格
- 问题列表（按严重程度排序）
- 结论和建议`;

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { fileData: { mimeType: 'text/plain', fileUri: gcsUri } },
        { text: prompt },
      ],
    }],
  });

  return result.response.candidates?.[0]?.content?.parts?.[0]?.text || '分析失败';
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  let pid = '', time = '', env = 'production', downloadOnly = false, fullMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pid') pid = args[++i];
    else if (args[i] === '--time') time = args[++i];
    else if (args[i] === '--env') env = args[++i];
    else if (args[i] === '--download-only') downloadOnly = true;
    else if (args[i] === '--full') fullMode = true;
  }

  if (!pid || !time) {
    console.log('使用方法: npx tsx src/cli/log-analyze.ts --pid <pid> --time "<反馈时间>"');
    console.log('示例:');
    console.log('  npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC"');
    console.log('  npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 16:33:55 -07:00"');
    console.log('  npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC" --full');
    process.exit(1);
  }

  console.log(`=== 分析玩家 ${pid} 的日志 ===\n`);

  // 1. 获取玩家信息
  console.log('1. 获取玩家信息...');
  const playerInfo = await getPlayerInfo(pid, env);
  if (!playerInfo.uid) {
    console.error('错误: 无法获取玩家信息');
    process.exit(1);
  }
  console.log(`   UID: ${playerInfo.uid}`);
  console.log(`   昵称: ${playerInfo.nickname}`);
  console.log(`   地区: ${playerInfo.region}\n`);

  // 2. 下载日志
  console.log('2. 下载日志...');
  const files = await downloadLogs(playerInfo.uid, env);
  if (!files.length) {
    console.error('错误: 未找到日志文件');
    process.exit(1);
  }
  console.log(`   共下载 ${files.length} 个文件\n`);

  if (downloadOnly) {
    console.log(`日志已下载到: ${DOWNLOAD_DIR}`);
    process.exit(0);
  }

  // 3. 解析时间
  console.log('3. 解析反馈时间...');
  const { dt: feedbackDt, tzStr: inputTz } = parseFeedbackTime(time);
  const tzStr = inputTz || getTimezoneFromLog(files[0]);
  console.log(`   反馈时间: ${feedbackDt.toISOString()}`);
  console.log(`   玩家时区: ${tzStr}\n`);

  // 4. 定位相关日志
  console.log('4. 定位相关日志...');
  const relevant = findRelevantLogs(files, feedbackDt, tzStr);
  for (const f of relevant) {
    console.log(`   - ${basename(f)}`);
  }
  console.log('');

  // 5. 分析
  console.log('5. 分析日志...\n');

  if (fullMode) {
    // --full 模式：直接走 GCS + Gemini 完整分析
    console.log('   [完整分析模式] 使用 GCS + Gemini\n');
    
    for (const file of relevant) {
      const size = statSync(file).size;
      const sizeMB = (size / 1024 / 1024).toFixed(1);
      console.log(`   上传 ${basename(file)} (${sizeMB}MB) 到 GCS...`);
      const gcsUri = await uploadToGCS(file);
      console.log(`   GCS URI: ${gcsUri}`);
      
      console.log('   调用 Gemini 分析...\n');
      console.log('='.repeat(60));
      const geminiReport = await analyzeWithGemini(gcsUri, playerInfo, time);
      console.log(geminiReport);
    }
  } else {
    // 默认模式：本地 grep 分析
    const analyses = relevant.map(f => analyzeLog(f));
    console.log('='.repeat(60));
    const report = generateReport(playerInfo, analyses, time, tzStr);
    console.log(report);
  }
}

main().catch(console.error);
