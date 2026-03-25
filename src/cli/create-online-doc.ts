#!/usr/bin/env npx tsx
/**
 * 创建飞书在线文档（简化版，只创建带标题的文档）
 */
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";

const { values } = parseArgs({
  options: {
    title: { type: "string", short: "t" },
    folder: { type: "string", short: "f" },
  },
});

if (!values.title) {
  console.log("Usage: npx tsx create-online-doc.ts --title <标题> [--folder <folder_token>]");
  process.exit(0);
}

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  console.log("创建在线文档...");
  
  const response = await client.docx.document.create({
    data: {
      title: values.title!,
      folder_token: values.folder || "",
    },
  });
  
  console.log("Response:", JSON.stringify(response, null, 2));
  
  const docId = (response as any).data?.document?.document_id;
  if (docId) {
    console.log(`\n✅ 文档创建成功！`);
    console.log(`📄 标题: ${values.title}`);
    console.log(`🔗 链接: https://joycastle.feishu.cn/docx/${docId}`);
  }
}

main().catch(console.error);
