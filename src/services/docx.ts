/**
 * 飞书 Docx（文档）API
 * 
 * 职责：读取飞书文档内容
 */

import * as lark from "@larksuiteoapi/node-sdk";

// ─── Docx Content API ─────────────────────────────────────────────────────────

/**
 * 获取文档纯文本内容
 * 
 * @param client - Lark SDK client
 * @param documentId - 文档 ID（不是 wiki token，而是 obj_token）
 */
export async function getDocxRawContent(client: lark.Client, documentId: string): Promise<string> {
  const response = await client.docx.document.rawContent({
    path: { document_id: documentId },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get docx content: ${response.msg}`);
  }
  
  return response.data?.content || "";
}

/**
 * 获取文档块列表（结构化内容）
 * 
 * @param client - Lark SDK client
 * @param documentId - 文档 ID
 */
export async function getDocxBlocks(client: lark.Client, documentId: string): Promise<any[]> {
  const response = await client.docx.documentBlock.list({
    path: { document_id: documentId },
    params: { page_size: 500 },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get docx blocks: ${response.msg}`);
  }
  
  return response.data?.items || [];
}

/**
 * 读取 Docx 文档完整内容
 * 
 * @returns { content, blocks? } - 文本内容和可选的结构化块
 */
export async function readDocx(client: lark.Client, documentId: string, includeBlocks = false): Promise<{
  content: string;
  blocks?: any[];
}> {
  const content = await getDocxRawContent(client, documentId);
  
  if (includeBlocks) {
    const blocks = await getDocxBlocks(client, documentId);
    return { content, blocks };
  }
  
  return { content };
}
