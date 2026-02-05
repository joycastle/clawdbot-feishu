/**
 * Bitable Video - read video attachments from Feishu Bitable (多维表格).
 *
 * Reads records from any Feishu bitable table that contains attachment fields.
 * Supports user-specified tables via URL, or the default configured table.
 * Finds video attachments automatically by scanning all attachment-type fields.
 */

import type { FeishuConfig } from "../types.js";
import { createFeishuClient } from "../client.js";
import { Readable } from "node:stream";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BitableAttachment {
  file_token: string;
  name: string;
  size: number;
  type: string; // mime type
  tmp_url?: string;
  url?: string;
}

export interface BitableRecord {
  record_id: string;
  /** Auto-number field value */
  autoNumber: number | string;
  /** Attachment list */
  attachments: BitableAttachment[];
}

export interface BitableVideoConfig {
  appToken: string;
  tableToken: string;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_APP_TOKEN = "OW7lbIpSlaf4nEsiDKLcqiYGn7c";
const DEFAULT_TABLE_TOKEN = "tblPFJHzLTyXMGcJ";

/** Resolve bitable config from feishu channel config, falling back to defaults. */
export function resolveBitableConfig(cfg: any): BitableVideoConfig {
  const feishuCfg = cfg?.channels?.feishu as Record<string, unknown> | undefined;
  return {
    appToken: (feishuCfg?.bitableAppToken as string) || DEFAULT_APP_TOKEN,
    tableToken: (feishuCfg?.bitableTableToken as string) || DEFAULT_TABLE_TOKEN,
  };
}

/**
 * Parse a Feishu bitable URL to extract appToken and tableToken.
 *
 * Supported formats:
 *   https://xxx.feishu.cn/base/OW7lbIpSlaf4nEsiDKLcqiYGn7c?table=tblPFJHzLTyXMGcJ&view=...
 *   https://xxx.feishu.cn/wiki/... (wiki-embedded bitable)
 *   Shorthand: just the appToken string (e.g. "OW7lbIpSlaf4nEsiDKLcqiYGn7c")
 */
export function parseBitableUrl(urlOrToken: string): BitableVideoConfig | null {
  // Try full URL
  const urlMatch = urlOrToken.match(/\/base\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    const appToken = urlMatch[1];
    const tableMatch = urlOrToken.match(/[?&]table=([A-Za-z0-9]+)/);
    const tableToken = tableMatch?.[1] ?? "";
    return { appToken, tableToken };
  }

  // Try bare appToken (alphanumeric, typically 20+ chars)
  if (/^[A-Za-z0-9]{15,}$/.test(urlOrToken.trim())) {
    return { appToken: urlOrToken.trim(), tableToken: "" };
  }

  return null;
}

// ─── Parse user command ──────────────────────────────────────────────────────

export interface VideoCommand {
  /** "latest", a specific auto-number, or "row:N" for Nth record by position */
  target: "latest" | number | `row:${number}`;
  /** User's analysis prompt (the text after the video reference) */
  prompt: string;
  /** Optional: user-specified bitable URL or appToken to override default table */
  bitableUrl?: string;
}

/**
 * Parse video command from user message using regex templates.
 *
 * @deprecated This function uses hard-coded regex to parse natural language,
 * which is fragile and can't handle the variety of user expressions.
 * The LLM agent now handles intent recognition and constructs VideoCommand
 * directly via src/big-video/bitable-video-cli.ts with structured --target/--prompt args.
 * Kept for backward compatibility only.
 *
 * Previously supported formats:
 *   "视频：最新，请分析一下"
 *   "视频：最新的，帮我看看"
 *   "视频：编号3，请分析"
 *   "视频：编号为3的，请分析"
 *   "视频：3，请分析"
 *   "视频：3号，请分析"
 */
export function parseVideoCommand(text: string): VideoCommand | null {
  // Match "视频：" or "视频:" prefix
  const match = text.match(/^视频[：:]\s*(.+)$/s);
  if (!match) return null;

  const rest = match[1].trim();

  // Match "最新" (latest)
  const latestMatch = rest.match(/^最新(?:的)?[，,]?\s*(.*)$/s);
  if (latestMatch) {
    return { target: "latest", prompt: latestMatch[1].trim() || "请分析这个视频的内容" };
  }

  // Match "编号X" or "编号为X" or just a number
  const numMatch = rest.match(/^(?:编号(?:为)?)?(\d+)(?:号|的)?[，,]?\s*(.*)$/s);
  if (numMatch) {
    return {
      target: parseInt(numMatch[1], 10),
      prompt: numMatch[2].trim() || "请分析这个视频的内容",
    };
  }

  return null;
}

// ─── Bitable API ─────────────────────────────────────────────────────────────

/**
 * Auto-resolve tableToken when only appToken is provided.
 * Lists all tables in the bitable and returns the first one.
 */
export async function resolveTableToken(params: {
  cfg: any;
  appToken: string;
}): Promise<string> {
  const feishuCfg = params.cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) throw new Error("Feishu channel not configured");

  const client = createFeishuClient(feishuCfg);
  const response = await (client.bitable.appTable as any).list({
    path: { app_token: params.appToken },
    params: { page_size: 1 },
  });

  if (response.code !== 0) {
    throw new Error(`无法读取该多维表格（可能没有权限或链接无效）: ${response.msg || `code ${response.code}`}`);
  }

  const tables = response.data?.items ?? [];
  if (tables.length === 0) {
    throw new Error("多维表格中没有找到数据表");
  }

  return tables[0].table_id as string;
}

/**
 * Ensure config has a valid tableToken. If missing, auto-resolve it.
 */
export async function ensureTableToken(params: {
  cfg: any;
  config: BitableVideoConfig;
}): Promise<BitableVideoConfig> {
  if (params.config.tableToken) return params.config;
  const tableToken = await resolveTableToken({ cfg: params.cfg, appToken: params.config.appToken });
  return { ...params.config, tableToken };
}

/**
 * Fetch records from a bitable table.
 * Auto-detects attachment fields and video files.
 * Returns records sorted by auto-number descending (latest first), or by position.
 */
export async function fetchBitableRecords(params: {
  cfg: any;
  config?: BitableVideoConfig;
  limit?: number;
}): Promise<BitableRecord[]> {
  const { cfg } = params;
  let btConfig = params.config ?? resolveBitableConfig(params.cfg);
  btConfig = await ensureTableToken({ cfg, config: btConfig });
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) throw new Error("Feishu channel not configured");

  const client = createFeishuClient(feishuCfg);

  const response = await (client.bitable.appTableRecord as any).search({
    path: {
      app_token: btConfig.appToken,
      table_id: btConfig.tableToken,
    },
    params: {
      page_size: params.limit ?? 10,
    },
    data: {
      automatic_fields: true,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Bitable search failed: ${response.msg || `code ${response.code}`}`);
  }

  const items = response.data?.items ?? [];
  const records: BitableRecord[] = [];

  for (const item of items) {
    const fields = item.fields ?? {};
    let attachments: BitableAttachment[] = [];
    let autoNumber: number | string = 0;

    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value) && value.length > 0 && (value[0] as any)?.file_token) {
        attachments = value as BitableAttachment[];
      }
      if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
        const numVal = typeof value === "number" ? value : parseInt(value, 10);
        if (numVal > 0 && numVal < 1_000_000) {
          autoNumber = numVal;
        }
      }
    }

    records.push({
      record_id: item.record_id,
      autoNumber,
      attachments,
    });
  }

  records.sort((a, b) => {
    const na = typeof a.autoNumber === "number" ? a.autoNumber : parseInt(String(a.autoNumber), 10) || 0;
    const nb = typeof b.autoNumber === "number" ? b.autoNumber : parseInt(String(b.autoNumber), 10) || 0;
    return nb - na;
  });

  return records;
}

export async function clearAllBitableRecords(params: {
  cfg: any;
  config?: BitableVideoConfig;
}): Promise<{ deleted: number; total: number; batches: number }> {
  const { cfg } = params;
  const btConfig = params.config ?? resolveBitableConfig(params.cfg);
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) throw new Error("Feishu channel not configured");

  const client = createFeishuClient(feishuCfg);

  const recordIds: string[] = [];
  let pageToken: string | undefined;

  while (true) {
    const response = await (client.bitable.appTableRecord as any).search({
      path: {
        app_token: btConfig.appToken,
        table_id: btConfig.tableToken,
      },
      params: {
        page_size: 200,
        page_token: pageToken,
      },
      data: {},
    });

    if (response.code !== 0) {
      throw new Error(`Bitable search failed: ${response.msg || `code ${response.code}`}`);
    }

    const items = response.data?.items ?? [];
    for (const item of items) {
      const id = item.record_id as string | undefined;
      if (id) recordIds.push(id);
    }

    if (!response.data?.has_more) break;
    const nextToken = response.data?.page_token as string | undefined;
    if (!nextToken) break;
    pageToken = nextToken;
  }

  const total = recordIds.length;
  if (total === 0) return { deleted: 0, total: 0, batches: 0 };

  const chunkSize = 500;
  let deleted = 0;
  let batches = 0;

  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    batches += 1;

    const delResp = await (client.bitable.appTableRecord as any).batchDelete({
      path: {
        app_token: btConfig.appToken,
        table_id: btConfig.tableToken,
      },
      data: {
        records: chunk,
      },
    });

    if (delResp.code !== 0) {
      throw new Error(`Bitable batchDelete failed: ${delResp.msg || `code ${delResp.code}`}`);
    }

    const results = delResp.data?.records ?? [];
    if (Array.isArray(results) && results.length > 0) {
      deleted += results.filter((r: any) => r?.deleted).length;
    } else {
      deleted += chunk.length;
    }
  }

  return { deleted, total, batches };
}

/**
 * Find a specific record by target.
 *
 * Target types:
 *   - "latest": most recently created record with video attachment
 *   - number: match by auto-number field value
 *   - "row:N": Nth record by position (1-based)
 */
export async function findVideoRecord(params: {
  cfg: any;
  target: "latest" | number | `row:${number}`;
  config?: BitableVideoConfig;
}): Promise<{ record: BitableRecord; attachment: BitableAttachment } | null> {
  const isRow = typeof params.target === "string" && params.target.startsWith("row:");
  const rowIndex = isRow ? parseInt(params.target.slice(4), 10) : 0;

  const records = await fetchBitableRecords({
    cfg: params.cfg,
    config: params.config,
    limit: params.target === "latest" ? 1 : isRow ? Math.max(rowIndex, 10) : 100,
  });

  if (records.length === 0) return null;

  // Filter to records with video attachments
  const withVideo = records.filter((r) =>
    r.attachments.some((a) => a.type?.startsWith("video/") || a.name?.match(/\.(mp4|mov|avi|mkv|webm|flv)$/i)),
  );

  let record: BitableRecord | undefined;

  if (params.target === "latest") {
    record = withVideo[0] || records[0]; // prefer records with video, fallback to any
  } else if (isRow) {
    // row:N is 1-based position
    record = (rowIndex > 0 && rowIndex <= withVideo.length) ? withVideo[rowIndex - 1]
      : (rowIndex > 0 && rowIndex <= records.length) ? records[rowIndex - 1]
      : undefined;
  } else {
    // Match by auto-number
    record = records.find((r) => {
      const num = typeof r.autoNumber === "number"
        ? r.autoNumber
        : parseInt(String(r.autoNumber), 10);
      return num === params.target;
    });
  }

  if (!record || record.attachments.length === 0) return null;

  // Find the first video attachment
  const videoAtt = record.attachments.find((a) =>
    a.type?.startsWith("video/") || a.name?.match(/\.(mp4|mov|avi|mkv|webm|flv)$/i),
  ) || record.attachments[0];

  return { record, attachment: videoAtt };
}

// ─── Download attachment ─────────────────────────────────────────────────────

/**
 * Download a bitable attachment as a readable stream.
 * Uses the Drive media download API (not the IM message resource API).
 *
 * For bitable attachments with advanced permissions, we need the extra parameter.
 */
export async function downloadBitableAttachment(params: {
  cfg: any;
  fileToken: string;
  config?: BitableVideoConfig;
}): Promise<{ stream: Readable; contentType: string }> {
  const { cfg, fileToken } = params;
  const btConfig = params.config ?? resolveBitableConfig(params.cfg);
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) throw new Error("Feishu channel not configured");

  createFeishuClient(feishuCfg);

  const extra = JSON.stringify({
    bitablePerm: {
      tableId: btConfig.tableToken,
    },
  });

  const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: feishuCfg.appId, app_secret: feishuCfg.appSecret }),
  });

  if (!tokenResp.ok) {
    throw new Error(`Failed to get tenant_access_token: ${tokenResp.status}`);
  }

  const tokenData = (await tokenResp.json()) as { tenant_access_token?: string; code?: number };
  if (!tokenData.tenant_access_token) {
    throw new Error(`tenant_access_token not returned: code ${tokenData.code}`);
  }

  const downloadUrl = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download?extra=${encodeURIComponent(extra)}`;

  const downloadResp = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` },
  });

  if (!downloadResp.ok) {
    const errText = await downloadResp.text().catch(() => "");
    throw new Error(`Drive media download failed: ${downloadResp.status} ${errText}`);
  }

  const contentType = downloadResp.headers.get("content-type") ?? "video/mp4";

  if (!downloadResp.body) {
    throw new Error("Drive media download: no response body");
  }

  const nodeStream = Readable.fromWeb(downloadResp.body as ReadableStream<any>);

  return { stream: nodeStream, contentType };
}
