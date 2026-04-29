#!/usr/bin/env npx tsx
import { readFileSync } from 'fs';
import * as lark from '@larksuiteoapi/node-sdk';
import { getConfigPath } from '../utils/paths.js';

type MessageItem = {
  message_id?: string;
  create_time?: string;
  msg_type?: string;
  deleted?: boolean;
  body?: { content?: string };
  sender?: {
    id?: string;
    sender_type?: string;
  };
};

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = getConfigPath();
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    throw new Error('Feishu credentials not found in config');
  }
  return { appId: feishu.appId, appSecret: feishu.appSecret };
}

function parseArgs(argv: string[]) {
  let chatId: string | undefined;
  let limit = 500;
  let execute = false;
  let pageSize = 100;
  let sleepMs = 150;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--chat' || arg === '-c') {
      chatId = argv[++i];
    } else if (arg === '--limit' || arg === '-n') {
      limit = Math.min(Math.max(parseInt(argv[++i] || '500', 10) || 500, 1), 500);
    } else if (arg === '--page-size') {
      pageSize = Math.min(Math.max(parseInt(argv[++i] || '100', 10) || 100, 1), 200);
    } else if (arg === '--sleep-ms') {
      sleepMs = Math.max(parseInt(argv[++i] || '150', 10) || 150, 0);
    } else if (arg === '--execute') {
      execute = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!chatId) {
    printHelp();
    process.exit(1);
  }

  return { chatId, limit, execute, pageSize, sleepMs };
}

function printHelp() {
  console.error(`Usage:
  npx tsx recall-chat-self-messages.ts --chat <chat_id> [--limit 500] [--execute] [--page-size 100] [--sleep-ms 150]

Description:
  Scan recent messages in a Feishu chat, find messages sent by this bot/app itself,
  and optionally recall them.

Safe default:
  Without --execute, this runs in dry-run mode and only prints which messages would be recalled.

Examples:
  npx tsx recall-chat-self-messages.ts --chat oc_xxx
  npx tsx recall-chat-self-messages.ts --chat oc_xxx --limit 500 --execute
`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePreview(msgType?: string, raw?: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (msgType === 'text') return parsed.text || '';
    if (msgType === 'post') {
      const content = parsed.content || parsed.zh_cn?.content || [];
      return content.flat().map((item: any) => item.text || item.content || '').join('');
    }
    if (msgType === 'interactive') return '[卡片消息]';
    if (msgType === 'image') return '[图片]';
    if (msgType === 'file') return `[文件: ${parsed.file_name || 'unknown'}]`;
    if (msgType === 'audio') return '[语音]';
    if (msgType === 'video' || msgType === 'media') return '[视频]';
    return raw.slice(0, 100);
  } catch {
    return raw.slice(0, 100);
  }
}

async function fetchRecentMessages(client: lark.Client, chatId: string, limit: number, pageSize: number): Promise<MessageItem[]> {
  const items: MessageItem[] = [];
  let pageToken: string | undefined;

  while (items.length < limit) {
    const resp = await client.im.message.list({
      params: {
        container_id_type: 'chat',
        container_id: chatId,
        page_size: Math.min(pageSize, limit - items.length),
        sort_type: 'ByCreateTimeDesc',
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    }) as any;

    if (resp.code !== 0) {
      throw new Error(`Failed to list messages: ${resp.msg || resp.code}`);
    }

    const pageItems = (resp.data?.items || []) as MessageItem[];
    if (pageItems.length === 0) break;
    items.push(...pageItems);

    pageToken = resp.data?.page_token;
    if (!pageToken) break;
  }

  return items.slice(0, limit);
}

async function main() {
  const { chatId, limit, execute, pageSize, sleepMs } = parseArgs(process.argv.slice(2));
  const creds = getFeishuCredentials();

  const client = new lark.Client({
    appId: creds.appId,
    appSecret: creds.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  const messages = await fetchRecentMessages(client, chatId, limit, pageSize);
  const selfMessages = messages.filter((item) => item.sender?.sender_type === 'app' && !item.deleted && item.message_id);

  console.log(JSON.stringify({
    ok: true,
    mode: execute ? 'execute' : 'dry-run',
    chat_id: chatId,
    scanned: messages.length,
    matched_self_messages: selfMessages.length,
    messages: selfMessages.map((item) => ({
      message_id: item.message_id,
      time: item.create_time ? new Date(Number(item.create_time)).toISOString() : '',
      msg_type: item.msg_type || '',
      preview: parsePreview(item.msg_type, item.body?.content).slice(0, 200),
    })),
  }, null, 2));

  if (!execute) {
    return;
  }

  const results: Array<{ message_id: string; ok: boolean; code?: number; msg?: string }> = [];
  for (const item of selfMessages) {
    const messageId = item.message_id!;
    const resp = await client.im.message.delete({
      path: { message_id: messageId },
    }) as any;

    results.push({
      message_id: messageId,
      ok: resp.code === 0,
      code: resp.code,
      msg: resp.msg,
    });

    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'execute',
    chat_id: chatId,
    recalled: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
