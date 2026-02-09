/**
 * 表格卡片 - 将 markdown 表格转换为飞书消息卡片
 */

export interface TableData {
  headers: string[];
  rows: string[][];
}

/**
 * 解析 markdown 表格
 * 支持格式：
 * | 列1 | 列2 | 列3 |
 * |-----|-----|-----|
 * | a   | b   | c   |
 */
export function parseMarkdownTable(text: string): TableData | null {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return null;

  // 检查是否是表格格式
  const tableLines = lines.filter(line => line.trim().startsWith('|') && line.trim().endsWith('|'));
  if (tableLines.length < 2) return null;

  // 解析表头
  const headerLine = tableLines[0];
  const headers = headerLine
    .split('|')
    .slice(1, -1) // 去掉首尾空字符串
    .map(cell => cell.trim());

  if (headers.length === 0) return null;

  // 跳过分隔行（|---|---|）
  let dataStartIndex = 1;
  if (tableLines[1] && /^\|[\s\-:]+\|$/.test(tableLines[1].replace(/\|/g, '|').replace(/[^|\-:\s]/g, ''))) {
    dataStartIndex = 2;
  }

  // 解析数据行
  const rows: string[][] = [];
  for (let i = dataStartIndex; i < tableLines.length; i++) {
    const cells = tableLines[i]
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    if (cells.length === headers.length) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return null;

  return { headers, rows };
}

/**
 * 检测文本中是否包含 markdown 表格
 */
export function containsMarkdownTable(text: string): boolean {
  // 检查是否有至少两行以 | 开头和结尾的内容
  const lines = text.split('\n');
  let tableLineCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|')) {
      tableLineCount++;
      if (tableLineCount >= 2) return true;
    }
  }
  return false;
}

/**
 * 从文本中提取表格和非表格部分
 */
export function extractTableFromText(text: string): {
  beforeTable: string;
  table: TableData | null;
  afterTable: string;
} {
  const lines = text.split('\n');
  const beforeLines: string[] = [];
  const tableLines: string[] = [];
  const afterLines: string[] = [];
  
  let inTable = false;
  let tableEnded = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|');

    if (!tableEnded) {
      if (isTableLine) {
        inTable = true;
        tableLines.push(line);
      } else if (inTable) {
        // 表格结束
        tableEnded = true;
        if (trimmed) afterLines.push(line);
      } else {
        beforeLines.push(line);
      }
    } else {
      afterLines.push(line);
    }
  }

  const table = tableLines.length >= 2 ? parseMarkdownTable(tableLines.join('\n')) : null;

  return {
    beforeTable: beforeLines.join('\n').trim(),
    table,
    afterTable: afterLines.join('\n').trim(),
  };
}

/**
 * 构建表格卡片
 */
export function buildTableCard(params: {
  title?: string;
  beforeText?: string;
  table: TableData;
  afterText?: string;
}): Record<string, unknown> {
  const { title, beforeText, table, afterText } = params;
  const elements: Record<string, unknown>[] = [];

  // 表格前的文字
  if (beforeText) {
    elements.push({
      tag: "markdown",
      content: beforeText,
    });
    elements.push({ tag: "hr" });
  }

  // 表头行
  elements.push({
    tag: "column_set",
    flex_mode: "none",
    background_style: "grey",
    columns: table.headers.map(h => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      vertical_align: "center",
      elements: [{
        tag: "markdown",
        content: `**${h}**`,
      }],
    })),
  });

  // 数据行
  for (const row of table.rows) {
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      columns: row.map(cell => ({
        tag: "column",
        width: "weighted",
        weight: 1,
        vertical_align: "center",
        elements: [{
          tag: "markdown",
          content: cell || " ", // 空单元格用空格
        }],
      })),
    });
  }

  // 表格后的文字
  if (afterText) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "markdown",
      content: afterText,
    });
  }

  const card: Record<string, unknown> = {
    config: { wide_screen_mode: true },
    elements,
  };

  if (title) {
    card.header = {
      title: { tag: "plain_text", content: title },
    };
  }

  return card;
}

/**
 * 将包含表格的文本转换为卡片
 * 如果没有表格则返回 null
 */
export function textToTableCard(text: string): Record<string, unknown> | null {
  if (!containsMarkdownTable(text)) return null;

  const { beforeTable, table, afterTable } = extractTableFromText(text);
  if (!table) return null;

  return buildTableCard({
    beforeText: beforeTable || undefined,
    table,
    afterText: afterTable || undefined,
  });
}
