# big-video/ - 大视频分析

处理多维表格（Bitable）里的大视频文件（>20MB），通过 GCS 中转后用 Gemini 分析。

## 文件说明

| 文件 | 说明 |
|------|------|
| `bitable-video-cli.ts` | CLI 入口，Agent 调用这个来触发分析 |
| `bitable-video-confirm.ts` | 确认卡片处理，用户点确认后开始分析 |
| `bitable-video-handler.ts` | 上传处理，从多维表格下载视频上传到 GCS |
| `bitable-video.ts` | 多维表格操作，读取视频记录 |
| `gcs-upload.ts` | GCS 上传，把视频传到 Google Cloud Storage |
| `video-cache.ts` | 视频缓存，避免重复下载 |

## 使用流程

```
1. Agent 调用 bitable-video-cli.ts
2. 从多维表格下载视频 → 上传到 GCS
3. 发送确认卡片给用户
4. 用户点击确认
5. 调用 Gemini 分析视频
6. 返回分析结果
```

## CLI 用法

```bash
npx tsx src/features/big-video/bitable-video-cli.ts \
  --target <latest|number> \
  --prompt "分析需求" \
  --to "user:<open_id>" \
  --reply-to "<message_id>" \
  --sender "<sender_open_id>"
```

## 配置

- 多维表格 app_token: `OW7lbIpSlaf4nEsiDKLcqiYGn7c`
- 多维表格 table_token: `tblPFJHzLTyXMGcJ`
- GCS bucket: `larkbot-storage`
