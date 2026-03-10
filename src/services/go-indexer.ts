/**
 * Go 代码索引器
 * 
 * 基于 tree-sitter-go，提取：
 * 1. 函数/方法定义
 * 2. 调用关系
 * 3. 结构体/接口定义
 */

import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ 配置 ============

interface Config {
  projectRoot: string;
  projectName: string;
  dbPath: string;
}

// ============ 类型 ============

interface NodeInfo {
  file: string;
  name: string;
  type: 'function' | 'method' | 'struct' | 'interface';
  receiver?: string;  // Go method receiver type
  startLine: number;
  endLine: number;
  exported: boolean;
  signature?: string;
}

interface CallEdge {
  callerFile: string;
  callerName: string;
  callerType: string;
  calleeName: string;
  line: number;
}

interface RpcRegistration {
  file: string;
  rpcName: string;
  handlerName: string;
  line: number;
  registerType: string; // RegisterRpc, RegisterBeforeRt, RegisterAfterRt, etc.
}

interface InheritanceEdge {
  childName: string;
  childFile: string;
  childType: 'struct' | 'interface';
  parentName: string;
  parentType: 'struct' | 'interface' | 'unknown';
  relation: 'embeds';  // Go 用 embeds 而不是 extends/implements
}

interface FileIndex {
  nodes: NodeInfo[];
  edges: CallEdge[];
  inheritance: InheritanceEdge[];
  rpcRegistrations: RpcRegistration[];
}

// ============ 解析器 ============

const parser = new Parser();
parser.setLanguage(Go);

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function isExported(name: string): boolean {
  // Go: exported if first letter is uppercase
  return /^[A-Z]/.test(name);
}

function parseGoFile(filePath: string, relativePath: string): FileIndex {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(content);
  
  const nodes: NodeInfo[] = [];
  const edges: CallEdge[] = [];
  const inheritance: InheritanceEdge[] = [];
  const rpcRegistrations: RpcRegistration[] = [];
  
  // Nakama runtime registration patterns
  const REGISTER_PATTERNS = new Set([
    'RegisterRpc',
    'RegisterBeforeRt',
    'RegisterAfterRt',
    'RegisterBeforeGetAccount',
    'RegisterAfterGetAccount',
    'RegisterMatch',
    'RegisterMatchmakerMatched',
  ]);
  
  let currentFunc: { name: string; type: string } | null = null;
  
  function visit(node: Parser.SyntaxNode) {
    switch (node.type) {
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = nameNode.text;
          nodes.push({
            file: relativePath,
            name,
            type: 'function',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isExported(name),
          });
          
          // 记录当前函数用于关联调用
          const prevFunc = currentFunc;
          currentFunc = { name, type: 'function' };
          
          // 解析函数体
          const body = node.childForFieldName('body');
          if (body) {
            for (const child of body.children) {
              visit(child);
            }
          }
          
          currentFunc = prevFunc;
          return;
        }
        break;
      }
      
      case 'method_declaration': {
        const nameNode = node.childForFieldName('name');
        const receiverNode = node.childForFieldName('receiver');
        if (nameNode) {
          const name = nameNode.text;
          let receiver: string | undefined;
          
          // 解析 receiver 类型
          if (receiverNode) {
            const typeNode = receiverNode.descendantsOfType('type_identifier')[0];
            if (typeNode) {
              receiver = typeNode.text;
            }
          }
          
          const fullName = receiver ? `${receiver}.${name}` : name;
          
          nodes.push({
            file: relativePath,
            name: fullName,
            type: 'method',
            receiver,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isExported(name),
          });
          
          // 记录当前方法
          const prevFunc = currentFunc;
          currentFunc = { name: fullName, type: 'method' };
          
          // 解析方法体
          const body = node.childForFieldName('body');
          if (body) {
            for (const child of body.children) {
              visit(child);
            }
          }
          
          currentFunc = prevFunc;
          return;
        }
        break;
      }
      
      case 'type_declaration': {
        // struct 或 interface 定义
        for (const child of node.children) {
          if (child.type === 'type_spec') {
            const nameNode = child.childForFieldName('name');
            const typeNode = child.childForFieldName('type');
            if (nameNode && typeNode) {
              const name = nameNode.text;
              let kind: 'struct' | 'interface' = 'struct';
              if (typeNode.type === 'interface_type') {
                kind = 'interface';
              }
              
              nodes.push({
                file: relativePath,
                name,
                type: kind,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                exported: isExported(name),
              });
              
              // 提取嵌入的类型
              if (typeNode.type === 'struct_type') {
                // 遍历 struct 字段找嵌入类型 (children[0] 是 field_declaration_list)
                const fieldList = typeNode.children.find(c => c.type === 'field_declaration_list');
                if (fieldList) {
                  for (const field of fieldList.children) {
                    if (field.type === 'field_declaration') {
                      // 嵌入类型没有名字字段，只有类型字段
                      // 检查是否只有一个 child 且是类型
                      const typeChildren = field.children.filter(c => 
                        c.type === 'type_identifier' || 
                        c.type === 'pointer_type' || 
                        c.type === 'qualified_type'
                      );
                      const nameChildren = field.children.filter(c => c.type === 'field_identifier');
                      
                      // 如果没有字段名，只有类型，这是嵌入
                      if (nameChildren.length === 0 && typeChildren.length > 0) {
                        for (const typeChild of typeChildren) {
                          let embeddedType = '';
                          if (typeChild.type === 'type_identifier') {
                            embeddedType = typeChild.text;
                          } else if (typeChild.type === 'pointer_type') {
                            // *Type - 找内部的 type_identifier
                            const inner = typeChild.children.find(c => c.type === 'type_identifier');
                            if (inner) {
                              embeddedType = inner.text;
                            }
                          } else if (typeChild.type === 'qualified_type') {
                            // pkg.Type
                            embeddedType = typeChild.text;
                          }
                          if (embeddedType) {
                            inheritance.push({
                              childName: name,
                              childFile: relativePath,
                              childType: 'struct',
                              parentName: embeddedType,
                              parentType: 'unknown',
                              relation: 'embeds',
                            });
                          }
                        }
                      }
                    }
                  }
                }
              } else if (typeNode.type === 'interface_type') {
                // 遍历 interface 方法列表找嵌入的接口
                for (const member of typeNode.children) {
                  if (member.type === 'type_identifier') {
                    // 嵌入的接口
                    inheritance.push({
                      childName: name,
                      childFile: relativePath,
                      childType: 'interface',
                      parentName: member.text,
                      parentType: 'interface',
                      relation: 'embeds',
                    });
                  } else if (member.type === 'qualified_type') {
                    inheritance.push({
                      childName: name,
                      childFile: relativePath,
                      childType: 'interface',
                      parentName: member.text,
                      parentType: 'interface',
                      relation: 'embeds',
                    });
                  }
                }
              }
            }
          }
        }
        break;
      }
      
      case 'call_expression': {
        // 函数调用
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
          let calleeName = '';
          
          if (funcNode.type === 'identifier') {
            calleeName = funcNode.text;
          } else if (funcNode.type === 'selector_expression') {
            // obj.Method() 或 pkg.Func()
            const field = funcNode.childForFieldName('field');
            if (field) {
              calleeName = field.text;
            }
          }
          
          // 记录普通调用
          if (calleeName && currentFunc) {
            edges.push({
              callerFile: relativePath,
              callerName: currentFunc.name,
              callerType: currentFunc.type,
              calleeName,
              line: node.startPosition.row + 1,
            });
          }
          
          // 检测 Nakama RPC 注册
          if (REGISTER_PATTERNS.has(calleeName)) {
            const argsNode = node.childForFieldName('arguments');
            if (argsNode) {
              const args = argsNode.children.filter(c => 
                c.type !== '(' && c.type !== ')' && c.type !== ','
              );
              
              // RegisterRpc(id, handler) - 第一个参数是 RPC 名称
              if (args.length >= 2) {
                let rpcName = '';
                const firstArg = args[0];
                
                // 提取 RPC 名称
                if (firstArg.type === 'interpreted_string_literal') {
                  // "rpc_name"
                  rpcName = firstArg.text.slice(1, -1); // 去掉引号
                } else if (firstArg.type === 'identifier') {
                  // 变量引用，记录变量名
                  rpcName = `<${firstArg.text}>`;
                } else if (firstArg.type === 'call_expression') {
                  // string(xxx) 或 fmt.Sprintf(...)
                  rpcName = `<expr:${firstArg.text.slice(0, 50)}>`;
                }
                
                // 提取处理函数名
                let handlerName = '';
                const secondArg = args[1];
                if (secondArg.type === 'identifier') {
                  handlerName = secondArg.text;
                } else if (secondArg.type === 'selector_expression') {
                  handlerName = secondArg.text;
                } else if (secondArg.type === 'func_literal') {
                  handlerName = '<anonymous>';
                }
                
                if (rpcName) {
                  rpcRegistrations.push({
                    file: relativePath,
                    rpcName,
                    handlerName,
                    line: node.startPosition.row + 1,
                    registerType: calleeName,
                  });
                }
              }
            }
          }
        }
        break;
      }
    }
    
    // 递归子节点
    for (const child of node.children) {
      visit(child);
    }
  }
  
  visit(tree.rootNode);
  
  return { nodes, edges, inheritance, rpcRegistrations };
}

// ============ 数据库 ============

function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY,
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      receiver TEXT,
      start_line INTEGER,
      end_line INTEGER,
      exported INTEGER,
      UNIQUE(file, name, type)
    );
    
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY,
      caller_file TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      caller_type TEXT NOT NULL,
      callee_name TEXT NOT NULL,
      line INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS file_hashes (
      file TEXT PRIMARY KEY,
      hash TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS inheritance (
      id INTEGER PRIMARY KEY,
      child_name TEXT NOT NULL,
      child_file TEXT NOT NULL,
      child_type TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      parent_type TEXT,
      relation TEXT NOT NULL DEFAULT 'embeds'
    );
    
    CREATE TABLE IF NOT EXISTS rpc_registrations (
      id INTEGER PRIMARY KEY,
      file TEXT NOT NULL,
      rpc_name TEXT NOT NULL,
      handler_name TEXT,
      line INTEGER,
      register_type TEXT NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
    CREATE INDEX IF NOT EXISTS idx_edges_caller ON edges(caller_name);
    CREATE INDEX IF NOT EXISTS idx_edges_callee ON edges(callee_name);
    CREATE INDEX IF NOT EXISTS idx_inheritance_child ON inheritance(child_name);
    CREATE INDEX IF NOT EXISTS idx_inheritance_parent ON inheritance(parent_name);
    CREATE INDEX IF NOT EXISTS idx_rpc_name ON rpc_registrations(rpc_name);
    CREATE INDEX IF NOT EXISTS idx_rpc_handler ON rpc_registrations(handler_name);
  `);
  
  return db;
}

// ============ 索引逻辑 ============

async function indexProject(config: Config) {
  console.log(`[Go Indexer] Starting: ${config.projectName}`);
  console.log(`[Go Indexer] Root: ${config.projectRoot}`);
  
  const startTime = Date.now();
  
  // 初始化数据库
  const db = initDatabase(config.dbPath);
  
  // 获取现有 hash
  const existingHashes = new Map<string, string>();
  const hashStmt = db.prepare('SELECT file, hash FROM file_hashes');
  for (const row of hashStmt.iterate() as Iterable<{ file: string; hash: string }>) {
    existingHashes.set(row.file, row.hash);
  }
  
  // 查找所有 Go 文件
  const pattern = path.join(config.projectRoot, '**/*.go');
  const files = await glob(pattern, {
    ignore: ['**/vendor/**', '**/*_test.go', '**/testdata/**'],
  });
  
  console.log(`[Go Indexer] Found ${files.length} Go files`);
  
  // 统计
  let added = 0, updated = 0, unchanged = 0;
  let totalNodes = 0, totalEdges = 0;
  
  // 准备语句
  const insertNode = db.prepare(`
    INSERT OR REPLACE INTO nodes (file, name, type, receiver, start_line, end_line, exported)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO edges (caller_file, caller_name, caller_type, callee_name, line)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertHash = db.prepare(`
    INSERT OR REPLACE INTO file_hashes (file, hash) VALUES (?, ?)
  `);
  const insertInheritance = db.prepare(`
    INSERT INTO inheritance (child_name, child_file, child_type, parent_name, parent_type, relation)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRpcRegistration = db.prepare(`
    INSERT INTO rpc_registrations (file, rpc_name, handler_name, line, register_type)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteFileNodes = db.prepare('DELETE FROM nodes WHERE file = ?');
  const deleteFileEdges = db.prepare('DELETE FROM edges WHERE caller_file = ?');
  const deleteFileInheritance = db.prepare('DELETE FROM inheritance WHERE child_file = ?');
  const deleteFileRpcRegistrations = db.prepare('DELETE FROM rpc_registrations WHERE file = ?');
  
  // 当前文件集
  const currentFiles = new Set<string>();
  
  // 索引每个文件
  const indexFile = db.transaction((filePath: string) => {
    const relativePath = path.relative(config.projectRoot, filePath);
    currentFiles.add(relativePath);
    
    const newHash = hashFile(filePath);
    const oldHash = existingHashes.get(relativePath);
    
    if (oldHash === newHash) {
      unchanged++;
      return;
    }
    
    // 删除旧数据
    deleteFileNodes.run(relativePath);
    deleteFileEdges.run(relativePath);
    deleteFileInheritance.run(relativePath);
    deleteFileRpcRegistrations.run(relativePath);
    
    // 解析文件
    try {
      const { nodes, edges, inheritance, rpcRegistrations } = parseGoFile(filePath, relativePath);
      
      for (const node of nodes) {
        insertNode.run(
          node.file,
          node.name,
          node.type,
          node.receiver || null,
          node.startLine,
          node.endLine,
          node.exported ? 1 : 0
        );
        totalNodes++;
      }
      
      for (const edge of edges) {
        insertEdge.run(
          edge.callerFile,
          edge.callerName,
          edge.callerType,
          edge.calleeName,
          edge.line
        );
        totalEdges++;
      }
      
      for (const inh of inheritance) {
        insertInheritance.run(
          inh.childName,
          inh.childFile,
          inh.childType,
          inh.parentName,
          inh.parentType,
          inh.relation
        );
      }
      
      for (const rpc of rpcRegistrations) {
        insertRpcRegistration.run(
          rpc.file,
          rpc.rpcName,
          rpc.handlerName,
          rpc.line,
          rpc.registerType
        );
      }
      
      insertHash.run(relativePath, newHash);
      
      if (oldHash) {
        updated++;
      } else {
        added++;
      }
    } catch (err) {
      console.error(`[Go Indexer] Error parsing ${relativePath}:`, err);
    }
  });
  
  // 执行索引
  for (const file of files) {
    indexFile(file);
  }
  
  // 删除不存在的文件
  let removed = 0;
  for (const oldFile of existingHashes.keys()) {
    if (!currentFiles.has(oldFile)) {
      deleteFileNodes.run(oldFile);
      deleteFileEdges.run(oldFile);
      deleteFileInheritance.run(oldFile);
      deleteFileRpcRegistrations.run(oldFile);
      db.prepare('DELETE FROM file_hashes WHERE file = ?').run(oldFile);
      removed++;
    }
  }
  
  // 统计总数
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
  const inheritanceCount = (db.prepare('SELECT COUNT(*) as c FROM inheritance').get() as { c: number }).c;
  const rpcCount = (db.prepare('SELECT COUNT(*) as c FROM rpc_registrations').get() as { c: number }).c;
  
  db.close();
  
  const elapsed = Date.now() - startTime;
  
  console.log(`[Go Indexer] Done in ${elapsed}ms`);
  console.log(`[Go Indexer] Files: +${added} ~${updated} -${removed} =${unchanged}`);
  console.log(`[Go Indexer] Total: ${nodeCount} nodes, ${edgeCount} edges, ${inheritanceCount} inheritance, ${rpcCount} RPC registrations`);
  
  return { added, updated, removed, unchanged, nodeCount, edgeCount, inheritanceCount, rpcCount, elapsed };
}

// ============ 生成摘要 JSONL ============

async function generateSummaries(config: Config, outputPath: string) {
  const db = new Database(config.dbPath, { readonly: true });
  
  const nodes = db.prepare(`
    SELECT file, name, type, receiver, start_line, end_line, exported
    FROM nodes
    ORDER BY file, start_line
  `).all() as any[];
  
  const lines: string[] = [];
  
  for (const node of nodes) {
    // 格式兼容 code-index-api 的 Summary 类型
    const summary = {
      file: node.file,  // code-index-api 用 file 不是 path
      name: node.name,
      type: node.type,
      signature: node.receiver ? `(${node.receiver}) ${node.name}` : node.name,
      doc: node.exported ? 'exported' : '',
      lines: node.start_line && node.end_line ? `${node.start_line}-${node.end_line}` : undefined,
    };
    lines.push(JSON.stringify(summary));
  }
  
  fs.writeFileSync(outputPath, lines.join('\n'));
  console.log(`[Go Indexer] Wrote ${lines.length} summaries to ${outputPath}`);
  
  db.close();
}

// ============ CLI ============

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: npx tsx go-indexer.ts <project-root> [project-name]');
    console.log('');
    console.log('Options:');
    console.log('  --summaries  Also generate summaries.jsonl');
    process.exit(1);
  }
  
  const projectRoot = path.resolve(args[0]);
  const projectName = args[1] || path.basename(projectRoot);
  const generateSummariesFlag = args.includes('--summaries');
  
  const dataDir = path.join(__dirname, '../../data/code-index');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const dbPath = path.join(dataDir, `${projectName}-call-graph.db`);
  
  const config: Config = {
    projectRoot,
    projectName,
    dbPath,
  };
  
  await indexProject(config);
  
  if (generateSummariesFlag) {
    const summariesPath = path.join(dataDir, `${projectName}.jsonl`);
    await generateSummaries(config, summariesPath);
  }
}

main().catch(console.error);
