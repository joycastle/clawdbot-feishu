import axios from 'axios';
import * as fs from 'fs';

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret
  });
  return res.data.tenant_access_token;
}

async function main() {
  const cfgPath = `${process.env.HOME}/.clawdbot/clawdbot.json`;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const { appId, appSecret } = cfg.channels.feishu;
  
  const token = await getTenantAccessToken(appId, appSecret);
  console.log('Token obtained!');
  
  // folder file_key 
  const folderToken = 'file_v3_01103_cf65b17e-4704-41e3-83a2-5373655f66cg';
  
  // 尝试列出文件夹内容
  // 方法1: 尝试用 drive API
  const url = `https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${folderToken}`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Files in folder:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.log('Error:', err.response?.data || err.message);
  }
}

main().catch(console.error);
