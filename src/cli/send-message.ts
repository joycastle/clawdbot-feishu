#!/usr/bin/env npx tsx
/**
 * 发送飞书消息的 CLI 工具
 * 用法: npx tsx send-message.ts --to <user_id|chat_id> --text <message>
 */

import * as lark from "@larksuiteoapi/node-sdk";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const args = process.argv.slice(2);
  const toIndex = args.indexOf("--to");
  const textIndex = args.indexOf("--text");
  
  if (toIndex === -1 || textIndex === -1) {
    console.error("Usage: npx tsx send-message.ts --to <id> --text <message>");
    process.exit(1);
  }
  
  const to = args[toIndex + 1];
  const text = args[textIndex + 1];
  
  if (!to || !text) {
    console.error("Missing --to or --text value");
    process.exit(1);
  }
  
  // 读取配置
  const cfgPath = path.join(process.env.HOME!, ".clawdbot/clawdbot.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  const { appId, appSecret } = cfg.channels.feishu;
  
  const client = new lark.Client({
    appId,
    appSecret,
    disableTokenCache: false,
  });
  
  // 判断是用户还是群
  const isUser = to.startsWith("ou_");
  const receiveIdType = isUser ? "open_id" : "chat_id";
  
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: to,
        msg_type: "text",
        content: JSON.stringify({ text: text.replace(/\\n/g, "\n") }),
      },
    });
    
    if (res.code === 0) {
      console.log(`Message sent to ${to}`);
    } else {
      console.error(`Failed: ${res.msg}`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
