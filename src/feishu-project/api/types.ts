/**
 * 飞书项目 API 类型定义
 */

// ============ 通用类型 ============

/** 通用 API 响应 */
export interface ApiResponse<T> {
  err_code: number;
  err_msg: string;
  err?: {
    code: number;
    msg: string;
    log_id?: string;
  };
  data?: T;
}

/** 分页信息 */
export interface Pagination {
  page_num?: number;
  page_size?: number;
  total?: number;
}

/** 用户信息 */
export interface UserInfo {
  user_key: string;
  username?: string;
  name_cn?: string;
  name_en?: string;
  avatar_url?: string;
}

// ============ 工作项类型 ============

/** 工作项类型 */
export interface WorkItemType {
  type_key: string;
  name: string;
  api_name?: string;
  is_disable?: number; // 1=禁用, 2=启用
  enable_model_resource_lib?: boolean;
}

/** 工作项基本信息 */
export interface WorkItem {
  id: number;
  work_item_id?: number;
  name: string;
  work_item_type_key: string;
  project_key: string;
  template_id?: string;
  template_name?: string;
  current_nodes?: WorkflowNode[];
  simple_name?: string;
  created_at?: number;
  updated_at?: number;
  created_by?: string;
  updated_by?: string;
}

/** 工作项详情 */
export interface WorkItemDetail extends WorkItem {
  fields?: FieldValuePair[];
  workflow_infos?: WorkflowInfo[];
  sub_stages?: string[];
  pattern?: number;
}

/** 字段值对 */
export interface FieldValuePair {
  field_key: string;
  field_value: unknown;
  field_type_key?: string;
  field_alias?: string;
}

// ============ 工作流类型 ============

/** 工作流信息 */
export interface WorkflowInfo {
  workflow_id?: string;
  workflow_name?: string;
  nodes?: WorkflowNode[];
}

/** 工作流节点 */
export interface WorkflowNode {
  id?: string;
  node_id?: string;
  name?: string;
  status?: number; // 1=未开始, 2=进行中, 3=已完成
  owners?: UserInfo[];
  actual_begin_time?: number;
  actual_finish_time?: number;
  schedule_begin_time?: number;
  schedule_finish_time?: number;
}

/** 状态信息 */
export interface StateInfo {
  state_key: string;
  name?: string;
  is_final?: boolean;
}

// ============ 子任务类型 ============

/** 子任务 */
export interface SubTask {
  task_id: string;
  name: string;
  status?: number; // 1=未完成, 2=已完成
  owner?: UserInfo;
  deadline?: number;
  created_at?: number;
  updated_at?: number;
}

// ============ 关联关系类型 ============

/** 工作项关联 */
export interface WorkItemRelation {
  relation_id?: string;
  work_item_id: number;
  work_item_type_key: string;
  project_key: string;
  relation_type?: string;
  name?: string;
}

/** 需求关联 */
export interface StoryRelation {
  source_work_item_id: number;
  target_work_item_id: number;
  relation_type: string;
}

// ============ 工时类型 ============

/** 工时记录 */
export interface ManHourRecord {
  record_id?: string;
  work_item_id: number;
  user_key: string;
  work_time?: number; // 分钟
  work_date?: number; // 时间戳
  work_description?: string;
  created_at?: number;
  updated_at?: number;
}

// ============ 字段类型 ============

/** 字段定义 */
export interface FieldDefinition {
  field_key: string;
  field_name: string;
  field_type_key: string;
  field_alias?: string;
  is_custom?: boolean;
  is_required?: boolean;
  options?: FieldOption[];
}

/** 字段选项 */
export interface FieldOption {
  value: string;
  label: string;
}

/** 业务线 */
export interface Business {
  id: string;
  name: string;
  parent_id?: string;
}

// ============ 模板类型 ============

/** 流程类型/模板 */
export interface Template {
  template_id: string;
  template_name: string;
  work_item_type_key?: string;
  is_disabled?: boolean;
  workflow_id?: string;
}

/** 流程角色 */
export interface FlowRole {
  role_id: string;
  role_name: string;
  role_type?: number;
  members?: UserInfo[];
}

// ============ 评论类型 ============

/** 评论 */
export interface Comment {
  comment_id: string;
  content: string;
  created_at: number;
  updated_at?: number;
  creator?: UserInfo;
  reply_to?: string;
  rich_text?: RichTextContent[];
}

/** 富文本内容 */
export interface RichTextContent {
  type: string;
  text?: string;
  user_key?: string;
  url?: string;
}

/** 附件评论 */
export interface FileComment extends Comment {
  file_key?: string;
  file_name?: string;
  file_url?: string;
}

// ============ 搜索/筛选参数 ============

/** 搜索参数 */
export interface SearchParams {
  search_group?: SearchGroup;
  page_num?: number;
  page_size?: number;
  expand?: ExpandOptions;
}

/** 搜索条件组 */
export interface SearchGroup {
  conjunction?: 'AND' | 'OR';
  search_params?: SearchParam[];
}

/** 单个搜索条件 */
export interface SearchParam {
  key: string;
  value: string | string[] | number | number[];
  operator?: string;
}

/** 展开选项 */
export interface ExpandOptions {
  need_workflow?: boolean;
  need_multi_text?: boolean;
  need_user_detail?: boolean;
  relationship_work_item_expand?: string[];
}

// ============ 操作记录 ============

/** 操作记录 */
export interface OperationRecord {
  op_id: string;
  op_type: string;
  op_time: number;
  operator?: UserInfo;
  details?: Record<string, unknown>;
}

// ============ 项目类型 ============

/** 项目/空间基本信息 */
export interface Project {
  project_key: string;
  name: string;
  simple_name?: string;
  tenant_group_id?: string;
}

/** 项目详情 */
export interface ProjectDetail extends Project {
  description?: string;
  creator?: string;
  created_at?: number;
  updated_at?: number;
}

// ============ Token 类型 ============

/** Plugin Token 响应 */
export interface PluginTokenResponse {
  data?: {
    token: string;
    expire_time: number;
  };
  error?: {
    code: number;
    msg: string;
  };
}
