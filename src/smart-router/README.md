# 智能路由 (Smart Router)

## 背景

当前所有消息都走同一个模型（claude-opus-4-5），响应延迟 5-15s，成本较高。
简单的问候/闲聊不需要这么重的模型，复杂的深度分析可能需要更强的推理能力。

## 目标

根据消息类型和复杂度，自动选择最优的处理策略，平衡响应速度、质量和成本。

## 设计方案

### 一、模型路由（按复杂度分层）

| 层级 | 场景 | 候选模型 | 预期延迟 |
|------|------|---------|---------|
| L0 | 简单问候/闲聊/短回复 | gemini-3-flash / claude haiku | <2s |
| L1 | 常规问答/代码/分析 | claude-opus-4-5（当前默认） | 5-15s |
| L2 | 深度推理/复杂任务 | claude-opus-4-5 + thinking | 15-30s |

#### 复杂度判定信号

- 消息长度（短消息倾向 L0）
- 是否包含代码/技术术语
- 是否有明确的分析/创作需求关键词
- 上下文中是否有正在进行的复杂讨论
- 是否 @ 指定要深度分析
- 是否带附件（图片/文件/视频）

#### 实现方式（两个方案可选）

**A. 规则引擎（推荐先做）**
- 基于消息长度、关键词、消息类型等硬规则分类
- 零延迟，无额外成本
- 覆盖 80% 场景

**B. 轻量 LLM 分类器（后续优化）**
- 用最便宜的模型（如 gemini-3-flash）做一次分类
- 更准确，但增加一次 API 调用的延迟和成本
- 适合边界情况

### 二、流程路由（按消息类型）

| 消息类型 | 处理管线 | 说明 |
|---------|---------|------|
| 纯文本 | 走模型路由选模型 → agent | 主路径 |
| 图片 | 视觉模型预处理 → agent | 可用轻量模型先理解图片 |
| 视频 | Gemini 异步分析 → 结果注入 | 已有管线，保持不变 |
| 文件/文档 | 解析提取 → agent | 飞书文档走 API，其他走本地解析 |
| 语音 | Whisper 转文字 → 当文本处理 | 已有能力 |

### 三、实现位置

在飞书插件层实现（不在 Clawdbot 核心层），原因：
1. Clawdbot 没有 `message:received` 入站消息 hook（planned 但未实现）
2. Clawdbot 模型选择是静态的（config primary → fallbacks），无动态路由能力
3. 飞书插件 `handleFeishuMessage` 是消息入口，可以在 dispatch 之前做路由

#### 集成点

```
handleFeishuMessage()
  → 消息预处理（解析类型、提取文本）
  → smartRouter.classify(message)  // 返回路由决策
  → 设置 session modelOverride     // 动态切换模型
  → dispatchReplyFromConfig()       // 正常 dispatch
```

## 文件结构

```
src/smart-router/
├── README.md          # 本文件
├── index.ts           # 路由器主入口
├── classifier.ts      # 消息分类器（规则引擎 + LLM 分类）
├── rules.ts           # 规则定义
└── types.ts           # 类型定义
```

## 待确定

- [ ] L0 具体用哪个模型？（gemini-3-flash-preview vs claude haiku）
- [ ] 分类器的具体规则阈值（消息长度、关键词列表等）
- [ ] 是否需要支持用户手动覆盖路由（如 /model 强制指定）
- [ ] modelOverride 的设置方式（通过 Clawdbot API 还是直接改 session store）
- [ ] 分类结果是否需要日志/统计
- [ ] 群聊 vs 私聊是否需要不同的路由策略

## 时间线

- Phase 1: 规则引擎 + 模型路由（L0/L1 两级）
- Phase 2: 加入 L2 层级 + thinking 级别控制
- Phase 3: LLM 分类器替换/辅助规则引擎
- Phase 4: 流程路由优化（图片/文件预处理管线）
