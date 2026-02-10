/**
 * 飞书文档统一路由服务
 * 
 * 端口：18798
 * 
 * 职责：
 * 1. 解析飞书文档 URL
 * 2. 根据 URL 类型路由到对应的处理器
 * 3. 提供统一的 /read?url=xxx 接口
 * 
 * URL 类型：
 * - /wiki/xxx   → Wiki 知识库（需二级解析：docx/sheet/bitable）
 * - /docx/xxx   → 独立文档
 * - /sheets/xxx → 独立电子表格
 * - /base/xxx   → 独立多维表格
 */

import * as http from "node:http";
import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "../types.js";

// 导入各类型处理器
import { getWikiSpaces, getWikiSpace, getWikiNodes, getWikiNode, resolveWikiNode } from "./wiki.js";
import { getDocxRawContent, getDocxBlocks } from "./docx.js";

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

// ─── URL 解析 ─────────────────────────────────────────────────────────────────

interface ParsedUrl {
  type: "wiki" | "docx" | "sheet" | "bitable" | "unknown";
  token: string;
  tableId?: string;  // URL 中的 table 参数
  sheetId?: string;  // URL 中的 sheet 参数
}

/** 解析飞书文档 URL */
function parseFeishuUrl(url: string): ParsedUrl {
  const patterns = [
    { regex: /\/wiki\/([a-zA-Z0-9]+)/, type: "wiki" as const },
    { regex: /\/docx\/([a-zA-Z0-9]+)/, type: "docx" as const },
    { regex: /\/sheets\/([a-zA-Z0-9]+)/, type: "sheet" as const },
    { regex: /\/base\/([a-zA-Z0-9]+)/, type: "bitable" as const },
  ];
  
  let result: ParsedUrl = { type: "unknown", token: "" };
  
  for (const { regex, type } of patterns) {
    const match = url.match(regex);
    if (match) {
      result = { type, token: match[1] };
      break;
    }
  }
  
  // 提取 URL 参数中的 table 和 sheet
  try {
    const urlObj = new URL(url);
    const tableId = urlObj.searchParams.get("table");
    const sheetId = urlObj.searchParams.get("sheet");
    if (tableId) result.tableId = tableId;
    if (sheetId) result.sheetId = sheetId;
  } catch {
    // URL 解析失败，忽略参数
  }
  
  return result;
}

// ─── 内部 API 调用 ─────────────────────────────────────────────────────────────

/** 调用 sheets-api (18796) 获取电子表格内容 */
async function fetchSheetContent(token: string): Promise<any> {
  try {
    const sheetsResp = await fetch(`http://127.0.0.1:18796/sheets?token=${token}`);
    const sheetsData = await sheetsResp.json() as any;
    
    if (sheetsData.error) {
      return { error: sheetsData.error };
    }
    
    const sheets = sheetsData.sheets || [];
    if (sheets.length === 0) {
      return { sheets: [], data: [] };
    }
    
    // 读取每个 sheet 的内容（最多前3个）
    const sheetContents = [];
    for (const sheet of sheets.slice(0, 3)) {
      const readResp = await fetch(`http://127.0.0.1:18796/read?token=${token}&sheetId=${sheet.sheetId}`);
      const readData = await readResp.json() as any;
      
      if (!readData.error) {
        // 过滤掉全是 null 的行
        const values = (readData.values || []).filter((row: any[]) => 
          row.some((cell: any) => cell !== null)
        );
        sheetContents.push({
          sheetId: sheet.sheetId,
          title: sheet.title,
          values: values.slice(0, 100),
        });
      }
    }
    
    return { sheets, data: sheetContents };
  } catch (err) {
    return { error: String(err) };
  }
}

/** 调用 bitable-api (18795) 获取多维表格内容 */
async function fetchBitableContent(appToken: string, tableId?: string): Promise<any> {
  try {
    const appResp = await fetch(`http://127.0.0.1:18795/app/${appToken}`);
    const appData = await appResp.json() as any;
    
    if (appData.error) {
      return { error: appData.error };
    }
    
    const tablesResp = await fetch(`http://127.0.0.1:18795/app/${appToken}/tables`);
    const tablesData = await tablesResp.json() as any;
    
    if (tablesData.error) {
      return { error: tablesData.error };
    }
    
    const tables = tablesData.items || [];
    const targetTables = tableId 
      ? tables.filter((t: any) => t.table_id === tableId)
      : tables.slice(0, 3);
    
    const tableContents = [];
    for (const table of targetTables) {
      const fieldsResp = await fetch(`http://127.0.0.1:18795/app/${appToken}/table/${table.table_id}/fields`);
      const fieldsData = await fieldsResp.json() as any;
      
      const recordsResp = await fetch(`http://127.0.0.1:18795/app/${appToken}/table/${table.table_id}/records`);
      const recordsData = await recordsResp.json() as any;
      
      tableContents.push({
        tableId: table.table_id,
        name: table.name,
        fields: fieldsData.items || [],
        records: (recordsData.items || []).slice(0, 100),
        total: recordsData.total || 0,
      });
    }
    
    return { 
      name: appData.name,
      appToken,
      tables: tables.map((t: any) => ({ tableId: t.table_id, name: t.name })),
      data: tableContents,
    };
  } catch (err) {
    return { error: String(err) };
  }
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
    // ─── Status ─────────────────────────────────────────────────────────────
    if (path === "/status") {
      return jsonResponse(res, { status: "ok", service: "docs-router", port: 18798 });
    }

    // ─── URL 解析 ────────────────────────────────────────────────────────────
    if (path === "/parse-url") {
      const docUrl = url.searchParams.get("url");
      if (!docUrl) {
        return errorResponse(res, "url parameter required", 400);
      }
      return jsonResponse(res, parseFeishuUrl(docUrl));
    }

    // ─── Wiki Routes ────────────────────────────────────────────────────────
    if (path === "/wiki/spaces") {
      const spaces = await getWikiSpaces(client);
      return jsonResponse(res, { spaces });
    }

    const spaceMatch = path.match(/^\/wiki\/space\/([^/]+)$/);
    if (spaceMatch) {
      const space = await getWikiSpace(client, spaceMatch[1]);
      return jsonResponse(res, { space });
    }

    const nodesMatch = path.match(/^\/wiki\/nodes\/([^/]+)$/);
    if (nodesMatch) {
      const parentToken = url.searchParams.get("parent") || undefined;
      const nodes = await getWikiNodes(client, nodesMatch[1], parentToken);
      return jsonResponse(res, { nodes });
    }

    if (path === "/wiki/node") {
      const token = url.searchParams.get("token");
      if (!token) {
        return errorResponse(res, "token parameter required", 400);
      }
      const node = await getWikiNode(cfg, token);
      return jsonResponse(res, { node });
    }

    // ─── Docx Routes ────────────────────────────────────────────────────────
    const rawMatch = path.match(/^\/docx\/raw\/([^/]+)$/);
    if (rawMatch) {
      const content = await getDocxRawContent(client, rawMatch[1]);
      return jsonResponse(res, { content });
    }

    const blocksMatch = path.match(/^\/docx\/blocks\/([^/]+)$/);
    if (blocksMatch) {
      const blocks = await getDocxBlocks(client, blocksMatch[1]);
      return jsonResponse(res, { blocks });
    }

    // ─── 统一读取入口 ────────────────────────────────────────────────────────
    if (path === "/read") {
      const docUrl = url.searchParams.get("url");
      if (!docUrl) {
        return errorResponse(res, "url parameter required", 400);
      }
      
      const parsed = parseFeishuUrl(docUrl);
      
      // ── Wiki：需要二级解析 ──
      if (parsed.type === "wiki") {
        const { objType, objToken, title } = await resolveWikiNode(cfg, parsed.token);
        
        if (objType === "docx" || objType === "doc") {
          const content = await getDocxRawContent(client, objToken);
          return jsonResponse(res, { 
            type: "docx",
            source: "wiki",
            wikiToken: parsed.token,
            objToken,
            title,
            content 
          });
        }
        
        if (objType === "sheet") {
          const sheetContent = await fetchSheetContent(objToken);
          return jsonResponse(res, { 
            type: "sheet",
            source: "wiki",
            wikiToken: parsed.token,
            objToken,
            title,
            ...sheetContent
          });
        }
        
        if (objType === "bitable") {
          const bitableContent = await fetchBitableContent(objToken, parsed.tableId);
          return jsonResponse(res, { 
            type: "bitable",
            source: "wiki",
            wikiToken: parsed.token,
            objToken,
            title,
            ...bitableContent
          });
        }
        
        // 未知类型
        return jsonResponse(res, { 
          type: "unknown",
          source: "wiki",
          wikiToken: parsed.token,
          objType,
          objToken,
          title,
          hint: `Unknown object type: ${objType}`
        });
      }
      
      // ── 独立 Docx ──
      if (parsed.type === "docx") {
        const content = await getDocxRawContent(client, parsed.token);
        return jsonResponse(res, { type: "docx", token: parsed.token, content });
      }
      
      // ── 独立 Sheet ──
      if (parsed.type === "sheet") {
        const sheetContent = await fetchSheetContent(parsed.token);
        return jsonResponse(res, { type: "sheet", token: parsed.token, ...sheetContent });
      }
      
      // ── 独立 Bitable (base) ──
      if (parsed.type === "bitable") {
        const bitableContent = await fetchBitableContent(parsed.token, parsed.tableId);
        return jsonResponse(res, { type: "bitable", token: parsed.token, ...bitableContent });
      }
      
      return errorResponse(res, `Unknown document type: ${docUrl}`, 400);
    }

    return errorResponse(res, "Not found", 404);
  } catch (err) {
    console.error("[docs-router] Error:", err);
    return errorResponse(res, String(err));
  }
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

export function startDocsRouter(cfg: FeishuConfig | undefined, log?: (...args: unknown[]) => void) {
  if (!cfg) {
    log?.("[docs-router] Feishu config not found, skipping");
    return;
  }

  const PORT = 18798;
  const client = createClient(cfg);

  server = http.createServer((req, res) => {
    handleRequest(req, res, client, cfg).catch((err) => {
      console.error("[docs-router] Unhandled error:", err);
      errorResponse(res, "Internal server error");
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    log?.(`[docs-router] Docs Router listening on http://127.0.0.1:${PORT}`);
  });
}

export function stopDocsRouter() {
  if (server) {
    server.close();
    server = null;
  }
}

// 保持向后兼容的导出
export { startDocsRouter as startDocsApi, stopDocsRouter as stopDocsApi };
