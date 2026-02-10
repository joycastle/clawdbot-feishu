#!/usr/bin/env npx tsx
/**
 * CLI to get group announcement.
 * Usage:
 *   npx tsx src/cli/announcement.ts --chat <chat_id>
 *   npx tsx src/cli/announcement.ts --chat <chat_id> --raw
 */

import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "node:util";
import * as lark from "@larksuiteoapi/node-sdk";

function loadConfig() {
  const configPath = path.join(process.env.HOME || "", ".clawdbot", "clawdbot.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/** 解析云文档格式的公告内容为可读文本 */
function parseAnnouncementContent(content: string): string {
  try {
    const doc = JSON.parse(content);
    const lines: string[] = [];

    function extractElements(elements: any[]): string {
      let text = "";
      for (const el of elements || []) {
        if (el.textRun?.text) {
          text += el.textRun.text;
        } else if (el.text_run?.content) {
          text += el.text_run.content;
        } else if (el.mentionUser?.userId) {
          text += `@${el.mentionUser.userId}`;
        } else if (el.docsLink?.url) {
          text += `[链接](${el.docsLink.url})`;
        }
      }
      return text;
    }

    function extractBlock(block: any): void {
      if (!block) return;

      // 处理段落
      if (block.paragraph?.elements) {
        const text = extractElements(block.paragraph.elements);
        if (text.trim()) {
          lines.push(text);
        }
        lines.push("\n");
      }

      // 处理标题
      const heading = block.heading1 || block.heading2 || block.heading3;
      if (heading?.elements) {
        const text = extractElements(heading.elements);
        if (text.trim()) {
          lines.push(`## ${text}`);
        }
        lines.push("\n");
      }
    }

    // 处理 body.blocks
    if (doc.body?.blocks) {
      for (const block of doc.body.blocks) {
        extractBlock(block);
      }
    }

    return lines.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    return `[解析失败: ${e}]\n${content}`;
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      chat: { type: "string", short: "c" },
      raw: { type: "boolean", short: "r" },
    },
  });

  const chatId = values.chat;
  const showRaw = values.raw;

  if (!chatId) {
    console.log(`Usage:
  npx tsx src/cli/announcement.ts --chat <chat_id>
  npx tsx src/cli/announcement.ts --chat <chat_id> --raw

Options:
  --chat, -c    Group chat_id
  --raw, -r     Show raw JSON content`);
    process.exit(1);
  }

  const config = loadConfig();
  const feishu = config?.channels?.feishu;

  const client = new lark.Client({
    appId: feishu.appId,
    appSecret: feishu.appSecret,
  });

  const response = await client.im.chatAnnouncement.get({
    path: { chat_id: chatId },
    params: { user_id_type: "open_id" },
  }) as {
    code?: number;
    msg?: string;
    data?: {
      content?: string;
      revision?: string;
      create_time?: string;
      update_time?: string;
      owner_id?: string;
      modifier_id?: string;
    };
  };

  if (response.code !== 0) {
    console.error(`Error: ${response.msg || `code ${response.code}`}`);
    process.exit(1);
  }

  const data = response.data;
  if (!data?.content) {
    console.log("该群没有群公告");
    process.exit(0);
  }

  console.log("=== 群公告 ===\n");

  if (showRaw) {
    console.log(data.content);
  } else {
    const text = parseAnnouncementContent(data.content);
    console.log(text);
  }

  console.log("\n--- 元信息 ---");
  console.log(`更新时间: ${data.update_time ? new Date(parseInt(data.update_time) * 1000).toISOString() : "未知"}`);
  console.log(`修改者: ${data.modifier_id || "未知"}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
