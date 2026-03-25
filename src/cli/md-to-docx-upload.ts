#!/usr/bin/env npx tsx
/**
 * 将 Markdown 转为 docx 并上传到飞书云盘
 * 支持：可点击超链接、真正的 Word 表格、等宽字体代码块
 */
import { 
  Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
  ShadingType, TableLayoutType
} from "docx";
import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "../utils/paths.js";
import { parseArgs } from "util";
import path from "path";

const { values } = parseArgs({
  options: {
    file: { type: "string", short: "f" },
    folder: { type: "string" },
    name: { type: "string", short: "n" },
  },
});

if (!values.file || !values.folder) {
  console.log("Usage: npx tsx md-to-docx-upload.ts --file <md-file> --folder <folder_token> [--name <filename>]");
  process.exit(0);
}

// 解析内联格式（粗体、链接等）
function parseInlineElements(text: string): (TextRun | ExternalHyperlink)[] {
  const elements: (TextRun | ExternalHyperlink)[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|([^*\[]+)/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      elements.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3]) {
      elements.push(new ExternalHyperlink({
        children: [new TextRun({ text: match[4], color: "0563C1", underline: { type: "single" } })],
        link: match[5],
      }));
    } else if (match[6] && match[6].trim()) {
      elements.push(new TextRun({ text: match[6] }));
    }
  }
  
  return elements.length > 0 ? elements : [new TextRun({ text })];
}

// 检测并转换独立 URL 为超链接
function parseLineWithUrls(text: string): (TextRun | ExternalHyperlink)[] {
  const elements: (TextRun | ExternalHyperlink)[] = [];
  const urlRegex = /(https?:\/\/[^\s<>\[\]]+)/g;
  let lastIndex = 0;
  let match;
  
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      elements.push(...parseInlineElements(beforeText));
    }
    elements.push(new ExternalHyperlink({
      children: [new TextRun({ text: match[1], color: "0563C1", underline: { type: "single" } })],
      link: match[1],
    }));
    lastIndex = urlRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    elements.push(...parseInlineElements(text.slice(lastIndex)));
  }
  
  return elements.length > 0 ? elements : parseInlineElements(text);
}

// 创建 Word 表格
function createTable(rows: string[][]): Table {
  if (rows.length === 0) return new Table({ rows: [] });
  
  const colCount = rows[0].length;
  // A4 纸宽约 8.5 英寸 = 12240 twips，减去边距约 9000 twips 可用
  const totalWidth = 9000;
  const colWidth = Math.floor(totalWidth / colCount);
  
  const tableRows = rows.map((row, rowIndex) => {
    const cells = row.map(cellText => {
      const isHeader = rowIndex === 0;
      return new TableCell({
        children: [new Paragraph({
          children: parseLineWithUrls(cellText.trim()),
          alignment: AlignmentType.LEFT,
        })],
        width: { size: colWidth, type: WidthType.DXA },
        shading: isHeader ? { fill: "E7E6E6", type: ShadingType.CLEAR } : undefined,
      });
    });
    return new TableRow({ children: cells });
  });

  return new Table({
    rows: tableRows,
    width: { size: totalWidth, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: Array(colCount).fill(colWidth),
  });
}

// 解析 Markdown 表格
function parseMarkdownTable(lines: string[], startIndex: number): { table: Table; endIndex: number } | null {
  const tableLines: string[] = [];
  let i = startIndex;
  
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    const line = lines[i].trim();
    // 跳过分隔行 |---|---|
    if (!/^\|[\s\-:|]+\|$/.test(line)) {
      tableLines.push(line);
    }
    i++;
  }
  
  if (tableLines.length < 1) return null;
  
  const rows = tableLines.map(line => {
    return line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
  });
  
  return { table: createTable(rows), endIndex: i };
}

// 创建代码块（等宽字体，保持格式）
function createCodeBlock(code: string): Paragraph[] {
  const lines = code.split("\n");
  return lines.map(line => new Paragraph({
    children: [new TextRun({ 
      text: line || " ", // 空行也保留
      font: "Courier New",
      size: 20, // 10pt
    })],
    shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
    spacing: { before: 0, after: 0, line: 276 }, // 1.15倍行距
  }));
}

// Markdown 转 docx 段落
function mdToDocxContent(markdown: string): (Paragraph | Table)[] {
  const lines = markdown.split("\n");
  const content: (Paragraph | Table)[] = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // 空行
    if (!line.trim()) {
      content.push(new Paragraph({}));
      i++;
      continue;
    }
    
    // 分隔线
    if (/^---+$/.test(line.trim())) {
      content.push(new Paragraph({
        children: [new TextRun({ text: "─".repeat(80), color: "CCCCCC" })],
      }));
      i++;
      continue;
    }
    
    // 标题
    if (line.startsWith("# ")) {
      content.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: line.slice(2), bold: true, size: 36 })],
        spacing: { before: 400, after: 200 },
      }));
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      content.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: line.slice(3), bold: true, size: 28 })],
        spacing: { before: 300, after: 150 },
      }));
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      content.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: line.slice(4), bold: true, size: 24 })],
        spacing: { before: 200, after: 100 },
      }));
      i++;
      continue;
    }
    if (line.startsWith("#### ")) {
      content.push(new Paragraph({
        children: [new TextRun({ text: line.slice(5), bold: true, size: 22 })],
        spacing: { before: 150, after: 80 },
      }));
      i++;
      continue;
    }
    
    // 引用块
    if (line.startsWith("> ")) {
      content.push(new Paragraph({
        children: [new TextRun({ text: line.slice(2), italics: true, color: "666666" })],
        indent: { left: 720 },
      }));
      i++;
      continue;
    }
    
    // 表格（Markdown 格式）
    if (line.trim().startsWith("|")) {
      const result = parseMarkdownTable(lines, i);
      if (result) {
        content.push(result.table);
        i = result.endIndex;
        continue;
      }
    }
    
    // 代码块（包括字符图）
    if (line.startsWith("```")) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 ```
      content.push(...createCodeBlock(codeLines.join("\n")));
      continue;
    }
    
    // 无序列表
    if (/^[-*•✅] /.test(line)) {
      const bullet = line.startsWith("✅") ? "✅ " : "• ";
      const listContent = line.replace(/^[-*•✅] /, "");
      content.push(new Paragraph({
        children: [new TextRun({ text: bullet }), ...parseLineWithUrls(listContent)],
        indent: { left: 360 },
      }));
      i++;
      continue;
    }
    
    // 数字列表
    if (/^\d+\. /.test(line)) {
      const match = line.match(/^(\d+)\. (.*)$/);
      if (match) {
        content.push(new Paragraph({
          children: [new TextRun({ text: `${match[1]}. ` }), ...parseLineWithUrls(match[2])],
          indent: { left: 360 },
        }));
      }
      i++;
      continue;
    }
    
    // 普通段落
    content.push(new Paragraph({
      children: parseLineWithUrls(line),
      spacing: { after: 100 },
    }));
    i++;
  }
  
  return content;
}

async function main() {
  const markdown = readFileSync(values.file!, "utf-8");
  const baseName = values.name || path.basename(values.file!, ".md");
  const docxName = baseName.endsWith(".docx") ? baseName : `${baseName}.docx`;
  
  const configPath = getConfigPath();
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const { appId, appSecret } = config.channels.feishu;
  const client = new lark.Client({ appId, appSecret });
  
  // 1. 生成 docx
  console.log("1. 生成 docx（含表格、可点击链接、等宽代码块）...");
  const doc = new Document({
    sections: [{
      children: mdToDocxContent(markdown),
    }],
  });
  
  const buffer = await Packer.toBuffer(doc);
  console.log(`   生成完成 (${buffer.length} bytes)`);
  
  // 2. 上传到飞书
  console.log(`2. 上传到云盘 ${values.folder}...`);
  
  const response = await client.drive.media.uploadAll({
    data: {
      file_name: docxName,
      parent_type: "explorer",
      parent_node: values.folder!,
      size: buffer.length,
      file: buffer,
    },
  });
  
  const fileToken = (response as any).file_token;
  if (fileToken) {
    console.log(`\n✅ 上传成功！`);
    console.log(`📄 文件: ${docxName}`);
    console.log(`📎 file_token: ${fileToken}`);
    console.log(`🔗 链接: https://joycastle.feishu.cn/file/${fileToken}`);
  } else {
    console.log("Response:", JSON.stringify(response, null, 2));
  }
}

main().catch(console.error);
