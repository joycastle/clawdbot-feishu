import { 
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, WidthType,
  ShadingType, TableLayoutType
} from "docx";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const markdown = readFileSync("/home/ubuntu/clawd/output/混合变现日报_2026-03-20_详细版.md", "utf-8");

// 简单解析表格行
function parseTableRows(lines: string[], startIdx: number): { rows: string[][], endIdx: number } {
  const rows: string[][] = [];
  let i = startIdx;
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    const line = lines[i].trim();
    if (!/^\|[\s\-:|]+\|$/.test(line)) {
      const cells = line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      rows.push(cells);
    }
    i++;
  }
  return { rows, endIdx: i };
}

// 创建表格
function createTable(rows: string[][]): Table {
  if (rows.length === 0) return new Table({ rows: [] });
  
  const colCount = rows[0].length;
  const totalWidth = 9000;
  const colWidth = Math.floor(totalWidth / colCount);
  
  console.log(`  表格: ${colCount}列, 每列${colWidth}twips`);
  
  const tableRows = rows.map((row, rowIndex) => {
    const cells = row.map(cellText => {
      return new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: cellText.trim() })] })],
        width: { size: colWidth, type: WidthType.DXA },
        shading: rowIndex === 0 ? { fill: "E7E6E6", type: ShadingType.CLEAR } : undefined,
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

// 解析 Markdown
const lines = markdown.split("\n");
const content: (Paragraph | Table)[] = [];
let i = 0;
let tableCount = 0;

while (i < lines.length) {
  const line = lines[i];
  
  if (!line.trim()) { content.push(new Paragraph({})); i++; continue; }
  
  if (line.trim().startsWith("|")) {
    const { rows, endIdx } = parseTableRows(lines, i);
    if (rows.length > 0) {
      tableCount++;
      console.log(`表格 #${tableCount}:`);
      content.push(createTable(rows));
    }
    i = endIdx;
    continue;
  }
  
  if (line.startsWith("# ")) {
    content.push(new Paragraph({ children: [new TextRun({ text: line.slice(2), bold: true, size: 36 })] }));
  } else if (line.startsWith("## ")) {
    content.push(new Paragraph({ children: [new TextRun({ text: line.slice(3), bold: true, size: 28 })] }));
  } else if (line.startsWith("### ")) {
    content.push(new Paragraph({ children: [new TextRun({ text: line.slice(4), bold: true, size: 24 })] }));
  } else {
    content.push(new Paragraph({ children: [new TextRun({ text: line })] }));
  }
  i++;
}

const doc = new Document({ sections: [{ children: content }] });

Packer.toBuffer(doc).then(buffer => {
  writeFileSync("/tmp/verify-test.docx", buffer);
  console.log("\n生成完成:", buffer.length, "bytes");
  
  // 用 pandoc 验证
  try {
    const html = execSync("pandoc /tmp/verify-test.docx -t html 2>/dev/null").toString();
    const colWidths = html.match(/col style="width: (\d+)%"/g);
    if (colWidths) {
      console.log("\n验证结果 - 列宽:");
      const unique = [...new Set(colWidths)];
      unique.forEach(w => console.log("  " + w));
    }
    
    // 检查是否有宽度异常的列
    const widthValues = (html.match(/width: (\d+)%/g) || []).map(w => parseInt(w.match(/\d+/)?.[0] || "0"));
    const abnormal = widthValues.filter(w => w < 10);
    if (abnormal.length > 0) {
      console.log("\n⚠️ 发现异常窄列:", abnormal);
    } else {
      console.log("\n✅ 所有列宽正常 (>= 10%)");
    }
  } catch (e) {
    console.log("pandoc 验证出错:", e);
  }
});
