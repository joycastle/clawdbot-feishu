# 代码索引服务 + 调用图 (Code Index API)

**端口**: 18801  
**位置**: `~/.clawdbot/extensions/feishu/src/services/code-index-api.ts`  
**数据**: `~/.clawdbot/extensions/feishu/data/code-index/`

## 功能概览

| 功能 | 数据量 | 说明 |
|------|--------|------|
| 代码摘要索引 | 3849 条 | 函数/类/方法摘要 |
| 调用图 | 14843 节点, 56917 边 | 函数调用关系 |
| 类型继承 | 2484 条 | extends/implements |
| 装饰器索引 | 5111 个 | @Rpc/@Controller 等 |
| 模块依赖 | 110 模块 | 按目录聚合 |

---

## 基础 API

### 搜索代码
```bash
curl "http://127.0.0.1:18801/search?q=rescue&p=bf-nakama-ts&limit=10"
```

### 健康检查 / 项目列表
```bash
curl http://127.0.0.1:18801/health
curl http://127.0.0.1:18801/projects
```

---

## ⭐ 调用图查询

### 谁调用了这个函数 / 它调用了谁
```bash
curl "http://127.0.0.1:18801/graph/callers?name=addRescueBall"
curl "http://127.0.0.1:18801/graph/callees?name=claimRoundAward"
```

### 两点间的调用路径
```bash
curl "http://127.0.0.1:18801/graph/path?from=claimRoundAward&to=addRescueBall"
```

### 影响范围分析 ⭐
```bash
# 改了某函数，哪些地方会受影响
curl "http://127.0.0.1:18801/graph/impact?name=addRescueBall&depth=3"
```

### 热点 / 孤立函数 / 统计
```bash
curl "http://127.0.0.1:18801/graph/hotspots?limit=10"   # 被调用最多的函数
curl "http://127.0.0.1:18801/graph/orphans?limit=20"    # 没有调用者（入口/死代码）
curl "http://127.0.0.1:18801/graph/stats"               # 图统计
```

### 循环依赖检测
```bash
curl "http://127.0.0.1:18801/graph/cycles?limit=10"
# 返回: mutualCalls (A调B且B调A) + selfLoops (自递归)
```

---

## ⭐ 模块依赖分析

### 模块列表
```bash
curl "http://127.0.0.1:18801/graph/modules?depth=3&limit=20"
# Top: src/bingo/campaign(5746), src/bingo/play(2099), src/bingo/promo(862)
```

### 某模块依赖谁 / 谁依赖它
```bash
curl "http://127.0.0.1:18801/graph/module-deps?module=src/bingo/campaign"
curl "http://127.0.0.1:18801/graph/module-dependents?module=src/bingo"
```

### 模块依赖矩阵
```bash
curl "http://127.0.0.1:18801/graph/module-matrix?depth=3&limit=15"
# 11392 次跨模块调用
```

---

## ⭐ 类型继承图

### 查找子类/实现类
```bash
curl "http://127.0.0.1:18801/graph/children?name=ServerResp"
# ServerResp 有 245 个子接口
```

### 查找父类/接口
```bash
curl "http://127.0.0.1:18801/graph/parents?name=ClaimRoundAwardResp"
```

### 继承树（递归）
```bash
curl "http://127.0.0.1:18801/graph/inheritance-tree?name=FESchema&direction=down&depth=3"
```

### 继承统计
```bash
curl "http://127.0.0.1:18801/graph/inheritance-stats"
# extends: 2135, implements: 349
# Top: Record<string,unknown>(733), ServerResp(226), ClientMsg(154)
```

---

## ⭐ 装饰器索引

### RPC 端点列表
```bash
curl "http://127.0.0.1:18801/graph/rpc-endpoints?limit=50"
# 915 个 RPC 端点
```

### Controller 列表
```bash
curl "http://127.0.0.1:18801/graph/controllers"
# 141 个 Controller
```

### 装饰器统计
```bash
curl "http://127.0.0.1:18801/graph/decorator-stats"
# Top: Validate(1316), Doc(1313), Rpc(915), TestRpc(443)
```

### 查找使用某装饰器的目标
```bash
curl "http://127.0.0.1:18801/graph/decorator-targets?name=PersonalLock"
```

---

## 重建索引

```bash
cd ~/work/bf/nakama-ts/tools

# 调用图
npx tsx extract-call-graph.ts

# 类型继承
npx tsx extract-inheritance.ts

# 装饰器
npx tsx extract-decorators.ts

# 代码摘要
npx tsx extract-summaries.ts > ../docs/summaries.jsonl
```

---

## 使用场景

| 场景 | 推荐 API |
|------|----------|
| 某函数做什么 | `/graph/callers` + `/graph/callees` |
| 追踪调用链 | `/graph/path` |
| 改代码前评估影响 | `/graph/impact` |
| 理解架构层级 | `/graph/children` + `/graph/parents` |
| 查 RPC 定义 | `/graph/rpc-endpoints` |
| 分析模块依赖 | `/graph/module-deps` |
