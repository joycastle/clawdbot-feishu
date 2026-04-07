import { analyzeVideo } from '../features/video-analyze.js';

const videoPath = process.argv[2] || '/tmp/feishu-video.mp4';

const prompt = `你是一位专业的广告合规审核专家。请对这个视频广告进行全面的合规性审查：

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

请给出：各维度分析、具体问题点、合规风险等级（低/中/高）、改进建议`;

async function main() {
  console.log('Starting compliance analysis...');
  const result = await analyzeVideo(videoPath, {
    prompt,
    log: console.log,
  });
  
  console.log('\n=== 视频合规性分析结果 ===\n');
  console.log(result.text);
  console.log('\n---');
  console.log(`耗时: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Tokens: ${result.usage?.inputTokens} → ${result.usage?.outputTokens}`);
  console.log(`成本: $${result.cost?.toFixed(4)}`);
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
