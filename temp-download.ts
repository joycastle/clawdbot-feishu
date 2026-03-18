import { downloadMessageResourceFeishu } from './src/api/media.js';
import fs from 'fs';

async function main() {
  // 下载第一个视频
  console.log('Downloading video 1...');
  const res1 = await downloadMessageResourceFeishu({
    messageId: 'om_x100b540a17cc80b8c2af4b2dc1927f9',
    fileKey: 'file_v3_00vo_95f4c031-5ed4-434a-a0cd-630a2a5688fg',
    type: 'file'
  });
  fs.writeFileSync('/tmp/video1.mp4', res1.data);
  console.log('Video 1:', res1.data.length, 'bytes');

  // 下载第二个视频  
  console.log('Downloading video 2...');
  const res2 = await downloadMessageResourceFeishu({
    messageId: 'om_x100b540a14c198b4c2b56688b381d15',
    fileKey: 'file_v3_00vo_5097b8f7-ead8-41c3-a344-bfa8bc1d4fdg',
    type: 'file'
  });
  fs.writeFileSync('/tmp/video2.mp4', res2.data);
  console.log('Video 2:', res2.data.length, 'bytes');

  console.log('Done');
}

main().catch(console.error);
