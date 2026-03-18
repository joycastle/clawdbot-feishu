import { VertexAI } from "@google-cloud/vertexai";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const MEMORY_DIR = "/home/ubuntu/clawd/memory";
const MAX_CHUNK_CHARS = 80000; // ~20K tokens per chunk
const PROJECT_ID = "larkbot-485707";
const LOCATION = "us-central1";

// 递归读取所有 md 文件
function readAllMemoryFiles(dir: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      results.push(...readAllMemoryFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      results.push({
        path: fullPath.replace(MEMORY_DIR, "memory"),
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }
  return results;
}

// 分块
function chunkMemory(files: { path: string; content: string }[]): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (const file of files) {
    const fileContent = `\n--- ${file.path} ---\n${file.content}\n`;
    
    if (currentChunk.length + fileContent.length > MAX_CHUNK_CHARS) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = fileContent;
    } else {
      currentChunk += fileContent;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  
  return chunks;
}

async function queryMemory(question: string) {
  // 设置凭证
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json";
  
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  
  console.log("读取记忆文件...");
  const files = readAllMemoryFiles(MEMORY_DIR);
  console.log(`找到 ${files.length} 个文件`);
  
  const chunks = chunkMemory(files);
  console.log(`分成 ${chunks.length} 块`);
  
  // 并行处理每个块
  console.log("并行查询各块...");
  const startTime = Date.now();
  
  const chunkResults = await Promise.all(
    chunks.map(async (chunk, i) => {
      const prompt = `你是一个记忆管理助手。以下是一部分记忆内容，请根据这些内容回答问题。如果这部分内容没有相关信息，回复"此块无相关信息"。

## 记忆内容
${chunk}

## 问题
${question}

## 回答（简洁）`;
      
      const result = await model.generateContent(prompt);
      const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log(`块 ${i + 1} 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s): ${text.slice(0, 60)}...`);
      return text;
    })
  );
  
  // 过滤无关结果
  const relevantResults = chunkResults.filter(r => !r.includes("无相关信息"));
  
  console.log(`\n有效结果: ${relevantResults.length}/${chunkResults.length} 块`);
  
  if (relevantResults.length === 0) {
    return "记忆中没有找到相关信息。";
  }
  
  // 汇总
  console.log("汇总结果...");
  const aggregatePrompt = `根据以下多个信息片段，综合回答问题。

## 问题
${question}

## 信息片段
${relevantResults.map((r, i) => `### 片段 ${i + 1}\n${r}`).join("\n\n")}

## 综合回答`;
  
  const finalResult = await model.generateContent(aggregatePrompt);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`总耗时: ${totalTime}s`);
  
  return finalResult.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// 测试
const question = process.argv[2] || "我是谁？介绍一下我的身份和特点。";
console.log(`\n问题: ${question}\n`);

queryMemory(question).then(answer => {
  console.log("\n========== 最终答案 ==========");
  console.log(answer);
}).catch(console.error);
