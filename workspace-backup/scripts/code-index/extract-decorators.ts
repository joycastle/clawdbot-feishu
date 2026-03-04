/**
 * 通用装饰器提取器
 * 
 * 环境变量:
 *   PROJECT_ROOT - 项目源代码目录
 *   DB_PATH - SQLite 数据库路径 (由 extract-call-graph 创建)
 * 
 * 用法:
 *   PROJECT_ROOT=/path/to/src DB_PATH=/path/to/db.db npx tsx extract-decorators.ts
 */

import { Project, SourceFile, Decorator } from 'ts-morph';
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

interface DecoratorInfo {
  file: string;
  target_name: string;
  target_type: 'class' | 'method' | 'property' | 'parameter';
  decorator_name: string;
  decorator_args: string;
  line: number;
}

function initDecoratorTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decorators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      target_name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      decorator_name TEXT NOT NULL,
      decorator_args TEXT,
      line INTEGER,
      UNIQUE(file, target_name, decorator_name, line)
    );
    
    CREATE INDEX IF NOT EXISTS idx_decorators_name ON decorators(decorator_name);
    CREATE INDEX IF NOT EXISTS idx_decorators_target ON decorators(target_name);
  `);
  
  db.exec(`DELETE FROM decorators`);
}

function extractDecoratorArgs(decorator: Decorator): string {
  const args: string[] = [];
  decorator.getArguments().forEach(arg => {
    args.push(arg.getText());
  });
  return JSON.stringify(args);
}

function extractFromFile(sourceFile: SourceFile, relativePath: string): DecoratorInfo[] {
  const decorators: DecoratorInfo[] = [];
  
  // 类装饰器
  sourceFile.getClasses().forEach(cls => {
    const className = cls.getName() || 'anonymous';
    
    cls.getDecorators().forEach(dec => {
      decorators.push({
        file: relativePath,
        target_name: className,
        target_type: 'class',
        decorator_name: dec.getName(),
        decorator_args: extractDecoratorArgs(dec),
        line: dec.getStartLineNumber()
      });
    });
    
    // 方法装饰器
    cls.getMethods().forEach(method => {
      const methodName = `${className}.${method.getName()}`;
      
      method.getDecorators().forEach(dec => {
        decorators.push({
          file: relativePath,
          target_name: methodName,
          target_type: 'method',
          decorator_name: dec.getName(),
          decorator_args: extractDecoratorArgs(dec),
          line: dec.getStartLineNumber()
        });
      });
    });
    
    // 属性装饰器
    cls.getProperties().forEach(prop => {
      const propName = `${className}.${prop.getName()}`;
      
      prop.getDecorators().forEach(dec => {
        decorators.push({
          file: relativePath,
          target_name: propName,
          target_type: 'property',
          decorator_name: dec.getName(),
          decorator_args: extractDecoratorArgs(dec),
          line: dec.getStartLineNumber()
        });
      });
    });
  });
  
  // 函数装饰器
  sourceFile.getFunctions().forEach(func => {
    const funcName = func.getName() || 'anonymous';
    
    func.getDecorators().forEach(dec => {
      decorators.push({
        file: relativePath,
        target_name: funcName,
        target_type: 'method',
        decorator_name: dec.getName(),
        decorator_args: extractDecoratorArgs(dec),
        line: dec.getStartLineNumber()
      });
    });
  });
  
  return decorators;
}

async function main() {
  console.log(`[装饰器提取] 项目: ${PROJECT_ROOT}`);
  
  const db = new Database(DB_PATH);
  initDecoratorTable(db);
  
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
  
  const insertDec = db.prepare(`
    INSERT OR IGNORE INTO decorators (file, target_name, target_type, decorator_name, decorator_args, line)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  let totalDecorators = 0;
  let processed = 0;
  
  const insertMany = db.transaction((decs: DecoratorInfo[]) => {
    for (const dec of decs) {
      insertDec.run(dec.file, dec.target_name, dec.target_type, dec.decorator_name, dec.decorator_args, dec.line);
    }
  });
  
  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    
    try {
      const decs = extractFromFile(sourceFile, relativePath);
      if (decs.length > 0) {
        insertMany(decs);
        totalDecorators += decs.length;
      }
    } catch (e: any) {
      console.error(`处理 ${relativePath} 出错:`, e.message);
    }
    
    processed++;
    if (processed % 100 === 0) {
      console.log(`进度: ${processed}/${sourceFiles.length}`);
    }
  }
  
  console.log(`\n完成! 提取了 ${totalDecorators} 个装饰器`);
  
  const stats = db.prepare(`
    SELECT decorator_name, COUNT(*) as count 
    FROM decorators 
    GROUP BY decorator_name 
    ORDER BY count DESC 
    LIMIT 15
  `).all() as any[];
  
  console.log('\n装饰器统计 (Top 15):');
  stats.forEach(s => console.log(`  ${s.decorator_name}: ${s.count}`));
  
  db.close();
}

main().catch(console.error);
