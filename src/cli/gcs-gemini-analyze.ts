import { Storage } from '@google-cloud/storage';
import { VertexAI } from '@google-cloud/vertexai';

const SA_PATH = '/home/ubuntu/.openclaw/credentials/google-vertex-sa.json';
const PROJECT_ID = 'larkbot-485707';
const BUCKET_NAME = 'larkbot-storage';

const gcsUri = process.argv[2];
if (!gcsUri) {
  console.error('Usage: npx tsx script.ts <gcs_uri>');
  process.exit(1);
}

async function main() {
  // Call Gemini with GCS URI - 用 us-central1 + gemini-2.0-flash
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: 'us-central1',
    googleAuthOptions: { keyFilename: SA_PATH },
  });
  
  const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
  
  console.log(`Analyzing ${gcsUri} with Gemini...`);
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { fileData: { mimeType: 'text/plain', fileUri: gcsUri } },
        { text: '分析这个日志文件，总结关键信息、错误、警告等。' },
      ],
    }],
  });
  
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('\n=== Gemini 分析结果 ===\n');
  console.log(text || 'No response');
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
