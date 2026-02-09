/**
 * 飞书项目 API 类型定义
 */

/** Plugin Token 响应 */
export interface PluginTokenResponse {
  data?: {
    token: string;
    expire_time: number; // 秒
  };
  error?: {
    code: number;
    msg: string;
  };
}

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
  members?: ProjectMember[];
}

/** 项目成员 */
export interface ProjectMember {
  user_key: string;
  role?: string;
}

/** 工作项类型 */
export interface WorkItemType {
  type_key: string;
  name: string;
  api_name?: string;
  is_disable?: number; // 1=禁用, 2=启用
  enable_model_resource_lib?: boolean;
}

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

/** 项目列表响应 */
export interface ProjectListResponse extends ApiResponse<Project[]> {}

/** 项目详情响应 */
export interface ProjectDetailResponse extends ApiResponse<ProjectDetail> {}

/** 工作项类型列表响应 */
export interface WorkItemTypesResponse extends ApiResponse<WorkItemType[]> {}
