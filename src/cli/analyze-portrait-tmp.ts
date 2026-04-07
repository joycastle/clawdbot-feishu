import { analyzeVideo } from "../features/video-analyze.js";

const videoPath = '/tmp/user-video-portrait.mp4';

const prompt = `请详细分析这个视频的肖像权风险，重点关注以下方面：

## 1. 人物识别
- 视频中出现了多少人？
- 每个人的面部是否清晰可辨认？
- 是否有路人/背景人物入镜？

## 2. 肖像权风险评估
对每个出现的人物，评估：
- **主要人物**：是否为演员/模特（通常已签约授权）还是普通人？
- **路人/背景人物**：是否面部清晰？是否需要打码？
- **名人相似度**：是否与已知公众人物高度相似？

## 3. 商业使用风险
- 如果用于商业广告，存在哪些肖像权隐患？
- 是否需要额外的肖像授权？

## 4. 风险等级总结
请给出整体肖像权风险等级（低/中/高），并说明理由。

## 5. 建议措施
如果存在风险，建议采取哪些措施？`;

async function main() {
  console.log(`Analyzing with Gemini 3.1 Pro...`);
  
  const result = await analyzeVideo(videoPath, {
    prompt,
    model: "gemini-3.1-pro-preview",
    log: (msg) => console.log(msg),
  });
  
  console.log('\n=== Gemini 3.1 Pro 肖像权分析结果 ===\n');
  console.log(result.text);
  console.log(`\n---\n模型: ${result.model} | Tokens: ${result.usage.promptTokens} → ${result.usage.completionTokens} | 耗时: ${(result.durationMs/1000).toFixed(1)}s | 成本: $${result.estimatedCostUsd?.toFixed(4) || 'N/A'}`);
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
