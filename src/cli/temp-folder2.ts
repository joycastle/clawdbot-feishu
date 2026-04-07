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
  const cfgPath = `${process.env.HOME}/.openclaw/openclaw.json`;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const { appId, appSecret } = cfg.channels.feishu;
  
  const token = await getTenantAccessToken(appId, appSecret);
  console.log('Token obtained!');
  
  const messageId = 'om_x100b531163b0c104b383303e99472b1';
  const fileKey = 'file_v3_01103_cf65b17e-4704-41e3-83a2-5373655f66cg';
  
  // 尝试下载文件夹（可能是 zip）
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer'
    });
    fs.writeFileSync('/tmp/folder.zip', Buffer.from(res.data));
    console.log('Downloaded:', res.data.length, 'bytes');
  } catch (err: any) {
    console.log('Error:', err.response?.data?.toString() || err.message);
  }
}

main().catch(console.error);
