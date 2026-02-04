/**
 * Bitable Video — read video attachments from Feishu Bitable (多维表格).
 *
 * Reads records from a configured bitable table, downloads video attachments
 * via the Drive media API, and streams them through the GCS upload pipeline.
 *
 * Table structure: auto-number + attachment (two fields only).
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
 
const DEFAULT_CONFIG: BitableVideoConfig = {
  appToken: "OW7lbIpSlaf4nEsiDKLcqiYGn7c",
  tableToken: "tblPFJHzLTyXMGcJ",
};
 
// ─── Parse user command ──────────────────────────────────────────────────────
 
export interface VideoCommand {
  /** "latest" or a specific auto-number */
  target: "latest" | number;
  /** User's analysis prompt (the text after the video reference) */
  prompt: string;
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
 * Fetch records from the video bitable table.
 * Returns records sorted by auto-number descending (latest first).
 */
export async function fetchBitableRecords(params: {
  cfg: any;
  config?: BitableVideoConfig;
  limit?: number;
}): Promise<BitableRecord[]> {
  const { cfg } = params;
  const btConfig = params.config ?? DEFAULT_CONFIG;
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
  const btConfig = params.config ?? DEFAULT_CONFIG;
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
 * Find a specific record by target (latest or auto-number).
 */
export async function findVideoRecord(params: {
  cfg: any;
  target: "latest" | number;
  config?: BitableVideoConfig;
}): Promise<{ record: BitableRecord; attachment: BitableAttachment } | null> {
  const records = await fetchBitableRecords({
    cfg: params.cfg,
    config: params.config,
    limit: params.target === "latest" ? 1 : 100,
  });
 
  if (records.length === 0) return null;
 
  let record: BitableRecord | undefined;
 
  if (params.target === "latest") {
    record = records[0];
  } else {
    record = records.find((r) => {
      const num = typeof r.autoNumber === "number"
        ? r.autoNumber
        : parseInt(String(r.autoNumber), 10);
      return num === params.target;
    });
  }
 
  if (!record || record.attachments.length === 0) return null;
 
  return { record, attachment: record.attachments[0] };
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
  const btConfig = params.config ?? DEFAULT_CONFIG;
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
