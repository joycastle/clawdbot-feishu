import { analyzeVideo } from "../features/video-analyze.js";

const videos = [
  { path: '/tmp/video1.mp4', name: '视频1' },
  { path: '/tmp/video2.mp4', name: '视频2' },
  { path: '/tmp/video3.mp4', name: '视频3' },
];

const prompt = `请详细分析这个视频的肖像权风险，重点关注：

1. **人物识别**：出现多少人？面部是否清晰？有无路人入镜？
2. **名人相似度**：是否与已知公众人物高度相似？（如有请指出具体名人）
3. **风险等级**：低/中/高，并说明理由
4. **建议措施**：如需要，给出具体建议

请用简洁的结构化格式回答。`;

async function main() {
  for (const v of videos) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`分析 ${v.name} (${v.path})`);
    console.log('='.repeat(60));
    
    try {
      const result = await analyzeVideo(v.path, {
        prompt,
        model: "gemini-3.1-pro-preview",
        log: (msg) => console.log(msg),
      });
      
      console.log(`\n--- ${v.name} 分析结果 ---\n`);
      console.log(result.text);
      console.log(`\n📊 Tokens: ${result.usage.promptTokens}→${result.usage.completionTokens} | 耗时: ${(result.durationMs/1000).toFixed(1)}s | 成本: $${result.estimatedCostUsd?.toFixed(4)}`);
    } catch (e: any) {
      console.error(`❌ ${v.name} 分析失败: ${e.message}`);
    }
  }
}

main();
