#!/usr/bin/env npx tsx
/**
 * 将 Markdown 文件导入为飞书在线文档
 * Usage: npx tsx import-md-to-doc.ts --file <markdown-file> --title "标题" [--folder <folder_token>]
 */
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync, createReadStream, statSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";
import path from "path";

const { values } = parseArgs({
  options: {
    file: { type: "string", short: "f" },
    title: { type: "string", short: "t" },
    folder: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || !values.file) {
  console.log(`Usage: npx tsx import-md-to-doc.ts --file <markdown-file> --title "标题" [--folder <folder_token>]`);
  process.exit(0);
}

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const filePath = values.file!;
  const title = values.title || path.basename(filePath, '.md');
  const folderToken = values.folder || '';
  
  const fileSize = statSync(filePath).size;
  const fileStream = createReadStream(filePath);
  const fileName = path.basename(filePath);
  
  console.log(`1. 上传文件 ${fileName} (${fileSize} bytes)...`);
  
  // 上传文件到云盘（作为临时文件）
  const uploadResp = await client.drive.media.uploadAll({
    data: {
      file_name: fileName,
      parent_type: "explorer",
      parent_node: folderToken || "root",
      size: fileSize,
      file: fileStream as any,
    },
  });
  
  const fileToken = uploadResp.data?.file_token || (uploadResp as any).file_token;
  if (!fileToken) {
    console.error("上传失败:", uploadResp);
    process.exit(1);
  }
  console.log(`   文件 token: ${fileToken}`);
  
  console.log(`2. 创建导入任务...`);
  
  // 创建导入任务
  const importResp = await client.drive.importTask.create({
    data: {
      file_extension: "md",
      file_token: fileToken,
      type: "docx",
      file_name: title,
      point: folderToken ? {
        mount_type: 1,  // 云空间
        mount_key: folderToken,
      } : undefined,
    },
  });
  
  if (importResp.code !== 0) {
    console.error("创建导入任务失败:", importResp);
    process.exit(1);
  }
  
  const ticket = importResp.data?.ticket;
  console.log(`   任务 ticket: ${ticket}`);
  
  console.log(`3. 等待导入完成...`);
  
  // 轮询等待任务完成
  let result: any;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    
    const statusResp = await client.drive.importTask.get({
      path: { ticket: ticket! },
    });
    
    const job = statusResp.data?.result;
    if (job?.job_status === 0) {
      result = job;
      break;
    } else if (job?.job_status === 2) {
      console.error("导入失败:", JSON.stringify(job, null, 2));
      process.exit(1);
    }
    
    process.stdout.write(".");
  }
  
  if (!result) {
    console.error("导入超时");
    process.exit(1);
  }
  
  console.log("\n");
  console.log(`✅ 导入成功！`);
  console.log(`📄 文档 token: ${result.token}`);
  console.log(`🔗 链接: https://joycastle.feishu.cn/docx/${result.token}`);
}

main().catch(console.error);
