/**
 * 通用代码摘要提取器
 * 
 * 环境变量:
 *   PROJECT_ROOT - 项目源代码目录
 * 
 * 输出: JSONL 到 stdout (每行一个 JSON)
 * 
 * 用法:
 *   PROJECT_ROOT=/path/to/src npx tsx extract-summaries.ts > output.jsonl
 */

import { Project, SyntaxKind, SourceFile, ClassDeclaration, MethodDeclaration } from 'ts-morph';
import * as path from 'path';

const PROJECT_ROOT = process.env.PROJECT_ROOT;

if (!PROJECT_ROOT) {
  console.error('错误: 必须设置 PROJECT_ROOT 环境变量');
  process.exit(1);
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

console.error(`[摘要提取] 项目: ${PROJECT_ROOT}`);
console.error('📁 加载项目...');

const project = new Project({
  tsConfigFilePath: path.join(PROJECT_ROOT, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
});

project.addSourceFilesAtPaths([
  `${PROJECT_ROOT}/**/*.ts`,
  `!${PROJECT_ROOT}/**/*.spec.ts`,
  `!${PROJECT_ROOT}/**/*.test.ts`,
  `!${PROJECT_ROOT}/**/*.d.ts`,
  `!${PROJECT_ROOT}/**/node_modules/**`,
]);

const sourceFiles = project.getSourceFiles();
console.error(`📊 已加载 ${sourceFiles.length} 个文件\n`);

const summaries: Summary[] = [];

function getRelativePath(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath);
}

function extractMethodSummary(method: MethodDeclaration, file: string): Summary {
  const decorators = method.getDecorators().map(d => d.getText());
  
  // 提取调用的函数
  const calls: string[] = [];
  method.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
    const expr = call.getExpression().getText();
    if (!expr.includes('console.') && !expr.includes('logger.')) {
      calls.push(expr.split('.').pop() || expr);
    }
  });
  
  return {
    type: 'method',
    name: method.getName() || 'anonymous',
    file,
    line: method.getStartLineNumber(),
    signature: method.getSignature()?.getDeclaration().getText().substring(0, 200),
    doc: method.getJsDocs().map(d => d.getDescription()).join('\n').substring(0, 200) || undefined,
    decorators: decorators.length > 0 ? decorators : undefined,
    calls: [...new Set(calls)].slice(0, 10),
  };
}

function extractClassSummary(cls: ClassDeclaration, file: string): Summary[] {
  const results: Summary[] = [];
  const className = cls.getName() || 'anonymous';
  const decorators = cls.getDecorators().map(d => d.getText());
  
  // 类摘要
  results.push({
    type: 'class',
    name: className,
    file,
    line: cls.getStartLineNumber(),
    doc: cls.getJsDocs().map(d => d.getDescription()).join('\n').substring(0, 200) || undefined,
    decorators: decorators.length > 0 ? decorators : undefined,
  });
  
  // 方法摘要（导出的或带装饰器的）
  for (const method of cls.getMethods()) {
    const methodDecorators = method.getDecorators();
    const isPublic = method.getScope() === 'public' || method.getScope() === undefined;
    
    if (methodDecorators.length > 0 || isPublic) {
      results.push(extractMethodSummary(method, file));
    }
  }
  
  return results;
}

function extractFileSummary(sourceFile: SourceFile): Summary[] {
  const results: Summary[] = [];
  const filePath = getRelativePath(sourceFile.getFilePath());
  
  if (filePath.includes('node_modules')) return results;
  if (filePath.includes('.spec.')) return results;
  if (filePath.includes('.test.')) return results;
  
  // 提取类
  for (const cls of sourceFile.getClasses()) {
    results.push(...extractClassSummary(cls, filePath));
  }
  
  // 提取导出的函数
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported()) {
      const calls: string[] = [];
      fn.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
        const expr = call.getExpression().getText();
        if (!expr.includes('console.') && !expr.includes('logger.')) {
          calls.push(expr.split('.').pop() || expr);
        }
      });
      
      results.push({
        type: 'function',
        name: fn.getName() || 'anonymous',
        file: filePath,
        line: fn.getStartLineNumber(),
        signature: fn.getSignature()?.getDeclaration().getText().substring(0, 200),
        doc: fn.getJsDocs().map(d => d.getDescription()).join('\n').substring(0, 200) || undefined,
        calls: [...new Set(calls)].slice(0, 10),
      });
    }
  }
  
  // 提取导出的箭头函数
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    if (varDecl.isExported()) {
      const init = varDecl.getInitializer();
      if (init && init.getKind() === SyntaxKind.ArrowFunction) {
        results.push({
          type: 'function',
          name: varDecl.getName(),
          file: filePath,
          line: varDecl.getStartLineNumber(),
        });
      }
    }
  }
  
  return results;
}

for (const sourceFile of sourceFiles) {
  const results = extractFileSummary(sourceFile);
  summaries.push(...results);
}

console.error(`✅ 提取了 ${summaries.length} 个摘要\n`);

// 输出 JSONL 到 stdout
for (const summary of summaries) {
  console.log(JSON.stringify(summary));
}
