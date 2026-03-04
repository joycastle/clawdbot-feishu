/**
 * 文件级增量代码索引器
 * 
 * 基于 tree-sitter，支持：
 * 1. 文件 hash 对比，只重新索引变化的文件
 * 2. watch 模式实时更新
 * 3. SQLite 存储调用图
 */

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import chokidar from 'chokidar';

// ============ 配置 ============

interface Config {
  projectRoot: string;
  dbPath: string;
  patterns: string[];
  ignorePatterns: string[];
}

// ============ 类型 ============

interface NodeInfo {
  file: string;
  name: string;
  type: 'function' | 'method' | 'class' | 'interface' | 'enum' | 'arrow';
  startLine: number;
  endLine: number;
  exported: boolean;
}

interface CallEdge {
  callerFile: string;
  callerName: string;
  callerType: string;
  calleeName: string;
  calleeType: string;
  line: number;
}

interface FileIndex {
  nodes: NodeInfo[];
  edges: CallEdge[];
}

// ============ 解析器 ============

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function parseFile(filePath: string, relativePath: string): FileIndex {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(content);
  
  const nodes: NodeInfo[] = [];
  const edges: CallEdge[] = [];
  
  // 遍历 AST
  function visit(node: Parser.SyntaxNode, currentClass?: string) {
    switch (node.type) {
      case 'class_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          nodes.push({
            file: relativePath,
            name,
            type: 'class',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: hasExportModifier(node),
          });
          // 递归处理类内部，传递类名
          for (const child of node.children) {
            visit(child, name);
          }
          return; // 不再继续默认递归
        }
        break;
      }
      
      case 'interface_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          nodes.push({
            file: relativePath,
            name: nameNode.text,
            type: 'interface',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: hasExportModifier(node),
          });
        }
        break;
      }
      
      case 'enum_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          nodes.push({
            file: relativePath,
            name: nameNode.text,
            type: 'enum',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: hasExportModifier(node),
          });
        }
        break;
      }
      
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          nodes.push({
            file: relativePath,
            name: nameNode.text,
            type: 'function',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: hasExportModifier(node),
          });
        }
        break;
      }
      
      case 'method_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode && currentClass) {
          const methodName = `${currentClass}.${nameNode.text}`;
          nodes.push({
            file: relativePath,
            name: methodName,
            type: 'method',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isPublicMethod(node),
          });
        }
        break;
      }
      
      case 'lexical_declaration':
      case 'variable_declaration': {
        // 检查是否是箭头函数
        for (const child of node.children) {
          if (child.type === 'variable_declarator') {
            const nameNode = child.childForFieldName('name');
            const valueNode = child.childForFieldName('value');
            if (nameNode && valueNode?.type === 'arrow_function') {
              nodes.push({
                file: relativePath,
                name: nameNode.text,
                type: 'arrow',
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                exported: hasExportModifier(node),
              });
            }
          }
        }
        break;
      }
      
      case 'call_expression': {
        // 提取调用关系
        const enclosing = findEnclosingFunction(node, currentClass);
        if (enclosing) {
          const funcNode = node.childForFieldName('function');
          if (funcNode) {
            let calleeName = funcNode.text;
            let calleeType = 'function';
            
            // 简化：member_expression -> method
            if (funcNode.type === 'member_expression') {
              calleeType = 'method';
            }
            
            edges.push({
              callerFile: relativePath,
              callerName: enclosing.name,
              callerType: enclosing.type,
              calleeName,
              calleeType,
              line: node.startPosition.row + 1,
            });
          }
        }
        break;
      }
    }
    
    // 默认递归
    for (const child of node.children) {
      visit(child, currentClass);
    }
  }
  
  visit(tree.rootNode);
  
  return { nodes, edges };
}

function hasExportModifier(node: Parser.SyntaxNode): boolean {
  // 检查父节点是否是 export_statement
  const parent = node.parent;
  if (parent?.type === 'export_statement') return true;
  
  // 检查是否有 export 修饰符
  for (const child of node.children) {
    if (child.type === 'export') return true;
  }
  return false;
}

function isPublicMethod(node: Parser.SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === 'accessibility_modifier') {
      return child.text === 'public';
    }
  }
  // 默认是 public
  return true;
}

function findEnclosingFunction(
  node: Parser.SyntaxNode,
  currentClass?: string
): { name: string; type: string } | null {
  let current = node.parent;
  
  while (current) {
    if (current.type === 'function_declaration') {
      const nameNode = current.childForFieldName('name');
      if (nameNode) return { name: nameNode.text, type: 'function' };
    }
    
    if (current.type === 'method_definition') {
      const nameNode = current.childForFieldName('name');
      if (nameNode) {
        const className = findClassName(current);
        const name = className ? `${className}.${nameNode.text}` : nameNode.text;
        return { name, type: 'method' };
      }
    }
    
    if (current.type === 'arrow_function') {
      // 找变量名
      const varDecl = current.parent;
      if (varDecl?.type === 'variable_declarator') {
        const nameNode = varDecl.childForFieldName('name');
        if (nameNode) return { name: nameNode.text, type: 'arrow' };
      }
    }
    
    current = current.parent;
  }
  
  return null;
}

function findClassName(node: Parser.SyntaxNode): string | null {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'class') {
      const nameNode = current.childForFieldName('name');
      if (nameNode) return nameNode.text;
    }
    current = current.parent;
  }
  return null;
}

// ============ 数据库 ============

function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_hashes (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      exported INTEGER DEFAULT 0,
      UNIQUE(file, name, type, start_line)
    );
    
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_file TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      caller_type TEXT NOT NULL,
      callee_name TEXT NOT NULL,
      callee_type TEXT NOT NULL,
      line INTEGER,
      UNIQUE(caller_file, caller_name, callee_name, line)
    );
    
    CREATE INDEX IF NOT EXISTS idx_file_hashes_path ON file_hashes(path);
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
    CREATE INDEX IF NOT EXISTS idx_edges_caller ON edges(caller_name);
    CREATE INDEX IF NOT EXISTS idx_edges_callee ON edges(callee_name);
  `);
  
  return db;
}

// ============ 增量索引器 ============

class IncrementalIndexer {
  private db: Database.Database;
  private config: Config;
  private stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  
  constructor(config: Config) {
    this.config = config;
    this.db = initDb(config.dbPath);
  }
  
  /**
   * 获取所有需要索引的文件
   */
  private async getFiles(): Promise<string[]> {
    const files: string[] = [];
    
    for (const pattern of this.config.patterns) {
      const matches = await glob(pattern, {
        cwd: this.config.projectRoot,
        ignore: this.config.ignorePatterns,
        absolute: false,
      });
      files.push(...matches);
    }
    
    return [...new Set(files)];
  }
  
  /**
   * 检查文件是否需要重新索引
   */
  private needsReindex(relativePath: string, currentHash: string): boolean {
    const row = this.db.prepare('SELECT hash FROM file_hashes WHERE path = ?').get(relativePath) as { hash: string } | undefined;
    return !row || row.hash !== currentHash;
  }
  
  /**
   * 删除文件的旧索引
   */
  private removeFileIndex(relativePath: string): void {
    this.db.prepare('DELETE FROM nodes WHERE file = ?').run(relativePath);
    this.db.prepare('DELETE FROM edges WHERE caller_file = ?').run(relativePath);
    this.db.prepare('DELETE FROM file_hashes WHERE path = ?').run(relativePath);
  }
  
  /**
   * 添加文件索引
   */
  private addFileIndex(relativePath: string, hash: string, index: FileIndex): void {
    const insertNode = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (file, name, type, start_line, end_line, exported)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO edges (caller_file, caller_name, caller_type, callee_name, callee_type, line)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertHash = this.db.prepare(`
      INSERT OR REPLACE INTO file_hashes (path, hash, indexed_at)
      VALUES (?, ?, ?)
    `);
    
    const transaction = this.db.transaction(() => {
      for (const node of index.nodes) {
        insertNode.run(node.file, node.name, node.type, node.startLine, node.endLine, node.exported ? 1 : 0);
      }
      for (const edge of index.edges) {
        insertEdge.run(edge.callerFile, edge.callerName, edge.callerType, edge.calleeName, edge.calleeType, edge.line);
      }
      insertHash.run(relativePath, hash, new Date().toISOString());
    });
    
    transaction();
  }
  
  /**
   * 清理已删除文件的索引
   */
  private cleanupDeletedFiles(currentFiles: Set<string>): number {
    const indexed = this.db.prepare('SELECT path FROM file_hashes').all() as { path: string }[];
    let removed = 0;
    
    for (const row of indexed) {
      if (!currentFiles.has(row.path)) {
        this.removeFileIndex(row.path);
        removed++;
      }
    }
    
    return removed;
  }
  
  /**
   * 执行增量索引
   */
  async index(): Promise<{ added: number; updated: number; removed: number; unchanged: number; totalTime: number }> {
    const startTime = performance.now();
    this.stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
    
    console.log(`[Indexer] 扫描文件: ${this.config.projectRoot}`);
    const files = await this.getFiles();
    console.log(`[Indexer] 找到 ${files.length} 个文件`);
    
    const currentFiles = new Set(files);
    
    // 清理已删除的文件
    this.stats.removed = this.cleanupDeletedFiles(currentFiles);
    if (this.stats.removed > 0) {
      console.log(`[Indexer] 清理 ${this.stats.removed} 个已删除文件`);
    }
    
    // 处理每个文件
    let processed = 0;
    for (const relativePath of files) {
      const absolutePath = path.join(this.config.projectRoot, relativePath);
      
      try {
        const hash = hashFile(absolutePath);
        
        if (this.needsReindex(relativePath, hash)) {
          // 需要重新索引
          const isNew = !this.db.prepare('SELECT 1 FROM file_hashes WHERE path = ?').get(relativePath);
          
          // 删除旧索引
          this.removeFileIndex(relativePath);
          
          // 解析并添加新索引
          const index = parseFile(absolutePath, relativePath);
          this.addFileIndex(relativePath, hash, index);
          
          if (isNew) {
            this.stats.added++;
          } else {
            this.stats.updated++;
          }
        } else {
          this.stats.unchanged++;
        }
      } catch (err) {
        console.error(`[Indexer] 处理失败: ${relativePath}`, err);
      }
      
      processed++;
      if (processed % 500 === 0) {
        console.log(`[Indexer] 进度: ${processed}/${files.length}`);
      }
    }
    
    const totalTime = performance.now() - startTime;
    
    return { ...this.stats, totalTime };
  }
  
  /**
   * 获取统计信息
   */
  getStats(): { nodes: number; edges: number; files: number } {
    const nodes = (this.db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as any).cnt;
    const edges = (this.db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as any).cnt;
    const files = (this.db.prepare('SELECT COUNT(*) as cnt FROM file_hashes').get() as any).cnt;
    return { nodes, edges, files };
  }
  
  /**
   * 更新单个文件的索引
   */
  updateFile(relativePath: string): { action: 'added' | 'updated' | 'unchanged'; time: number } {
    const absolutePath = path.join(this.config.projectRoot, relativePath);
    const startTime = performance.now();
    
    try {
      const hash = hashFile(absolutePath);
      
      if (this.needsReindex(relativePath, hash)) {
        const isNew = !this.db.prepare('SELECT 1 FROM file_hashes WHERE path = ?').get(relativePath);
        
        this.removeFileIndex(relativePath);
        const index = parseFile(absolutePath, relativePath);
        this.addFileIndex(relativePath, hash, index);
        
        return { action: isNew ? 'added' : 'updated', time: performance.now() - startTime };
      }
      
      return { action: 'unchanged', time: performance.now() - startTime };
    } catch (err) {
      console.error(`[Indexer] 更新失败: ${relativePath}`, err);
      return { action: 'unchanged', time: performance.now() - startTime };
    }
  }
  
  /**
   * 删除单个文件的索引
   */
  removeFile(relativePath: string): void {
    this.removeFileIndex(relativePath);
    console.log(`[Indexer] 已删除: ${relativePath}`);
  }
  
  /**
   * 启动 watch 模式
   */
  watch(): void {
    const patterns = this.config.patterns.map(p => path.join(this.config.projectRoot, p));
    const ignorePatterns = this.config.ignorePatterns;
    
    console.log(`[Watch] 监听: ${this.config.projectRoot}`);
    
    const watcher = chokidar.watch(patterns, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });
    
    watcher.on('add', (filePath) => {
      const relativePath = path.relative(this.config.projectRoot, filePath);
      if (this.shouldIndex(relativePath)) {
        const result = this.updateFile(relativePath);
        console.log(`[Watch] 新增: ${relativePath} (${result.time.toFixed(1)}ms)`);
      }
    });
    
    watcher.on('change', (filePath) => {
      const relativePath = path.relative(this.config.projectRoot, filePath);
      if (this.shouldIndex(relativePath)) {
        const result = this.updateFile(relativePath);
        if (result.action !== 'unchanged') {
          console.log(`[Watch] 更新: ${relativePath} (${result.time.toFixed(1)}ms)`);
        }
      }
    });
    
    watcher.on('unlink', (filePath) => {
      const relativePath = path.relative(this.config.projectRoot, filePath);
      this.removeFile(relativePath);
    });
    
    watcher.on('error', (error) => {
      console.error('[Watch] 错误:', error);
    });
    
    watcher.on('ready', () => {
      console.log('[Watch] 初始扫描完成，开始监听...');
    });
  }
  
  /**
   * 检查文件是否应该被索引
   */
  private shouldIndex(relativePath: string): boolean {
    // 检查是否匹配忽略模式
    for (const pattern of this.config.ignorePatterns) {
      if (relativePath.includes('node_modules') || 
          relativePath.endsWith('.spec.ts') ||
          relativePath.endsWith('.test.ts') ||
          relativePath.endsWith('.d.ts')) {
        return false;
      }
    }
    // 检查是否是 .ts 文件
    return relativePath.endsWith('.ts');
  }
  
  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}

// ============ CLI ============

async function main() {
  const args = process.argv.slice(2);
  
  // 解析参数
  const watchMode = args.includes('--watch') || args.includes('-w');
  const filteredArgs = args.filter(a => a !== '--watch' && a !== '-w');
  
  if (filteredArgs.length === 0) {
    console.log('增量代码索引器 (tree-sitter)\n');
    console.log('用法: npx tsx incremental-indexer.ts <project-root> [db-path] [--watch]');
    console.log('');
    console.log('选项:');
    console.log('  --watch, -w    启动 watch 模式，实时监听文件变化');
    console.log('');
    console.log('示例:');
    console.log('  npx tsx incremental-indexer.ts /path/to/project');
    console.log('  npx tsx incremental-indexer.ts /path/to/project --watch');
    console.log('  npx tsx incremental-indexer.ts /path/to/project ./index.db --watch');
    process.exit(1);
  }
  
  const projectRoot = path.resolve(filteredArgs[0]);
  const dbPath = filteredArgs[1] || path.join(projectRoot, '.code-index.db');
  
  console.log('=== 增量代码索引器 ===\n');
  console.log(`项目: ${projectRoot}`);
  console.log(`数据库: ${dbPath}`);
  console.log(`模式: ${watchMode ? 'watch' : '单次索引'}\n`);
  
  const indexer = new IncrementalIndexer({
    projectRoot,
    dbPath,
    patterns: ['**/*.ts'],
    ignorePatterns: ['**/node_modules/**', '**/*.spec.ts', '**/*.test.ts', '**/*.d.ts'],
  });
  
  // 首次索引
  console.log('--- 索引 ---');
  const result = await indexer.index();
  console.log(`耗时: ${(result.totalTime / 1000).toFixed(2)}s`);
  console.log(`新增: ${result.added}, 更新: ${result.updated}, 删除: ${result.removed}, 未变: ${result.unchanged}`);
  
  const stats = indexer.getStats();
  console.log(`总计: ${stats.nodes} 节点, ${stats.edges} 边, ${stats.files} 文件\n`);
  
  if (watchMode) {
    // 进入 watch 模式
    indexer.watch();
    
    // 处理退出信号
    process.on('SIGINT', () => {
      console.log('\n[Watch] 停止监听...');
      indexer.close();
      process.exit(0);
    });
  } else {
    indexer.close();
    console.log('完成!');
  }
}

// 如果直接运行，执行 CLI
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('incremental-indexer.ts');

if (isMainModule) {
  main().catch(console.error);
}

// 导出供其他模块使用
export { IncrementalIndexer, Config, NodeInfo, CallEdge, FileIndex };
