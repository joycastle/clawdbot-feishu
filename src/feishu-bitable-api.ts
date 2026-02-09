/**
 * 飞书多维表格 (Bitable) API 服务
 * 基于 @larksuiteoapi/node-sdk
 */

import * as http from 'http';
import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from './types.js';
import { createFeishuClient } from './client.js';

const PORT = 18795;

let server: http.Server | null = null;
let client: Lark.Client | null = null;

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function errorResponse(res: http.ServerResponse, message: string, status = 400): void {
  jsonResponse(res, { error: message }, status);
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  params.forEach((v, k) => (result[k] = v));
  return result;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!client) {
    errorResponse(res, 'Service not initialized', 503);
    return;
  }

  const url = req.url || '/';
  const method = req.method || 'GET';
  const path = url.split('?')[0];
  const query = parseQuery(url);
  const bitable = client.bitable;

  try {
    // ==================== 基础 ====================

    // GET /status
    if (method === 'GET' && path === '/status') {
      jsonResponse(res, { ok: true, service: 'feishu-bitable-api', port: PORT });
      return;
    }

    // ==================== 多维表格应用 ====================

    // POST /app - 创建多维表格
    if (method === 'POST' && path === '/app') {
      const body = await parseBody(req);
      const result = await bitable.app.create({
        data: {
          name: body.name as string,
          folder_token: body.folder_token as string | undefined,
        },
      });

      if (result.code !== 0) {
        errorResponse(res, result.msg || 'Failed to create app', 400);
        return;
      }
      jsonResponse(res, result.data?.app);
      return;
    }

    // 多维表格操作 - /app/:app_token/...
    const appMatch = path.match(/^\/app\/([^/]+)(\/.*)?$/);
    if (appMatch) {
      const appToken = appMatch[1];
      const subPath = appMatch[2] || '';

      // GET /app/:app_token - 获取多维表格信息
      if (method === 'GET' && !subPath) {
        const result = await bitable.app.get({
          path: { app_token: appToken },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to get app', 400);
          return;
        }
        jsonResponse(res, result.data?.app);
        return;
      }

      // ==================== 数据表 ====================

      // GET /app/:app_token/tables - 列出数据表
      if (method === 'GET' && subPath === '/tables') {
        const result = await bitable.appTable.list({
          path: { app_token: appToken },
          params: {
            page_size: query.page_size ? parseInt(query.page_size) : 20,
            page_token: query.page_token,
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to list tables', 400);
          return;
        }
        jsonResponse(res, {
          items: result.data?.items || [],
          page_token: result.data?.page_token,
          has_more: result.data?.has_more,
        });
        return;
      }

      // POST /app/:app_token/table - 创建数据表
      if (method === 'POST' && subPath === '/table') {
        const body = await parseBody(req);
        const result = await bitable.appTable.create({
          path: { app_token: appToken },
          data: {
            table: {
              name: body.name as string,
              default_view_name: body.default_view_name as string | undefined,
              fields: body.fields as Array<{
                field_name: string;
                type: number;
              }> | undefined,
            },
          },
        });

        if (result.code !== 0) {
          errorResponse(res, result.msg || 'Failed to create table', 400);
          return;
        }
        jsonResponse(res, result.data);
        return;
      }

      // 数据表操作 - /app/:app_token/table/:table_id/...
      const tableMatch = subPath.match(/^\/table\/([^/]+)(\/.*)?$/);
      if (tableMatch) {
        const tableId = tableMatch[1];
        const tableSubPath = tableMatch[2] || '';

        // ==================== 记录 ====================

        // GET /app/:app_token/table/:table_id/records - 列出记录
        if (method === 'GET' && tableSubPath === '/records') {
          const result = await bitable.appTableRecord.list({
            path: { app_token: appToken, table_id: tableId },
            params: {
              page_size: query.page_size ? parseInt(query.page_size) : 20,
              page_token: query.page_token,
              view_id: query.view_id,
              filter: query.filter,
              sort: query.sort,
              field_names: query.field_names,
              text_field_as_array: query.text_field_as_array === 'true',
              user_id_type: 'open_id',
              display_formula_ref: query.display_formula_ref === 'true',
              automatic_fields: query.automatic_fields === 'true',
            },
          });

          if (result.code !== 0) {
            errorResponse(res, result.msg || 'Failed to list records', 400);
            return;
          }
          jsonResponse(res, {
            items: result.data?.items || [],
            page_token: result.data?.page_token,
            has_more: result.data?.has_more,
            total: result.data?.total,
          });
          return;
        }

        // POST /app/:app_token/table/:table_id/records/search - 搜索记录
        if (method === 'POST' && tableSubPath === '/records/search') {
          const body = await parseBody(req);
          const result = await bitable.appTableRecord.search({
            path: { app_token: appToken, table_id: tableId },
            data: {
              view_id: body.view_id as string | undefined,
              field_names: body.field_names as string[] | undefined,
              sort: body.sort as Array<{ field_name: string; desc?: boolean }> | undefined,
              filter: body.filter as {
                conjunction: 'and' | 'or';
                conditions?: Array<{
                  field_name: string;
                  operator: 'in' | 'is' | 'isNot' | 'contains' | 'doesNotContain' | 'isEmpty' | 'isNotEmpty' | 'isGreater' | 'isGreaterEqual' | 'isLess' | 'isLessEqual' | 'like';
                  value?: string[];
                }>;
              } | undefined,
              automatic_fields: body.automatic_fields as boolean | undefined,
            },
            params: {
              page_size: query.page_size ? parseInt(query.page_size) : 20,
              page_token: query.page_token,
              user_id_type: 'open_id',
            },
          });

          if (result.code !== 0) {
            errorResponse(res, result.msg || 'Failed to search records', 400);
            return;
          }
          jsonResponse(res, {
            items: result.data?.items || [],
            page_token: result.data?.page_token,
            has_more: result.data?.has_more,
            total: result.data?.total,
          });
          return;
        }

        // POST /app/:app_token/table/:table_id/record - 创建记录
        if (method === 'POST' && tableSubPath === '/record') {
          const body = await parseBody(req);
          const result = await bitable.appTableRecord.create({
            path: { app_token: appToken, table_id: tableId },
            data: {
              fields: body.fields as Record<string, unknown>,
            },
            params: { user_id_type: 'open_id' },
          });

          if (result.code !== 0) {
            errorResponse(res, result.msg || 'Failed to create record', 400);
            return;
          }
          jsonResponse(res, result.data?.record);
          return;
        }

        // POST /app/:app_token/table/:table_id/records/batch - 批量创建记录
        if (method === 'POST' && tableSubPath === '/records/batch') {
          const body = await parseBody(req);
          const result = await bitable.appTableRecord.batchCreate({
            path: { app_token: appToken, table_id: tableId },
            data: {
              records: body.records as Array<{ fields: Record<string, unknown> }>,
            },
            params: { user_id_type: 'open_id' },
          });

          if (result.code !== 0) {
            errorResponse(res, result.msg || 'Failed to batch create records', 400);
            return;
          }
          jsonResponse(res, result.data?.records);
          return;
        }

        // 单条记录操作 - /app/:app_token/table/:table_id/record/:record_id
        const recordMatch = tableSubPath.match(/^\/record\/([^/]+)$/);
        if (recordMatch) {
          const recordId = recordMatch[1];

          // GET - 获取记录
          if (method === 'GET') {
            const result = await bitable.appTableRecord.get({
              path: { app_token: appToken, table_id: tableId, record_id: recordId },
              params: {
                text_field_as_array: query.text_field_as_array === 'true',
                user_id_type: 'open_id',
                display_formula_ref: query.display_formula_ref === 'true',
                automatic_fields: query.automatic_fields === 'true',
              },
            });

            if (result.code !== 0) {
              errorResponse(res, result.msg || 'Failed to get record', 400);
              return;
            }
            jsonResponse(res, result.data?.record);
            return;
          }

          // PUT - 更新记录
          if (method === 'PUT') {
            const body = await parseBody(req);
            const result = await bitable.appTableRecord.update({
              path: { app_token: appToken, table_id: tableId, record_id: recordId },
              data: {
                fields: body.fields as Record<string, unknown>,
              },
              params: { user_id_type: 'open_id' },
            });

            if (result.code !== 0) {
              errorResponse(res, result.msg || 'Failed to update record', 400);
              return;
            }
            jsonResponse(res, result.data?.record);
            return;
          }

          // DELETE - 删除记录
          if (method === 'DELETE') {
            const result = await bitable.appTableRecord.delete({
              path: { app_token: appToken, table_id: tableId, record_id: recordId },
            });

            if (result.code !== 0) {
              errorResponse(res, result.msg || 'Failed to delete record', 400);
              return;
            }
            jsonResponse(res, { success: true, deleted: result.data?.deleted });
            return;
          }
        }

        // ==================== 字段 ====================

        // GET /app/:app_token/table/:table_id/fields - 列出字段
        if (method === 'GET' && tableSubPath === '/fields') {
          const result = await bitable.appTableField.list({
            path: { app_token: appToken, table_id: tableId },
            params: {
              page_size: query.page_size ? parseInt(query.page_size) : 100,
              page_token: query.page_token,
              view_id: query.view_id,
              text_field_as_array: query.text_field_as_array === 'true',
            },
          });

          if (result.code !== 0) {
            errorResponse(res, result.msg || 'Failed to list fields', 400);
            return;
          }
          jsonResponse(res, {
            items: result.data?.items || [],
            page_token: result.data?.page_token,
            has_more: result.data?.has_more,
          });
          return;
        }

        // POST /app/:app_token/table/:table_id/field - 创建字段
        if (method === 'POST' && tableSubPath === '/field') {
          const body = await parseBody(req);
          const result = await bitable.appTableField.create({
            path: { app_token: appToken, table_id: tableId },
            data: {
              field_name: body.field_name as string,
              type: body.type as number,
              property: body.property as Record<string, unknown> | undefined,
              description: body.description as { disable_sync?: boolean; text?: string } | undefined,
            },
          });

          if (result.code !== 0) {
            errorResponse(res, result.msg || 'Failed to create field', 400);
            return;
          }
          jsonResponse(res, result.data?.field);
          return;
        }
      }
    }

    errorResponse(res, 'Not found', 404);
  } catch (err) {
    errorResponse(res, err instanceof Error ? err.message : 'Unknown error', 500);
  }
}

export function startFeishuBitableApi(feishuCfg: FeishuConfig | undefined, log?: (...args: unknown[]) => void): void {
  if (server) {
    log?.('[FeishuBitableAPI] Server already running');
    return;
  }

  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    log?.('[FeishuBitableAPI] Missing appId/appSecret - not starting');
    return;
  }

  try {
    client = createFeishuClient(feishuCfg);
  } catch (err) {
    log?.('[FeishuBitableAPI] Failed to create client:', err);
    return;
  }

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log?.('[FeishuBitableAPI] Request error:', err);
      errorResponse(res, 'Internal error', 500);
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    log?.(`[FeishuBitableAPI] Listening on http://127.0.0.1:${PORT}`);
  });

  server.on('error', (err) => {
    log?.(`[FeishuBitableAPI] Server error: ${err.message}`);
  });
}

export function stopFeishuBitableApi(): void {
  if (server) {
    server.close();
    server = null;
    client = null;
  }
}
