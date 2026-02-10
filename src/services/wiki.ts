/**
 * 飞书 Wiki（知识库）API
 * 
 * 职责：解析 Wiki 节点，获取真实文档类型和 token
 * Wiki 内容类型：docx、sheet、bitable 等
 */

import * as lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "../types.js";

// ─── Wiki Space API ─────────────────────────────────────────────────────────

/** 获取知识空间列表 */
export async function getWikiSpaces(client: lark.Client): Promise<any[]> {
  const response = await client.wiki.space.list({
    params: { page_size: 50 },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get wiki spaces: ${response.msg}`);
  }
  
  return response.data?.items || [];
}

/** 获取知识空间信息 */
export async function getWikiSpace(client: lark.Client, spaceId: string): Promise<any> {
  const response = await client.wiki.space.get({
    path: { space_id: spaceId },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get wiki space: ${response.msg}`);
  }
  
  return response.data?.space;
}

/** 获取知识空间节点列表 */
export async function getWikiNodes(
  client: lark.Client,
  spaceId: string,
  parentNodeToken?: string
): Promise<any[]> {
  const response = await client.wiki.spaceNode.list({
    path: { space_id: spaceId },
    params: {
      page_size: 50,
      parent_node_token: parentNodeToken,
    },
  });
  
  if (response.code !== 0) {
    throw new Error(`Failed to get wiki nodes: ${response.msg}`);
  }
  
  return response.data?.items || [];
}

// ─── Wiki Node API ─────────────────────────────────────────────────────────

export interface WikiNode {
  node_token: string;
  obj_token: string;
  obj_type: "docx" | "doc" | "sheet" | "bitable" | string;
  title: string;
  space_id: string;
  parent_node_token?: string;
  has_child: boolean;
  node_create_time: string;
}

/**
 * 获取单个 Wiki 节点信息
 * 
 * 通过 HTTP 直接调用飞书 API（SDK 没有封装这个方法）
 * 返回节点的真实类型（obj_type）和实际文档 token（obj_token）
 */
export async function getWikiNode(cfg: FeishuConfig, token: string): Promise<WikiNode> {
  // 获取 tenant_access_token
  const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
  });
  const tokenData = await tokenResp.json() as any;
  const accessToken = tokenData.tenant_access_token;
  
  if (!accessToken) {
    throw new Error(`Failed to get access token: ${tokenData.msg || "unknown error"}`);
  }
  
  // 获取 wiki 节点信息
  const nodeResp = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${token}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const nodeData = await nodeResp.json() as any;
  
  if (nodeData.code !== 0) {
    throw new Error(`Failed to get wiki node: ${nodeData.msg}`);
  }
  
  return nodeData.data?.node as WikiNode;
}

/**
 * 解析 Wiki 节点并返回标准化结果
 * 
 * @returns { objType, objToken, title } - 真实文档类型和 token
 */
export async function resolveWikiNode(cfg: FeishuConfig, wikiToken: string): Promise<{
  objType: string;
  objToken: string;
  title: string;
}> {
  const node = await getWikiNode(cfg, wikiToken);
  return {
    objType: node.obj_type,
    objToken: node.obj_token,
    title: node.title,
  };
}
