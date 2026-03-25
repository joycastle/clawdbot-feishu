import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs';
import * as path from 'path';

const credPath = path.join(process.cwd(), 'credentials.json');
const cred = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

const client = new lark.Client({
  appId: cred.app_id,
  appSecret: cred.app_secret,
});

async function main() {
  const folderToken = 'OpPNfw4iFltkapdLbEYcjSQFnHg';
  
  console.log('=== 列出文件夹内容 ===');
  try {
    const listRes = await client.drive.file.list({
      params: { folder_token: folderToken }
    });
    console.log('文件列表:', JSON.stringify(listRes.data, null, 2));
  } catch (e: any) {
    console.error('列出失败:', e.message, e.code);
  }
}

main();
