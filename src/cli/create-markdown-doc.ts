#!/usr/bin/env npx tsx
/**
 * 创建飞书文档 - 从 Markdown 文件
 * 
 * Usage: npx tsx create-markdown-doc.ts --file <markdown-file> --title "标题" [--folder <folder_token>]
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";

function getFeishuCredentials(): { appId: string; appSecret: string } {
  const configPath = getConfigPath();
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    throw new Error('Feishu credentials not found in config');
  }
  return { appId: feishu.appId, appSecret: feishu.appSecret };
}

const creds = getFeishuCredentials();
const client = new lark.Client({
  appId: creds.appId,
  appSecret: creds.appSecret,
  disableTokenCache: false,
});

// 解析 Markdown 为块结构
interface Block {
  type: "heading1" | "heading2" | "heading3" | "text" | "bullet" | "quote" | "divider" | "code";
  content?: string;
  items?: string[];
  bold?: boolean;
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // 空行跳过
    if (!line.trim()) {
      i++;
      continue;
    }
    
    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }
    
    // 标题
    if (line.startsWith("# ")) {
      blocks.push({ type: "heading1", content: line.slice(2) });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "heading2", content: line.slice(3) });
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push({ type: "heading3", content: line.slice(4) });
      i++;
      continue;
    }
    
    // 引用块
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "quote", content: quoteLines.join("\n") });
      continue;
    }
    
    // 无序列表
    if (/^[-*•] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*•] /, ""));
        i++;
      }
      blocks.push({ type: "bullet", items });
      continue;
    }
    
    // 代码块
    if (line.startsWith("```")) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 ```
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }
    
    // 普通段落
    const paragraphLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith(">") && !/^[-*•] /.test(lines[i]) && !lines[i].startsWith("```") && !/^---+$/.test(lines[i].trim())) {
      paragraphLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "text", content: paragraphLines.join("\n") });
  }
  
  return blocks;
}

// 解析内联格式（粗体、链接等）
function parseInlineElements(text: string): any[] {
  const elements: any[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|([^*\[]+)/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      // 粗体 **text**
      elements.push({
        text_run: {
          content: match[2],
          text_element_style: { bold: true }
        }
      });
    } else if (match[3]) {
      // 链接 [text](url)
      elements.push({
        text_run: {
          content: match[4],
          text_element_style: {
            link: { url: match[5] }
          }
        }
      });
    } else if (match[6]) {
      // 普通文本
      elements.push({
        text_run: { content: match[6] }
      });
    }
  }
  
  return elements.length > 0 ? elements : [{ text_run: { content: text } }];
}

async function createDocument(title: string, markdown: string, folderToken?: string): Promise<string> {
  // 1. 创建空白文档
  const createResp = await client.docx.document.create({
    data: {
      title: title,
      folder_token: folderToken || "", // 空字符串表示根目录
    },
  });

  if (createResp.code !== 0) {
    throw new Error(`创建文档失败: ${createResp.msg}`);
  }

  const documentId = createResp.data?.document?.document_id;
  if (!documentId) {
    throw new Error("未获取到文档 ID");
  }

  console.log(`✅ 文档已创建: ${documentId}`);

  // 2. 解析 Markdown 并添加内容块
  const blocks = parseMarkdown(markdown);
  let index = 0;
  
  for (const block of blocks) {
    let blockData: any;
    
    switch (block.type) {
      case "heading1":
        blockData = {
          block_type: 3, // heading1
          heading1: {
            style: {},
            elements: parseInlineElements(block.content || "")
          }
        };
        break;
        
      case "heading2":
        blockData = {
          block_type: 4, // heading2
          heading2: {
            style: {},
            elements: parseInlineElements(block.content || "")
          }
        };
        break;
        
      case "heading3":
        blockData = {
          block_type: 5, // heading3
          heading3: {
            style: {},
            elements: parseInlineElements(block.content || "")
          }
        };
        break;
        
      case "text":
        blockData = {
          block_type: 2, // text
          text: {
            style: {},
            elements: parseInlineElements(block.content || "")
          }
        };
        break;
        
      case "quote":
        // quote 转为普通文本（带 > 前缀）
        blockData = {
          block_type: 2,
          text: {
            elements: [
              { text_run: { content: "> " + (block.content || "") } }
            ]
          }
        };
        break;
        
      case "divider":
        blockData = {
          block_type: 22, // divider
          divider: {}
        };
        break;
        
      case "code":
        blockData = {
          block_type: 14, // code
          code: {
            style: {},
            elements: [{ text_run: { content: block.content || "" } }],
            language: 1 // PlainText
          }
        };
        break;
        
      case "bullet":
        // 列表项转为普通文本（带 • 前缀）
        for (const item of block.items || []) {
          if (!item || item.trim() === '') continue;
          blockData = {
            block_type: 2,
            text: {
              elements: [
                { text_run: { content: "• " } },
                ...parseInlineElements(item)
              ]
            }
          };
          try {
            await client.docx.documentBlockChildren.create({
              path: { document_id: documentId, block_id: documentId },
              params: { document_revision_id: -1 },
              data: { children: [blockData], index: -1 }
            });
            await new Promise(r => setTimeout(r, 100));
          } catch (err: any) {
            // 静默跳过
          }
        }
        continue;
        
      default:
        continue;
    }
    
    try {
      await client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: documentId },
        params: { document_revision_id: -1 },
        data: {
          children: [blockData],
          index: -1,
        },
      });
      // 添加延迟避免限流
      await new Promise(r => setTimeout(r, 150));
    } catch (err: any) {
      // 静默跳过失败的块
      if (err.response?.status === 429) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // 返回文档链接
  return `https://shulex.feishu.cn/docx/${documentId}`;
}

// 主函数
async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string", short: "f" },
      title: { type: "string", short: "t" },
      folder: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  
  if (values.help || !values.file) {
    console.log(`Usage: npx tsx create-markdown-doc.ts --file <markdown-file> --title "标题" [--folder <folder_token>]`);
    process.exit(0);
  }
  
  const markdown = readFileSync(values.file, "utf-8");
  const title = values.title || "Untitled Document";
  
  try {
    const url = await createDocument(title, markdown, values.folder);
    console.log(`\n📄 文档链接: ${url}`);
  } catch (error) {
    console.error("❌ 错误:", error);
    process.exit(1);
  }
}

main();
