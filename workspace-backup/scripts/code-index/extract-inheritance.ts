/**
 * 通用继承关系提取器
 * 
 * 环境变量:
 *   PROJECT_ROOT - 项目源代码目录
 *   DB_PATH - SQLite 数据库路径 (由 extract-call-graph 创建)
 * 
 * 用法:
 *   PROJECT_ROOT=/path/to/src DB_PATH=/path/to/db.db npx tsx extract-inheritance.ts
 */

import { Project, SourceFile } from 'ts-morph';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_ROOT = process.env.PROJECT_ROOT;
const DB_PATH = process.env.DB_PATH;

if (!PROJECT_ROOT || !DB_PATH) {
  console.error('错误: 必须设置 PROJECT_ROOT 和 DB_PATH 环境变量');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`错误: 数据库不存在 ${DB_PATH}`);
  console.error('请先运行 extract-call-graph.ts');
  process.exit(1);
}

interface InheritanceEdge {
  child_file: string;
  child_name: string;
  child_type: 'class' | 'interface';
  parent_name: string;
  parent_type: 'class' | 'interface';
  relation: 'extends' | 'implements';
}

function initInheritanceTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inheritance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_file TEXT NOT NULL,
      child_name TEXT NOT NULL,
      child_type TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      parent_type TEXT NOT NULL,
      relation TEXT NOT NULL,
      UNIQUE(child_file, child_name, parent_name)
    );
    
    CREATE INDEX IF NOT EXISTS idx_inheritance_child ON inheritance(child_name);
    CREATE INDEX IF NOT EXISTS idx_inheritance_parent ON inheritance(parent_name);
  `);
  
  db.exec(`DELETE FROM inheritance`);
}

function extractFromFile(sourceFile: SourceFile, relativePath: string): InheritanceEdge[] {
  const edges: InheritanceEdge[] = [];
  
  // 类继承
  sourceFile.getClasses().forEach(cls => {
    const className = cls.getName();
    if (!className) return;
    
    const extendsClause = cls.getExtends();
    if (extendsClause) {
      edges.push({
        child_file: relativePath,
        child_name: className,
        child_type: 'class',
        parent_name: extendsClause.getText(),
        parent_type: 'class',
        relation: 'extends'
      });
    }
    
    cls.getImplements().forEach(impl => {
      edges.push({
        child_file: relativePath,
        child_name: className,
        child_type: 'class',
        parent_name: impl.getText(),
        parent_type: 'interface',
        relation: 'implements'
      });
    });
  });
  
  // 接口继承
  sourceFile.getInterfaces().forEach(iface => {
    const interfaceName = iface.getName();
    if (!interfaceName) return;
    
    iface.getExtends().forEach(ext => {
      edges.push({
        child_file: relativePath,
        child_name: interfaceName,
        child_type: 'interface',
        parent_name: ext.getText(),
        parent_type: 'interface',
        relation: 'extends'
      });
    });
  });
  
  return edges;
}

async function main() {
  console.log(`[继承关系提取] 项目: ${PROJECT_ROOT}`);
  
  const db = new Database(DB_PATH);
  initInheritanceTable(db);
  
  const project = new Project({
    tsConfigFilePath: path.join(PROJECT_ROOT, 'tsconfig.json'),
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
  
  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO inheritance (child_file, child_name, child_type, parent_name, parent_type, relation)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  let totalEdges = 0;
  let processed = 0;
  
  const insertMany = db.transaction((edges: InheritanceEdge[]) => {
    for (const edge of edges) {
      insertEdge.run(edge.child_file, edge.child_name, edge.child_type, edge.parent_name, edge.parent_type, edge.relation);
    }
  });
  
  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    
    try {
      const edges = extractFromFile(sourceFile, relativePath);
      if (edges.length > 0) {
        insertMany(edges);
        totalEdges += edges.length;
      }
    } catch (e: any) {
      console.error(`处理 ${relativePath} 出错:`, e.message);
    }
    
    processed++;
    if (processed % 100 === 0) {
      console.log(`进度: ${processed}/${sourceFiles.length}`);
    }
  }
  
  console.log(`\n完成! 提取了 ${totalEdges} 条继承关系`);
  
  const stats = db.prepare(`SELECT relation, COUNT(*) as count FROM inheritance GROUP BY relation`).all() as any[];
  console.log('\n统计:');
  stats.forEach(s => console.log(`  ${s.relation}: ${s.count}`));
  
  db.close();
}

main().catch(console.error);
