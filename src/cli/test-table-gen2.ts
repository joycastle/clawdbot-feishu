import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, TableLayoutType } from "docx";
import { writeFileSync } from "fs";

const rows = [
  ["品类", "典型ARPDAU", "收入构成"],
  ["超休闲", "$0.02-$0.05", "几乎全靠广告"],
  ["混合休闲", "$0.10-$0.20", "广告 + 轻度IAP"],
  ["中核", "$0.30-$0.40+", "IAP为主"],
];

const colCount = rows[0].length;
// A4 纸宽 = 12240 twips (8.5 inches * 1440), 减去边距约 9000 twips 可用
const totalWidth = 9000;
const colWidth = Math.floor(totalWidth / colCount);

console.log(`列数: ${colCount}, 总宽: ${totalWidth} twips, 每列: ${colWidth} twips`);

const tableRows = rows.map((row, rowIndex) => {
  const cells = row.map(cellText => {
    return new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: cellText })],
      })],
      width: { size: colWidth, type: WidthType.DXA },
      shading: rowIndex === 0 ? { fill: "E7E6E6", type: ShadingType.CLEAR } : undefined,
    });
  });
  return new TableRow({ children: cells });
});

const table = new Table({
  rows: tableRows,
  width: { size: totalWidth, type: WidthType.DXA },
  layout: TableLayoutType.FIXED, // 强制固定布局
  columnWidths: Array(colCount).fill(colWidth), // 显式指定每列宽度
});

const doc = new Document({
  sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: "测试表格", bold: true, size: 32 })] }),
    table,
  ]}],
});

Packer.toBuffer(doc).then(buffer => {
  writeFileSync("/tmp/test-table2.docx", buffer);
  console.log("生成完成: /tmp/test-table2.docx, 大小:", buffer.length);
});
