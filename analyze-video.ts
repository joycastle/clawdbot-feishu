#!/usr/bin/env npx tsx
import { VertexAI } from '@google-cloud/vertexai';
import { readFileSync } from 'fs';

async function main() {
  const vertexAI = new VertexAI({
    project: 'larkbot-485707',
    location: 'us-central1',
    googleAuthOptions: {
      keyFilename: '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json',
    },
  });

  const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

  // Read video file and convert to base64
  const videoBuffer = readFileSync('/tmp/user_video.mp4');
  const base64Video = videoBuffer.toString('base64');

  console.log('Analyzing video with Gemini...');
  console.log('Video size:', videoBuffer.length, 'bytes');

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
        { text: '详细描述这个视频中的形象/角色。重点关注：1) 外观特征 2) 风格（真人、AI生成、动画等）3) 整体氛围和感觉' },
      ],
    }],
  });

  console.log('\n=== 分析结果 ===\n');
  console.log(result.response.candidates?.[0]?.content?.parts?.[0]?.text);
}

main().catch(console.error);
