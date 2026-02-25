# 玩家日志分析工具

> 通用工具，所有 session 可用
> 凭证已内置，无需配置

---

## 快速使用

### 一键分析（推荐）

```bash
cd /home/ubuntu/.clawdbot/extensions/feishu
npx tsx src/cli/log-analyze.ts --pid <pid> --time "<反馈时间>"
```

**示例**：
```bash
# UTC 时间
npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC"

# 本地时间（带时区）
npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 16:33:55 -07:00"

# 只下载不分析
npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 16:33:55 -07:00" --download-only

# 完整分析模式（大文件 > 10MB 走 GCS + Gemini）
npx tsx src/cli/log-analyze.ts --pid 791542412 --time "2026-02-02 06:08:39 UTC" --full
```

### 分析模式

| 模式 | 说明 |
|------|------|
| 默认 | grep 预过滤，本地分析（快速、省资源） |
| `--full` | 直接走 GCS + Gemini 完整分析 |

**什么时候用 `--full`**：
- 用户对 grep 过滤结果不满意
- 需要完整上下文分析
- 想让 AI 看完整日志

**输出位置**: `/home/ubuntu/clawd/download/`

### 手动分析（下载后）

```bash
# 查看文件列表
ls -lh /home/ubuntu/clawd/download/

# 分析指定文件
grep -E 'DeviceID|deviceModel|BuildVer|ResVer|System Memory' <文件>
grep -E '^E:|Exception|OnLowMemory|Long frame' <文件>
```

---

## 日志分析方法论

### 1. 定位相关日志文件

根据玩家反馈时间，定位需要分析的日志文件：
- **反馈时间当时的文件** — 玩家反馈时正在运行的会话
- **反馈时间前的最后三个文件** — 紧邻前一个会话

> 日志文件名代表的是**会话开始时间**，需要找到反馈时间落在哪几个文件之间。

### ⚠️ 时区处理（重要）

1. **日志文件名中的时间是玩家本地时区**，不是 UTC
2. **玩家时区需要从日志内容中获取**，查找类似 `+00:00` 或 `-07:00` 的时区标记
3. **反馈时间（UTC）需要先转换为玩家本地时间**，再定位日志文件

**示例**：
- 反馈时间：`2026-02-02 06:08 UTC`
- 玩家时区：`-07:00`（从日志内容获取）
- 本地时间：`06:08 - 7h = 2026-02-01 23:08`
- 应该找文件名包含 `2026-02-01_23-08` 的日志

### 2. 查找设备基础信息

```bash
grep -E 'DeviceID|deviceModel|LibInfo\.Version|BuildVer|ResVer|System Memory|Unzipping Main\.dll' <文件>
```

### 3. 查找 Exception

```bash
grep -E '^E:|Exception|OnLowMemory|Long frame' <文件>
```

重点关注：
- **ILRuntimeException**
- **GameLib 相关的 Exception**
- **ThreadAbortException**
- **OnLowMemory called**
- **Long frame time > 5000ms**

### 4. 生成报告

报告必须包含：
- **参与分析的日志文件名**（含本地时间和大小）
- 设备信息表格
- Exception/问题列表（按严重程度）
- 结论

---

## 大日志预过滤

当日志 > 10MB 时，先过滤再分析：

```bash
grep -E '^E:|Exception|OnLowMemory|Long frame' 原始日志.txt > 过滤后.txt
```

效果：37MB → 18KB（压缩 2000 倍）

---

## S3 存储结构

| Bucket | 路径格式 | 说明 |
|--------|----------|------|
| bingo2-client-logan | `{env}/logs/ai_help/{uid}` | 按 UID 分类 |
| bingo2-client-logs | `logs/{device_id}` | 按设备 ID 分类 |

---

## 权限说明

- **AWS 凭证**：只有宪伟可以提供，不要在群里公开
- **日志分析方法**：公开，所有人可用

---

## 相关脚本

| 脚本 | 说明 |
|------|------|
| `scripts/analyze_player_log.py` | 一键分析（下载 + 分析 + 报告） |
| `scripts/get_user_debug_logs.py` | 仅下载日志 |

---

*来源：王总实验群 (2026-02-11)*
*维护：文侃、宝根*
