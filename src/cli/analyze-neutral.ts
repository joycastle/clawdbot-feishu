import { analyzeVideo } from "../features/video-analyze.js";

const prompt = `请客观描述这个视频中的人物。

## 任务
1. 描述视频中出现的每个人物的外貌特征（年龄、性别、肤色、发型、面部特征等）
2. 如果这些人物让你联想到某个公众人物/名人，请说明：
   - 具体是谁
   - 相似的具体特征有哪些
   - 不相似的具体特征有哪些
   - 用 1-10 分评估整体相似度（1=完全不像，10=几乎一模一样）
3. 如果你认为不像任何名人，也请直接说明

## 要求
- 只陈述你观察到的事实
- 不要预设结论
- 不要迎合任何倾向
- 如实报告你的判断和置信度`;

async function main() {
  console.log('中立分析视频1...\n');
  
  const result = await analyzeVideo('/tmp/video1.mp4', {
    prompt,
    model: "gemini-3.1-pro-preview",
    log: (msg) => console.log(msg),
  });
  
  console.log('\n=== Gemini 中立分析结果 ===\n');
  console.log(result.text);
  console.log(`\n📊 Tokens: ${result.usage.promptTokens}→${result.usage.completionTokens} | 耗时: ${(result.durationMs/1000).toFixed(1)}s | 成本: $${result.estimatedCostUsd?.toFixed(4)}`);
}

main();
