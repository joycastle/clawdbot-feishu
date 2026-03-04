/**
 * 通用调用图提取器
 * 
 * 环境变量:
 *   PROJECT_ROOT - 项目源代码目录 (必须包含 tsconfig.json)
 *   DB_PATH - 输出 SQLite 数据库路径
 * 
 * 用法:
 *   PROJECT_ROOT=/path/to/src DB_PATH=/path/to/db.db npx tsx extract-call-graph.ts
 */

import { Project, Node, SyntaxKind, SourceFile } from 'ts-morph';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_ROOT = process.env.PROJECT_ROOT;
const DB_PATH = process.env.DB_PATH;

if (!PROJECT_ROOT || !DB_PATH) {
  console.error('错误: 必须设置 PROJECT_ROOT 和 DB_PATH 环境变量');
  console.error('用法: PROJECT_ROOT=/path/to/src DB_PATH=/path/to/db.db npx tsx extract-call-graph.ts');
  process.exit(1);
}

// 检查 tsconfig.json
const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json');
if (!fs.existsSync(tsconfigPath)) {
  console.error(`错误: 未找到 ${tsconfigPath}`);
  console.error('项目目录必须包含 tsconfig.json');
  process.exit(1);
}

interface CallEdge {
  caller_file: string;
  caller_name: string;
  caller_type: 'function' | 'method' | 'arrow';
  callee_name: string;
  callee_type: 'function' | 'method' | 'property';
  line: number;
}

interface NodeInfo {
  file: string;
  name: string;
  type: 'function' | 'method' | 'class' | 'arrow';
  start_line: number;
  end_line: number;
  exported: boolean;
}

function initDb(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  
  db.exec(`
    DROP TABLE IF EXISTS nodes;
    DROP TABLE IF EXISTS edges;
    
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      exported INTEGER DEFAULT 0,
      UNIQUE(file, name, type, start_line)
    );
    
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_file TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      caller_type TEXT NOT NULL,
      callee_name TEXT NOT NULL,
      callee_type TEXT NOT NULL,
      line INTEGER,
      UNIQUE(caller_file, caller_name, callee_name, line)
    );
    
    CREATE INDEX idx_nodes_name ON nodes(name);
    CREATE INDEX idx_nodes_file ON nodes(file);
    CREATE INDEX idx_edges_caller ON edges(caller_name);
    CREATE INDEX idx_edges_callee ON edges(callee_name);
  `);
  
  return db;
}

function getEnclosingFunction(node: Node): { name: string; type: 'function' | 'method' | 'arrow' } | null {
  let current = node.getParent();
  
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name) return { name, type: 'function' };
    }
    if (Node.isMethodDeclaration(current)) {
      const name = current.getName();
      const className = current.getParent()?.asKind(SyntaxKind.ClassDeclaration)?.getName();
      if (name) return { name: className ? `${className}.${name}` : name, type: 'method' };
    }
    if (Node.isArrowFunction(current)) {
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        const name = parent.getName();
        return { name, type: 'arrow' };
      }
      if (Node.isPropertyDeclaration(parent)) {
        const name = parent.getName();
        const className = parent.getParent()?.asKind(SyntaxKind.ClassDeclaration)?.getName();
        return { name: className ? `${className}.${name}` : name, type: 'arrow' };
      }
    }
    current = current.getParent();
  }
  
  return null;
}

function extractFromFile(sourceFile: SourceFile, relativePath: string): { nodes: NodeInfo[]; edges: CallEdge[] } {
  const nodes: NodeInfo[] = [];
  const edges: CallEdge[] = [];
  
  // 提取函数声明
  sourceFile.getFunctions().forEach(func => {
    const name = func.getName();
    if (name) {
      nodes.push({
        file: relativePath,
        name,
        type: 'function',
        start_line: func.getStartLineNumber(),
        end_line: func.getEndLineNumber(),
        exported: func.isExported()
      });
    }
  });
  
  // 提取类和方法
  sourceFile.getClasses().forEach(cls => {
    const className = cls.getName();
    if (className) {
      nodes.push({
        file: relativePath,
        name: className,
        type: 'class',
        start_line: cls.getStartLineNumber(),
        end_line: cls.getEndLineNumber(),
        exported: cls.isExported()
      });
      
      cls.getMethods().forEach(method => {
        const methodName = method.getName();
        nodes.push({
          file: relativePath,
          name: `${className}.${methodName}`,
          type: 'method',
          start_line: method.getStartLineNumber(),
          end_line: method.getEndLineNumber(),
          exported: method.getScope() === 'public'
        });
      });
    }
  });
  
  // 提取顶层箭头函数
  sourceFile.getVariableDeclarations().forEach(varDecl => {
    const init = varDecl.getInitializer();
    if (init && Node.isArrowFunction(init)) {
      nodes.push({
        file: relativePath,
        name: varDecl.getName(),
        type: 'arrow',
        start_line: varDecl.getStartLineNumber(),
        end_line: varDecl.getEndLineNumber(),
        exported: varDecl.isExported()
      });
    }
  });
  
  // 提取调用关系
  sourceFile.forEachDescendant(node => {
    if (Node.isCallExpression(node)) {
      const caller = getEnclosingFunction(node);
      if (!caller) return;
      
      const expr = node.getExpression();
      let calleeName: string;
      let calleeType: 'function' | 'method' | 'property' = 'function';
      
      if (Node.isIdentifier(expr)) {
        calleeName = expr.getText();
      } else if (Node.isPropertyAccessExpression(expr)) {
        calleeName = expr.getText();
        calleeType = 'method';
      } else {
        return;
      }
      
      edges.push({
        caller_file: relativePath,
        caller_name: caller.name,
        caller_type: caller.type,
        callee_name: calleeName,
        callee_type: calleeType,
        line: node.getStartLineNumber()
      });
    }
  });
  
  return { nodes, edges };
}

async function main() {
  console.log(`[调用图提取] 项目: ${PROJECT_ROOT}`);
  console.log(`[调用图提取] 数据库: ${DB_PATH}`);
  
  console.log('初始化数据库...');
  const db = initDb();
  
  console.log('加载项目...');
  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: true,
  });
  
  const sourceFiles = project.addSourceFilesAtPaths([
    `${PROJECT_ROOT}/**/*.ts`,
    `!${PROJECT_ROOT}/**/*.spec.ts`,
    `!${PROJECT_ROOT}/**/*.test.ts`,
    `!${PROJECT_ROOT}/**/*.d.ts`,
    `!${PROJECT_ROOT}/**/node_modules/**`,
  ]);
  
  console.log(`找到 ${sourceFiles.length} 个源文件`);
  
  const insertNode = db.prepare(`
    INSERT OR IGNORE INTO nodes (file, name, type, start_line, end_line, exported)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO edges (caller_file, caller_name, caller_type, callee_name, callee_type, line)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  let totalNodes = 0;
  let totalEdges = 0;
  let processed = 0;
  
  const insertMany = db.transaction((nodes: NodeInfo[], edges: CallEdge[]) => {
    for (const node of nodes) {
      insertNode.run(node.file, node.name, node.type, node.start_line, node.end_line, node.exported ? 1 : 0);
    }
    for (const edge of edges) {
      insertEdge.run(edge.caller_file, edge.caller_name, edge.caller_type, edge.callee_name, edge.callee_type, edge.line);
    }
  });
  
  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    
    try {
      const { nodes, edges } = extractFromFile(sourceFile, relativePath);
      insertMany(nodes, edges);
      totalNodes += nodes.length;
      totalEdges += edges.length;
    } catch (err) {
      console.error(`处理失败: ${relativePath}`, err);
    }
    
    processed++;
    if (processed % 500 === 0) {
      console.log(`进度: ${processed}/${sourceFiles.length} (${totalNodes} nodes, ${totalEdges} edges)`);
    }
  }
  
  console.log(`\n完成!`);
  console.log(`- 节点: ${totalNodes}`);
  console.log(`- 边: ${totalEdges}`);
  console.log(`- 数据库: ${DB_PATH}`);
  
  db.close();
}

main().catch(console.error);
