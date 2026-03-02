/**
 * 代码索引服务
 * 
 * 端口: 18801
 * 
 * 功能:
 * 1. 关键字搜索代码摘要
 * 2. 支持多项目索引
 * 3. 调用图查询（图数据库）
 * 
 * API:
 *   GET  /health              健康检查
 *   GET  /projects            列出已索引项目
 *   POST /index               索引项目
 *   GET  /search?q=xxx&p=xxx  搜索
 *   GET  /graph/callers?name=xxx       谁调用了这个函数
 *   GET  /graph/callees?name=xxx       这个函数调用了谁
 *   GET  /graph/path?from=xxx&to=xxx   两点间的调用路径
 *   GET  /graph/info?name=xxx          函数信息
 *   GET  /graph/impact?name=xxx&depth=3  影响范围分析（递归向上找调用方）
 *   GET  /graph/hotspots?limit=20        热点分析（被调用最多的函数）
 *   GET  /graph/orphans?limit=50&type=x  孤立函数（没有调用者，可能是入口或死代码）
 *   GET  /graph/stats                    图统计信息
 *   GET  /graph/cycles?limit=20&minSize=2  循环依赖检测（找出互相调用的函数组）
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 18801;
const DATA_DIR = join(__dirname, '../../data/code-index');

// 确保数据目录存在
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

// 调用图数据库
const GRAPH_DB_PATH = join(DATA_DIR, 'call-graph.db');
let graphDb: Database.Database | null = null;

function getGraphDb(): Database.Database | null {
    if (!graphDb && existsSync(GRAPH_DB_PATH)) {
        try {
            graphDb = new Database(GRAPH_DB_PATH, { readonly: true });
            console.log('[CodeIndex] Graph database loaded');
        } catch (e) {
            console.error('[CodeIndex] Failed to load graph database:', e);
        }
    }
    return graphDb;
}

// 图查询函数
function graphCallers(name: string, limit = 50): any[] {
    try {
        const db = getGraphDb();
        if (!db) return [];
        
        const stmt = db.prepare(`
            SELECT DISTINCT caller_file, caller_name, caller_type, line
            FROM edges
            WHERE callee_name LIKE ?
            ORDER BY caller_file, line
            LIMIT ?
        `);
        return stmt.all(`%${name}%`, limit) as any[];
    } catch (e: any) {
        console.error('[CodeIndex] graphCallers error:', e.message);
        return [];
    }
}

function graphCallees(name: string, limit = 50): any[] {
    try {
        const db = getGraphDb();
        if (!db) return [];
        
        const stmt = db.prepare(`
            SELECT DISTINCT callee_name, callee_type, line
            FROM edges
            WHERE caller_name LIKE ?
            ORDER BY line
            LIMIT ?
        `);
        return stmt.all(`%${name}%`, limit) as any[];
    } catch (e: any) {
        console.error('[CodeIndex] graphCallees error:', e.message);
        return [];
    }
}

function graphPath(from: string, to: string, maxDepth = 3): any[] {
    const db = getGraphDb();
    if (!db) return [];
    
    // 使用 BFS 手动实现路径查找，避免复杂递归 CTE
    try {
        const getCallees = db.prepare(`
            SELECT DISTINCT callee_name FROM edges WHERE caller_name = ? LIMIT 100
        `);
        
        // BFS 搜索
        const queue: { name: string; path: string[]; depth: number }[] = [];
        const visited = new Set<string>();
        const results: { path: string; depth: number }[] = [];
        
        // 找起点（模糊匹配）
        const starts = db.prepare(`
            SELECT DISTINCT caller_name FROM edges WHERE caller_name LIKE ?
        `).all(`%${from}%`) as any[];
        
        for (const s of starts.slice(0, 10)) {
            queue.push({ name: s.caller_name, path: [s.caller_name], depth: 0 });
        }
        
        while (queue.length > 0 && results.length < 10) {
            const current = queue.shift()!;
            
            if (current.depth >= maxDepth) continue;
            if (visited.has(current.name)) continue;
            visited.add(current.name);
            
            const callees = getCallees.all(current.name) as any[];
            
            for (const callee of callees) {
                const newPath = [...current.path, callee.callee_name];
                
                // 检查是否到达目标
                if (callee.callee_name.includes(to)) {
                    results.push({ 
                        path: newPath.join(' -> '), 
                        depth: current.depth + 1 
                    });
                } else if (!visited.has(callee.callee_name)) {
                    queue.push({ 
                        name: callee.callee_name, 
                        path: newPath, 
                        depth: current.depth + 1 
                    });
                }
            }
        }
        
        return results;
    } catch (e: any) {
        console.error('[CodeIndex] graphPath error:', e.message);
        return [];
    }
}

/**
 * 影响范围分析 - 找出修改某函数会影响哪些调用方（递归向上）
 */
function graphImpact(name: string, maxDepth = 3, limit = 100): { 
    layers: { depth: number; functions: { name: string; file: string; line: number }[] }[];
    total: number;
} {
    const db = getGraphDb();
    if (!db) return { layers: [], total: 0 };
    
    try {
        const getCallers = db.prepare(`
            SELECT DISTINCT caller_name, caller_file, caller_type, line
            FROM edges 
            WHERE callee_name = ?
            LIMIT 200
        `);
        
        // 找起点（精确匹配优先，否则模糊匹配）
        let startNodes: string[] = [];
        const exactMatch = db.prepare(`
            SELECT DISTINCT name FROM nodes WHERE name = ?
        `).all(name) as any[];
        
        if (exactMatch.length > 0) {
            startNodes = exactMatch.map(n => n.name);
        } else {
            const fuzzyMatch = db.prepare(`
                SELECT DISTINCT name FROM nodes WHERE name LIKE ? LIMIT 5
            `).all(`%${name}%`) as any[];
            startNodes = fuzzyMatch.map(n => n.name);
        }
        
        if (startNodes.length === 0) {
            return { layers: [], total: 0 };
        }
        
        // BFS 按层遍历
        const visited = new Set<string>(startNodes);
        const layers: { depth: number; functions: { name: string; file: string; line: number }[] }[] = [];
        let currentLevel = startNodes;
        let total = 0;
        
        for (let depth = 1; depth <= maxDepth && total < limit; depth++) {
            const nextLevel: { name: string; file: string; line: number }[] = [];
            
            for (const funcName of currentLevel) {
                if (total >= limit) break;
                
                const callers = getCallers.all(funcName) as any[];
                for (const caller of callers) {
                    if (!visited.has(caller.caller_name) && total < limit) {
                        visited.add(caller.caller_name);
                        nextLevel.push({
                            name: caller.caller_name,
                            file: caller.caller_file,
                            line: caller.line
                        });
                        total++;
                    }
                }
            }
            
            if (nextLevel.length > 0) {
                layers.push({ depth, functions: nextLevel });
                currentLevel = nextLevel.map(f => f.name);
            } else {
                break;
            }
        }
        
        return { layers, total };
    } catch (e: any) {
        console.error('[CodeIndex] graphImpact error:', e.message);
        return { layers: [], total: 0 };
    }
}

/**
 * 热点分析 - 找出被调用最多的函数（核心代码）
 */
function graphHotspots(limit = 20): { name: string; file: string; callerCount: number }[] {
    const db = getGraphDb();
    if (!db) return [];
    
    try {
        const stmt = db.prepare(`
            SELECT 
                n.name,
                n.file,
                COUNT(DISTINCT e.caller_name) as caller_count
            FROM nodes n
            LEFT JOIN edges e ON e.callee_name = n.name
            GROUP BY n.name, n.file
            HAVING caller_count > 0
            ORDER BY caller_count DESC
            LIMIT ?
        `);
        return stmt.all(limit) as any[];
    } catch (e: any) {
        console.error('[CodeIndex] graphHotspots error:', e.message);
        return [];
    }
}

/**
 * 孤立函数检测 - 找出没有调用者的函数（入口点或死代码）
 */
function graphOrphans(limit = 50, type?: string): { name: string; file: string; type: string; calleeCount: number }[] {
    const db = getGraphDb();
    if (!db) return [];
    
    try {
        // 找没有被任何人调用的函数
        let sql = `
            SELECT 
                n.name,
                n.file,
                n.type,
                (SELECT COUNT(*) FROM edges e2 WHERE e2.caller_name = n.name) as callee_count
            FROM nodes n
            WHERE NOT EXISTS (
                SELECT 1 FROM edges e WHERE e.callee_name = n.name
            )
        `;
        
        if (type) {
            sql += ` AND n.type = ?`;
        }
        
        sql += ` ORDER BY callee_count DESC LIMIT ?`;
        
        const stmt = db.prepare(sql);
        return (type ? stmt.all(type, limit) : stmt.all(limit)) as any[];
    } catch (e: any) {
        console.error('[CodeIndex] graphOrphans error:', e.message);
        return [];
    }
}

/**
 * 图统计信息
 */
function graphStats(): { 
    nodeCount: number; 
    edgeCount: number; 
    avgCallersPerNode: number;
    avgCalleesPerNode: number;
    maxCallers: { name: string; count: number };
    maxCallees: { name: string; count: number };
} | null {
    const db = getGraphDb();
    if (!db) return null;
    
    try {
        const nodeCount = (db.prepare(`SELECT COUNT(*) as cnt FROM nodes`).get() as any).cnt;
        const edgeCount = (db.prepare(`SELECT COUNT(*) as cnt FROM edges`).get() as any).cnt;
        
        const avgCallersPerNode = edgeCount / nodeCount;
        const avgCalleesPerNode = edgeCount / nodeCount;
        
        const maxCallers = db.prepare(`
            SELECT callee_name as name, COUNT(DISTINCT caller_name) as count
            FROM edges
            GROUP BY callee_name
            ORDER BY count DESC
            LIMIT 1
        `).get() as any;
        
        const maxCallees = db.prepare(`
            SELECT caller_name as name, COUNT(DISTINCT callee_name) as count
            FROM edges
            GROUP BY caller_name
            ORDER BY count DESC
            LIMIT 1
        `).get() as any;
        
        return {
            nodeCount,
            edgeCount,
            avgCallersPerNode: Math.round(avgCallersPerNode * 100) / 100,
            avgCalleesPerNode: Math.round(avgCalleesPerNode * 100) / 100,
            maxCallers: maxCallers || { name: '', count: 0 },
            maxCallees: maxCallees || { name: '', count: 0 }
        };
    } catch (e: any) {
        console.error('[CodeIndex] graphStats error:', e.message);
        return null;
    }
}

/**
 * 循环依赖检测 - 找出互相调用的函数对（A 调 B，B 也调 A）
 * 更实用的方式，避免 Tarjan 在大图上的性能问题
 */
function graphCycles(limit = 20, _minSize = 2): { 
    cycles: { functions: { name: string; file: string }[]; callsAtoB: number; callsBtoA: number }[];
    selfLoops: { name: string; file: string; count: number }[];
    totalMutualPairs: number;
    totalSelfLoops: number;
} {
    const db = getGraphDb();
    if (!db) return { cycles: [], selfLoops: [], totalMutualPairs: 0, totalSelfLoops: 0 };
    
    try {
        // 1. 查找互相调用的函数对（A 调 B 且 B 调 A）
        const mutualCalls = db.prepare(`
            SELECT 
                e1.caller_name as func_a,
                e1.callee_name as func_b,
                n1.file as file_a,
                n2.file as file_b,
                COUNT(DISTINCT e1.line) as calls_a_to_b,
                (SELECT COUNT(DISTINCT line) FROM edges WHERE caller_name = e1.callee_name AND callee_name = e1.caller_name) as calls_b_to_a
            FROM edges e1
            JOIN edges e2 ON e1.caller_name = e2.callee_name AND e1.callee_name = e2.caller_name
            LEFT JOIN nodes n1 ON n1.name = e1.caller_name
            LEFT JOIN nodes n2 ON n2.name = e1.callee_name
            WHERE e1.caller_name < e1.callee_name  -- 避免重复（只取 A < B）
            GROUP BY e1.caller_name, e1.callee_name
            ORDER BY (calls_a_to_b + calls_b_to_a) DESC
            LIMIT ?
        `).all(limit * 2) as any[];  // 取多一点，后面去重
        
        // 2. 查找自环（自己调用自己）
        const selfLoops = db.prepare(`
            SELECT 
                e.caller_name as name,
                n.file,
                COUNT(*) as count
            FROM edges e
            LEFT JOIN nodes n ON n.name = e.caller_name
            WHERE e.caller_name = e.callee_name
            GROUP BY e.caller_name
            ORDER BY count DESC
            LIMIT ?
        `).all(limit) as any[];
        
        // 统计总数
        const totalMutual = (db.prepare(`
            SELECT COUNT(*) as cnt FROM (
                SELECT DISTINCT e1.caller_name, e1.callee_name
                FROM edges e1
                JOIN edges e2 ON e1.caller_name = e2.callee_name AND e1.callee_name = e2.caller_name
                WHERE e1.caller_name < e1.callee_name
            )
        `).get() as any)?.cnt || 0;
        
        const totalSelf = (db.prepare(`
            SELECT COUNT(DISTINCT caller_name) as cnt FROM edges WHERE caller_name = callee_name
        `).get() as any)?.cnt || 0;
        
        // 整理结果
        const cycles = mutualCalls.slice(0, limit).map(row => ({
            functions: [
                { name: row.func_a, file: row.file_a || 'unknown' },
                { name: row.func_b, file: row.file_b || 'unknown' }
            ],
            callsAtoB: row.calls_a_to_b,
            callsBtoA: row.calls_b_to_a
        }));
        
        return { 
            cycles, 
            selfLoops: selfLoops.map(s => ({ name: s.name, file: s.file || 'unknown', count: s.count })),
            totalMutualPairs: totalMutual,
            totalSelfLoops: totalSelf
        };
    } catch (e: any) {
        console.error('[CodeIndex] graphCycles error:', e.message);
        return { cycles: [], selfLoops: [], totalMutualPairs: 0, totalSelfLoops: 0 };
    }
}

function graphInfo(name: string): { nodes: any[]; callerCount: number; calleeCount: number } {
    try {
        const db = getGraphDb();
        if (!db) return { nodes: [], callerCount: 0, calleeCount: 0 };
        
        const nodes = db.prepare(`
            SELECT * FROM nodes
            WHERE name LIKE ?
            ORDER BY file
            LIMIT 20
        `).all(`%${name}%`) as any[];
        
        const callerCount = (db.prepare(`
            SELECT COUNT(DISTINCT caller_name) as cnt FROM edges WHERE callee_name LIKE ?
        `).get(`%${name}%`) as any)?.cnt || 0;
        
        const calleeCount = (db.prepare(`
            SELECT COUNT(DISTINCT callee_name) as cnt FROM edges WHERE caller_name LIKE ?
        `).get(`%${name}%`) as any)?.cnt || 0;
        
        return { nodes, callerCount, calleeCount };
    } catch (e: any) {
        console.error('[CodeIndex] graphInfo error:', e.message);
        return { nodes: [], callerCount: 0, calleeCount: 0 };
    }
}

interface Summary {
    type: 'class' | 'function' | 'method' | 'module';
    name: string;
    file: string;
    line: number;
    signature?: string;
    doc?: string;
    decorators?: string[];
    calls?: string[];
}

interface Project {
    name: string;
    path: string;
    summaries: Summary[];
    indexedAt: string;
}

// 项目缓存
const projects: Map<string, Project> = new Map();

// 加载已索引的项目
function loadProjects() {
    const indexPath = join(DATA_DIR, 'projects.json');
    if (existsSync(indexPath)) {
        try {
            const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
            for (const p of data) {
                const summariesPath = join(DATA_DIR, `${p.name}.jsonl`);
                if (existsSync(summariesPath)) {
                    const summaries = readFileSync(summariesPath, 'utf-8')
                        .trim().split('\n')
                        .filter(Boolean)
                        .map(line => JSON.parse(line));
                    projects.set(p.name, { ...p, summaries });
                }
            }
            console.log(`[CodeIndex] Loaded ${projects.size} projects`);
        } catch (e) {
            console.error('[CodeIndex] Failed to load projects:', e);
        }
    }
}

// 保存项目索引
function saveProjectIndex() {
    const indexPath = join(DATA_DIR, 'projects.json');
    const data = Array.from(projects.values()).map(p => ({
        name: p.name,
        path: p.path,
        indexedAt: p.indexedAt,
        count: p.summaries.length
    }));
    writeFileSync(indexPath, JSON.stringify(data, null, 2));
}

// 搜索
function search(query: string, projectName?: string, limit = 20): { project: string; results: Summary[] }[] {
    const keyword = query.toLowerCase();
    const results: { project: string; results: Summary[] }[] = [];
    
    const targetProjects = projectName 
        ? [projects.get(projectName)].filter(Boolean) as Project[]
        : Array.from(projects.values());
    
    for (const project of targetProjects) {
        const matches: { summary: Summary; score: number }[] = [];
        
        for (const s of project.summaries) {
            let score = 0;
            if (s.name.toLowerCase().includes(keyword)) score += 10;
            if (s.file.toLowerCase().includes(keyword)) score += 5;
            if (s.doc?.toLowerCase().includes(keyword)) score += 3;
            if (s.signature?.toLowerCase().includes(keyword)) score += 2;
            if (s.calls?.some(c => c.toLowerCase().includes(keyword))) score += 1;
            
            if (score > 0) {
                matches.push({ summary: s, score });
            }
        }
        
        matches.sort((a, b) => b.score - a.score);
        results.push({
            project: project.name,
            results: matches.slice(0, limit).map(m => m.summary)
        });
    }
    
    return results;
}

// HTTP 处理
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    const sendJson = (data: any, status = 200) => {
        res.statusCode = status;
        res.end(JSON.stringify(data, null, 2));
    };
    
    try {
        // 健康检查
        if (path === '/health') {
            sendJson({ ok: true, service: 'code-index', port: PORT });
            return;
        }
        
        // 列出项目
        if (path === '/projects') {
            sendJson({
                ok: true,
                projects: Array.from(projects.values()).map(p => ({
                    name: p.name,
                    path: p.path,
                    count: p.summaries.length,
                    indexedAt: p.indexedAt
                }))
            });
            return;
        }
        
        // 搜索
        if (path === '/search') {
            const q = url.searchParams.get('q');
            const p = url.searchParams.get('p') || undefined;
            const limit = parseInt(url.searchParams.get('limit') || '20');
            
            if (!q) {
                sendJson({ ok: false, error: '缺少查询参数 q' }, 400);
                return;
            }
            
            const results = search(q, p, limit);
            sendJson({ ok: true, query: q, results });
            return;
        }
        
        // 索引项目 (POST)
        if (path === '/index' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { name, path: projectPath, summariesPath } = JSON.parse(body);
                    
                    if (!name || !summariesPath) {
                        sendJson({ ok: false, error: '缺少 name 或 summariesPath' }, 400);
                        return;
                    }
                    
                    // 读取摘要
                    if (!existsSync(summariesPath)) {
                        sendJson({ ok: false, error: `摘要文件不存在: ${summariesPath}` }, 400);
                        return;
                    }
                    
                    const summaries = readFileSync(summariesPath, 'utf-8')
                        .trim().split('\n')
                        .filter(Boolean)
                        .map(line => JSON.parse(line));
                    
                    // 保存
                    const project: Project = {
                        name,
                        path: projectPath || '',
                        summaries,
                        indexedAt: new Date().toISOString()
                    };
                    
                    projects.set(name, project);
                    writeFileSync(join(DATA_DIR, `${name}.jsonl`), 
                        summaries.map(s => JSON.stringify(s)).join('\n'));
                    saveProjectIndex();
                    
                    sendJson({ ok: true, message: `索引完成: ${name}`, count: summaries.length });
                } catch (e: any) {
                    sendJson({ ok: false, error: e.message }, 500);
                }
            });
            return;
        }
        
        // 图查询: 谁调用了这个函数
        if (path === '/graph/callers') {
            const name = url.searchParams.get('name');
            const limit = parseInt(url.searchParams.get('limit') || '50');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const results = graphCallers(name, limit);
            sendJson({ ok: true, name, count: results.length, callers: results });
            return;
        }
        
        // 图查询: 这个函数调用了谁
        if (path === '/graph/callees') {
            const name = url.searchParams.get('name');
            const limit = parseInt(url.searchParams.get('limit') || '50');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const results = graphCallees(name, limit);
            sendJson({ ok: true, name, count: results.length, callees: results });
            return;
        }
        
        // 图查询: 两点间的路径
        if (path === '/graph/path') {
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const maxDepth = parseInt(url.searchParams.get('depth') || '5');
            
            if (!from || !to) {
                sendJson({ ok: false, error: '缺少参数 from 或 to' }, 400);
                return;
            }
            
            const results = graphPath(from, to, maxDepth);
            sendJson({ ok: true, from, to, count: results.length, paths: results });
            return;
        }
        
        // 图查询: 函数信息
        if (path === '/graph/info') {
            const name = url.searchParams.get('name');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const info = graphInfo(name);
            sendJson({ ok: true, name, ...info });
            return;
        }
        
        // 图查询: 影响范围分析（改了某函数，哪些地方会受影响）
        if (path === '/graph/impact') {
            const name = url.searchParams.get('name');
            const depth = parseInt(url.searchParams.get('depth') || '3');
            const limit = parseInt(url.searchParams.get('limit') || '100');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const result = graphImpact(name, depth, limit);
            sendJson({ 
                ok: true, 
                name, 
                depth,
                totalAffected: result.total,
                layers: result.layers 
            });
            return;
        }
        
        // 图查询: 热点分析（被调用最多的函数）
        if (path === '/graph/hotspots') {
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const results = graphHotspots(limit);
            sendJson({ 
                ok: true, 
                description: '被调用最多的函数（核心代码热点）',
                count: results.length, 
                hotspots: results 
            });
            return;
        }
        
        // 图查询: 孤立函数（没有调用者的函数）
        if (path === '/graph/orphans') {
            const limit = parseInt(url.searchParams.get('limit') || '50');
            const type = url.searchParams.get('type') || undefined;
            const results = graphOrphans(limit, type);
            sendJson({ 
                ok: true, 
                description: '没有调用者的函数（可能是入口点或死代码）',
                count: results.length, 
                orphans: results 
            });
            return;
        }
        
        // 图查询: 统计信息
        if (path === '/graph/stats') {
            const stats = graphStats();
            if (stats) {
                sendJson({ ok: true, ...stats });
            } else {
                sendJson({ ok: false, error: '图数据库未加载' }, 500);
            }
            return;
        }
        
        // 图查询: 循环依赖检测
        if (path === '/graph/cycles') {
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const result = graphCycles(limit);
            sendJson({ 
                ok: true, 
                description: '循环依赖检测',
                mutualCalls: {
                    description: '互相调用的函数对（A调B且B调A）',
                    total: result.totalMutualPairs,
                    showing: result.cycles.length,
                    pairs: result.cycles
                },
                selfLoops: {
                    description: '自己调用自己的函数',
                    total: result.totalSelfLoops,
                    showing: result.selfLoops.length,
                    functions: result.selfLoops
                }
            });
            return;
        }
        
        // 删除项目
        if (path === '/delete' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { name } = JSON.parse(body);
                    if (projects.has(name)) {
                        projects.delete(name);
                        saveProjectIndex();
                        sendJson({ ok: true, message: `已删除: ${name}` });
                    } else {
                        sendJson({ ok: false, error: `项目不存在: ${name}` }, 404);
                    }
                } catch (e: any) {
                    sendJson({ ok: false, error: e.message }, 500);
                }
            });
            return;
        }
        
        sendJson({ ok: false, error: 'Not found' }, 404);
        
    } catch (e: any) {
        sendJson({ ok: false, error: e.message }, 500);
    }
}

// 启动服务
loadProjects();

const server = createServer(handleRequest);
server.listen(PORT, () => {
    console.log(`[CodeIndex] Server running on http://localhost:${PORT}`);
});

export { PORT };
