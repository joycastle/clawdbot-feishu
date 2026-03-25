#!/usr/bin/env npx tsx
/**
 * 转移飞书云盘文件所有权
 * Usage: npx tsx transfer-owner.ts --file-token <token> --new-owner <open_id>
 */
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";

const { values } = parseArgs({
  options: {
    "file-token": { type: "string" },
    "new-owner": { type: "string" },
  },
});

if (!values["file-token"] || !values["new-owner"]) {
  console.log("Usage: npx tsx transfer-owner.ts --file-token <token> --new-owner <open_id>");
  process.exit(0);
}

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const fileToken = values["file-token"]!;
  const newOwner = values["new-owner"]!;
  
  console.log(`转移文件 ${fileToken} 所有权给 ${newOwner}...`);
  
  // 使用 drive/v1/permissions/{token}/members/transfer_owner
  try {
    const response = await (client as any).request({
      method: "POST",
      url: `https://open.feishu.cn/open-apis/drive/v1/permissions/${fileToken}/members/transfer_owner`,
      params: { type: "file" },
      data: {
        member_type: "openid",
        member_id: newOwner,
      },
    });
    
    console.log("Response:", JSON.stringify(response, null, 2));
  } catch (error: any) {
    console.error("Error:", error.response?.data || error.message);
  }
}

main();
