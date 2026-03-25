import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType } from "docx";
import { writeFileSync } from "fs";

const rows = [
  ["品类", "典型ARPDAU", "收入构成"],
  ["超休闲", "$0.02-$0.05", "几乎全靠广告"],
  ["混合休闲", "$0.10-$0.20", "广告 + 轻度IAP"],
  ["中核", "$0.30-$0.40+", "IAP为主"],
];

const colCount = rows[0].length;
// 改用百分比宽度试试
const colWidthPct = Math.floor(5000 / colCount); // 5000 = 100% in fifths of a percent

console.log(`列数: ${colCount}, 每列百分比: ${colWidthPct/50}%`);

const tableRows = rows.map((row, rowIndex) => {
  const cells = row.map(cellText => {
    return new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: cellText })],
      })],
      width: { size: colWidthPct, type: WidthType.PERCENTAGE },
      shading: rowIndex === 0 ? { fill: "E7E6E6", type: ShadingType.CLEAR } : undefined,
    });
  });
  return new TableRow({ children: cells });
});

const table = new Table({
  rows: tableRows,
  width: { size: 100, type: WidthType.PERCENTAGE },
});

const doc = new Document({
  sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: "测试表格", bold: true, size: 32 })] }),
    table,
  ]}],
});

Packer.toBuffer(doc).then(buffer => {
  writeFileSync("/tmp/test-table.docx", buffer);
  console.log("生成完成: /tmp/test-table.docx, 大小:", buffer.length);
});
