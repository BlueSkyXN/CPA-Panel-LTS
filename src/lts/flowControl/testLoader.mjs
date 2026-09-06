import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
export function loadTypeScript(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  const localRequire = (name) => name === './model' ? loadTypeScript('model.ts') : require(name);
  new Function('require', 'module', 'exports', output.outputText)(localRequire, mod, mod.exports);
  cache.set(filename, mod.exports);
  return mod.exports;
}
