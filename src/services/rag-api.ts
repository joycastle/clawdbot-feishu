/**
 * RAG 知识库检索 API
 * 
 * 端口：18800
 * 
 * 职责：
 * 1. 启动并管理 Python RAG 服务
 * 2. 代理请求（可选，也可直接调用 Python 服务）
 * 
 * ⚠️ 安全注意事项（防止 2026-02-13 事故重演）：
 * - 所有操作都有 try-catch
 * - 错误返回友好消息，不暴露给 LLM
 * - Python 服务崩溃时自动重启
 */

import * as http from "node:http";
import * as path from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 18800;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts/rag");

let pythonProcess: ChildProcess | null = null;
let restartCount = 0;
const MAX_RESTARTS = 3;
const RESTART_COOLDOWN = 60000; // 1分钟内最多重启3次

// ─── Python 进程管理 ────────────────────────────────────────────────────────

function startPythonServer(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const serverPath = path.join(SCRIPTS_DIR, "server.py");
      
      pythonProcess = spawn("python3", [serverPath], {
        cwd: SCRIPTS_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      let started = false;

      pythonProcess.stdout?.on("data", (data: Buffer) => {
        const msg = data.toString();
        console.log(`[RAG-py] ${msg.trim()}`);
        if (msg.includes("Server running") && !started) {
          started = true;
          resolve(true);
        }
      });

      pythonProcess.stderr?.on("data", (data: Buffer) => {
        console.error(`[RAG-py] ERROR: ${data.toString().trim()}`);
      });

      pythonProcess.on("error", (err) => {
        console.error(`[RAG] Failed to start Python server: ${err.message}`);
        resolve(false);
      });

      pythonProcess.on("exit", (code) => {
        console.log(`[RAG] Python server exited with code ${code}`);
        pythonProcess = null;
        
        // 自动重启（有限次数）
        if (restartCount < MAX_RESTARTS) {
          restartCount++;
          console.log(`[RAG] Restarting Python server (attempt ${restartCount}/${MAX_RESTARTS})...`);
          setTimeout(() => startPythonServer(), 1000);
        }
      });

      // 超时检测
      setTimeout(() => {
        if (!started) {
          console.log("[RAG] Python server start timeout, assuming success");
          resolve(true);
        }
      }, 5000);

    } catch (err) {
      console.error(`[RAG] Error starting Python server: ${err}`);
      resolve(false);
    }
  });
}

function stopPythonServer() {
  if (pythonProcess) {
    pythonProcess.kill("SIGTERM");
    pythonProcess = null;
  }
}

// ─── HTTP 代理（可选） ────────────────────────────────────────────────────────

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  // 直接代理到 Python 服务
  const options: http.RequestOptions = {
    hostname: "127.0.0.1",
    port: PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "RAG service unavailable" }));
  });

  req.pipe(proxyReq);
}

// ─── 生命周期 ────────────────────────────────────────────────────────────────

let server: http.Server | null = null;

export async function startRagApi(log?: (...args: unknown[]) => void) {
  log?.("[RAG] Starting RAG API service...");

  // 先检查 Python 服务是否已经在运行
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (response.ok) {
      log?.(`[RAG] Python server already running on port ${PORT}`);
      return;
    }
  } catch {
    // 没运行，需要启动
  }

  // 启动 Python 服务
  const started = await startPythonServer();
  if (started) {
    log?.(`[RAG] Python server started on port ${PORT}`);
  } else {
    log?.("[RAG] Warning: Failed to start Python server");
  }

  // 重置重启计数器
  setTimeout(() => {
    restartCount = 0;
  }, RESTART_COOLDOWN);
}

export function stopRagApi() {
  stopPythonServer();
  if (server) {
    server.close();
    server = null;
  }
}

// 导出默认端口供其他模块使用
export const RAG_PORT = PORT;
