import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, '.account-review-worker'), { recursive: true });
for (const name of ['account-review-report', 'account-review-queue', 'ai-analysis', 'ai-queue', 'media-source']) {
  const source = fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('"./account-review-report"', '"./account-review-report.mjs"').replace('"./ai-analysis"', '"./ai-analysis.mjs"');
  fs.writeFileSync(path.join(root, '.account-review-worker', name + '.mjs'), output);
}
