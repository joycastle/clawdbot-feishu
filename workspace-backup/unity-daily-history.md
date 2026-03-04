# Unity 每日技术推送历史

记录已推送过的内容，避免重复。

---

## 2026-02-16
*迁移初始化，暂无历史记录*

## 2026-02-21

### 技术资源
1. Unity Draw Call Batching 终极指南（2026更新）- 减少 DrawCall 和 SetPass 的实战方案
2. DOTS Animation Bridge - 连接 ECS 系统与 Animator 的开源桥接包

### 知识小课堂
1. Draw Call 与 Batching 合批原理
2. NativeArray 与 Job System 基础

## 2026-02-22

### 技术资源
1. Unity Shader 示例库 300+ - 全类型 Shader 合集，从基础光照到高级后处理
2. Unity 性能优化完全指南 2025 - Burst、SRP Batcher、GPU Instancing 等现代优化技术

### 知识小课堂
1. ScriptableObject 数据驱动设计
2. Object Pooling 对象池模式

## 2026-02-23

### 技术资源
1. UniTask - 零GC分配的异步/await库，替代Coroutine的高性能方案
2. SplineMesh - 实时贝塞尔曲线网格生成插件，适合道路/管道/轨道等曲线内容

### 知识小课堂
1. Coroutine vs async/await 异步编程对比
2. SerializeField 与 Unity 序列化系统

## 2026-02-24

### 技术资源
1. Unity-MCP - AI驱动Unity开发的MCP桥接工具，让Claude/Cursor直接操作Unity Editor
2. Aim-IK - 程序化头部/脊椎朝向控制包，无需动画数据的视线跟踪方案

### 知识小课堂
1. Addressables vs Resources 资源加载系统对比
2. Quaternion 四元数旋转基础

## 2026-02-25

### 技术资源
1. Unity 6 内存优化完全指南 - Memory Profiler 实战教程，解决内存泄漏和崩溃问题
2. Create Shaders & VFX with URP（Unity官方电子书）- URP着色器与视觉特效制作指南

### 知识小课堂
1. GC 垃圾回收优化：避免运行时分配
2. 渲染管线选择：Built-in vs URP vs HDRP

## 2026-02-26

### 技术资源
1. Shader Graph 无代码着色器开发指南 - 可视化节点创建着色器，支持 Keywords 条件分支
2. Compute Shader 程序化草地生成方案 - GPU 驱动生成百万级草地位置，零卡顿

### 知识小课堂
1. Shader Keywords 变体编译系统
2. Unity Native Collections 高性能容器

## 2026-02-27

### 技术资源
1. TEngine - 集成 HybridCLR + YooAsset + Obfuz 的商业级热更新框架
2. NavMeshPlus - 2D 游戏导航网格生成工具

### 知识小课堂
1. HybridCLR 热更新原理与 AOT/JIT 混合
2. LOD（Level of Detail）层级细节系统

## 2026-02-28

### 技术资源
1. Smart Lighting 2D - Unity Awards 获奖的2D动态光照解决方案
2. Timeline 时间线系统 - 可视化序列编辑器

### 知识小课堂
1. Graphics.Blit 与 RenderTexture 后处理应用
2. Physics.Raycast 射线检测系统详解

## 2026-03-01

### 技术资源
1. DOTween - 高性能补间动画引擎，链式语法一行代码搞定复杂动画
2. ParrelSync - 本地多编辑器实例同时运行，多人游戏调试神器

### 知识小课堂
1. Animation Layers 动画分层系统 - Override/Additive 模式与 Avatar Mask
2. Custom Editor 自定义编辑器 - OnInspectorGUI 面板扩展

## 2026-03-02

### 技术资源
1. Unity DOTS-training-samples（官方训练项目）- 从 MonoBehaviour 迁移到 DOTS 的实战练习集
2. Ultimate Guide to Profiling Unity Games (Unity 6 版) - 官方近 100 页性能分析电子书

### 知识小课堂
1. ISystem vs SystemBase：ECS 系统选择 - 非托管结构体零 GC，配合 Burst 性能提升 10-50 倍
2. Physics.OverlapSphereNonAlloc：零 GC 碰撞检测 - 预分配数组避免运行时分配

### AI 资讯
1. Anthropic 拒绝五角大楼监控武器用途，引发行业震动
2. Google DeepMind 发布 Gemini 3.1 Pro - 100 万 Token 上下文，ARC-AGI-2 得分 77.1%

### Claude Code 技巧
1. CLAUDE.md 项目说明文件 - 自动读取作为上下文
2. 多环境无缝切换 - CLI/VS Code/Desktop/Web 共享配置

## 2026-03-03

### 技术资源
1. Unity 内置对象池 API (ObjectPool<T>) - 2021+ 官方 API 使用教程
2. Addressables 异步资产管理完整指南 - 动态加载、依赖追踪、内存管理

### 知识小课堂
1. IDisposable 与 NativeArray 内存管理模式
2. AssetReference 软引用与异步加载

### AI 资讯
1. Anthropic 被五角大楼列入安全风险名单，Claude 应用却冲上 App Store 榜首
2. 美国政府机构开始从 Anthropic 切换到 OpenAI

### Claude Code 技巧
1. /insights 命令 - 分析编码习惯生成 HTML 报告
2. /rewind 时间旅行调试 - Esc+Esc 分别回退代码和对话

## 2026-03-04

### 技术资源
1. Odin Inspector & Serializer - 编辑器扩展神器，70+ 特性标签和强大序列化
2. Mirror 网络框架 - 开源 UNET 继承者，多传输层支持

### 知识小课堂
1. Input System 新输入管理系统 - 回调式监听、多设备热插拔
2. ScriptableObject 事件总线 - 解耦的事件系统设计模式

### AI 资讯
1. Apple 官宣 Siri 将采用 Google Gemini 模型
2. 100+ Google DeepMind 员工要求限制军方使用 Gemini

### Claude Code 技巧
1. /hooks 自定义钩子 - PreToolUse/PostToolUse/Notification 事件
2. Shift+Tab 紧凑模式 - 减少 token 消耗
