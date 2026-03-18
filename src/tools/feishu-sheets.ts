/**
 * feishu_sheets — 飞书电子表格工具
 *
 * Actions:
 *   list_sheets — 列出电子表格中所有工作表
 *   read        — 读取指定区间数据（支持合并单元格展开、Excel 日期转换）
 *   find        — 在工作表中搜索文本
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";
import * as Lark from "@larksuiteoapi/node-sdk";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FeishuSheetsSchema = Type.Union([
  Type.Object({
    action: Type.Literal("list_sheets"),
    spreadsheet_token: Type.String({ description: "电子表格 token，可从 URL 中获取：/sheets/<token>" }),
  }),
  Type.Object({
    action: Type.Literal("read"),
    spreadsheet_token: Type.String({ description: "电子表格 token" }),
    sheet_id: Type.String({ description: "工作表 ID（可通过 list_sheets 获取）" }),
    range: Type.String({
      description: "读取区间，A1 表示法，例如 A1:Z100。不带工作表前缀",
    }),
    handle_merges: Type.Optional(
      Type.Boolean({ description: "是否将合并单元格的值填充到所有格，默认 true" }),
    ),
    convert_dates: Type.Optional(
      Type.Boolean({ description: "是否将 Excel 日期序列号转为 YYYY-MM-DD 字符串，默认 true" }),
    ),
  }),
  Type.Object({
    action: Type.Literal("find"),
    spreadsheet_token: Type.String({ description: "电子表格 token" }),
    sheet_id: Type.String({ description: "工作表 ID" }),
    text: Type.String({ description: "要搜索的文本" }),
    regex: Type.Optional(Type.Boolean({ description: "是否使用正则表达式，默认 false" })),
    match_case: Type.Optional(Type.Boolean({ description: "是否区分大小写，默认 false" })),
    include_data: Type.Optional(Type.Boolean({ description: "是否返回匹配行的数据，默认 false" })),
  }),
]);

type FeishuSheetsParams = Static<typeof FeishuSheetsSchema>;

// ─── Helper ───────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

/** Excel 序列号转日期字符串 (YYYY-MM-DD) */
function excelSerialToDate(serial: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString().split("T")[0];
}

/** 判断数字是否像是 Excel 日期序列号（1900-2100 年范围） */
function looksLikeExcelDate(n: number): boolean {
  return Number.isInteger(n) && n > 25569 && n < 73051; // 1970-01-01 ~ 2099-12-31
}

/** 将值中的 Excel 日期序列号转为日期字符串 */
function convertDatesInRow(row: unknown[]): unknown[] {
  return row.map((cell) => {
    if (typeof cell === "number" && looksLikeExcelDate(cell)) {
      return excelSerialToDate(cell);
    }
    return cell;
  });
}

// ─── Sheets API Implementations ───────────────────────────────────────────────

interface SheetMeta {
  sheetId: string;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

async function listSheets(client: Lark.Client, spreadsheetToken: string): Promise<SheetMeta[]> {
  const res = await (client as any).sheets.v3.spreadsheetSheet.query({
    path: { spreadsheet_token: spreadsheetToken },
  });
  if (res.code !== 0) throw new Error(`list_sheets failed: ${res.msg}`);
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

async function getMerges(client: Lark.Client, spreadsheetToken: string, sheetId: string): Promise<MergeInfo[]> {
  const res = await (client as any).sheets.v3.spreadsheetSheet.get({
    path: { spreadsheet_token: spreadsheetToken, sheet_id: sheetId },
  });
  if (res.code !== 0) throw new Error(`getMerges failed: ${res.msg}`);
  return (res.data?.sheet?.merges ?? []).map((m: any) => ({
    startRow: m.start_row_index,
    endRow: m.end_row_index,
    startCol: m.start_column_index,
    endCol: m.end_column_index,
  }));
}

function parseRange(range: string): { startRow: number; endRow: number; startCol: number; endCol: number } {
  const [start, end] = range.split(":");
  const parseCell = (cell: string) => {
    const colMatch = cell.match(/[A-Z]+/);
    const rowMatch = cell.match(/[0-9]+/);
    let col = 0;
    if (colMatch) {
      for (let i = 0; i < colMatch[0].length; i++) {
        col = col * 26 + (colMatch[0].charCodeAt(i) - 64);
      }
      col -= 1;
    }
    return { row: rowMatch ? parseInt(rowMatch[0]) - 1 : 0, col };
  };
  const s = parseCell(start);
  const e = end ? parseCell(end) : s;
  return { startRow: s.row, endRow: e.row, startCol: s.col, endCol: e.col };
}

async function readRange(
  client: Lark.Client,
  spreadsheetToken: string,
  sheetId: string,
  rangeStr: string,
): Promise<unknown[][]> {
  const fullRange = `${sheetId}!${rangeStr}`;
  const res = await (client as any).sheets.v2.spreadsheetValuesGet({
    path: { spreadsheetToken, range: fullRange },
    params: { valueRenderOption: "ToString" },
  });
  if (res.code !== 0) throw new Error(`read range failed: ${res.msg}`);
  return res.data?.valueRange?.values ?? [];
}

async function readWithMerges(
  client: Lark.Client,
  spreadsheetToken: string,
  sheetId: string,
  rangeStr: string,
  handleMerges: boolean,
  convertDates: boolean,
): Promise<unknown[][]> {
  let values = await readRange(client, spreadsheetToken, sheetId, rangeStr);

  if (handleMerges && values.length > 0) {
    const merges = await getMerges(client, spreadsheetToken, sheetId);
    if (merges.length > 0) {
      const { startRow: rangeStartRow, startCol: rangeStartCol } = parseRange(rangeStr);
      const result = values.map((row) => [...row]);

      for (const merge of merges) {
        const iStartRow = Math.max(merge.startRow, rangeStartRow);
        const iEndRow = Math.min(merge.endRow, rangeStartRow + values.length - 1);
        const iStartCol = Math.max(merge.startCol, rangeStartCol);
        const iEndCol = Math.min(merge.endCol, rangeStartCol + (values[0]?.length ?? 0) - 1);

        if (iStartRow > iEndRow || iStartCol > iEndCol) continue;

        const srcRow = iStartRow - rangeStartRow;
        const srcCol = iStartCol - rangeStartCol;
        const srcVal = result[srcRow]?.[srcCol];

        for (let r = iStartRow; r <= iEndRow; r++) {
          for (let c = iStartCol; c <= iEndCol; c++) {
            const ri = r - rangeStartRow;
            const ci = c - rangeStartCol;
            if (ri !== srcRow || ci !== srcCol) {
              if (!result[ri]) result[ri] = [];
              result[ri][ci] = srcVal;
            }
          }
        }
      }
      values = result;
    }
  }

  if (convertDates) {
    values = values.map(convertDatesInRow);
  }

  return values;
}

async function findInSheet(
  client: Lark.Client,
  spreadsheetToken: string,
  sheetId: string,
  text: string,
  opts: { regex?: boolean; matchCase?: boolean; includeData?: boolean },
): Promise<{ matchedCells: string[]; rows: number[]; rowsCount: number; data?: unknown[][] }> {
  // 获取 tenant_access_token（通过 SDK 内部的 token manager）
  const token = await (client as any).tokenManager.getTenantAccessToken();
  const apiUrl = `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/${sheetId}/find`;

  const httpRes = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      find_condition: {
        range: `${sheetId}!A1:Z1000`,
        match_case: opts.matchCase ?? false,
        match_entire_cell: false,
        search_by_regex: opts.regex ?? false,
      },
      find: text,
    }),
  });

  const res = (await httpRes.json()) as {
    code: number;
    msg: string;
    data?: { find_result?: { matched_cells?: string[]; rows?: number[]; rows_count?: number } };
  };
  if (res.code !== 0) throw new Error(`find failed: ${res.msg}`);

  const findResult = res.data?.find_result;
  const rows: number[] = findResult?.rows ?? [];
  const matchedCells: string[] = findResult?.matched_cells ?? [];

  let data: unknown[][] | undefined;
  if (opts.includeData && rows.length > 0) {
    const uniqueRows = Array.from(new Set(rows)).sort((a, b) => a - b);
    const minRow = uniqueRows[0];
    const maxRow = uniqueRows[uniqueRows.length - 1];
    const allValues = await readRange(client, spreadsheetToken, sheetId, `A${minRow + 1}:Z${maxRow + 1}`);
    data = uniqueRows.map((r) => (allValues[r - minRow] as unknown[]) || []);
  }

  return { matchedCells, rows, rowsCount: findResult?.rows_count ?? 0, data };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerFeishuSheetsTool(api: ClawdbotPluginApi) {
  api.registerTool(
    (ctx) => {
      const feishuCfg = ctx.config?.channels?.feishu as FeishuConfig | undefined;
      const creds = resolveFeishuCredentials(feishuCfg);
      if (!creds) return null;

      const client = createFeishuClient(feishuCfg!);

      return {
        name: "feishu_sheets",
        label: "Feishu Sheets",
        description:
          "飞书电子表格操作。" +
          "Actions: list_sheets（列出工作表）、read（读取区间数据，支持合并单元格和日期转换）、" +
          "find（搜索文本，支持正则）",
        parameters: FeishuSheetsSchema,
        async execute(_id, params: FeishuSheetsParams) {
          try {
            switch (params.action) {
              case "list_sheets":
                return json(await listSheets(client, params.spreadsheet_token));
              case "read": {
                const values = await readWithMerges(
                  client,
                  params.spreadsheet_token,
                  params.sheet_id,
                  params.range,
                  params.handle_merges ?? true,
                  params.convert_dates ?? true,
                );
                return json({ range: params.range, values });
              }
              case "find":
                return json(
                  await findInSheet(client, params.spreadsheet_token, params.sheet_id, params.text, {
                    regex: params.regex,
                    matchCase: params.match_case,
                    includeData: params.include_data,
                  }),
                );
              default:
                return json({ error: `Unknown action: ${(params as any).action}` });
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "feishu_sheets" },
  );
}
