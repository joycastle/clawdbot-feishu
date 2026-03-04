# Vertex AI + GCS 大文件分析

> 文件超过 20MB 要给 Gemini 分析时，用这条路径

## 什么时候用

| 场景 | 限制 | 方案 |
|------|------|------|
| 飞书 IM 下载 | 100MB | 直接下载 |
| Gemini inline | **20MB** | 小文件直接传 |
| Gemini GCS | **2GB** | 大文件走 GCS 中转 |

**判断逻辑**：文件 > 20MB → 必须用 GCS 路径

---

## 配置信息

| 配置项 | 值 |
|--------|-----|
| GCS Bucket | `larkbot-storage` |
| SA 文件 | `/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json` |
| SA 邮箱 | `openclaw@larkbot-485707.iam.gserviceaccount.com` |
| Project | `larkbot-485707` |
| Vertex AI Location | `us-central1`（Gemini 2.x）/ `global`（Gemini 3.x） |

### Gemini 3 特殊配置

Gemini 3 系列（gemini-3-flash-preview 等）需要 `global` region，**但 SDK 有 bug**，必须手动指定 `apiEndpoint`：

```typescript
const vertexAI = new VertexAI({
  project: 'larkbot-485707',
  location: 'global',
  apiEndpoint: 'aiplatform.googleapis.com',  // ← 必须加这个！
  googleAuthOptions: {
    keyFilename: '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json',
  },
});
const model = vertexAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
```

不加 `apiEndpoint` 会报 404（SDK 错误地构造成 `global-aiplatform.googleapis.com`）。

---

## 代码示例

### 1. 上传文件到 GCS

```typescript
import { Storage } from '@google-cloud/storage';

const storage = new Storage({
  keyFilename: '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json',
  projectId: 'larkbot-485707',
});

const bucket = storage.bucket('larkbot-storage');

// 上传
await bucket.upload('/path/to/local/file.mp4', {
  destination: 'video/filename.mp4',
});

// GCS URI
const gcsUri = 'gs://larkbot-storage/video/filename.mp4';
```

### 2. 用 GCS URI 调用 Gemini

```typescript
import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({
  project: 'larkbot-485707',
  location: 'us-central1',
  googleAuthOptions: {
    keyFilename: '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json',
  },
});

const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });

const result = await model.generateContent({
  contents: [{
    role: 'user',
    parts: [
      { fileData: { mimeType: 'video/mp4', fileUri: 'gs://larkbot-storage/video/filename.mp4' } },
      { text: '分析这个视频' },
    ],
  }],
});

console.log(result.response.candidates[0].content.parts[0].text);
```

---

## ⚠️ 常见误区

### 测试 Vertex AI 用 SDK，不要用 curl！

这台机器**没有 gcloud CLI**，所以：
- ❌ `curl` + `gcloud auth print-access-token` → 会失败（command not found）
- ✅ 用 Node.js SDK 测试

**正确的测试方式：**
```bash
cd ~/.clawdbot/extensions/feishu && node -e "
const { VertexAI } = require('@google-cloud/vertexai');
const vertexAI = new VertexAI({
  project: 'larkbot-485707',
  location: 'us-central1',
  googleAuthOptions: {
    keyFilename: '/home/ubuntu/.clawdbot/credentials/google-vertex-sa.json',
  },
});
const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });
model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
  .then(r => console.log('✅ 成功:', r.response.candidates[0].content.parts[0].text.slice(0,50)))
  .catch(e => console.log('❌ 失败:', e.message));
"
```

### Files API vs GCS

| 概念 | 平台 | 我们用吗 |
|------|------|----------|
| **Files API** | Google AI Studio | ❌ 不用 |
| **GCS URI** | Vertex AI | ✅ 用这个 |

**当别人提到 "Files API" 时**：
- 这是 Google AI Studio 的概念，需要 `GEMINI_API_KEY`
- 我们用的是 **Vertex AI**，走 GCS 路径
- 不要被误导去找 Files API

---

## ⚠️ Context Caching 限制

> 用 GCS 做 Context Caching 有更严格的限制

| 限制项 | 值 | 说明 |
|--------|-----|------|
| text/plain 文件 | **7 MB** | 超过会报错 |
| 模型上下文 | **1M tokens** | gemini-2.5-flash |

**实测数据**：6MB 日志 ≈ 257万 tokens，远超 1M 限制

**结论**：Context Caching 不适合大日志分析，需要**预过滤**（只保留 Error/Warning）或**分块处理**

---

## 已验证场景

- 视频分析（最大测试过 339MB）✅
- 日志分析（最大测试过 12MB txt）⚠️ 超限制，需预处理
- 权限验证：SA 对 larkbot-storage 有对象读写权限 ✅

---

*最后更新: 2026-02-11*
