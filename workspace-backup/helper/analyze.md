# 分析能力

> 视频分析、日志分析

---

## 🎬 视频分析

从多维表格取视频 → Gemini 分析

**使用方式：**
- 「分析最新的视频」
- 「看看 3 号视频」

**流程：**
```
多维表格视频 → 下载 → GCS（>20MB）→ Gemini → 结果
```

**CLI：**
```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/bitable-video.ts \
  --target latest --prompt "分析需求"
```

---

## 📋 玩家日志分析

分析玩家客户端日志，定位问题

**使用方式：**
- 「帮我分析一下这个玩家的日志，pid xxx，反馈时间 xxx」

**一键分析：**
```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/log-analyze.ts \
  --pid <玩家ID> --time "<反馈时间>"
```

**示例：**
```bash
# 默认模式（grep 预过滤）
npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC"

# 完整模式（大文件走 GCS + Gemini）
npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC" --full
```

**分析内容：**
- 设备信息（型号、内存、版本）
- Exception 和错误
- 内存警告、长帧

---

## 🔍 GCS + Gemini 通用分析

大文件（>20MB）分析通用路径

```bash
npx tsx ~/.clawdbot/extensions/feishu/src/cli/gcs-gemini-analyze.ts \
  --file <本地文件> --prompt "分析需求"
```

---

## 详细文档

- `memory/tools/log-analysis.md`
- `memory/tools/vertex-gcs.md`
