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
 *   GET  /graph/callers-chain?name=xxx   递归向上追踪完整调用链
 *   GET  /graph/hotspots?limit=20        热点分析（被调用最多的函数）
 *   GET  /graph/orphans?limit=50&type=x  孤立函数（没有调用者，可能是入口或死代码）
 *   GET  /graph/stats                    图统计信息
 *   GET  /graph/cycles?limit=20            循环依赖检测（找出互相调用的函数组）
 *   GET  /graph/modules?depth=3&limit=50  模块列表（按目录聚合）
 *   GET  /graph/module-deps?module=xxx    某模块依赖哪些模块（出边）
 *   GET  /graph/module-dependents?module=xxx  哪些模块依赖这个模块（入边）
 *   GET  /graph/module-matrix?depth=3     模块间依赖矩阵
 *   GET  /graph/children?name=xxx         查找子类/实现类
 *   GET  /graph/parents?name=xxx          查找父类/接口
 *   GET  /graph/inheritance-tree?name=xxx&direction=down  继承树
 *   GET  /graph/inheritance-stats         继承统计
 *   GET  /graph/decorator-targets?name=xxx  查找使用某装饰器的目标
 *   GET  /graph/decorator-stats           装饰器统计
 *   GET  /graph/rpc-endpoints             RPC 端点列表
 *   GET  /graph/controllers               Controller 列表
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
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

// 调用图数据库 - 支持多项目（自动发现）
const graphDbMap: Map<string, Database.Database> = new Map();
const DEFAULT_GRAPH_PROJECT = 'bf-nakama-ts';

// 动态发现数据库文件
function discoverGraphDbs(): Record<string, string> {
    const paths: Record<string, string> = {};
    
    // 硬编码的特殊映射（向后兼容）
    const legacyDb = join(DATA_DIR, 'call-graph.db');
    if (existsSync(legacyDb)) {
        paths['bf-nakama-ts'] = legacyDb;
    }
    
    // 自动发现 *-call-graph.db 文件
    try {
        const files = readdirSync(DATA_DIR);
        for (const file of files) {
            if (file.endsWith('-call-graph.db')) {
                const projectName = file.replace('-call-graph.db', '');
                paths[projectName] = join(DATA_DIR, file);
            }
        }
    } catch (e) {
        console.error('[CodeIndex] Failed to discover databases:', e);
    }
    
    return paths;
}

let GRAPH_DB_PATHS = discoverGraphDbs();

// 刷新数据库列表
function refreshGraphDbs(): void {
    GRAPH_DB_PATHS = discoverGraphDbs();
    console.log(`[CodeIndex] Discovered ${Object.keys(GRAPH_DB_PATHS).length} graph databases:`, Object.keys(GRAPH_DB_PATHS));
}

function getGraphDb(project?: string): Database.Database | null {
    const proj = project || DEFAULT_GRAPH_PROJECT;
    
    if (graphDbMap.has(proj)) {
        return graphDbMap.get(proj)!;
    }
    
    // 尝试刷新发现（可能新增了项目）
    if (!GRAPH_DB_PATHS[proj]) {
        refreshGraphDbs();
    }
    
    const dbPath = GRAPH_DB_PATHS[proj];
    if (!dbPath || !existsSync(dbPath)) {
        return null;
    }
    
    try {
        const db = new Database(dbPath, { readonly: true });
        graphDbMap.set(proj, db);
        console.log(`[CodeIndex] Graph database loaded: ${proj}`);
        return db;
    } catch (e) {
        console.error('[CodeIndex] Failed to load graph database:', e);
        return null;
    }
}


// 获取所有图数据库（用于跨项目查询）
function getAllGraphDbs(): { name: string; db: Database.Database }[] {
    refreshGraphDbs();
    const result: { name: string; db: Database.Database }[] = [];
    for (const projectName of Object.keys(GRAPH_DB_PATHS)) {
        const db = getGraphDb(projectName);
        if (db) {
            result.push({ name: projectName, db });
        }
    }
    return result;
}

// 图查询函数
function graphCallers(name: string, limit = 50, project?: string): any[] {
    try {
        const db = getGraphDb(project);
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

function graphCallees(name: string, limit = 50, project?: string): any[] {
    try {
        const db = getGraphDb(project);
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

function graphPath(from: string, to: string, maxDepth = 3, project?: string): any[] {
    const db = getGraphDb(project);
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
function graphImpact(name: string, maxDepth = 3, limit = 100, project?: string): { 
    layers: { depth: number; functions: { name: string; file: string; line: number }[] }[];
    total: number;
} {
    const db = getGraphDb(project);
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
 * 递归向上追踪调用链 - 从某函数出发，找到完整的上游调用链
 * 返回多条链路，每条链路是一个调用栈
 */
function graphCallersChain(name: string, maxDepth = 5, maxChains = 10, project?: string): {
    chains: { path: string[]; files: string[] }[];
    totalChains: number;
} {
    const db = getGraphDb(project);
    if (!db) return { chains: [], totalChains: 0 };
    
    try {
        const getCallers = db.prepare(`
            SELECT DISTINCT caller_name, caller_file
            FROM edges 
            WHERE callee_name = ?
            LIMIT 50
        `);
        
        // 找起点
        let startName = name;
        const exactMatch = db.prepare(`SELECT name FROM nodes WHERE name = ?`).get(name) as any;
        if (!exactMatch) {
            const fuzzy = db.prepare(`SELECT name FROM nodes WHERE name LIKE ? LIMIT 1`).get(`%${name}%`) as any;
            if (fuzzy) startName = fuzzy.name;
            else return { chains: [], totalChains: 0 };
        }
        
        // DFS 找所有链路
        const chains: { path: string[]; files: string[] }[] = [];
        
        function dfs(current: string, path: string[], files: string[], depth: number) {
            if (chains.length >= maxChains) return;
            if (depth >= maxDepth) {
                if (path.length > 1) chains.push({ path: [...path], files: [...files] });
                return;
            }
            
            const callers = getCallers.all(current) as any[];
            if (callers.length === 0) {
                // 到达顶层（没有调用者了）
                if (path.length > 1) chains.push({ path: [...path], files: [...files] });
                return;
            }
            
            for (const caller of callers) {
                if (path.includes(caller.caller_name)) continue; // 避免循环
                path.push(caller.caller_name);
                files.push(caller.caller_file);
                dfs(caller.caller_name, path, files, depth + 1);
                path.pop();
                files.pop();
                if (chains.length >= maxChains) return;
            }
        }
        
        dfs(startName, [startName], [''], 0);
        
        return { chains, totalChains: chains.length };
    } catch (e: any) {
        console.error('[CodeIndex] graphCallersChain error:', e.message);
        return { chains: [], totalChains: 0 };
    }
}

/**
 * 热点分析 - 找出被调用最多的函数（核心代码）
 */
function graphHotspots(limit = 20, project?: string): { name: string; file: string; callerCount: number }[] {
    const db = getGraphDb(project);
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
function graphOrphans(limit = 50, type?: string, project?: string): { name: string; file: string; type: string; calleeCount: number }[] {
    const db = getGraphDb(project);
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
function graphStats(project?: string): { 
    nodeCount: number; 
    edgeCount: number; 
    avgCallersPerNode: number;
    avgCalleesPerNode: number;
    maxCallers: { name: string; count: number };
    maxCallees: { name: string; count: number };
    projects?: { name: string; nodeCount: number; edgeCount: number }[];
} | null {
    // 如果指定项目，只查该项目
    if (project) {
        const db = getGraphDb(project);
        if (!db) return null;
        return querySingleDbStats(db);
    }
    
    // 否则合并所有项目
    const allDbs = getAllGraphDbs();
    if (allDbs.length === 0) return null;
    
    let totalNodes = 0, totalEdges = 0;
    const projects: { name: string; nodeCount: number; edgeCount: number }[] = [];
    let maxCallers = { name: '', count: 0 };
    let maxCallees = { name: '', count: 0 };
    
    for (const { name, db } of allDbs) {
        try {
            const stats = querySingleDbStats(db);
            if (stats) {
                totalNodes += stats.nodeCount;
                totalEdges += stats.edgeCount;
                projects.push({ name, nodeCount: stats.nodeCount, edgeCount: stats.edgeCount });
                if (stats.maxCallers.count > maxCallers.count) {
                    maxCallers = { name: `${name}:${stats.maxCallers.name}`, count: stats.maxCallers.count };
                }
                if (stats.maxCallees.count > maxCallees.count) {
                    maxCallees = { name: `${name}:${stats.maxCallees.name}`, count: stats.maxCallees.count };
                }
            }
        } catch (e) {}
    }
    
    return {
        nodeCount: totalNodes,
        edgeCount: totalEdges,
        avgCallersPerNode: totalNodes > 0 ? Math.round(totalEdges / totalNodes * 100) / 100 : 0,
        avgCalleesPerNode: totalNodes > 0 ? Math.round(totalEdges / totalNodes * 100) / 100 : 0,
        maxCallers,
        maxCallees,
        projects
    };
}

function querySingleDbStats(db: Database.Database): { 
    nodeCount: number; 
    edgeCount: number; 
    avgCallersPerNode: number;
    avgCalleesPerNode: number;
    maxCallers: { name: string; count: number };
    maxCallees: { name: string; count: number };
} | null {
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
function graphCycles(limit = 20, _minSize = 2, project?: string): { 
    cycles: { functions: { name: string; file: string }[]; callsAtoB: number; callsBtoA: number }[];
    selfLoops: { name: string; file: string; count: number }[];
    totalMutualPairs: number;
    totalSelfLoops: number;
} {
    const db = getGraphDb(project);
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

/**
 * 从文件路径提取模块名（取到倒数第二级目录）
 * 例如: src/bingo/campaign/rescue_rush/rpc.ts -> src/bingo/campaign/rescue_rush
 */
function extractModule(filePath: string, depth = 3): string {
    const parts = filePath.split('/').filter(Boolean);
    // 去掉文件名，取前 depth 级目录
    const dirs = parts.slice(0, -1);
    return dirs.slice(0, Math.min(depth, dirs.length)).join('/') || 'root';
}

/**
 * 模块列表 - 按目录聚合，统计每个模块的函数数量
 */
function graphModules(depth = 3, limit = 50, project?: string): { 
    modules: { name: string; nodeCount: number; edgeCount: number }[];
    totalModules: number;
} {
    const db = getGraphDb(project);
    if (!db) return { modules: [], totalModules: 0 };
    
    try {
        // 获取所有节点，按模块聚合
        const nodes = db.prepare(`SELECT file FROM nodes`).all() as any[];
        const moduleStats = new Map<string, { nodes: number; edges: number }>();
        
        for (const node of nodes) {
            const mod = extractModule(node.file, depth);
            const stats = moduleStats.get(mod) || { nodes: 0, edges: 0 };
            stats.nodes++;
            moduleStats.set(mod, stats);
        }
        
        // 统计模块的边数（出边）
        const edges = db.prepare(`SELECT caller_file FROM edges`).all() as any[];
        for (const edge of edges) {
            const mod = extractModule(edge.caller_file, depth);
            const stats = moduleStats.get(mod);
            if (stats) stats.edges++;
        }
        
        // 排序并限制数量
        const modules = Array.from(moduleStats.entries())
            .map(([name, stats]) => ({ name, nodeCount: stats.nodes, edgeCount: stats.edges }))
            .sort((a, b) => b.nodeCount - a.nodeCount)
            .slice(0, limit);
        
        return { modules, totalModules: moduleStats.size };
    } catch (e: any) {
        console.error('[CodeIndex] graphModules error:', e.message);
        return { modules: [], totalModules: 0 };
    }
}

/**
 * 模块依赖分析 - 某模块依赖哪些其他模块（出边）
 */
function graphModuleDeps(moduleName: string, depth = 3, limit = 30, project?: string): {
    module: string;
    dependencies: { name: string; callCount: number; functions: string[] }[];
    totalDeps: number;
} {
    const db = getGraphDb(project);
    if (!db) return { module: moduleName, dependencies: [], totalDeps: 0 };
    
    try {
        // 找出从该模块调用其他模块的边（JOIN nodes 获取 callee 的文件）
        const edges = db.prepare(`
            SELECT e.caller_file, e.caller_name, e.callee_name, n.file as callee_file
            FROM edges e
            LEFT JOIN nodes n ON n.name = e.callee_name
            WHERE e.caller_file LIKE ?
        `).all(`${moduleName}%`) as any[];
        
        // 按目标模块聚合
        const depStats = new Map<string, { count: number; funcs: Set<string> }>();
        
        for (const edge of edges) {
            if (!edge.callee_file) continue;  // 跳过外部函数
            const callerMod = extractModule(edge.caller_file, depth);
            const calleeMod = extractModule(edge.callee_file, depth);
            
            // 只统计跨模块调用
            if (callerMod !== calleeMod) {
                const stats = depStats.get(calleeMod) || { count: 0, funcs: new Set() };
                stats.count++;
                stats.funcs.add(edge.callee_name);
                depStats.set(calleeMod, stats);
            }
        }
        
        // 排序
        const dependencies = Array.from(depStats.entries())
            .map(([name, stats]) => ({ 
                name, 
                callCount: stats.count, 
                functions: Array.from(stats.funcs).slice(0, 10) 
            }))
            .sort((a, b) => b.callCount - a.callCount)
            .slice(0, limit);
        
        return { module: moduleName, dependencies, totalDeps: depStats.size };
    } catch (e: any) {
        console.error('[CodeIndex] graphModuleDeps error:', e.message);
        return { module: moduleName, dependencies: [], totalDeps: 0 };
    }
}

/**
 * 模块被依赖分析 - 哪些模块依赖这个模块（入边）
 */
function graphModuleDependents(moduleName: string, depth = 3, limit = 30, project?: string): {
    module: string;
    dependents: { name: string; callCount: number; functions: string[] }[];
    totalDependents: number;
} {
    const db = getGraphDb(project);
    if (!db) return { module: moduleName, dependents: [], totalDependents: 0 };
    
    try {
        // 找出调用该模块的边（通过 nodes 表关联 callee 的文件）
        const edges = db.prepare(`
            SELECT e.caller_file, e.caller_name, e.callee_name, n.file as callee_file
            FROM edges e
            JOIN nodes n ON n.name = e.callee_name
            WHERE n.file LIKE ?
        `).all(`${moduleName}%`) as any[];
        
        // 按来源模块聚合
        const depStats = new Map<string, { count: number; funcs: Set<string> }>();
        
        for (const edge of edges) {
            const callerMod = extractModule(edge.caller_file, depth);
            const calleeMod = extractModule(edge.callee_file, depth);
            
            // 只统计跨模块调用
            if (callerMod !== calleeMod) {
                const stats = depStats.get(callerMod) || { count: 0, funcs: new Set() };
                stats.count++;
                stats.funcs.add(edge.caller_name);
                depStats.set(callerMod, stats);
            }
        }
        
        // 排序
        const dependents = Array.from(depStats.entries())
            .map(([name, stats]) => ({ 
                name, 
                callCount: stats.count, 
                functions: Array.from(stats.funcs).slice(0, 10) 
            }))
            .sort((a, b) => b.callCount - a.callCount)
            .slice(0, limit);
        
        return { module: moduleName, dependents, totalDependents: depStats.size };
    } catch (e: any) {
        console.error('[CodeIndex] graphModuleDependents error:', e.message);
        return { module: moduleName, dependents: [], totalDependents: 0 };
    }
}

/**
 * 模块间依赖矩阵 - 所有模块之间的调用统计
 */
function graphModuleMatrix(depth = 3, limit = 20, project?: string): {
    modules: string[];
    matrix: { from: string; to: string; count: number }[];
    totalCrossModuleCalls: number;
} {
    const db = getGraphDb(project);
    if (!db) return { modules: [], matrix: [], totalCrossModuleCalls: 0 };
    
    try {
        // JOIN nodes 获取 callee 的文件
        const edges = db.prepare(`
            SELECT e.caller_file, n.file as callee_file
            FROM edges e
            LEFT JOIN nodes n ON n.name = e.callee_name
        `).all() as any[];
        
        // 按模块对聚合
        const pairStats = new Map<string, number>();
        const moduleSet = new Set<string>();
        let totalCross = 0;
        
        for (const edge of edges) {
            if (!edge.callee_file) continue;  // 跳过外部函数
            const fromMod = extractModule(edge.caller_file, depth);
            const toMod = extractModule(edge.callee_file, depth);
            moduleSet.add(fromMod);
            moduleSet.add(toMod);
            
            if (fromMod !== toMod) {
                const key = `${fromMod}|${toMod}`;
                pairStats.set(key, (pairStats.get(key) || 0) + 1);
                totalCross++;
            }
        }
        
        // 取调用最多的模块
        const topModules = Array.from(moduleSet)
            .map(m => {
                let count = 0;
                pairStats.forEach((v, k) => {
                    if (k.startsWith(m + '|') || k.endsWith('|' + m)) count += v;
                });
                return { name: m, count };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, limit)
            .map(m => m.name);
        
        // 构建矩阵（只包含 top 模块）
        const topSet = new Set(topModules);
        const matrix = Array.from(pairStats.entries())
            .filter(([k]) => {
                const [from, to] = k.split('|');
                return topSet.has(from) && topSet.has(to);
            })
            .map(([k, count]) => {
                const [from, to] = k.split('|');
                return { from, to, count };
            })
            .sort((a, b) => b.count - a.count);
        
        return { modules: topModules, matrix, totalCrossModuleCalls: totalCross };
    } catch (e: any) {
        console.error('[CodeIndex] graphModuleMatrix error:', e.message);
        return { modules: [], matrix: [], totalCrossModuleCalls: 0 };
    }
}

/**
 * 类型继承图 - 查找某类/接口的子类/实现类
 */
function graphChildren(name: string, limit = 50, project?: string): {
    children: { name: string; file: string; type: string; relation: string }[];
    total: number;
} {
    const db = getGraphDb(project);
    if (!db) return { children: [], total: 0 };
    
    try {
        const children = db.prepare(`
            SELECT child_name as name, child_file as file, child_type as type, relation
            FROM inheritance
            WHERE parent_name LIKE ?
            ORDER BY relation, child_name
            LIMIT ?
        `).all(`%${name}%`, limit) as any[];
        
        const total = (db.prepare(`
            SELECT COUNT(*) as cnt FROM inheritance WHERE parent_name LIKE ?
        `).get(`%${name}%`) as any)?.cnt || 0;
        
        return { children, total };
    } catch (e: any) {
        console.error('[CodeIndex] graphChildren error:', e.message);
        return { children: [], total: 0 };
    }
}

/**
 * 类型继承图 - 查找某类/接口的父类/实现的接口
 */
function graphParents(name: string, limit = 50, project?: string): {
    parents: { name: string; type: string; relation: string }[];
    total: number;
} {
    const db = getGraphDb(project);
    if (!db) return { parents: [], total: 0 };
    
    try {
        const parents = db.prepare(`
            SELECT parent_name as name, parent_type as type, relation
            FROM inheritance
            WHERE child_name LIKE ?
            ORDER BY relation
            LIMIT ?
        `).all(`%${name}%`, limit) as any[];
        
        const total = (db.prepare(`
            SELECT COUNT(*) as cnt FROM inheritance WHERE child_name LIKE ?
        `).get(`%${name}%`) as any)?.cnt || 0;
        
        return { parents, total };
    } catch (e: any) {
        console.error('[CodeIndex] graphParents error:', e.message);
        return { parents: [], total: 0 };
    }
}

/**
 * 继承树 - 递归查找完整的继承链
 */
function graphInheritanceTree(name: string, project?: string, direction: 'up' | 'down' = 'down', maxDepth = 5): {
    root: string;
    tree: { name: string; file?: string; children?: any[] }[];
    totalNodes: number;
} {
    const db = getGraphDb(project);
    if (!db) return { root: name, tree: [], totalNodes: 0 };
    
    try {
        const visited = new Set<string>();
        let totalNodes = 0;
        
        function buildTree(nodeName: string, depth: number): any[] {
            if (depth >= maxDepth || visited.has(nodeName) || totalNodes > 100) return [];
            visited.add(nodeName);
            totalNodes++;
            
            let query: any[];
            if (direction === 'down') {
                // 找子类
                query = db!.prepare(`
                    SELECT child_name as name, child_file as file, relation
                    FROM inheritance WHERE parent_name = ?
                `).all(nodeName) as any[];
            } else {
                // 找父类
                query = db!.prepare(`
                    SELECT parent_name as name, relation
                    FROM inheritance WHERE child_name = ?
                `).all(nodeName) as any[];
            }
            
            return query.map(row => ({
                name: row.name,
                file: row.file,
                relation: row.relation,
                children: buildTree(row.name, depth + 1)
            }));
        }
        
        const tree = buildTree(name, 0);
        return { root: name, tree, totalNodes };
    } catch (e: any) {
        console.error('[CodeIndex] graphInheritanceTree error:', e.message);
        return { root: name, tree: [], totalNodes: 0 };
    }
}

/**
 * 装饰器搜索 - 查找使用某装饰器的所有目标
 */
function graphDecoratorTargets(decoratorName: string, limit = 100, project?: string): {
    targets: { name: string; file: string; type: string; args: string; line: number }[];
    total: number;
} {
    const db = getGraphDb(project);
    if (!db) return { targets: [], total: 0 };
    
    try {
        const targets = db.prepare(`
            SELECT target_name as name, file, target_type as type, decorator_args as args, line
            FROM decorators
            WHERE decorator_name = ?
            ORDER BY file, line
            LIMIT ?
        `).all(decoratorName, limit) as any[];
        
        const total = (db.prepare(`
            SELECT COUNT(*) as cnt FROM decorators WHERE decorator_name = ?
        `).get(decoratorName) as any)?.cnt || 0;
        
        return { targets, total };
    } catch (e: any) {
        console.error('[CodeIndex] graphDecoratorTargets error:', e.message);
        return { targets: [], total: 0 };
    }
}

/**
 * 装饰器统计
 */
function graphDecoratorStats(project?: string): {
    total: number;
    byDecorator: { name: string; count: number }[];
    byType: { type: string; count: number }[];
} | null {
    const db = getGraphDb(project);
    if (!db) return null;
    
    try {
        const total = (db.prepare(`SELECT COUNT(*) as cnt FROM decorators`).get() as any)?.cnt || 0;
        
        const byDecorator = db.prepare(`
            SELECT decorator_name as name, COUNT(*) as count
            FROM decorators
            GROUP BY decorator_name
            ORDER BY count DESC
            LIMIT 20
        `).all() as any[];
        
        const byType = db.prepare(`
            SELECT target_type as type, COUNT(*) as count
            FROM decorators
            GROUP BY target_type
            ORDER BY count DESC
        `).all() as any[];
        
        return { total, byDecorator, byType };
    } catch (e: any) {
        console.error('[CodeIndex] graphDecoratorStats error:', e.message);
        return null;
    }
}

/**
 * RPC 端点列表 - 专门查询 @Rpc 装饰器
 */
function graphRpcEndpoints(limit = 200, project?: string): {
    endpoints: { name: string; file: string; rpcName: string; line: number }[];
    total: number;
} {
    const db = getGraphDb(project);
    if (!db) return { endpoints: [], total: 0 };
    
    try {
        const endpoints = db.prepare(`
            SELECT target_name as name, file, decorator_args as args, line
            FROM decorators
            WHERE decorator_name = 'Rpc'
            ORDER BY file, line
            LIMIT ?
        `).all(limit) as any[];
        
        // 解析 RPC 名称
        const parsed = endpoints.map(e => {
            let rpcName = '';
            try {
                const args = JSON.parse(e.args);
                rpcName = args[0] || '';
            } catch {}
            return { name: e.name, file: e.file, rpcName, line: e.line };
        });
        
        const total = (db.prepare(`
            SELECT COUNT(*) as cnt FROM decorators WHERE decorator_name = 'Rpc'
        `).get() as any)?.cnt || 0;
        
        return { endpoints: parsed, total };
    } catch (e: any) {
        console.error('[CodeIndex] graphRpcEndpoints error:', e.message);
        return { endpoints: [], total: 0 };
    }
}

/**
 * Controller 列表 - 专门查询 @Controller 装饰器
 */
function graphControllers(limit = 100, project?: string): {
    controllers: { name: string; file: string; path: string; line: number }[];
    total: number;
} {
    const db = getGraphDb(project);
    if (!db) return { controllers: [], total: 0 };
    
    try {
        const controllers = db.prepare(`
            SELECT target_name as name, file, decorator_args as args, line
            FROM decorators
            WHERE decorator_name = 'Controller'
            ORDER BY file, line
            LIMIT ?
        `).all(limit) as any[];
        
        const parsed = controllers.map(c => {
            let path = '';
            try {
                const args = JSON.parse(c.args);
                path = args[0] || '';
            } catch {}
            return { name: c.name, file: c.file, path, line: c.line };
        });
        
        const total = (db.prepare(`
            SELECT COUNT(*) as cnt FROM decorators WHERE decorator_name = 'Controller'
        `).get() as any)?.cnt || 0;
        
        return { controllers: parsed, total };
    } catch (e: any) {
        console.error('[CodeIndex] graphControllers error:', e.message);
        return { controllers: [], total: 0 };
    }
}

/**
 * 继承统计
 */
function graphInheritanceStats(project?: string): {
    total: number;
    extends: number;
    implements: number;
    topParents: { name: string; childCount: number }[];
    deepestTrees: { name: string; depth: number }[];
} | null {
    const db = getGraphDb(project);
    if (!db) return null;
    
    try {
        const total = (db.prepare(`SELECT COUNT(*) as cnt FROM inheritance`).get() as any)?.cnt || 0;
        const extendsCount = (db.prepare(`SELECT COUNT(*) as cnt FROM inheritance WHERE relation = 'extends'`).get() as any)?.cnt || 0;
        const implementsCount = (db.prepare(`SELECT COUNT(*) as cnt FROM inheritance WHERE relation = 'implements'`).get() as any)?.cnt || 0;
        
        const topParents = db.prepare(`
            SELECT parent_name as name, COUNT(*) as childCount
            FROM inheritance
            GROUP BY parent_name
            ORDER BY childCount DESC
            LIMIT 10
        `).all() as any[];
        
        return {
            total,
            extends: extendsCount,
            implements: implementsCount,
            topParents,
            deepestTrees: [] // 计算深度太耗时，先留空
        };
    } catch (e: any) {
        console.error('[CodeIndex] graphInheritanceStats error:', e.message);
        return null;
    }
}

function graphInfo(name: string, project?: string): { nodes: any[]; callerCount: number; calleeCount: number } {
    try {
        const db = getGraphDb(project);
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
        
        // 列出项目（摘要）
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
        
        // 列出图数据库项目
        if (path === '/graph-projects') {
            refreshGraphDbs();
            const graphProjects = Object.entries(GRAPH_DB_PATHS).map(([name, dbPath]) => {
                try {
                    const db = getGraphDb(name);
                    if (!db) return { name, dbPath, error: 'failed to load' };
                    
                    const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any)?.c || 0;
                    const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as any)?.c || 0;
                    
                    let inheritanceCount = 0;
                    let decoratorCount = 0;
                    try {
                        inheritanceCount = (db.prepare('SELECT COUNT(*) as c FROM inheritance').get() as any)?.c || 0;
                    } catch {}
                    try {
                        decoratorCount = (db.prepare('SELECT COUNT(*) as c FROM decorators').get() as any)?.c || 0;
                    } catch {}
                    
                    return { name, dbPath, nodeCount, edgeCount, inheritanceCount, decoratorCount };
                } catch (e: any) {
                    return { name, dbPath, error: e.message };
                }
            });
            sendJson({ ok: true, graphProjects });
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
            const project = url.searchParams.get('project') || undefined;
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const results = graphCallers(name, limit, project);
            sendJson({ ok: true, name, project: project || 'bf-nakama-ts', count: results.length, callers: results });
            return;
        }
        
        // 图查询: 这个函数调用了谁
        if (path === '/graph/callees') {
            const name = url.searchParams.get('name');
            const limit = parseInt(url.searchParams.get('limit') || '50');
            const project = url.searchParams.get('project') || undefined;
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const results = graphCallees(name, limit, project);
            sendJson({ ok: true, name, project: project || 'bf-nakama-ts', count: results.length, callees: results });
            return;
        }
        
        // 图查询: 两点间的路径
        if (path === '/graph/path') {
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const maxDepth = parseInt(url.searchParams.get('depth') || '5');
            const project = url.searchParams.get('project') || undefined;
            
            if (!from || !to) {
                sendJson({ ok: false, error: '缺少参数 from 或 to' }, 400);
                return;
            }
            
            const results = graphPath(from, to, maxDepth, project);
            sendJson({ ok: true, from, to, project: project || 'bf-nakama-ts', count: results.length, paths: results });
            return;
        }
        
        // 图查询: 函数信息
        if (path === '/graph/info') {
            const name = url.searchParams.get('name');
            const project = url.searchParams.get('project') || undefined;
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const info = graphInfo(name, project);
            sendJson({ ok: true, name, project: project || 'bf-nakama-ts', ...info });
            return;
        }
        
        // 图查询: 影响范围分析（改了某函数，哪些地方会受影响）
        if (path === '/graph/impact') {
            const name = url.searchParams.get('name');
            const depth = parseInt(url.searchParams.get('depth') || '3');
            const limit = parseInt(url.searchParams.get('limit') || '100');
            const project = url.searchParams.get('project') || undefined;
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const result = graphImpact(name, depth, limit, project);
            sendJson({ 
                ok: true, 
                name, 
                project: project || 'bf-nakama-ts',
                depth,
                totalAffected: result.total,
                layers: result.layers 
            });
            return;
        }
        
        // 图查询: 递归向上追踪调用链
        if (path === '/graph/callers-chain') {
            const name = url.searchParams.get('name');
            const depth = parseInt(url.searchParams.get('depth') || '5');
            const maxChains = parseInt(url.searchParams.get('max') || '10');
            const project = url.searchParams.get('project') || undefined;
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const result = graphCallersChain(name, depth, maxChains, project);
            sendJson({ 
                ok: true, 
                description: `从 ${name} 向上追踪的调用链`,
                name,
                project: project || 'bf-nakama-ts',
                depth,
                ...result
            });
            return;
        }
        
        // 图查询: 热点分析（被调用最多的函数）
        if (path === '/graph/hotspots') {
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const project = url.searchParams.get('project') || undefined;
            const results = graphHotspots(limit, project);
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
            const project = url.searchParams.get('project') || undefined;
            const results = graphOrphans(limit, type, project);
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
            const project = url.searchParams.get('project') || undefined;
            const stats = graphStats(project);
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
            const project = url.searchParams.get('project') || undefined;
            const result = graphCycles(limit, 2, project);
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
        
        // 模块列表（按目录聚合）
        if (path === '/graph/modules') {
            const depth = parseInt(url.searchParams.get('depth') || '3');
            const limit = parseInt(url.searchParams.get('limit') || '50');
            const project = url.searchParams.get('project') || undefined;
            const result = graphModules(depth, limit, project);
            sendJson({ 
                ok: true, 
                description: '模块列表（按目录聚合）',
                depth,
                ...result
            });
            return;
        }
        
        // 模块依赖分析（某模块依赖哪些模块）
        if (path === '/graph/module-deps') {
            const moduleName = url.searchParams.get('module');
            const depth = parseInt(url.searchParams.get('depth') || '3');
            const limit = parseInt(url.searchParams.get('limit') || '30');
            
            if (!moduleName) {
                sendJson({ ok: false, error: '缺少参数 module' }, 400);
                return;
            }
            
            const project = url.searchParams.get('project') || undefined;
            const result = graphModuleDeps(moduleName, depth, limit, project);
            sendJson({ 
                ok: true, 
                description: `模块 ${moduleName} 的依赖（它调用了哪些模块）`,
                ...result
            });
            return;
        }
        
        // 模块被依赖分析（哪些模块依赖这个模块）
        if (path === '/graph/module-dependents') {
            const moduleName = url.searchParams.get('module');
            const depth = parseInt(url.searchParams.get('depth') || '3');
            const limit = parseInt(url.searchParams.get('limit') || '30');
            
            if (!moduleName) {
                sendJson({ ok: false, error: '缺少参数 module' }, 400);
                return;
            }
            
            const project = url.searchParams.get('project') || undefined;
            const result = graphModuleDependents(moduleName, depth, limit, project);
            sendJson({ 
                ok: true, 
                description: `哪些模块依赖 ${moduleName}`,
                ...result
            });
            return;
        }
        
        // 模块依赖矩阵
        if (path === '/graph/module-matrix') {
            const depth = parseInt(url.searchParams.get('depth') || '3');
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const project = url.searchParams.get('project') || undefined;
            const result = graphModuleMatrix(depth, limit, project);
            sendJson({ 
                ok: true, 
                description: '模块间依赖矩阵（跨模块调用统计）',
                depth,
                ...result
            });
            return;
        }
        
        // 继承图: 查找子类/实现类
        if (path === '/graph/children') {
            const name = url.searchParams.get('name');
            const limit = parseInt(url.searchParams.get('limit') || '50');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const project = url.searchParams.get('project') || undefined;
            const result = graphChildren(name, limit, project);
            sendJson({ 
                ok: true, 
                description: `${name} 的子类/实现类`,
                name,
                ...result
            });
            return;
        }
        
        // 继承图: 查找父类/接口
        if (path === '/graph/parents') {
            const name = url.searchParams.get('name');
            const limit = parseInt(url.searchParams.get('limit') || '50');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const project = url.searchParams.get('project') || undefined;
            const result = graphParents(name, limit, project);
            sendJson({ 
                ok: true, 
                description: `${name} 的父类/实现的接口`,
                name,
                ...result
            });
            return;
        }
        
        // 继承图: 继承树
        if (path === '/graph/inheritance-tree') {
            const name = url.searchParams.get('name');
            const direction = (url.searchParams.get('direction') || 'down') as 'up' | 'down';
            const maxDepth = parseInt(url.searchParams.get('depth') || '5');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const project = url.searchParams.get('project') || undefined;
            const result = graphInheritanceTree(name, project, direction, maxDepth);
            sendJson({ 
                ok: true, 
                description: direction === 'down' ? `${name} 的继承树（向下）` : `${name} 的继承链（向上）`,
                direction,
                ...result
            });
            return;
        }
        
        // 继承图: 统计信息
        if (path === '/graph/inheritance-stats') {
            const project = url.searchParams.get('project') || undefined;
            const stats = graphInheritanceStats(project);
            if (stats) {
                sendJson({ ok: true, description: '类型继承统计', ...stats });
            } else {
                sendJson({ ok: false, error: '继承表未加载' }, 500);
            }
            return;
        }
        
        // 装饰器: 查找使用某装饰器的目标
        if (path === '/graph/decorator-targets') {
            const name = url.searchParams.get('name');
            const limit = parseInt(url.searchParams.get('limit') || '100');
            
            if (!name) {
                sendJson({ ok: false, error: '缺少参数 name' }, 400);
                return;
            }
            
            const project = url.searchParams.get('project') || undefined;
            const result = graphDecoratorTargets(name, limit, project);
            sendJson({ 
                ok: true, 
                description: `使用 @${name} 装饰器的目标`,
                decorator: name,
                ...result
            });
            return;
        }
        
        // 装饰器: 统计
        if (path === '/graph/decorator-stats') {
            const project = url.searchParams.get('project') || undefined;
            const stats = graphDecoratorStats(project);
            if (stats) {
                sendJson({ ok: true, description: '装饰器统计', ...stats });
            } else {
                sendJson({ ok: false, error: '装饰器表未加载' }, 500);
            }
            return;
        }
        
        // 装饰器: RPC 端点列表
        if (path === '/graph/rpc-endpoints') {
            const limit = parseInt(url.searchParams.get('limit') || '200');
            const project = url.searchParams.get('project') || undefined;
            const result = graphRpcEndpoints(limit, project);
            sendJson({ 
                ok: true, 
                description: '所有 RPC 端点（@Rpc 装饰器）',
                ...result
            });
            return;
        }
        
        // 装饰器: Controller 列表
        if (path === '/graph/controllers') {
            const limit = parseInt(url.searchParams.get('limit') || '100');
            const project = url.searchParams.get('project') || undefined;
            const result = graphControllers(limit, project);
            sendJson({ 
                ok: true, 
                description: '所有 Controller（@Controller 装饰器）',
                ...result
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
        
        // ============ 增量索引 API ============
        
        // 增量索引: 触发索引
        if (path === '/incremental/index' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { projectRoot, dbPath } = JSON.parse(body);
                    
                    if (!projectRoot) {
                        sendJson({ ok: false, error: '缺少 projectRoot' }, 400);
                        return;
                    }
                    
                    // 动态导入增量索引器
                    const { IncrementalIndexer } = await import('./incremental-indexer.js');
                    
                    const indexer = new IncrementalIndexer({
                        projectRoot,
                        dbPath: dbPath || join(projectRoot, '.code-index.db'),
                        patterns: ['**/*.ts'],
                        ignorePatterns: ['**/node_modules/**', '**/*.spec.ts', '**/*.test.ts', '**/*.d.ts'],
                    });
                    
                    const result = await indexer.index();
                    const stats = indexer.getStats();
                    indexer.close();
                    
                    sendJson({
                        ok: true,
                        description: '增量索引完成',
                        result: {
                            added: result.added,
                            updated: result.updated,
                            removed: result.removed,
                            unchanged: result.unchanged,
                            timeMs: Math.round(result.totalTime),
                        },
                        stats: {
                            nodes: stats.nodes,
                            edges: stats.edges,
                            files: stats.files,
                        }
                    });
                } catch (e: any) {
                    sendJson({ ok: false, error: e.message }, 500);
                }
            });
            return;
        }
        
        // 增量索引: 查询索引状态
        if (path === '/incremental/status') {
            const projectRoot = url.searchParams.get('projectRoot');
            
            if (!projectRoot) {
                sendJson({ ok: false, error: '缺少 projectRoot' }, 400);
                return;
            }
            
            const dbPath = join(projectRoot, '.code-index.db');
            
            if (!existsSync(dbPath)) {
                sendJson({ ok: true, indexed: false, message: '尚未索引' });
                return;
            }
            
            try {
                const db = new Database(dbPath, { readonly: true });
                const nodes = (db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as any).cnt;
                const edges = (db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as any).cnt;
                const files = (db.prepare('SELECT COUNT(*) as cnt FROM file_hashes').get() as any).cnt;
                const lastIndexed = (db.prepare('SELECT MAX(indexed_at) as t FROM file_hashes').get() as any).t;
                db.close();
                
                sendJson({
                    ok: true,
                    indexed: true,
                    stats: { nodes, edges, files },
                    lastIndexed,
                    dbPath,
                });
            } catch (e: any) {
                sendJson({ ok: false, error: e.message }, 500);
            }
            return;
        }
        
        // ============ 跨语言 RPC 关联 API ============
        
        // 跨语言 RPC 分析 - 找出 Go 调用的 RPC 与 TS 定义的关联
        if (path === '/graph/cross-rpc') {
            try {
                const results: {
                    goProject: string;
                    tsProject: string;
                    associations: { rpcName: string; goCallers: string[]; tsHandler: string | null }[];
                }[] = [];
                
                // 获取所有 Go 项目的 RPC 调用
                const goProjects = ['bf-server-nakama', 'bf-server-nakama-game'];
                const tsProject = 'bf-nakama-ts';
                
                // 获取 TS 的 RPC endpoints
                const tsDb = getGraphDb(tsProject);
                let tsRpcMap = new Map<string, { name: string; file: string }>();
                
                if (tsDb) {
                    try {
                        const rpcEndpoints = tsDb.prepare(`
                            SELECT target_name, file, decorator_args
                            FROM decorators
                            WHERE decorator_name = 'Rpc'
                        `).all() as any[];
                        
                        for (const rpc of rpcEndpoints) {
                            // 解析 RPC 名称
                            try {
                                const args = JSON.parse(rpc.decorator_args);
                                let rpcName = args[0] || '';
                                // 处理 BingoServer.Rpc.xxx 格式
                                if (typeof rpcName === 'string') {
                                    const match = rpcName.match(/\.([^.]+)$/);
                                    if (match) rpcName = match[1];
                                    // 转换为 snake_case
                                    rpcName = rpcName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
                                    tsRpcMap.set(rpcName, { name: rpc.target_name, file: rpc.file });
                                }
                            } catch {}
                        }
                    } catch {}
                }
                
                // 从 Go edges 中找 ForwardRpc 调用（通过搜索 callee_name）
                for (const goProject of goProjects) {
                    const goDb = getGraphDb(goProject);
                    if (!goDb) continue;
                    
                    const associations: { rpcName: string; goCallers: string[]; tsHandler: string | null }[] = [];
                    
                    try {
                        // 搜索调用 ForwardRpc 的边
                        const forwardRpcCalls = goDb.prepare(`
                            SELECT DISTINCT caller_name, caller_file
                            FROM edges
                            WHERE callee_name = 'ForwardRpc'
                        `).all() as any[];
                        
                        // 如果有 ForwardRpc 调用，尝试匹配
                        if (associations.length > 0) {
                            // 搜索代码中的 RPC 名称（通过 search）
                            const searchResults = search('ForwardRpc', goProject, 100);
                            for (const result of searchResults) {
                                for (const item of result.results) {
                                    // 从 signature 中提取 RPC 名称
                                    if (item.signature) {
                                        const match = item.signature.match(/ForwardRpc[^"]*"([^"]+)"/);
                                        if (match) {
                                            const rpcName = match[1];
                                            const tsHandler = tsRpcMap.get(rpcName);
                                            associations.push({
                                                rpcName,
                                                goCallers: [item.name],
                                                tsHandler: tsHandler ? `${tsHandler.name} (${tsHandler.file})` : null
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    } catch {}
                    
                    if (associations.length > 0 || associations.length > 0) {
                        results.push({
                            goProject,
                            tsProject,
                            associations
                        });
                    }
                }
                
                sendJson({
                    ok: true,
                    description: '跨语言 RPC 关联分析 (Go → TS)',
                    tsRpcCount: tsRpcMap.size,
                    results
                });
            } catch (e: any) {
                sendJson({ ok: false, error: e.message }, 500);
            }
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
