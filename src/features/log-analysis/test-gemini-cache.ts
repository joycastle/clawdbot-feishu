/**
 * Gemini GCS + Context Caching 测试 (Vertex AI)
 * 
 * 流程：
 * 1. 上传日志到 GCS
 * 2. 创建 Context Cache（引用 GCS URI）
 * 3. 多次查询复用缓存
 */

import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';

// 配置
const LOG_FILE = '/home/ubuntu/.clawdbot/media/inbound/37EmOPLwXEJ3dIPQPvE4Hap7zgg_3959rv9OOZ7ehWvmd1T4U6Uq6px_2026---5b22c45f-386b-4d38-b474-477154b4f643';
const PROJECT_ID = 'larkbot-485707';
const LOCATION = 'us-central1';
const BUCKET_NAME = 'larkbot-storage';
const SA_PATH = '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json';

async function main() {
  console.log('🚀 Gemini GCS + Context Caching 测试 (Vertex AI)\n');

  // 设置凭证
  process.env.GOOGLE_APPLICATION_CREDENTIALS = SA_PATH;

  // 读取日志文件
  const stats = fs.statSync(LOG_FILE);
  console.log(`📄 日志文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  const lines = content.split('\n').length;
  console.log(`📝 日志行数: ${lines.toLocaleString()}\n`);

  let gcsFile: any = null;
  let cache: any = null;
  
  try {
    // Step 1: 上传到 GCS
    console.log('📤 正在上传文件到 GCS...');
    const uploadStart = Date.now();
    
    const storage = new Storage({ keyFilename: SA_PATH });
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsFileName = `log-analysis/${Date.now()}-bingo-log.txt`;
    gcsFile = bucket.file(gcsFileName);
    
    await gcsFile.save(content, { contentType: 'text/plain' });
    const gcsUri = `gs://${BUCKET_NAME}/${gcsFileName}`;
    
    console.log(`✅ GCS 上传成功! 用时: ${Date.now() - uploadStart}ms`);
    console.log(`   GCS URI: ${gcsUri}\n`);

    // Step 2: 初始化 Vertex AI 客户端
    const ai = new GoogleGenAI({
      vertexai: true,
      project: PROJECT_ID,
      location: LOCATION,
    });

    // Step 3: 创建 Context Cache
    console.log('💾 正在创建 Context Cache...');
    const cacheStart = Date.now();

    const systemPrompt = `你是一个专业的游戏日志分析专家。你正在分析 Bingo Voyage (BV) 游戏的客户端日志。

日志格式说明：
- I: Info 级别
- W: Warning 级别  
- E: Error 级别
- 格式: 级别:线程:帧:时间戳 消息内容

请根据用户的问题分析日志，识别问题、异常、性能瓶颈等。回答要简洁专业。`;

    cache = await ai.caches.create({
      model: 'gemini-1.5-flash-002',
      config: {
        displayName: 'BingoVoyage Log Cache',
        systemInstruction: systemPrompt,
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { fileUri: gcsUri, mimeType: 'text/plain' } }],
          },
        ],
        ttl: '1800s', // 缓存 30 分钟
      },
    });

    console.log(`✅ Cache 创建成功! 用时: ${Date.now() - cacheStart}ms`);
    console.log(`   Cache 名称: ${cache.name}`);
    console.log(`   Token 数量: ${cache.usageMetadata?.totalTokenCount?.toLocaleString()}`);
    console.log(`   过期时间: ${cache.expireTime}\n`);

    // Step 4: 多次查询测试
    const queries = [
      '这个日志中有哪些 Error？列出来',
      '启动过程花了多长时间？有没有性能问题？',
      'WebSocket 连接是否正常？有没有断开重连？',
    ];

    console.log('🔍 开始测试查询...\n');

    for (const query of queries) {
      console.log(`❓ 问题: ${query}`);
      const queryStart = Date.now();

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash-002',
        contents: query,
        config: {
          cachedContent: cache.name,
        },
      });

      console.log(`⏱️  用时: ${Date.now() - queryStart}ms`);
      console.log(`📊 Token 使用:`);
      console.log(`   - 缓存 token: ${response.usageMetadata?.cachedContentTokenCount?.toLocaleString() || 'N/A'}`);
      console.log(`   - 输入 token: ${response.usageMetadata?.promptTokenCount?.toLocaleString() || 'N/A'}`);
      console.log(`   - 输出 token: ${response.usageMetadata?.candidatesTokenCount?.toLocaleString() || 'N/A'}`);
      console.log(`💬 回答:\n${response.text}\n`);
      console.log('---\n');
    }

    // Step 5: 清理
    console.log('🧹 清理资源...');
    if (cache?.name) await ai.caches.delete({ name: cache.name });
    if (gcsFile) await gcsFile.delete();
    console.log('✅ 清理完成');

    // 总结
    console.log('\n📋 方案验证成功!');
    console.log('   1. 上传日志到 GCS');
    console.log('   2. 创建 Context Cache（引用 GCS URI）');
    console.log('   3. 多次查询复用缓存，节省 token 成本');

  } catch (error: any) {
    console.error('❌ 错误:', error.message);
    if (error.status) {
      console.error('   状态码:', error.status);
    }
    if (error.details) {
      console.error('   详情:', JSON.stringify(error.details, null, 2));
    }
    
    // 清理
    try {
      if (gcsFile) await gcsFile.delete().catch(() => {});
    } catch {}
  }
}

main();
