import { FeishuService } from '../feishu-service.js';

async function main() {
  const fs = new FeishuService();
  const token = await fs.getAccessToken();

  const sheetToken = 'IadvsL8nXhs3autyLWkcHVYinye';

  // 获取元信息
  const metaResp = await fetch(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${sheetToken}/metainfo`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaResp.json();
  console.log('META:', JSON.stringify(meta, null, 2));
  
  // 如果有 sheets，获取数据
  if (meta.data?.properties?.sheetCount > 0) {
    const sheets = meta.data.sheets || [];
    for (const sheet of sheets) {
      const sheetId = sheet.sheetId;
      const valResp = await fetch(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${sheetId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const vals = await valResp.json();
      console.log(`\nSHEET [${sheet.title}]:`, JSON.stringify(vals, null, 2));
    }
  }
}

main().catch(console.error);
