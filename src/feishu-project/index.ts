/**
 * 飞书项目 API 模块
 * 封装飞书项目（project.feishu.cn）的 Open API 调用
 */

// 客户端
export { FeishuProjectClient, type FeishuProjectClientOptions } from './client.js';

// 单例管理
export { initProjectClient, getProjectClient, resetProjectClient } from './instance.js';

// API 模块（按需导入）
export * as projectApi from './api/project.js';
export * as workitemApi from './api/workitem.js';
export * as workflowApi from './api/workflow.js';
export * as subtaskApi from './api/subtask.js';
export * as relationApi from './api/relation.js';
export * as manhourApi from './api/manhour.js';
export * as fieldApi from './api/field.js';
export * as templateApi from './api/template.js';
export * as commentApi from './api/comment.js';

// 类型导出
export type {
  ApiResponse,
  Pagination,
  UserInfo,
  WorkItemType,
  WorkItem,
  WorkItemDetail,
  FieldValuePair,
  WorkflowInfo,
  WorkflowNode,
  StateInfo,
  SubTask,
  WorkItemRelation,
  StoryRelation,
  ManHourRecord,
  FieldDefinition,
  FieldOption,
  Business,
  Template,
  FlowRole,
  Comment,
  RichTextContent,
  FileComment,
  SearchParams,
  SearchGroup,
  SearchParam,
  ExpandOptions,
  OperationRecord,
  Project,
  ProjectDetail,
  PluginTokenResponse,
} from './api/types.js';

// 基础工具
export { request, buildPath, buildQuery, type RequestContext } from './api/base.js';
