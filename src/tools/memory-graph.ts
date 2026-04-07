/**
 * memory_graph — 实体关系图数据库工具
 *
 * 支持对人物、项目、概念等实体建立关系图谱，
 * 进行实体查询、关系追踪、路径发现等操作。
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

// ─── Schema ──────────────────────────────────────────────────────────────────

const MemoryGraphSchema = Type.Object({
  action: Type.Union([
    Type.Literal("stats"),
    Type.Literal("get_entity"),
    Type.Literal("list_entities"),
    Type.Literal("create_entity"),
    Type.Literal("get_relations"),
    Type.Literal("create_relation"),
    Type.Literal("find_path"),
    Type.Literal("link_memory"),
    Type.Literal("search"),
  ], {
    description: "操作类型",
  }),
  // 实体相关
  entity_id: Type.Optional(Type.String({
    description: "实体 ID（名称）",
  })),
  entity_type: Type.Optional(Type.String({
    description: "实体类型（如 person, project, concept, tool, group）",
  })),
  name: Type.Optional(Type.String({
    description: "实体名称",
  })),
  properties: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: "实体属性（JSON 对象）",
  })),
  // 关系相关
  from_id: Type.Optional(Type.String({
    description: "关系起点实体名称",
  })),
  to_id: Type.Optional(Type.String({
    description: "关系终点实体名称",
  })),
  relation_type: Type.Optional(Type.String({
    description: "关系类型（如 owns, uses, knows, related_to）",
  })),
  // 路径查找
  start_id: Type.Optional(Type.String({
    description: "路径起点实体名称",
  })),
  end_id: Type.Optional(Type.String({
    description: "路径终点实体名称",
  })),
  max_depth: Type.Optional(Type.Integer({
    description: "最大搜索深度，默认 2",
    minimum: 1,
    maximum: 10,
  })),
  // 记忆关联
  memory_path: Type.Optional(Type.String({
    description: "记忆文件路径",
  })),
  snippet: Type.Optional(Type.String({
    description: "记忆片段内容",
  })),
  // 搜索
  query: Type.Optional(Type.String({
    description: "搜索关键词（实体名称）",
  })),
  limit: Type.Optional(Type.Integer({
    description: "返回结果数量限制",
    minimum: 1,
    maximum: 100,
  })),
});

type MemoryGraphParams = Static<typeof MemoryGraphSchema>;

// ─── Constants ───────────────────────────────────────────────────────────────

const GRAPH_API_BASE = "http://127.0.0.1:18803";

// ─── Helper ──────────────────────────────────────────────────────────────────

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function error(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

async function apiCall(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  const url = `${GRAPH_API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }
  return response.json();
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleStats() {
  // GET /stats
  const data = await apiCall("/stats");
  return json(data);
}

async function handleGetEntity(params: MemoryGraphParams) {
  // GET /entity?name=xxx — 返回 {entity, relations, memories}
  const name = params.entity_id || params.name;
  if (!name) {
    return error("entity_id or name is required for get_entity");
  }
  const data = await apiCall(`/entity?name=${encodeURIComponent(name)}`);
  return json(data);
}

async function handleListEntities(params: MemoryGraphParams) {
  // GET /list?type=xxx — 返回 {entities: [...]}
  const queryParams = new URLSearchParams();
  if (params.entity_type) queryParams.set("type", params.entity_type);
  const query = queryParams.toString();
  const data = await apiCall(`/list${query ? `?${query}` : ""}`);
  return json(data);
}

async function handleCreateEntity(params: MemoryGraphParams) {
  // POST /entity — body: {type, name, data?}
  if (!params.entity_type || !params.name) {
    return error("entity_type and name are required for create_entity");
  }
  const body = {
    type: params.entity_type,
    name: params.name,
    data: params.properties || {},
  };
  const data = await apiCall("/entity", "POST", body);
  return json(data);
}

async function handleGetRelations(params: MemoryGraphParams) {
  // 使用 get_entity 获取关系
  const name = params.entity_id || params.name;
  if (!name) {
    return error("entity_id is required for get_relations");
  }
  const data = await apiCall(`/entity?name=${encodeURIComponent(name)}`) as { relations?: unknown[] };
  return json({ relations: data.relations || [] });
}

async function handleCreateRelation(params: MemoryGraphParams) {
  // POST /relation — body: {from, to, relation, weight?}
  if (!params.from_id || !params.to_id || !params.relation_type) {
    return error("from_id, to_id, and relation_type are required for create_relation");
  }
  const body = {
    from: params.from_id,
    to: params.to_id,
    relation: params.relation_type,
    weight: 1.0,
  };
  const data = await apiCall("/relation", "POST", body);
  return json(data);
}

async function handleFindPath(params: MemoryGraphParams) {
  // GET /find?name=xxx&depth=N — 查找相关实体
  const name = params.start_id || params.query;
  if (!name) {
    return error("start_id is required for find_path");
  }
  const depth = params.max_depth || 2;
  const data = await apiCall(`/find?name=${encodeURIComponent(name)}&depth=${depth}`);
  return json(data);
}

async function handleLinkMemory(params: MemoryGraphParams) {
  // POST /memory — body: {entity, path, line?, snippet?, relevance?}
  const entityName = params.entity_id || params.name;
  if (!entityName || !params.memory_path) {
    return error("entity_id and memory_path are required for link_memory");
  }
  const body = {
    entity: entityName,
    path: params.memory_path,
    snippet: params.snippet || "",
  };
  const data = await apiCall("/memory", "POST", body);
  return json(data);
}

async function handleSearch(params: MemoryGraphParams) {
  // 使用 /find 或遍历 /list 进行搜索
  if (!params.query) {
    return error("query is required for search");
  }
  // 尝试直接查找
  try {
    const data = await apiCall(`/find?name=${encodeURIComponent(params.query)}&depth=1`);
    return json(data);
  } catch {
    // 如果没找到，返回空结果
    return json({ entity: null, related: [] });
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

async function handleMemoryGraph(params: MemoryGraphParams) {
  try {
    switch (params.action) {
      case "stats":
        return handleStats();
      case "get_entity":
        return handleGetEntity(params);
      case "list_entities":
        return handleListEntities(params);
      case "create_entity":
        return handleCreateEntity(params);
      case "get_relations":
        return handleGetRelations(params);
      case "create_relation":
        return handleCreateRelation(params);
      case "find_path":
        return handleFindPath(params);
      case "link_memory":
        return handleLinkMemory(params);
      case "search":
        return handleSearch(params);
      default:
        return error(`Unknown action: ${params.action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerMemoryGraphTool(api: ClawdbotPluginApi) {
  // ⚠️ 重要：registerTool 必须用工厂函数签名 (ctx) => ({...})
  // 不能用 { inputSchema } 对象签名，否则会报 Cannot read properties of undefined (reading 'properties')
  api.registerTool(
    (_ctx) => ({
      name: "memory_graph",
      label: "Memory Graph",
      description:
        "实体关系图数据库。用于存储和查询人物、项目、概念之间的关系。\n\n" +
        "Actions:\n" +
        "- stats: 获取数据库统计信息\n" +
        "- get_entity: 获取单个实体详情（需要 entity_id）\n" +
        "- list_entities: 列出实体（可选 entity_type, limit）\n" +
        "- create_entity: 创建实体（需要 entity_type, name，可选 properties）\n" +
        "- get_relations: 获取实体的关系（需要 entity_id，可选 relation_type）\n" +
        "- create_relation: 创建关系（需要 from_id, to_id, relation_type）\n" +
        "- find_path: 查找两个实体间的路径（需要 start_id, end_id，可选 max_depth）\n" +
        "- link_memory: 关联记忆文件到实体（需要 entity_id, memory_path）\n" +
        "- search: 搜索实体（需要 query，可选 entity_type, limit）\n\n" +
        "示例:\n" +
        '- 查统计: { "action": "stats" }\n' +
        '- 查实体: { "action": "get_entity", "entity_id": "person_baogen" }\n' +
        '- 建实体: { "action": "create_entity", "entity_type": "person", "name": "张三", "properties": { "role": "PM" } }\n' +
        '- 查关系: { "action": "get_relations", "entity_id": "person_baogen" }\n' +
        '- 建关系: { "action": "create_relation", "from_id": "person_baogen", "to_id": "project_bf", "relation_type": "owns" }\n' +
        '- 找路径: { "action": "find_path", "start_id": "person_a", "end_id": "project_b" }\n' +
        '- 搜索: { "action": "search", "query": "监控" }',
      parameters: MemoryGraphSchema,
      async execute(_id: string, params: MemoryGraphParams) {
        return handleMemoryGraph(params);
      },
    }),
    { name: "memory_graph" },
  );
}
