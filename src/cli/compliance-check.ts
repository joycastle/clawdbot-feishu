import { VertexAI } from '@google-cloud/vertexai';
import * as fs from 'fs';
import { getGoogleSAPath } from '../utils/paths.js';

const SA_PATH = getGoogleSAPath();
const PROJECT_ID = 'larkbot-485707';
const videoPath = process.argv[2] || '/tmp/feishu-video.mp4';

async function main() {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: 'global',
    googleAuthOptions: { keyFilename: SA_PATH },
  });
  
  const model = vertexAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
  
  console.log(`Reading video ${videoPath}...`);
  const videoData = fs.readFileSync(videoPath);
  const base64Video = videoData.toString('base64');
  
  console.log(`Analyzing with Gemini 3.1 Flash Lite (${(videoData.length / 1024 / 1024).toFixed(2)} MB)...`);
  const startTime = Date.now();
  
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'video/mp4', data: base64Video } },
        { text: `你是一位专业的广告合规审核专家。请对这个视频广告进行全面的合规性审查：

## 1. 内容合规
- 暴力/血腥/恐怖
- 色情/低俗/性暗示
- 政治敏感/宗教争议
- 歧视性内容
- 赌博/毒品等违禁内容

## 2. 广告宣称合规
- 虚假/夸大宣传
- "无广告"/"免费"等宣称真实性
- 是否有误导性优惠

## 3. 版权风险
- 背景音乐侵权风险
- 画面素材侵权风险
- 肖像权/商标问题

## 4. 平台政策风险
- TikTok/Meta/Google Ads 等平台可能的审核风险点

请给出：各维度分析、具体问题点、合规风险等级（低/中/高）、改进建议` },
      ],
    }],
  });
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
  
  console.log(`\n=== 视频合规性分析 (${elapsed}s) ===\n`);
  console.log(text || 'No response');
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
