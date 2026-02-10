/**
 * 飞书电子表格 HTTP API
 * 监听 localhost:18796，供 Agent 调用
 *
 * 功能：
 * - 读取电子表格数据
 * - 处理合并单元格
 * - Excel 日期序列号转换
 * - 支持 wiki URL 解析
 */

import * as http from 'node:http';
import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from '../types.js';

const PORT = 18796;
let server: http.Server | null = null;
let client: Lark.Client | null = null;

// ============ Helpers ============

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function errorResponse(res: http.ServerResponse, message: string, status = 400): void {
  jsonResponse(res, { error: message }, status);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return null;
  }
}

// ============ Excel Date Utils ============

/** Excel 序列号转日期字符串 (YYYY-MM-DD) */
function excelSerialToDate(serial: number): string {
  // Excel 日期以 1899-12-30 为 day 0（因为 Excel 错误地认为 1900 是闰年）
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString().split('T')[0];
}

/** 日期字符串转 Excel 序列号 */
function dateToExcelSerial(dateStr: string): number {
  const date = new Date(dateStr);
  const excelEpoch = new Date(1899, 11, 30);
  return Math.round((date.getTime() - excelEpoch.getTime()) / (24 * 60 * 60 * 1000));
}

/** 今天的 Excel 序列号 */
function todaySerial(): number {
  return dateToExcelSerial(new Date().toISOString().split('T')[0]);
}

// ============ URL Parser ============

interface ParsedSheetUrl {
  spreadsheetToken: string;
  sheetId?: string;
  isWiki: boolean;
  wikiToken?: string;
}

/** 解析飞书电子表格 URL */
function parseSheetUrl(url: string): ParsedSheetUrl | null {
  try {
    const u = new URL(url);
    const sheetId = u.searchParams.get('sheet') ?? undefined;

    // Wiki 格式: /wiki/XXXXX?sheet=YYY
    const wikiMatch = u.pathname.match(/\/wiki\/([A-Za-z0-9]+)/);
    if (wikiMatch) {
      return {
        spreadsheetToken: '', // 需要通过 API 解析
        sheetId,
        isWiki: true,
        wikiToken: wikiMatch[1],
      };
    }

    // 直接 Sheets 格式: /sheets/XXXXX?sheet=YYY
    const sheetsMatch = u.pathname.match(/\/sheets\/([A-Za-z0-9]+)/);
    if (sheetsMatch) {
      return {
        spreadsheetToken: sheetsMatch[1],
        sheetId,
        isWiki: false,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** 从 wiki token 解析出实际的 spreadsheet token */
async function resolveWikiToSpreadsheet(wikiToken: string): Promise<string> {
  if (!client) throw new Error('Client not initialized');

  const res = await (client as any).wiki.v2.space.getNode({
    params: { token: wikiToken },
  });

  if (res.code !== 0) {
    throw new Error(`Failed to resolve wiki: ${res.msg}`);
  }

  const node = res.data?.node;
  if (!node) {
    throw new Error('Wiki node not found');
  }

  if (node.obj_type !== 'sheet') {
    throw new Error(`Wiki node is not a sheet (type: ${node.obj_type})`);
  }

  return node.obj_token;
}

// ============ Core Functions ============

interface SheetMeta {
  sheetId: string;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

/** 获取电子表格所有 sheet 列表 */
async function listSheets(spreadsheetToken: string): Promise<SheetMeta[]> {
  if (!client) throw new Error('Client not initialized');

  const res = await (client as any).sheets.v3.spreadsheetSheet.query({
    path: { spreadsheet_token: spreadsheetToken },
  });

  if (res.code !== 0) {
    throw new Error(`Failed to list sheets: ${res.msg}`);
  }

  return (res.data?.sheets ?? []).map((s: any) => ({
    sheetId: s.sheet_id,
    title: s.title,
    rowCount: s.grid_properties?.row_count,
    columnCount: s.grid_properties?.column_count,
  }));
}

interface MergeInfo {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

/** 获取合并单元格信息 */
async function getMerges(spreadsheetToken: string, sheetId: string): Promise<MergeInfo[]> {
  if (!client) throw new Error('Client not initialized');

  const res = await (client as any).sheets.v3.spreadsheetSheet.get({
    path: { spreadsheet_token: spreadsheetToken, sheet_id: sheetId },
  });

  if (res.code !== 0) {
    throw new Error(`Failed to get sheet info: ${res.msg}`);
  }

  return (res.data?.sheet?.merges ?? []).map((m: any) => ({
    startRow: m.start_row_index,
    endRow: m.end_row_index,
    startCol: m.start_column_index,
    endCol: m.end_column_index,
  }));
}

/** 搜索单元格内容 */
async function findInSheet(
  spreadsheetToken: string,
  sheetId: string,
  searchText: string,
  range?: string, // e.g., "B1:B200"，如果不传则搜索整个 sheet
): Promise<{ matchedCells: string[]; rowsCount: number }> {
  if (!client) throw new Error('Client not initialized');

  // range 如果已经带了 sheet_id 前缀就直接用，否则加上
  const fullRange = range
    ? (range.includes('!') ? range : `${sheetId}!${range}`)
    : sheetId;

  // 直接用 SDK 的 sheets.v3.spreadsheetSheet.find
  try {
    const res = await (client as any).sheets.v3.spreadsheetSheet.find({
      path: { spreadsheet_token: spreadsheetToken, sheet_id: sheetId },
      data: {
        find_condition: {
          range: fullRange,
        },
        find: searchText,
      },
    });

    if (res.code !== 0) {
      throw new Error(`Find failed: ${res.msg}`);
    }

    return {
      matchedCells: res.data?.find_result?.matched_cells ?? [],
      rowsCount: res.data?.find_result?.rows_count ?? 0,
    };
  } catch (err) {
    console.error('[sheets-api] findInSheet error:', err);
    throw err;
  }
}

/** 读取指定范围的数据 */
async function readRange(
  spreadsheetToken: string,
  sheetId: string,
  range: string, // e.g., "A1:Z50" or "A1" or "A:Z"
): Promise<unknown[][]> {
  if (!client) throw new Error('Client not initialized');

  const fullRange = `${sheetId}!${range}`;
  const encodedRange = encodeURIComponent(fullRange);

  // 使用 SDK 的 request 方法（自动处理认证）
  const res = await (client as any).request({
    method: 'GET',
    url: `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodedRange}`,
  }) as { code: number; msg?: string; data?: { valueRange?: { values?: unknown[][] } } };

  if (res.code !== 0) {
    throw new Error(`Failed to read range: ${res.msg}`);
  }

  return res.data?.valueRange?.values ?? [];
}

/** 读取单个单元格（考虑合并单元格） */
async function readCell(
  spreadsheetToken: string,
  sheetId: string,
  row: number, // 0-indexed
  col: number, // 0-indexed
  merges?: MergeInfo[],
): Promise<{ value: unknown; fromMerge: boolean; mergeRange?: string }> {
  // 如果没提供 merges，先获取
  const mergeList = merges ?? await getMerges(spreadsheetToken, sheetId);

  // 检查是否在合并单元格内
  for (const m of mergeList) {
    if (row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol) {
      // 在合并单元格内，读取左上角的值
      const colLetter = String.fromCharCode(65 + m.startCol);
      const cellRef = `${colLetter}${m.startRow + 1}`;
      const range = `${cellRef}:${cellRef}`; // 飞书 API 需要范围格式
      const values = await readRange(spreadsheetToken, sheetId, range);
      return {
        value: values[0]?.[0] ?? null,
        fromMerge: true,
        mergeRange: `${String.fromCharCode(65 + m.startCol)}${m.startRow + 1}:${String.fromCharCode(65 + m.endCol)}${m.endRow + 1}`,
      };
    }
  }

  // 不在合并单元格内，直接读取
  const colLetter = String.fromCharCode(65 + col);
  const cellRef = `${colLetter}${row + 1}`;
  const range = `${cellRef}:${cellRef}`; // 飞书 API 需要范围格式
  const values = await readRange(spreadsheetToken, sheetId, range);
  return {
    value: values[0]?.[0] ?? null,
    fromMerge: false,
  };
}

/** 在表格中查找某个值所在的行 */
async function findRowByValue(
  spreadsheetToken: string,
  sheetId: string,
  searchCol: number, // 搜索哪一列
  searchValue: string,
  startRow = 0,
  endRow = 500,
): Promise<number | null> {
  const colLetter = String.fromCharCode(65 + searchCol);
  const range = `${colLetter}${startRow + 1}:${colLetter}${endRow + 1}`;
  const values = await readRange(spreadsheetToken, sheetId, range);

  for (let i = 0; i < values.length; i++) {
    const cellValue = values[i]?.[0];
    if (cellValue && String(cellValue).includes(searchValue)) {
      return startRow + i;
    }
  }
  return null;
}

/** 在表格头部查找某个日期对应的列 */
async function findColByDate(
  spreadsheetToken: string,
  sheetId: string,
  dateSerial: number,
  headerRow = 0,
  startCol = 0,
  endCol = 50,
): Promise<number | null> {
  const startLetter = String.fromCharCode(65 + startCol);
  const endLetter = String.fromCharCode(65 + Math.min(endCol, 25)); // 最多到 Z
  const range = `${startLetter}${headerRow + 1}:${endLetter}${headerRow + 1}`;
  const values = await readRange(spreadsheetToken, sheetId, range);

  if (!values[0]) return null;

  for (let i = 0; i < values[0].length; i++) {
    const cellValue = values[0][i];
    if (cellValue === dateSerial) {
      return startCol + i;
    }
  }
  return null;
}

// ============ Request Handler ============

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!client) {
    errorResponse(res, 'Client not initialized', 503);
    return;
  }

  try {
    // ==================== 状态 ====================

    if (path === '/status' && req.method === 'GET') {
      jsonResponse(res, {
        ok: true,
        service: 'feishu-sheets-api',
        port: PORT,
        today: new Date().toISOString().split('T')[0],
        todaySerial: todaySerial(),
      });
      return;
    }

    // ==================== 日期转换 ====================

    if (path === '/date/to-serial' && req.method === 'GET') {
      const date = query.date as string;
      if (!date) {
        errorResponse(res, 'Missing date parameter (YYYY-MM-DD)');
        return;
      }
      jsonResponse(res, {
        date,
        serial: dateToExcelSerial(date),
      });
      return;
    }

    if (path === '/date/from-serial' && req.method === 'GET') {
      const serial = parseInt(query.serial as string);
      if (isNaN(serial)) {
        errorResponse(res, 'Missing or invalid serial parameter');
        return;
      }
      jsonResponse(res, {
        serial,
        date: excelSerialToDate(serial),
      });
      return;
    }

    // ==================== URL 解析 ====================

    if (path === '/parse-url' && req.method === 'GET') {
      const sheetUrl = query.url as string;
      if (!sheetUrl) {
        errorResponse(res, 'Missing url parameter');
        return;
      }

      const parsed = parseSheetUrl(sheetUrl);
      if (!parsed) {
        errorResponse(res, 'Invalid sheet URL format');
        return;
      }

      // 如果是 wiki URL，解析出实际的 spreadsheet token
      if (parsed.isWiki && parsed.wikiToken) {
        const spreadsheetToken = await resolveWikiToSpreadsheet(parsed.wikiToken);
        jsonResponse(res, {
          ...parsed,
          spreadsheetToken,
        });
        return;
      }

      jsonResponse(res, parsed);
      return;
    }

    // ==================== Sheet 列表 ====================

    if (path === '/sheets' && req.method === 'GET') {
      const token = query.token as string;
      if (!token) {
        errorResponse(res, 'Missing token parameter (spreadsheet token)');
        return;
      }

      const sheets = await listSheets(token);
      jsonResponse(res, { sheets });
      return;
    }

    // ==================== 读取数据 ====================

    if (path === '/read' && req.method === 'GET') {
      const token = query.token as string;
      const sheetId = query.sheetId as string;
      const range = query.range as string || 'A1:Z50';

      if (!token || !sheetId) {
        errorResponse(res, 'Missing token or sheetId parameter');
        return;
      }

      const values = await readRange(token, sheetId, range);

      // 如果请求了日期转换
      const convertDates = query.convertDates === 'true';
      if (convertDates && values.length > 0) {
        // 假设第一行是日期头
        values[0] = values[0].map((v: unknown) => {
          if (typeof v === 'number' && v > 40000 && v < 60000) {
            return { serial: v, date: excelSerialToDate(v) };
          }
          return v;
        });
      }

      jsonResponse(res, {
        range: `${sheetId}!${range}`,
        rowCount: values.length,
        colCount: values[0]?.length ?? 0,
        values,
      });
      return;
    }

    // ==================== 搜索 ====================

    if (path === '/find' && req.method === 'GET') {
      const token = query.token as string;
      const sheetId = query.sheetId as string;
      const text = query.text as string;
      const range = query.range as string; // 可选

      if (!token || !sheetId || !text) {
        errorResponse(res, 'Missing token, sheetId, or text parameter');
        return;
      }

      const result = await findInSheet(token, sheetId, text, range);
      jsonResponse(res, result);
      return;
    }

    // ==================== 合并单元格 ====================

    if (path === '/merges' && req.method === 'GET') {
      const token = query.token as string;
      const sheetId = query.sheetId as string;

      if (!token || !sheetId) {
        errorResponse(res, 'Missing token or sheetId parameter');
        return;
      }

      const merges = await getMerges(token, sheetId);
      jsonResponse(res, { merges, count: merges.length });
      return;
    }

    // ==================== 智能查询 ====================

    if (path === '/query' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) {
        errorResponse(res, 'Invalid JSON body');
        return;
      }

      const token = body.token as string;
      const sheetId = body.sheetId as string;
      const name = body.name as string; // 人名
      const date = body.date as string; // YYYY-MM-DD，默认今天
      const nameCol = (body.nameCol as number) ?? 1; // 人名在哪列，默认 B 列 (index 1)
      const dateRow = (body.dateRow as number) ?? 0; // 日期在哪行，默认第 1 行 (index 0)

      if (!token || !sheetId || !name) {
        errorResponse(res, 'Missing required fields: token, sheetId, name');
        return;
      }

      const targetDate = date || new Date().toISOString().split('T')[0];
      const targetSerial = dateToExcelSerial(targetDate);

      // 1. 找人名所在的行
      const nameRow = await findRowByValue(token, sheetId, nameCol, name);
      if (nameRow === null) {
        jsonResponse(res, {
          found: false,
          error: `Name "${name}" not found in column ${String.fromCharCode(65 + nameCol)}`,
        });
        return;
      }

      // 2. 找日期所在的列
      const dateCol = await findColByDate(token, sheetId, targetSerial, dateRow);
      if (dateCol === null) {
        jsonResponse(res, {
          found: false,
          error: `Date ${targetDate} (serial ${targetSerial}) not found in row ${dateRow + 1}`,
        });
        return;
      }

      // 3. 获取合并单元格信息
      const merges = await getMerges(token, sheetId);

      // 4. 读取交叉点的值（考虑合并单元格）
      // 同时读取人名下面几行的内容（因为一个人可能有多行任务）
      const results: { row: number; value: unknown; fromMerge: boolean; mergeRange?: string }[] = [];

      // 往下读最多 5 行，直到遇到另一个人名
      for (let r = nameRow; r < nameRow + 10; r++) {
        // 检查这一行 B 列是否有新的人名（跳过第一行）
        if (r > nameRow) {
          const checkName = await readCell(token, sheetId, r, nameCol, merges);
          if (checkName.value && String(checkName.value).trim()) {
            // 遇到新人名，停止
            break;
          }
        }

        const cell = await readCell(token, sheetId, r, dateCol, merges);
        if (cell.value !== null && cell.value !== undefined) {
          results.push({
            row: r + 1, // 转为 1-indexed
            ...cell,
          });
        }
      }

      jsonResponse(res, {
        found: true,
        name,
        date: targetDate,
        dateSerial: targetSerial,
        nameRow: nameRow + 1,
        dateCol: String.fromCharCode(65 + dateCol),
        tasks: results,
      });
      return;
    }

    // ==================== 404 ====================

    errorResponse(res, `Unknown endpoint: ${req.method} ${path}`, 404);

  } catch (err) {
    console.error('[sheets-api] Error:', err);
    errorResponse(res, String(err), 500);
  }
}

// ============ Lifecycle ============

export async function startSheetsApi(cfg: FeishuConfig, log?: (msg: string) => void): Promise<void> {
  const logger = log ?? console.log;

  if (server) {
    logger('[sheets-api] Already running');
    return;
  }

  client = new Lark.Client({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    domain: cfg.domain ?? Lark.Domain.Feishu,
  });

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[sheets-api] Unhandled error:', err);
      errorResponse(res, 'Internal server error', 500);
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    logger(`[sheets-api] Listening on http://127.0.0.1:${PORT}`);
  });
}

export async function stopSheetsApi(): Promise<void> {
  if (server) {
    server.close();
    server = null;
    client = null;
    console.log('[sheets-api] Stopped');
  }
}
