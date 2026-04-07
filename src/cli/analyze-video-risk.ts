import { VertexAI } from '@google-cloud/vertexai';
import * as fs from 'fs';

const SA_PATH = '/home/ubuntu/.openclaw/credentials/google-vertex-sa.json';
const PROJECT_ID = 'larkbot-485707';

const videoPath = process.argv[2] || '/tmp/jimeng-video-new.mp4';

async function main() {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: 'us-central1',
    googleAuthOptions: { keyFilename: SA_PATH },
  });
  
  const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
  
  console.log(`Reading video ${videoPath}...`);
  const videoData = fs.readFileSync(videoPath);
  const base64Video = videoData.toString('base64');
  
  console.log(`Analyzing with Gemini (${(videoData.length / 1024 / 1024).toFixed(2)} MB)...`);
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { 
          inlineData: { 
            mimeType: 'video/mp4', 
            data: base64Video 
          } 
        },
        { text: `请详细分析这个视频，重点关注以下方面：

1. **画面内容**：描述视频中的人物、场景、动作
2. **角色外观**：人物的服装、发型、外貌特征
3. **场景设计**：背景、道具、整体风格
4. **版权风险评估**：
   - 是否与已知影视作品（如《生活大爆炸》The Big Bang Theory）相似？
   - 角色设计是否像已有IP角色（如霍华德的红黑格子衬衫）？
   - 场景/对话是否有明显借鉴痕迹？

请给出详细分析和版权风险等级（低/中/高）。` },
      ],
    }],
  });
  
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('\n=== 视频分析结果 ===\n');
  console.log(text || 'No response');
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
