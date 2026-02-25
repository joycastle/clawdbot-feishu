# Jenkins 操作

## 指令识别（重要！）

**常见说法 → 对应操作：**

| 用户说的 | 我该做的 |
|---------|---------|
| "30s后重启开发服" | cron job 30s 后执行 `bf-jenkins.sh restart develop` |
| "1分钟后重启 test2" | cron job 1min 后执行 `bv-jenkins.sh restart test2` |
| "重启开发服" | 立即执行重启脚本 |
| "帮我重启一下 release" | 立即执行重启脚本 |
| "检查一下配置" | 执行 check 命令 |

**定时重启流程：**
```bash
# 用 cron 的延时任务 API
curl -X POST http://127.0.0.1:18797/add -H "Content-Type: application/json" \
  -d '{"job":{"schedule":"in 30 seconds","text":"执行 BF 开发服重启"}}'
```

或者用 shell 的 sleep：
```bash
(sleep 30 && ~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh restart develop) &
```

## 权限规则（2026-02-11 更新）

**基于来源群判断，不看发的人是谁：**
- BF研发大群发的 → 有 BF 所有操作权限
- BV研发大群发的 → 有 BV 所有操作权限
- 私聊或其他群 → 检查 USER.md 里的"有重启权限"

---

## BV Jenkins

**脚本：** `~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh`

### 操作类型

| 操作 | 说明 |
|------|------|
| restart | 更新 GDS + 部署 Model（标准重启） |
| hotupdate | 热更新 GDS + 部署 Model |
| deploy | 完整部署 + 部署 Model |
| check | 配置检查（调用 BingoTool API） |

### 环境

- dev（开发）
- test, test2, test3, test4（测试）
- design（策划）

### 用法

```bash
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh restart dev
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh hotupdate test
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh deploy design
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-jenkins.sh check dev
```

### 客户端打包

```bash
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-build.sh android          # 安卓包
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-build.sh android-mini     # 安卓 mini 包
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-build.sh ios              # iOS 包
~/.clawdbot/extensions/feishu/scripts/jenkins/bv-build.sh ios feature-xxx  # 指定分支
```

---

## BF Jenkins

**脚本：** `~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh`

### 操作类型

| 操作 | 说明 |
|------|------|
| restart | 配置检查 + 重启服务器 |
| update | 配置检查 + 更新配置（不重启） |
| check | 仅检查配置 |

### 环境

- develop（开发服，默认）
- develop1（开发服 1）
- release（预发布）
- plan（策划服）

### 用法

```bash
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh restart develop
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh restart develop1
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh update develop
~/.clawdbot/extensions/feishu/scripts/jenkins/bf-jenkins.sh check develop
```

### API 配置

- Jenkins: jenkins.bingo-testing.elitescastle.com
- BingoTool: bingo-tools.bingo-testing.elitescastle.com
- Sheet ID: 1XkorKsp8XLiXubD9ffpFsvS6gSXTtbMqk1fe-EDv3ss
- API Key: BingoFrenzy
