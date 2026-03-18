#!/usr/bin/env npx tsx
/**
 * 创建飞书文档
 * 
 * Usage: npx tsx create-doc.ts --title "标题" --content "内容"
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

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

interface DocContent {
  title: string;
  sections: Array<{
    heading?: string;
    items: Array<{ label: string; value: string }>;
  }>;
}

async function createDocument(content: DocContent): Promise<string> {
  // 1. 创建空白文档
  const createResp = await client.docx.document.create({
    data: {
      title: content.title,
      folder_token: "", // 根目录
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

  // 2. 获取文档根 block
  const docResp = await client.docx.document.get({
    path: { document_id: documentId },
  });

  const rootBlockId = docResp.data?.document?.document_id;

  // 3. 添加内容块
  let index = 0;
  for (const section of content.sections) {
    // 添加标题（如果有）
    if (section.heading) {
      await client.docx.documentBlock.createChildren({
        path: { document_id: documentId, block_id: documentId },
        params: { document_revision_id: -1 },
        data: {
          children: [{
            block_type: 4, // heading2
            heading2: {
              elements: [{
                text_run: { content: section.heading }
              }]
            }
          }],
          index: index++,
        },
      });
    }

    // 添加每个条目
    for (const item of section.items) {
      await client.docx.documentBlock.createChildren({
        path: { document_id: documentId, block_id: documentId },
        params: { document_revision_id: -1 },
        data: {
          children: [{
            block_type: 2, // text
            text: {
              elements: [
                { text_run: { content: `${item.label}: `, text_element_style: { bold: true } } },
                { text_run: { content: item.value } },
              ]
            }
          }],
          index: index++,
        },
      });
    }

    // 添加空行分隔
    await client.docx.documentBlock.createChildren({
      path: { document_id: documentId, block_id: documentId },
      params: { document_revision_id: -1 },
      data: {
        children: [{
          block_type: 2, // text
          text: { elements: [{ text_run: { content: "" } }] }
        }],
        index: index++,
      },
    });
  }

  // 返回文档链接
  return `https://shulex.feishu.cn/docx/${documentId}`;
}

// Brief 内容
const briefContent: DocContent = {
  title: "Creator Collaboration Brief",
  sections: [
    {
      heading: "Creator Preferences",
      items: [
        { label: "Review creators", value: "No" },
        { label: "Goal for number of creator collaborations", value: "30" },
        { label: "Creator category", value: "Games" },
        { label: "Preferred creator description", value: "We hope to reach creators who are aged 18-45 and have a passion for simulation games. It's essential that your content resonates with players who enjoy managing virtual businesses and appreciate captivating storylines." },
      ]
    }
  ]
};

// 主函数
async function main() {
  try {
    const url = await createDocument(briefContent);
    console.log(`\n📄 文档链接: ${url}`);
  } catch (error) {
    console.error("❌ 错误:", error);
    process.exit(1);
  }
}

main();
