#!/usr/bin/env node
/**
 * 直接调用自动压缩函数，测试 compaction-safeguard 扩展
 */

import { compactEmbeddedPiSession } from '/home/ubuntu/.npm-global/lib/node_modules/clawdbot/dist/agents/pi-embedded-runner/compact.js';
import fs from 'node:fs';
import path from 'node:path';

// 读取配置
const configPath = '/home/ubuntu/.clawdbot/clawdbot.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 获取当前 session 文件（正确的目录）
const sessionsDir = '/home/ubuntu/.clawdbot/agents/main/sessions';
const sessionFiles = fs.readdirSync(sessionsDir)
  .filter(f => f.endsWith('.jsonl') && !f.includes('.lock') && !f.includes('.deleted'))
  .map(f => ({
    name: f,
    path: path.join(sessionsDir, f),
    mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs
  }))
  .sort((a, b) => b.mtime - a.mtime);

if (sessionFiles.length === 0) {
  console.error('No session files found');
  process.exit(1);
}

// 用第二个 session（最近的那个被锁了）
const sessionFile = sessionFiles[1].path;
const sessionId = sessionFiles[1].name.replace('.jsonl', '');

console.log('Testing auto-compaction with:');
console.log('  Session file:', sessionFile);
console.log('  Session ID:', sessionId);
console.log('  Compaction mode:', config.agents?.defaults?.compaction?.mode);
console.log('');

try {
  const result = await compactEmbeddedPiSession({
    sessionId,
    sessionFile,
    workspaceDir: '/home/ubuntu/clawd',
    config,
    provider: 'anthropic',
    model: 'claude-opus-4-5',
  });
  
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Error:', err);
}
