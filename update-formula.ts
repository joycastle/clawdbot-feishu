import * as lark from "@larksuiteoapi/node-sdk";
import { readFileSync } from "fs";
import { getConfigPath } from "./src/utils/paths.js";

const configPath = getConfigPath();
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { appId, appSecret } = config.channels.feishu;

const client = new lark.Client({ appId, appSecret });

async function main() {
  const appToken = 'D3j2b92i5aPtowsX4vucV7gtn3d';
  const tableId = 'tblgdSNYgKn3knzx';
  const fieldId = 'fldmuNsOL1'; // 综合得分字段
  
  console.log('=== 更新公式字段 ===');
  try {
    const res = await client.bitable.appTableField.update({
      path: { 
        app_token: appToken, 
        table_id: tableId,
        field_id: fieldId
      },
      data: {
        field_name: '综合得分',
        type: 20, // Formula type
        property: {
          formula_expression: '(VALUE([UI/UX理解 得分]) + VALUE([产品理解与判断 得分]) + VALUE([执行与落地 得分]) + VALUE([协作成熟度 得分]) + VALUE([AI协作能力得分])) / 5'
        }
      }
    });
    console.log('更新成功:', JSON.stringify(res.data, null, 2));
  } catch (e: any) {
    console.error('更新失败:', e.code, e.msg, JSON.stringify(e.data || e.error, null, 2));
  }
}

main();
