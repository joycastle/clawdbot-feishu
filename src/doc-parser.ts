/**
 * Feishu Document Parser
 * Detects Feishu document URLs in message text and fetches their content via API.
 */
import { createFeishuClient } from "./client.js";
import type { FeishuConfig } from "./types.js";

/** Regex to match Feishu/Lark document URLs */
const FEISHU_DOC_URL_RE =
  /https?:\/\/[\w.-]+\.(feishu|lark)\.(cn|com)\/(wiki|docx|docs)\/([\w-]+)/gi;

export interface ParsedDocUrl {
  url: string;
  type: "wiki" | "docx" | "docs";
  token: string;
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
): Promise<{ title: string; content: string } | null> {
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

    // Fetch all blocks
    log?.(`feishu-doc: fetching blocks for ${docId}`);
    const blocksResp = await (client as any).docx.v1.documentBlock.list({
      path: { document_id: docId },
      params: { page_size: 500 },
    });

    const items: DocBlock[] = blocksResp?.data?.items ?? [];
    if (items.length === 0) {
      log?.(`feishu-doc: no blocks found`);
      return { title, content: "(文档内容为空)" };
    }

    const content = blocksToText(items);
    log?.(`feishu-doc: parsed ${items.length} blocks, ${content.length} chars`);
    return { title, content };
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
): Promise<string> {
  const urls = extractFeishuDocUrls(text);
  if (urls.length === 0) return text;

  log?.(`feishu-doc: found ${urls.length} document URL(s) in message`);

  const parts: string[] = [text];

  for (const parsed of urls) {
    const doc = await fetchFeishuDocContent(cfg, parsed, log);
    if (doc) {
      parts.push(`\n\n--- 飞书文档: ${doc.title} ---\n${doc.content}\n--- 文档结束 ---`);
    }
  }

  return parts.join("");
}
