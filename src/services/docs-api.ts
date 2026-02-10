/**
 * 飞书云文档 API 服务
 * 支持 Wiki（知识库）和 Docx（文档）的读取
 * 
 * 端口：18798
 */

import * as http from "node:http";
import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "../types.js";

let server: http.Server | null = null;
let feishuClient: lark.Client | null = null;

function createClient(cfg: FeishuConfig): lark.Client {
  if (!feishuClient) {
    feishuClient = new lark.Client({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
    });
  }
  return feishuClient;
}

// ─── Wiki API ─────────────────────────────────────────────────────────────────

/** 获取知识空间列表 */
async function getWikiSpaces(client: lark.Client): Promise<any[]> {
  const response = await client.wiki.space.list({
    params: { page_size: 50 },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get wiki spaces: ${response.msg}`);
  }
  
  return response.data?.items || [];
}

/** 获取知识空间信息 */
async function getWikiSpace(client: lark.Client, spaceId: string): Promise<any> {
  const response = await client.wiki.space.get({
    path: { space_id: spaceId },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get wiki space: ${response.msg}`);
  }
  
  return response.data?.space;
}

/** 获取知识空间节点列表 */
async function getWikiNodes(
  client: lark.Client,
  spaceId: string,
  parentNodeToken?: string
): Promise<any[]> {
  const response = await client.wiki.spaceNode.list({
    path: { space_id: spaceId },
    params: {
      page_size: 50,
      parent_node_token: parentNodeToken,
    },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get wiki nodes: ${response.msg}`);
  }
  
  return response.data?.items || [];
}

/** 获取单个节点信息（通过 HTTP 直接调用，因为 SDK 没有这个方法） */
async function getWikiNode(cfg: FeishuConfig, token: string): Promise<any> {
  // 获取 tenant_access_token
  const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
  });
  const tokenData = await tokenResp.json() as any;
  const accessToken = tokenData.tenant_access_token;
  
  // 获取 wiki 节点信息
  const nodeResp = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${token}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const nodeData = await nodeResp.json() as any;
  
  if (nodeData.code !== 0) {
    throw new Error(`Failed to get wiki node: ${nodeData.msg}`);
  }
  
  return nodeData.data?.node;
}

// ─── Docx API ─────────────────────────────────────────────────────────────────

/** 获取文档纯文本内容 */
async function getDocxRawContent(client: lark.Client, documentId: string): Promise<string> {
  const response = await client.docx.document.rawContent({
    path: { document_id: documentId },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get docx content: ${response.msg}`);
  }
  
  return response.data?.content || "";
}

/** 获取文档块列表 */
async function getDocxBlocks(client: lark.Client, documentId: string): Promise<any[]> {
  const response = await client.docx.documentBlock.list({
    path: { document_id: documentId },
    params: { page_size: 500 },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get docx blocks: ${response.msg}`);
  }
  
  return response.data?.items || [];
}

// ─── URL 解析 ─────────────────────────────────────────────────────────────────

interface ParsedUrl {
  type: "wiki" | "docx" | "sheet" | "bitable" | "unknown";
  token: string;
  spaceId?: string;
}

/** 解析飞书文档 URL */
function parseFeishuUrl(url: string): ParsedUrl {
  // Wiki: https://xxx.feishu.cn/wiki/xxxtoken
  // Docx: https://xxx.feishu.cn/docx/xxxtoken
  // Sheet: https://xxx.feishu.cn/sheets/xxxtoken
  // Bitable: https://xxx.feishu.cn/base/xxxtoken
  
  const patterns = [
    { regex: /\/wiki\/([a-zA-Z0-9]+)/, type: "wiki" as const },
    { regex: /\/docx\/([a-zA-Z0-9]+)/, type: "docx" as const },
    { regex: /\/sheets\/([a-zA-Z0-9]+)/, type: "sheet" as const },
    { regex: /\/base\/([a-zA-Z0-9]+)/, type: "bitable" as const },
  ];
  
  for (const { regex, type } of patterns) {
    const match = url.match(regex);
    if (match) {
      return { type, token: match[1] };
    }
  }
  
  return { type: "unknown", token: "" };
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

function jsonResponse(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function errorResponse(res: http.ServerResponse, message: string, status = 500) {
  jsonResponse(res, { error: message }, status);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  client: lark.Client,
  cfg: FeishuConfig
) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // GET /status
    if (path === "/status") {
      return jsonResponse(res, { status: "ok", service: "docs-api", port: 18798 });
    }

    // GET /parse-url?url=xxx
    if (path === "/parse-url") {
      const docUrl = url.searchParams.get("url");
      if (!docUrl) {
        return errorResponse(res, "url parameter required", 400);
      }
      const parsed = parseFeishuUrl(docUrl);
      return jsonResponse(res, parsed);
    }

    // ─── Wiki Routes ─────────────────────────────────────────────────────────

    // GET /wiki/spaces - 列出知识空间
    if (path === "/wiki/spaces") {
      const spaces = await getWikiSpaces(client);
      return jsonResponse(res, { spaces });
    }

    // GET /wiki/space/:spaceId - 获取知识空间信息
    const spaceMatch = path.match(/^\/wiki\/space\/([^/]+)$/);
    if (spaceMatch) {
      const space = await getWikiSpace(client, spaceMatch[1]);
      return jsonResponse(res, { space });
    }

    // GET /wiki/nodes/:spaceId - 获取节点列表
    const nodesMatch = path.match(/^\/wiki\/nodes\/([^/]+)$/);
    if (nodesMatch) {
      const parentToken = url.searchParams.get("parent") || undefined;
      const nodes = await getWikiNodes(client, nodesMatch[1], parentToken);
      return jsonResponse(res, { nodes });
    }

    // GET /wiki/node?token=xxx - 获取单个节点
    if (path === "/wiki/node") {
      const token = url.searchParams.get("token");
      if (!token) {
        return errorResponse(res, "token parameter required", 400);
      }
      const node = await getWikiNode(cfg, token);
      return jsonResponse(res, { node });
    }

    // ─── Docx Routes ─────────────────────────────────────────────────────────

    // GET /docx/raw/:documentId - 获取文档纯文本
    const rawMatch = path.match(/^\/docx\/raw\/([^/]+)$/);
    if (rawMatch) {
      const content = await getDocxRawContent(client, rawMatch[1]);
      return jsonResponse(res, { content });
    }

    // GET /docx/blocks/:documentId - 获取文档块
    const blocksMatch = path.match(/^\/docx\/blocks\/([^/]+)$/);
    if (blocksMatch) {
      const blocks = await getDocxBlocks(client, blocksMatch[1]);
      return jsonResponse(res, { blocks });
    }

    // ─── 智能读取 ─────────────────────────────────────────────────────────────

    // GET /read?url=xxx - 智能解析 URL 并读取内容
    if (path === "/read") {
      const docUrl = url.searchParams.get("url");
      if (!docUrl) {
        return errorResponse(res, "url parameter required", 400);
      }
      
      const parsed = parseFeishuUrl(docUrl);
      
      // Wiki 需要先获取节点信息，找到真正的文档类型
      if (parsed.type === "wiki") {
        const node = await getWikiNode(cfg, parsed.token);
        const objType = node.obj_type; // docx, sheet, bitable, etc.
        const objToken = node.obj_token;
        
        if (objType === "docx" || objType === "doc") {
          const content = await getDocxRawContent(client, objToken);
          return jsonResponse(res, { 
            type: "wiki", 
            wikiToken: parsed.token,
            objType,
            objToken,
            title: node.title,
            content 
          });
        }
        
        // 其他类型返回节点信息和提示
        return jsonResponse(res, { 
          type: "wiki",
          wikiToken: parsed.token,
          objType,
          objToken,
          title: node.title,
          hint: objType === "sheet" 
            ? "Use sheets-api (port 18796) with objToken" 
            : objType === "bitable"
            ? "Use bitable-api (port 18795) with objToken"
            : `Object type: ${objType}`
        });
      }
      
      if (parsed.type === "docx") {
        const content = await getDocxRawContent(client, parsed.token);
        return jsonResponse(res, { type: parsed.type, token: parsed.token, content });
      }
      
      if (parsed.type === "sheet") {
        return jsonResponse(res, { 
          type: parsed.type, 
          token: parsed.token,
          hint: "Use sheets-api (port 18796) for spreadsheets"
        });
      }
      
      if (parsed.type === "bitable") {
        return jsonResponse(res, { 
          type: parsed.type, 
          token: parsed.token,
          hint: "Use bitable-api (port 18795) for bitables"
        });
      }
      
      return errorResponse(res, `Unknown document type: ${docUrl}`, 400);
    }

    return errorResponse(res, "Not found", 404);
  } catch (err) {
    console.error("[docs-api] Error:", err);
    return errorResponse(res, String(err));
  }
}

export function startDocsApi(cfg: FeishuConfig | undefined, log?: (...args: unknown[]) => void) {
  if (!cfg) {
    log?.("[docs-api] Feishu config not found, skipping");
    return;
  }

  const PORT = 18798;
  const client = createClient(cfg);

  server = http.createServer((req, res) => {
    handleRequest(req, res, client, cfg).catch((err) => {
      console.error("[docs-api] Unhandled error:", err);
      errorResponse(res, "Internal server error");
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    log?.(`[docs-api] Docs API listening on http://127.0.0.1:${PORT}`);
  });
}

export function stopDocsApi() {
  if (server) {
    server.close();
    server = null;
  }
}
