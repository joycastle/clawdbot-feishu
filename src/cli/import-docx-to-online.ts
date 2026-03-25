#!/usr/bin/env npx tsx
/**
 * 将 docx 上传并转换为飞书在线文档
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";
import path from "path";

const { values } = parseArgs({
  options: {
    file: { type: "string", short: "f" },
    folder: { type: "string" },
    name: { type: "string", short: "n" },
  },
});

if (!values.file || !values.folder) {
  console.log("Usage: npx tsx import-docx-to-online.ts --file <md-file> --folder <folder_token> [--name <title>]");
  process.exit(0);
}

// Markdown 转 docx 段落
function mdToDocxParagraphs(markdown: string): Paragraph[] {
  const lines = markdown.split("\n");
  const paragraphs: Paragraph[] = [];
  
  for (const line of lines) {
    if (!line.trim()) {
      paragraphs.push(new Paragraph({}));
      continue;
    }
    
    if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: line.slice(2), bold: true, size: 32 })],
      }));
    } else if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: line.slice(3), bold: true, size: 28 })],
      }));
    } else if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: line.slice(4), bold: true, size: 24 })],
      }));
    } else if (line.startsWith("---")) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: "─".repeat(50) })] }));
    } else if (line.startsWith("> ")) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.slice(2), italics: true, color: "666666" })],
        indent: { left: 720 },
      }));
    } else if (/^[-*•] /.test(line)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: "• " + line.replace(/^[-*•] /, "") })],
        indent: { left: 360 },
      }));
    } else {
      const parts: TextRun[] = [];
      const regex = /\*\*([^*]+)\*\*/g;
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) parts.push(new TextRun({ text: line.slice(lastIndex, match.index) }));
        parts.push(new TextRun({ text: match[1], bold: true }));
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < line.length) parts.push(new TextRun({ text: line.slice(lastIndex) }));
      paragraphs.push(new Paragraph({ children: parts.length > 0 ? parts : [new TextRun({ text: line })] }));
    }
  }
  return paragraphs;
}

async function main() {
  const markdown = readFileSync(values.file!, "utf-8");
  const title = values.name || path.basename(values.file!, ".md");
  
  const configPath = getConfigPath();
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const { appId, appSecret } = config.channels.feishu;
  const client = new lark.Client({ appId, appSecret });
  
  // 1. 生成 docx
  console.log("1. 生成 docx...");
  const doc = new Document({ sections: [{ children: mdToDocxParagraphs(markdown) }] });
  const buffer = await Packer.toBuffer(doc);
  console.log(`   生成完成 (${buffer.length} bytes)`);
  
  // 2. 上传文件
  console.log("2. 上传文件...");
  const uploadResp = await client.drive.media.uploadAll({
    data: {
      file_name: `${title}.docx`,
      parent_type: "explorer",
      parent_node: values.folder!,
      size: buffer.length,
      file: buffer,
    },
  });
  
  const fileToken = (uploadResp as any).file_token;
  if (!fileToken) {
    console.error("上传失败:", uploadResp);
    return;
  }
  console.log(`   上传成功: ${fileToken}`);
  
  // 3. 创建导入任务
  console.log("3. 创建导入任务...");
  try {
    const importResp = await client.drive.importTask.create({
      data: {
        file_extension: "docx",
        file_token: fileToken,
        type: "docx", // 目标类型：飞书文档
        file_name: title,
        point: {
          mount_type: 1, // 云空间
          mount_key: values.folder!,
        },
      },
    });
    
    console.log("导入响应:", JSON.stringify(importResp, null, 2));
    
    const ticket = (importResp as any).data?.ticket || (importResp as any).ticket;
    if (ticket) {
      // 4. 轮询导入结果
      console.log("4. 等待导入完成...");
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const statusResp = await client.drive.importTask.get({
          path: { ticket },
        });
        const result = (statusResp as any).data?.result || (statusResp as any).result;
        console.log(`   状态: ${JSON.stringify(result)}`);
        
        if (result?.job_status === 0) {
          console.log(`\n✅ 导入成功！`);
          console.log(`📄 文档: ${title}`);
          console.log(`🔗 链接: https://joycastle.feishu.cn/docx/${result.token}`);
          return;
        } else if (result?.job_status === 2) {
          console.log("导入失败:", result);
          return;
        }
      }
    }
  } catch (error: any) {
    console.error("导入错误:", error.response?.data || error.message);
  }
}

main().catch(console.error);
