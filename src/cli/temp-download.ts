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
  
  const messageId = 'om_x100b531160afc0acb291ffa6948edc5';
  const images = [
    'img_v3_02103_5b509e1c-6b19-4459-9e58-2e92530058cg',
    'img_v3_02103_940c4384-0175-4b1e-9b53-384f9ba77e5g'
  ];
  
  for (let i = 0; i < images.length; i++) {
    const imageKey = images[i];
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`;
    const imgRes = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer'
    });
    
    const filePath = `/tmp/screenshot_${i+1}.jpg`;
    fs.writeFileSync(filePath, Buffer.from(imgRes.data));
    console.log(`Downloaded: ${filePath} (${imgRes.data.length} bytes)`);
  }
}

main().catch(console.error);
