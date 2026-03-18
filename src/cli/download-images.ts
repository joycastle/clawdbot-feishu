import * as Lark from "@larksuiteoapi/node-sdk";
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const messageIds = [
  "om_x100b559c4133748cc11860c5caeb459",
  "om_x100b559c5ec9208cc3bf77f72dcc8d3",
  "om_x100b559c5ec540bcc2bec6db77c6143",
  "om_x100b559c5ec170a0c4c59d2e3882d55",
  "om_x100b559c5edc50f4c4a68364ba06463",
  "om_x100b559c5ed83cacc114ef7bc18f256",
  "om_x100b559c5ed7cc90c496a6e9ea84669",
  "om_x100b559c5ed328acc2bff7bc745781d",
  "om_x100b559c5eee84a0c39620a4553ed9d",
  "om_x100b559c5eeaf824c29119c3790be86",
  "om_x100b559c5ee64cb4c3d731f6e46db84",
  "om_x100b559c5efdf4b4c31d468a466c517",
  "om_x100b559c5ef80880c36cb738f333bfa",
  "om_x100b559c5ef440a4c4c773d20ebfa84",
  "om_x100b559c5ef02098c2c9a70edb1b81a",
  "om_x100b559c5e8f1cacc2eb753c0c52562",
  "om_x100b559c5e8b40a0c2b7be34f5ce4b0",
  "om_x100b559c5e8614b0c44749b71a243d5",
  "om_x100b559c5e9d5cb8c4ff527f27969ba",
  "om_x100b559c5e9898a4c2ae86396f158f3",
  "om_x100b559c5e94e098c2e573c305cf778",
  "om_x100b559c5e908ca0c4e4039c906003e",
  "om_x100b559c5eac54bcc29359d134ce0ac",
  "om_x100b559c5eab5ca8c42378a7c6b153f",
  "om_x100b559c5ea7754cc4ca7ca0f655cb1",
  "om_x100b559c5ebda4bcc2b8d260b1b391c",
  "om_x100b559c5eb964b4c3d47656d1f9507",
  "om_x100b559c5eb40494c4c17af6c98a96d",
  "om_x100b559c5eb0150cc29758f8efff84c",
  "om_x100b559c5e4ffce8c352881d75bf986",
  "om_x100b559c5e4b04b8c10f3bcb0998865",
  "om_x100b559c5e4690acc3f4219de8e4395",
  "om_x100b559c5e4214a4c3bc0124a07c21a",
  "om_x100b559c5e5ba4bcc103cd6828b124b",
  "om_x100b559c5e546110c35f085a35d8da8",
  "om_x100b559c5e539ca0c3957c9d8a7a24f",
  "om_x100b559c5e6ffd64c2d34fcc09fcd77",
  "om_x100b559c5e6bf4a0c4ec84a66be9bc6",
  "om_x100b559c5e674c84c44c03ee1cd9706",
  "om_x100b559c5e637ca0c2b69ff65abe2f2",
  "om_x100b559c5e7ed8b8c12b1a60d9dcdf7",
  "om_x100b559c5e7a54a0c117a7ba4476022",
  "om_x100b559c5e71d4acc4cf89d37d69d59",
  "om_x100b559c5e0d3c98c3acf5147c0e4bd"
];

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret
  });
  return res.data.tenant_access_token;
}

async function main() {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  
  console.log('Getting token...');
  const token = await getTenantAccessToken(appId, appSecret);
  console.log('Token obtained!');
  
  const client = new Lark.Client({
    appId, appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  });

  const outputDir = '/tmp/receipts';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  for (let i = 0; i < messageIds.length; i++) {
    const msgId = messageIds[i];
    try {
      // Get message
      const msgRes = await client.im.message.get({ path: { message_id: msgId } });
      const content = msgRes.data?.items?.[0]?.body?.content;
      if (!content) {
        console.log(`[${i+1}/${messageIds.length}] No content`);
        continue;
      }
      
      const body = JSON.parse(content);
      const imageKey = body.image_key;
      
      if (imageKey) {
        // Download image using axios
        const url = `https://open.feishu.cn/open-apis/im/v1/messages/${msgId}/resources/${imageKey}?type=image`;
        const imgRes = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer'
        });
        
        const filePath = path.join(outputDir, `receipt_${String(i+1).padStart(2, '0')}.jpg`);
        fs.writeFileSync(filePath, Buffer.from(imgRes.data));
        
        console.log(`[${i+1}/${messageIds.length}] ✓ receipt_${String(i+1).padStart(2, '0')}.jpg (${imgRes.data.length} bytes)`);
      }
    } catch (err: any) {
      console.error(`[${i+1}/${messageIds.length}] Error: ${err.message}`);
    }
  }
  
  console.log('\nDone!');
}

main();
