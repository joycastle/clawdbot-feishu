# 定时任务 (Cron)

> ⚠️ **2026-02-25 更新**：HTTP API (18797) 的人类友好格式转换**未实现**，必须用完整 schema！

---

## 方式一：原生 cron 工具（推荐）

直接调用 clawdbot 的 cron 工具，参数必须严格按 schema。

### Schedule 格式

| kind | 必需字段 | 说明 |
|------|---------|------|
| `"at"` | `atMs` | 一次性任务，指定时间戳（毫秒） |
| `"cron"` | `expr` | 周期性任务，5位 cron 表达式（UTC！） |
| `"every"` | `everyMs` | 间隔执行，毫秒数 |

### 一次性任务（X秒/分钟后）

```json
{
  "action": "add",
  "job": {
    "name": "bf-dev1-restart",
    "schedule": {
      "kind": "at",
      "atMs": 1771995980000
    },
    "sessionTarget": "isolated",
    "payload": {
      "kind": "agentTurn",
      "message": "执行 xxx 脚本，完成后回复 HEARTBEAT_OK"
    }
  }
}
```

**计算 atMs**：`当前时间戳(ms) + 延迟时间(ms)`
```bash
# 30秒后的时间戳
echo $(($(date +%s)*1000 + 30000))
```

### 周期性任务（cron 表达式）

```json
{
  "action": "add",
  "job": {
    "name": "daily-report",
    "schedule": {
      "kind": "cron",
      "expr": "0 1 * * *"
    },
    "sessionTarget": "isolated",
    "payload": {
      "kind": "agentTurn",
      "message": "执行日报任务"
    },
    "deliver": true,
    "channel": "feishu",
    "to": "chat:oc_xxx"
  }
}
```

⚠️ **cron 表达式用 UTC 时间！** 北京时间 -8 小时。

### Payload 类型

| kind | 字段 | 说明 |
|------|------|------|
| `"agentTurn"` | `message` | 作为用户消息触发 agent 回复 |
| `"systemEvent"` | `text` | 作为系统事件，不进入对话历史 |

### 其他字段

| 字段 | 说明 |
|------|------|
| `sessionTarget` | `"main"` 主 session / `"isolated"` 隔离 session |
| `wakeMode` | `"next-heartbeat"`（默认） |
| `deliver` | `true` 直接投递回复到指定渠道 |
| `channel` | 投递渠道：`"feishu"` |
| `to` | 投递目标：`"user:ou_xxx"` 或 `"chat:oc_xxx"` |

---

## 方式二：HTTP API (localhost:18797)

> ⚠️ **注意**：人类友好格式（`"in 5 minutes"`）**未实现**！必须用完整 schema，和原生工具一样。

```bash
# 列出所有任务
curl http://127.0.0.1:18797/list

# 添加任务（必须完整 schema）
curl -X POST http://127.0.0.1:18797/add -H "Content-Type: application/json" -d '{
  "job": {
    "name": "test-job",
    "schedule": {"kind": "at", "atMs": 1771995980000},
    "sessionTarget": "isolated",
    "payload": {"kind": "agentTurn", "message": "测试任务"}
  }
}'

# 删除任务
curl -X POST http://127.0.0.1:18797/remove -H "Content-Type: application/json" -d '{"id": "job-uuid"}'

# 立即运行
curl -X POST http://127.0.0.1:18797/run -H "Content-Type: application/json" -d '{"id": "job-uuid"}'
```

---

## 方式三：Shell sleep（Fallback）

简单粗暴，适合一次性快速任务，但**不可追溯、不可取消**。

```bash
(sleep 30 && ~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh restart develop1) &
```

---

## 常见错误

| 错误 | 原因 |
|------|------|
| `unexpected property 'text'` | job 里不能直接用 `text`，要放在 `payload.message` 或 `payload.text` |
| `must be object` at `/schedule` | schedule 必须是对象，不能是字符串 |
| `must have required property 'sessionTarget'` | 缺少 sessionTarget 字段 |
| `must have required property 'payload'` | 缺少 payload 字段 |
| `kind: must be equal to constant` | kind 值错误，只能是 `"at"` / `"cron"` / `"every"` |

---

## 使用场景映射

| 用户说的 | 该怎么做 |
|---------|---------|
| "30秒后重启服务器" | cron add, `kind: "at"`, `atMs: now+30000` |
| "5分钟后提醒我xxx" | cron add, `kind: "at"`, `atMs: now+300000` |
| "每天早上9点提醒" | cron add, `kind: "cron"`, `expr: "0 1 * * *"`（UTC 1点=北京9点） |
| "取消刚才的提醒" | 先 list 找 id，再 remove |

---

## 教训（2026-02-25）

1. **不要偷懒用 sleep**：cron job 可追溯、可取消
2. **schedule 必须是对象**：`{"kind": "at", "atMs": xxx}` 不是 `"in 5 minutes"`
3. **payload 必须有**：不能直接在 job 里写 `text`
4. **HTTP API 没有格式转换**：文档说的人类友好格式是假的
