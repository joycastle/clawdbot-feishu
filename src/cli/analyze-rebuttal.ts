import { analyzeVideo } from "../features/video-analyze.js";

const prompt = `请重新审视这个视频中人物与名人的相似度，这次请用**更严格、更客观**的标准：

## 严格审视要求

1. **区分"部分特征相似"和"整体高度相似"**
   - 如果只是发型像、眉毛位置像、肤色像，这不构成"高度相似"
   - 只有五官整体轮廓、面部比例、标志性特征都高度吻合，才算"高度相似"

2. **普通观众混淆测试**
   - 一个普通观众（不是专业人士）看到这个视频，会不会真的以为是某个名人在代言？
   - 还是只是"有点像某个人"的程度？

3. **重新评估**
   - 如果之前判断存在"高度相似名人"，请重新审视：
     - 具体哪些核心特征是相似的？
     - 哪些特征是不同的？
     - 相似程度是否足以让普通人产生混淆？

4. **修正结论**
   - 如果之前的判断过于牵强（比如只是发型像），请诚实修正
   - 给出修正后的风险等级

请诚实、客观地重新评估，不要为了"找到风险"而强行匹配名人。`;

async function main() {
  console.log('重新用严格标准分析视频1...\n');
  
  const result = await analyzeVideo('/tmp/video1.mp4', {
    prompt,
    model: "gemini-3.1-pro-preview",
    log: (msg) => console.log(msg),
  });
  
  console.log('\n=== Gemini 重新审视结果 ===\n');
  console.log(result.text);
  console.log(`\n📊 Tokens: ${result.usage.promptTokens}→${result.usage.completionTokens} | 耗时: ${(result.durationMs/1000).toFixed(1)}s | 成本: $${result.estimatedCostUsd?.toFixed(4)}`);
}

main();
