import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Compile the real, pure pricing modules with the project's TypeScript compiler.
// No browser, esbuild binary, provider call, or replacement pricing implementation.
const compiled = new Map();
export function loadTypeScript(filename) {
  const resolved = path.resolve(filename);
  if (compiled.has(resolved)) return compiled.get(resolved).exports;
  const source = fs.readFileSync(resolved, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: resolved,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${resolved}: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n')}`);
  const mod = { exports: {} };
  compiled.set(resolved, mod);
  const require = createRequire(resolved);
  const localRequire = (name) => {
    if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
    const target = name.startsWith('@/')
      ? fileURLToPath(new URL(`../src/${name.slice(2)}`, import.meta.url))
      : path.resolve(path.dirname(resolved), name);
    return loadTypeScript(fs.existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, 'index.ts'));
  };
  new Function('require', 'module', 'exports', result.outputText)(localRequire, mod, mod.exports);
  return mod.exports;
}
