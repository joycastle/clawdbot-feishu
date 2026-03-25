import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const feishu = config?.channels?.feishu;

const client = new lark.Client({ appId: feishu.appId, appSecret: feishu.appSecret });

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// 飞书文档块类型测试
const BLOCK_TYPES: Record<number, { name: string; data: any }> = {
  2: { name: "Text (文本)", data: { text: { elements: [{ text_run: { content: "测试文本" } }] } } },
  3: { name: "Heading1 (一级标题)", data: { heading1: { elements: [{ text_run: { content: "一级标题" } }] } } },
  4: { name: "Heading2 (二级标题)", data: { heading2: { elements: [{ text_run: { content: "二级标题" } }] } } },
  5: { name: "Heading3 (三级标题)", data: { heading3: { elements: [{ text_run: { content: "三级标题" } }] } } },
  6: { name: "Heading4 (四级标题)", data: { heading4: { elements: [{ text_run: { content: "四级标题" } }] } } },
  7: { name: "Heading5 (五级标题)", data: { heading5: { elements: [{ text_run: { content: "五级标题" } }] } } },
  8: { name: "Heading6 (六级标题)", data: { heading6: { elements: [{ text_run: { content: "六级标题" } }] } } },
  9: { name: "Heading7 (七级标题)", data: { heading7: { elements: [{ text_run: { content: "七级标题" } }] } } },
  10: { name: "Heading8 (八级标题)", data: { heading8: { elements: [{ text_run: { content: "八级标题" } }] } } },
  11: { name: "Heading9 (九级标题)", data: { heading9: { elements: [{ text_run: { content: "九级标题" } }] } } },
  12: { name: "Bullet (无序列表)", data: { bullet: { elements: [{ text_run: { content: "无序列表项" } }] } } },
  13: { name: "Ordered (有序列表)", data: { ordered: { elements: [{ text_run: { content: "有序列表项" } }] } } },
  14: { name: "Code (代码块)", data: { code: { elements: [{ text_run: { content: "console.log('hello')" } }], language: 1 } } },
  15: { name: "Quote (引用)", data: { quote: { elements: [{ text_run: { content: "引用文本" } }] } } },
  17: { name: "Todo (待办)", data: { todo: { elements: [{ text_run: { content: "待办事项" } }], style: { done: false } } } },
  22: { name: "Divider (分割线)", data: { divider: {} } },
  // 特殊块
  19: { name: "Callout (高亮块)", data: { callout: { background_color: 1, border_color: 1, emoji_id: "bulb" } } },
  31: { name: "Table (表格)", data: { table: { property: { row_size: 2, column_size: 2 } } } },
  32: { name: "Grid (分栏)", data: { grid: { column_size: 2 } } },
};

async function testAllBlocks() {
  console.log("创建测试文档...");
  const createResp = await client.docx.document.create({ data: { title: "飞书文档块类型测试" } });
  if (createResp.code !== 0) throw new Error(createResp.msg);
  const docId = createResp.data?.document?.document_id!;
  console.log("文档ID:", docId);
  console.log("\n========== 测试各种块类型 ==========\n");
  
  const results: { type: number; name: string; ok: boolean; error?: string }[] = [];
  
  for (const [typeStr, config] of Object.entries(BLOCK_TYPES)) {
    const type = parseInt(typeStr);
    try {
      const resp = await client.docx.documentBlockChildren.create({
        path: { document_id: docId, block_id: docId },
        params: { document_revision_id: -1 },
        data: { children: [{ block_type: type, ...config.data }], index: -1 }
      });
      
      const ok = resp.code === 0;
      results.push({ type, name: config.name, ok, error: ok ? undefined : resp.msg });
      console.log(`${ok ? "✅" : "❌"} ${type.toString().padStart(2)}: ${config.name}${ok ? "" : " - " + resp.msg}`);
    } catch (e: any) {
      const errMsg = e.response?.data?.msg || e.message?.slice(0, 50);
      results.push({ type, name: config.name, ok: false, error: errMsg });
      console.log(`❌ ${type.toString().padStart(2)}: ${config.name} - ${errMsg}`);
    }
    await delay(150);
  }
  
  // 汇总
  console.log("\n========== 汇总 ==========\n");
  const success = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  
  console.log(`✅ 可创建 (${success.length}): ${success.map(r => r.name.split(" ")[0]).join(", ")}`);
  console.log(`❌ 不可创建 (${failed.length}): ${failed.map(r => r.name.split(" ")[0]).join(", ")}`);
  
  console.log("\n📄 测试文档: https://shulex.feishu.cn/docx/" + docId);
  
  // 删除测试文档
  // await client.drive.file.delete({ path: { file_token: docId }, params: { type: "docx" } });
}

testAllBlocks().catch(console.error);
