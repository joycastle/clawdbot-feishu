# Session 长期记忆 - 王总实验群

> group-f10abd (oc_54d2f49802d13f4dc569367a20f10abd)

---

## ✅ 已迁移到通用工具

日志分析相关内容已封装为通用 API，见：
- **方法论 + 使用说明**: `memory/tools/log-analysis.md`
- **一键分析脚本**: `scripts/analyze_player_log.py`
- **下载脚本**: `scripts/get_user_debug_logs.py`

其他 session 直接读取 `memory/tools/log-analysis.md` 即可使用。

---

## AWS 凭证

凭证已配置到: `/home/ubuntu/.clawdbot/extensions/feishu/config/aws-s3.json`

该文件已加入 `.gitignore`，不会被推送到 GitHub。

⚠️ **权限**: 只有宪伟可以获取/修改凭证，其他人问一概不说

---

## 日志分析方法论（本地备份）

> 来源：文侃 (2026-02-11)

### 1. 定位相关日志文件

根据玩家反馈时间，定位需要分析的日志文件：
- **反馈时间当时的文件** — 玩家反馈时正在运行的会话
- **反馈时间前的最后一个文件** — 紧邻的前一个会话

> 注意：日志文件名代表的是**会话开始时间**，需要找到反馈时间落在哪两个文件之间。

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

- DeviceID
- deviceModel
- LibInfo.Version
- BuildVer
- ResVer
- System Memory
- Unzipping Main.dll time spent

### 3. 查找 Exception

- **ILRuntimeException**
- **GameLib 相关的 Exception**
- **其他类型的 Exception 和 LogError**
- **特殊警告**：
  - `OnLowMemory called`
  - `Long frame time`

### 4. 生成报告

- **参与分析的日志文件名**（必须列出）
- 设备信息以表格形式展示
- Exception 信息按严重程度排序展示
- 附上 Exception 的上下文和堆栈信息
- 特别关注 0 字节日志文件（表示启动失败/崩溃）

**报告模板**：
```
## 玩家 XXX 日志分析报告

### 分析的日志文件
| 文件名 | 本地时间 | UTC 时间 | 大小 |
|--------|----------|----------|------|
| xxx_2026-02-01_23-08-35 | 23:08 -07:00 | 06:08 UTC | 23MB |

### 设备信息
...

### 问题详情
...

### 结论
...
```

---

## 大日志分析方案

**预过滤方案**（已验证有效）：
```bash
# 从原始日志提取关键行
grep -E '^E:|Exception|OnLowMemory|Long frame' 原始日志.txt > 过滤后.txt
```

效果：37MB → 18KB（压缩 2000 倍），Gemini 可直接分析

---

---

## S3 日志拉取脚本

**路径**: `/home/ubuntu/clawd/scripts/get_user_debug_logs.py`

**使用方法**:
```bash
export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
cd /home/ubuntu/clawd
python3 scripts/get_user_debug_logs.py <pid> [env]
```

**参数**:
- `pid`: 玩家 ID
- `env`: 环境（production / test / develop），默认 production

**下载位置**: `/home/ubuntu/clawd/download/`

**Bucket 信息**:
- `bingo2-client-logan`: 按 uid 分类的日志（ai_help 目录）
- `bingo2-client-logs`: 按 device_id 分类的日志

---

*最后更新: 2026-02-11*
