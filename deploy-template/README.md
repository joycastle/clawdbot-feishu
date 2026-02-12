# 本地兼容性测试指南

用于在本地测试 Clawdbot 新版本与飞书扩展的兼容性，**不连接飞书**。

## 快速开始

```bash
# 1. 安装要测试的 Clawdbot 版本
npm install -g clawdbot@latest  # 或指定版本

# 2. 创建配置目录
mkdir -p ~/.clawdbot

# 3. 复制测试配置（channels 已清空，不会连飞书）
cp clawdbot.local-test.json ~/.clawdbot/clawdbot.json

# 4. 复制 .env（需要 ANTHROPIC_API_KEY）
cp .env.example ~/.clawdbot/.env
# 编辑 .env 填入你的 API Key

# 5. 复制飞书扩展（从仓库根目录）
mkdir -p ~/.clawdbot/extensions
cp -r ../ ~/.clawdbot/extensions/feishu

# 6. 测试
clawdbot doctor          # 检查配置
clawdbot gateway start   # 启动看有没有报错
clawdbot gateway logs    # 查看日志
```

## 测试什么

- ✅ 配置格式兼容性
- ✅ 核心模块加载
- ✅ 飞书扩展能否初始化
- ✅ 依赖是否正常
- ❌ 不会真正连接飞书
- ❌ 不会处理消息

## 文件说明

| 文件 | 说明 |
|------|------|
| `clawdbot.local-test.json` | 主配置（channels 已清空） |
| `.env.example` | 环境变量模板 |
| `README.md` | 本文件 |

## 需要的环境变量

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-xxx  # 必须
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json  # 可选，用 Vertex AI 需要
```

## 如果要测完整链路

需要：
1. 填入真实的飞书凭证到配置
2. 或创建测试用飞书应用
3. 确保不和生产环境冲突
