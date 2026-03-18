import * as Lark from "@larksuiteoapi/node-sdk";
import * as fs from 'fs';

const APP_ID = "cli_a9f05db654f8dbc6";
const APP_SECRET = "AZt40GUGEhd1MlPHqjN37dBk4jqaDjVy";

const client = new Lark.Client({
  appId: APP_ID,
  appSecret: APP_SECRET,
  disableTokenCache: false,
  loggerLevel: Lark.LoggerLevel.debug,
});

const messageId = 'om_x100b540fcacded30b214888f0a686c1';
const fileKey = 'file_v3_00vo_6161aa48-a562-40f8-a316-5338d53aa88g';
const outputPath = '/tmp/267671749.mp4';

async function main() {
  // 尝试不同的类型
  for (const type of ['file', 'video', 'media']) {
    try {
      console.log(`Trying type: ${type}`);
      const resp = await client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: type as any },
      });
      
      if (resp) {
        fs.writeFileSync(outputPath, resp as any);
        const stats = fs.statSync(outputPath);
        console.log('Downloaded:', stats.size, 'bytes to', outputPath);
        return;
      }
    } catch (e: any) {
      console.error(`Type ${type} failed:`, e.message?.substring(0, 100) || 'unknown');
    }
  }
  console.error('All types failed');
}

main();
