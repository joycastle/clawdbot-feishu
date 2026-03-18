import * as Lark from "@larksuiteoapi/node-sdk";
import * as fs from 'fs';

async function main() {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  
  const client = new Lark.Client({
    appId, appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  });

  const msgId = 'om_x100b544c24893130c35e5d6e8885102';
  
  console.log('Getting message...');
  const msgRes = await client.im.message.get({ path: { message_id: msgId } });
  
  console.log('Message items:', JSON.stringify(msgRes.data?.items, null, 2));
  
  // 获取消息内容中的视频信息
  const item = msgRes.data?.items?.[0];
  if (item) {
    console.log('\nMessage type:', item.msg_type);
    console.log('Body content:', item.body?.content);
  }
}

main().catch(e => console.error('Error:', e.message));
