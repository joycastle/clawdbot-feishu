/**
 * Gemini Files API + Context Caching 测试
 * 使用 Google AI Studio API Key（非 Vertex AI）
 * 
 * 需要设置环境变量: GEMINI_API_KEY
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

// 配置
const LOG_FILE = '/home/ubuntu/.clawdbot/media/inbound/37EmOPLwXEJ3dIPQPvE4Hap7zgg_3959rv9OOZ7ehWvmd1T4U6Uq6px_2026---5b22c45f-386b-4d38-b474-477154b4f643';

async function main() {
  console.log('🚀 Gemini Files API + Context Caching 测试\n');

  // 检查 API Key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ 需要设置 GEMINI_API_KEY 环境变量');
    console.error('   获取方式: https://aistudio.google.com/apikey');
    process.exit(1);
  }

  // 初始化客户端
  const ai = new GoogleGenAI({ apiKey });

  // 读取日志文件
  const stats = fs.statSync(LOG_FILE);
  console.log(`📄 日志文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').length;
  console.log(`📝 日志行数: ${lines.toLocaleString()}\n`);

  try {
    // Step 1: 上传文件到 Files API
    console.log('📤 正在上传文件到 Gemini Files API...');
    const uploadStart = Date.now();
    
    const fileBuffer = fs.readFileSync(LOG_FILE);
    const file = await ai.files.upload({
      file: new Blob([fileBuffer], { type: 'text/plain' }),
      config: {
        displayName: 'bingo-voyage-log.txt',
        mimeType: 'text/plain',
      },
    });
    
    console.log(`✅ 文件上传成功! 用时: ${Date.now() - uploadStart}ms`);
    console.log(`   文件名: ${file.name}`);
    console.log(`   URI: ${file.uri}`);
    console.log(`   状态: ${file.state}`);

    // 等待文件处理完成
    let processedFile = file;
    if (processedFile.state === 'PROCESSING') {
      console.log('⏳ 等待文件处理...');
      while (processedFile.state === 'PROCESSING') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        processedFile = await ai.files.get({ name: file.name! });
        console.log(`   状态: ${processedFile.state}`);
      }
    }
    
    if (processedFile.state !== 'ACTIVE') {
      throw new Error(`文件处理失败，状态: ${processedFile.state}`);
    }
    console.log('');

    // Step 2: 创建 Context Cache
    console.log('💾 正在创建 Context Cache...');
    const cacheStart = Date.now();

    const cache = await ai.caches.create({
      model: 'gemini-1.5-flash-001', // 需要使用支持缓存的模型版本
      config: {
        displayName: 'BingoVoyage Log Cache',
        systemInstruction: `你是一个专业的游戏日志分析专家。你正在分析 Bingo Voyage (BV) 游戏的客户端日志。

日志格式说明：
- I: Info 级别
- W: Warning 级别  
- E: Error 级别
- 格式: 级别:线程:帧:时间戳 消息内容

请根据用户的问题分析日志，识别问题、异常、性能瓶颈等。回答要简洁专业。`,
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { fileUri: processedFile.uri!, mimeType: 'text/plain' } }],
          },
        ],
        ttl: '1800s', // 缓存 30 分钟
      },
    });

    console.log(`✅ Cache 创建成功! 用时: ${Date.now() - cacheStart}ms`);
    console.log(`   Cache 名称: ${cache.name}`);
    console.log(`   Token 数量: ${cache.usageMetadata?.totalTokenCount?.toLocaleString()}`);
    console.log(`   过期时间: ${cache.expireTime}\n`);

    // Step 3: 使用缓存进行多次查询
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
        model: 'gemini-1.5-flash-001',
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

    // Step 4: 清理资源
    console.log('🧹 清理资源...');
    await ai.caches.delete({ name: cache.name! });
    await ai.files.delete({ name: file.name! });
    console.log('✅ 清理完成');

    // 总结
    console.log('\n📋 方案总结:');
    console.log('   1. Files API 上传大文件，获取 URI');
    console.log('   2. 创建 Context Cache，引用文件 URI');
    console.log('   3. 后续查询使用 cachedContent 参数');
    console.log('   4. 节省 token 成本，加速响应');

  } catch (error: any) {
    console.error('❌ 错误:', error.message);
    if (error.status) {
      console.error('   状态码:', error.status);
    }
    if (error.details) {
      console.error('   详情:', JSON.stringify(error.details, null, 2));
    }
  }
}

main();
