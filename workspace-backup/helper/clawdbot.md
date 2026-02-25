# Clawdbot 原生指令速查

> 快速参考：所有 `/` 开头的斜杠指令

---

## 🚀 核心指令

| 指令 | 说明 | 示例 |
|------|------|------|
| `/new` | 开始新会话（可选模型） | `/new` `/new opus` |
| `/reset` | 同 `/new` | |
| `/status` | 当前状态（模型、用量等） | |
| `/help` | 帮助信息 | |
| `/commands` | 指令列表 | |

---

## 🧠 模型切换

| 指令 | 说明 | 示例 |
|------|------|------|
| `/model` | 显示模型选择器 | |
| `/model list` | 同上 | |
| `/model <序号>` | 按序号选择 | `/model 3` |
| `/model <名称>` | 按名称/别名选择 | `/model opus` `/model sonnet` |
| `/model status` | 显示模型详情 | |

**常用别名：**
- `opus` → anthropic/claude-opus-4-5
- `sonnet` → anthropic/claude-sonnet-4-5
- `gpt` → openai/gpt-5.2
- `gemini` → google/gemini-3-pro-preview

---

## 💭 思考/推理模式

| 指令 | 说明 | 值 |
|------|------|-----|
| `/think <级别>` | 设置思考深度 | `off` `minimal` `low` `medium` `high` `xhigh` |
| `/thinking` | 同上（别名） | |
| `/t` | 同上（简写） | |
| `/reasoning on\|off\|stream` | 推理输出开关 | |
| `/verbose on\|full\|off` | 详细输出 | |

---

## 🔧 执行控制

| 指令 | 说明 | 示例 |
|------|------|------|
| `/exec` | 显示当前 exec 设置 | |
| `/exec host=<类型>` | 设置执行环境 | `sandbox` `gateway` `node` |
| `/exec security=<级别>` | 安全级别 | `deny` `allowlist` `full` |
| `/elevated on\|off\|ask\|full` | 提权模式 | |
| `/approve <id> <动作>` | 处理审批请求 | `allow-once` `allow-always` `deny` |

---

## 📨 消息队列

| 指令 | 说明 |
|------|------|
| `/queue` | 显示当前队列设置 |
| `/queue steer` | 新消息重定向当前任务 |
| `/queue followup` | 按顺序处理消息 |
| `/queue collect` | 批量处理后统一回复（默认）|
| `/queue interrupt` | 中断当前任务重新开始 |

**可选参数：** `debounce:2s cap:25 drop:summarize`

---

## 🎙️ 语音 (TTS)

| 指令 | 说明 |
|------|------|
| `/tts off` | 关闭语音 |
| `/tts always` | 始终语音 |
| `/tts inbound` | 仅语音输入时回复语音 |
| `/tts status` | 当前状态 |

---

## 📊 用量与上下文

| 指令 | 说明 |
|------|------|
| `/usage off\|tokens\|full\|cost` | 每条回复显示用量 |
| `/context` | 上下文信息 |
| `/context detail` | 详细（各文件/工具大小）|
| `/compact [指令]` | 压缩会话历史 |

---

## 👤 身份与权限

| 指令 | 说明 |
|------|------|
| `/whoami` | 显示你的 sender ID |
| `/id` | 同上 |
| `/allowlist` | 列出白名单 |
| `/allowlist add <id>` | 添加（需 config 权限）|
| `/allowlist remove <id>` | 移除 |

---

## 🤖 子代理

| 指令 | 说明 |
|------|------|
| `/subagents list` | 列出当前会话的子代理 |
| `/subagents stop <id>` | 停止子代理 |
| `/subagents log <id>` | 查看日志 |
| `/subagents info <id>` | 详情 |
| `/subagents send <id> <msg>` | 发消息给子代理 |

---

## 🛠️ 技能

| 指令 | 说明 | 示例 |
|------|------|------|
| `/skill <名称> [输入]` | 运行技能 | `/skill weather 北京` |

---

## ⚙️ 配置（需开启）

需要 `commands.config: true`：

| 指令 | 说明 |
|------|------|
| `/config show` | 显示配置 |
| `/config get <key>` | 读取配置项 |
| `/config set <key>=<value>` | 设置配置 |
| `/config unset <key>` | 删除配置项 |

需要 `commands.debug: true`：

| 指令 | 说明 |
|------|------|
| `/debug show` | 显示运行时覆盖 |
| `/debug set <key>=<value>` | 设置临时覆盖 |
| `/debug reset` | 清除所有覆盖 |

---

## 🔄 其他

| 指令 | 说明 |
|------|------|
| `/stop` | 停止当前任务 |
| `/restart` | 重启（需开启）|
| `/send on\|off` | 发送开关 |
| `/activation mention\|always` | 群聊激活方式 |
| `/dock-telegram` | 切换回复到 Telegram |
| `/dock-discord` | 切换回复到 Discord |
| `/dock-slack` | 切换回复到 Slack |

---

## 💡 快捷中断词

以下单词可直接发送来中断任务（不需要 `/`）：

```
stop  abort  esc  wait  exit  interrupt
```

---

## 📝 Bash 命令（需开启）

需要 `commands.bash: true` + `tools.elevated` 配置：

| 指令 | 说明 |
|------|------|
| `! <命令>` | 执行 shell 命令 |
| `/bash <命令>` | 同上 |
| `!poll` | 检查后台任务状态 |
| `!stop` | 停止后台任务 |

---

## ⚠️ 注意事项

1. 大多数指令需要作为**独立消息**发送
2. 部分指令支持内联（allowlisted senders）：`/help` `/status` `/whoami`
3. 群聊中 `/verbose` `/reasoning` 可能暴露内部信息，谨慎使用
4. 指令和参数之间可以加 `:` 如 `/think: high`
