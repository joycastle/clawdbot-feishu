/**
 * Feishu Document Parser
 * Detects Feishu document URLs in message text and fetches their content via API.
 */
import { createFeishuClient } from "../client.js";
import { resolveFeishuCredentials } from "../accounts.js";
import type { FeishuConfig } from "../types.js";

/** Regex to match Feishu/Lark document URLs */
const FEISHU_DOC_URL_RE =
  /https?:\/\/[\w.-]+\.(feishu|lark)\.(cn|com)\/(wiki|docx|docs)\/([\w-]+)/gi;

export interface ParsedDocUrl {
  url: string;
  type: "wiki" | "docx" | "docs";
  token: string;
}

type DocsContentResponse =
  | { code: number; msg: string; data?: unknown }
  | { code?: number; msg?: string; data?: unknown };

const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

function resolveOpenApiBase(domain: "feishu" | "lark"): string {
  return domain === "lark" ? "https://open.larksuite.com/open-apis" : "https://open.feishu.cn/open-apis";
}

async function getTenantAccessToken(cfg: FeishuConfig): Promise<string> {
  const creds = resolveFeishuCredentials(cfg);
  if (!creds) {
    throw new Error("Feishu credentials missing (appId/appSecret required)");
  }

  const cacheKey = `${creds.domain}|${creds.appId}|${creds.appSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.token;
  }

  const res = await fetch(`${resolveOpenApiBase(creds.domain)}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant_access_token: ${data.msg ?? `HTTP ${res.status}`}`);
  }
  tokenCache.set(cacheKey, {
    token: data.tenant_access_token,
    expiresAtMs: Date.now() + (data.expire ?? 7200) * 1000,
  });
  return data.tenant_access_token;
}

function extractDocsMarkdownFromResponse(payload: DocsContentResponse): string {
  const code = typeof payload.code === "number" ? payload.code : 0;
  if (code !== 0) {
    throw new Error(`docs/v1/content failed: ${payload.msg ?? `code ${code}`}`);
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (typeof rec.content === "string") return rec.content;
    if (typeof rec.markdown === "string") return rec.markdown;
    if (rec.data && typeof rec.data === "object") {
      const nested = rec.data as Record<string, unknown>;
      if (typeof nested.content === "string") return nested.content;
      if (typeof nested.markdown === "string") return nested.markdown;
    }
  }
  throw new Error("docs/v1/content returned unexpected payload shape (missing markdown content)");
}

function isPrivateIpV4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const octets = m.slice(1).map((n) => Number(n));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL protocol for media download: ${url.protocol}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || isPrivateIpV4(hostname)) {
    throw new Error(`Refusing to fetch from private/localhost hostname: ${hostname}`);
  }
  return url;
}

export async function downloadFeishuDocMediaByUrl(params: {
  cfg: FeishuConfig;
  url: string;
  maxBytes: number;
}): Promise<{ buffer: Buffer; contentType?: string }> {
  const { cfg, url, maxBytes } = params;
  const safeUrl = assertSafeHttpUrl(url);

  const tryFetch = async (withAuth: boolean) => {
    const headers: Record<string, string> = {};
    if (withAuth) {
      headers.Authorization = `Bearer ${await getTenantAccessToken(cfg)}`;
    }
    const res = await fetch(safeUrl.toString(), { headers });
    return res;
  };

  // For Feishu/Lark URLs, always use auth (drive API requires it)
  const isFeishuUrl = safeUrl.hostname.endsWith("feishu.cn") || safeUrl.hostname.endsWith("larksuite.com");
  let res = await tryFetch(isFeishuUrl);
  if (!res.ok && isFeishuUrl && res.status >= 400 && res.status < 500) {
    // Retry with auth in case first attempt failed
    res = await tryFetch(true);
  }
  if (!res.ok) {
    throw new Error(`Media download failed: HTTP ${res.status}`);
  }

  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader) {
    const n = Number(contentLengthHeader);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`Media exceeds size limit: ${n} bytes > ${maxBytes} bytes`);
    }
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(`Media exceeds size limit: ${ab.byteLength} bytes > ${maxBytes} bytes`);
  }

  return {
    buffer: Buffer.from(ab),
    contentType: res.headers.get("content-type") ?? undefined,
  };
}

/** Extract all Feishu doc URLs from a text string. */
export function extractFeishuDocUrls(text: string): ParsedDocUrl[] {
  const results: ParsedDocUrl[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  // Reset regex state
  FEISHU_DOC_URL_RE.lastIndex = 0;
  while ((match = FEISHU_DOC_URL_RE.exec(text)) !== null) {
    const token = match[4];
    if (seen.has(token)) continue;
    seen.add(token);
    results.push({
      url: match[0],
      type: match[3] as "wiki" | "docx" | "docs",
      token,
    });
  }
  return results;
}

/**
 * Block types in Feishu docx API.
 */
interface DocBlock {
  block_id: string;
  block_type: number;
  parent_id?: string;
  children?: string[];
  page?: { elements?: DocElement[]; style?: { align?: number } };
  text?: { elements?: DocElement[]; style?: { align?: number; folded?: boolean } };
  heading1?: { elements?: DocElement[] };
  heading2?: { elements?: DocElement[] };
  heading3?: { elements?: DocElement[] };
  heading4?: { elements?: DocElement[] };
  heading5?: { elements?: DocElement[] };
  heading6?: { elements?: DocElement[] };
  bullet?: { elements?: DocElement[] };
  ordered?: { elements?: DocElement[] };
  code?: { elements?: DocElement[] };
  quote?: { elements?: DocElement[] };
  quote_container?: Record<string, unknown>;
  todo?: { elements?: DocElement[]; style?: { done?: boolean } };
}

interface DocElement {
  text_run?: {
    content: string;
    text_element_style?: { bold?: boolean };
  };
  mention_user?: { user_id?: string };
}

/** Extract text from block elements. */
function extractBlockText(elements?: DocElement[]): string {
  if (!elements) return "";
  return elements
    .map((el) => {
      if (el.text_run) return el.text_run.content;
      if (el.mention_user) return `@${el.mention_user.user_id ?? "user"}`;
      return "";
    })
    .join("");
}

/** Convert a list of doc blocks into readable plain text. */
function blocksToText(blocks: DocBlock[]): string {
  const lines: string[] = [];

  const typeKeyMap: Record<number, string> = {
    1: "page",
    2: "text",
    3: "heading1",
    4: "heading2",
    5: "heading3",
    6: "heading4",
    7: "heading5",
    8: "heading6",
    9: "bullet",
    10: "ordered",
    11: "code",
    12: "bullet", // quote_container children are separate
  };

  const prefixMap: Record<number, string> = {
    3: "# ",
    4: "## ",
    5: "### ",
    6: "#### ",
    9: "• ",
    10: "", // could number, but skip
    11: "```\n",
    12: "• ",
  };

  for (const block of blocks) {
    const bt = block.block_type;

    // Skip page root (type 1) — its text is just the title, already captured in metadata
    if (bt === 1) continue;

    // Divider
    if (bt === 14) {
      lines.push("---");
      continue;
    }

    // Image / table / other non-text blocks
    if (bt === 27) {
      lines.push("[图片]");
      continue;
    }
    if (bt === 23) {
      lines.push("[表格]");
      continue;
    }

    // Quote container (type 34) — children handled separately
    if (bt === 34) continue;

    // Todo
    if (bt === 13) {
      const done = block.todo?.style?.done;
      const text = extractBlockText(block.todo?.elements);
      if (text) lines.push(`${done ? "[x]" : "[ ]"} ${text}`);
      continue;
    }

    // Text-like blocks
    const key = typeKeyMap[bt];
    if (key) {
      const content = (block as unknown as Record<string, unknown>)[key] as
        | { elements?: DocElement[] }
        | undefined;
      const text = extractBlockText(content?.elements);
      if (text) {
        const prefix = prefixMap[bt] ?? "";
        lines.push(`${prefix}${text}`);
      }
      continue;
    }

    // Unknown block type — skip silently
  }

  return lines.join("\n");
}

/**
 * Fetch the content of a Feishu document by URL components.
 * Returns the document title and plain-text content, or null on failure.
 */
export async function fetchFeishuDocContent(
  cfg: FeishuConfig,
  parsed: ParsedDocUrl,
  log?: (msg: string) => void,
): Promise<{ title: string; content: string; docImageUrls: string[] } | null> {
  try {
    const client = createFeishuClient(cfg);

    let docId = parsed.token;
    let docType = parsed.type;

    // Wiki: resolve node to get real document id
    if (docType === "wiki") {
      log?.(`feishu-doc: resolving wiki node ${docId}`);
      const nodeResp = await (client as any).wiki.v2.space.getNode({
        params: { token: docId },
      });
      if (nodeResp?.data?.node) {
        const node = nodeResp.data.node;
        if (node.obj_token && node.obj_type === "docx") {
          docId = node.obj_token;
          docType = "docx";
          log?.(`feishu-doc: resolved wiki to docx ${docId}`);
        } else {
          log?.(`feishu-doc: wiki node type=${node.obj_type}, not docx — skipping`);
          return null;
        }
      } else {
        log?.(`feishu-doc: failed to resolve wiki node`);
        return null;
      }
    }

    // Fetch document metadata
    log?.(`feishu-doc: fetching document ${docId}`);
    const docResp = await (client as any).docx.v1.document.get({
      path: { document_id: docId },
    });
    const title = docResp?.data?.document?.title ?? "未知标题";

    const docImageUrls: string[] = [];
    const creds = resolveFeishuCredentials(cfg);
    const wantsMarkdown = Boolean(creds?.appId && creds.appSecret);

    // Always fetch blocks to extract image tokens (markdown API doesn't include images)
    log?.(`feishu-doc: fetching blocks for ${docId}`);
    const blocksResp = await (client as any).docx.v1.documentBlock.list({
      path: { document_id: docId },
      params: { page_size: 500 },
    });
    const items: DocBlock[] = blocksResp?.data?.items ?? [];

    // Extract image tokens from blocks (block_type 27 = image)
    const base = resolveOpenApiBase(creds?.domain ?? "feishu");
    for (const block of items) {
      if (block.block_type === 27) {
        const imageToken = (block as any).image?.token;
        if (imageToken) {
          // Construct download URL for the image
          const imageUrl = `${base}/drive/v1/medias/${imageToken}/download`;
          docImageUrls.push(imageUrl);
        }
      }
    }
    if (docImageUrls.length > 0) {
      log?.(`feishu-doc: found ${docImageUrls.length} image(s) in document`);
    }

    // Try markdown content for better text formatting
    if (wantsMarkdown) {
      try {
        const token = await getTenantAccessToken(cfg);
        const url = new URL(`${base}/docs/v1/content`);
        url.searchParams.set("doc_token", docId);
        url.searchParams.set("doc_type", "docx");
        url.searchParams.set("content_type", "markdown");
        url.searchParams.set("lang", "zh");
        const contentRes = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
        });
        const payload = (await contentRes.json().catch(() => ({}))) as DocsContentResponse;
        const markdown = extractDocsMarkdownFromResponse(payload);

        log?.(`feishu-doc: fetched markdown content (${markdown.length} chars)`);
        return { title, content: markdown, docImageUrls };
      } catch (err) {
        log?.(`feishu-doc: markdown fetch failed, falling back to blocks: ${String(err)}`);
      }
    }

    // Fallback: render blocks as plain text
    if (items.length === 0) {
      log?.(`feishu-doc: no blocks found`);
      return { title, content: "(文档内容为空)", docImageUrls };
    }

    const content = blocksToText(items);
    log?.(`feishu-doc: parsed ${items.length} blocks, ${content.length} chars`);
    return { title, content, docImageUrls };
  } catch (err) {
    log?.(`feishu-doc: error fetching document: ${String(err)}`);
    return null;
  }
}

/**
 * Given a message text, detect Feishu doc URLs and return enriched text
 * with document content appended.
 */
export async function enrichMessageWithDocs(
  cfg: FeishuConfig,
  text: string,
  log?: (msg: string) => void,
): Promise<{ text: string; docImageUrls: string[] }> {
  const urls = extractFeishuDocUrls(text);
  if (urls.length === 0) return { text, docImageUrls: [] };

  log?.(`feishu-doc: found ${urls.length} document URL(s) in message`);

  const parts: string[] = [text];
  const docImageUrls: string[] = [];

  for (const parsed of urls) {
    const doc = await fetchFeishuDocContent(cfg, parsed, log);
    if (doc) {
      docImageUrls.push(...doc.docImageUrls);
      parts.push(`\n\n--- 飞书文档: ${doc.title} ---\n${doc.content}\n--- 文档结束 ---`);
    }
  }

  return { text: parts.join(""), docImageUrls };
}
