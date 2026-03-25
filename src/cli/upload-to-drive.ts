#!/usr/bin/env npx tsx
/**
 * 上传文件到飞书云盘
 * Usage: npx tsx upload-to-drive.ts --file <path> --folder <folder_token> [--name <filename>]
 */
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync, createReadStream, statSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";
import path from "path";

const { values } = parseArgs({
  options: {
    file: { type: "string", short: "f" },
    folder: { type: "string" },
    name: { type: "string", short: "n" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || !values.file || !values.folder) {
  console.log("Usage: npx tsx upload-to-drive.ts --file <path> --folder <folder_token> [--name <filename>]");
  process.exit(0);
}

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const filePath = values.file!;
  const folderToken = values.folder!;
  const fileName = values.name || path.basename(filePath);
  
  const fileSize = statSync(filePath).size;
  const fileStream = createReadStream(filePath);
  
  console.log(`Uploading ${fileName} (${fileSize} bytes) to folder ${folderToken}...`);
  
  try {
    const response = await client.drive.media.uploadAll({
      data: {
        file_name: fileName,
        parent_type: "explorer",
        parent_node: folderToken,
        size: fileSize,
        file: fileStream as any,
      },
    });
    
    console.log("Response:", JSON.stringify(response, null, 2));
    
    if ((response as any).code === 0) {
      const fileToken = (response as any).data?.file_token;
      console.log(`\n✅ 上传成功！`);
      console.log(`📄 文件链接: https://joycastle.feishu.cn/file/${fileToken}`);
    } else {
      console.log("Upload failed:", (response as any).msg);
    }
  } catch (error: any) {
    console.error("Error:", error.response?.data || error.message);
  }
}

main();
