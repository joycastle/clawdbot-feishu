#!/usr/bin/env npx tsx
/**
 * Bitable Video CLI - 多维表格视频分析
 * 
 * 这是 cli/ 的索引入口，实际实现在 features/big-video/bitable-video-cli_core.ts
 * 
 * 用法:
 *   npx tsx src/cli/bitable-video.ts --target <latest|number> --prompt "分析需求" \
 *     --to "user:<open_id>" --reply-to "<message_id>" --sender "<sender_open_id>"
 */

// 直接执行 core 实现
import "../features/big-video/bitable-video-cli_core.js";
