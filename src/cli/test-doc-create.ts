import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;
const client = new lark.Client({ appId, appSecret });

async function test() {
  // 创建文档
  const doc = await client.docx.document.create({
    data: { title: '测试文档_可删除', folder_token: 'K0PVfierbljO3GdmluycbUKFnwf' }
  });
  console.log('文档创建:', JSON.stringify(doc.data, null, 2));
  
  const docId = doc.data?.document?.document_id;
  if (!docId) {
    console.log('创建失败');
    return;
  }
  
  // 测试各种 block 类型，每次创建新文档避免 revision 问题
  
  const blocks = [
    { name: 'heading1', data: { block_type: 3, heading1: { elements: [{ text_run: { content: '标题一' } }] } } },
    { name: 'heading2', data: { block_type: 4, heading2: { elements: [{ text_run: { content: '标题二' } }] } } },
    { name: 'text', data: { block_type: 2, text: { elements: [{ text_run: { content: '正文' } }] } } },
    { name: 'divider', data: { block_type: 22, divider: {} } },
    { name: 'bullet', data: { block_type: 15, bullet: { elements: [{ text_run: { content: '列表项' } }] } } },
  ];
  
  for (const block of blocks) {
    try {
      await client.docx.documentBlockChildren.create({
        path: { document_id: docId, block_id: docId },
        params: { document_revision_id: -1 },
        data: {
          children: [block.data],
          index: -1  // -1 表示追加到末尾
        }
      });
      console.log(block.name + ' ✅');
      await new Promise(r => setTimeout(r, 200)); // 避免限流
    } catch (err: any) {
      console.log(block.name + ' ❌:', err.response?.data?.msg || err.message);
    }
  }
  
  console.log('\n链接: https://joycastle.feishu.cn/docx/' + docId);
}
test();
