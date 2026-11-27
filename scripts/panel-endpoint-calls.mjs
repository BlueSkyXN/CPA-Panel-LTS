import path from 'node:path';
import ts from 'typescript';

const requestMethods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'getRaw',
  'postForm',
  'requestRaw',
]);
const configMethods = new Set([
  'getConfigValue',
  'readConfigSnapshot',
  'putConfigValue',
  'deleteConfigValue',
]);
const segment = '{segment}';
const ltsBase = '{lts-base}';

function visit(node, handle) {
  handle(node);
  ts.forEachChild(node, (child) => visit(child, handle));
}

function importBinding(checker, node) {
  const decl = checker.getSymbolAtLocation(node)?.declarations?.[0];
  if (!decl || (!ts.isImportSpecifier(decl) && !ts.isImportClause(decl))) return null;
  const from = ts.findAncestor(decl, ts.isImportDeclaration)?.moduleSpecifier.text;
  return {
    from,
    name: ts.isImportClause(decl) ? 'default' : (decl.propertyName ?? decl.name).text,
  };
}

function canonicalPath(value) {
  return value
    .split('/')
    .map((part) => (/^:\w+$/.test(part) ? segment : part))
    .join('/');
}

// Follow runtime initializers across lexical scopes and imported endpoint tables.
function collectCalls(program, file) {
  const checker = program.getTypeChecker();
  const calls = [];
  const callers = new Map();
  const endpoints = new Set();
  const declarationOf = (expr) => {
    let symbol = checker.getSymbolAtLocation(expr);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration;
  };
  const constInitializer = (decl) =>
    decl && ts.isVariableDeclaration(decl) && decl.parent.flags & ts.NodeFlags.Const
      ? decl.initializer
      : undefined;
  const localFunction = (expr) => {
    if (!ts.isIdentifier(expr)) return undefined;
    const decl = declarationOf(expr);
    if (!decl || decl.getSourceFile() !== file) return undefined;
    if (ts.isFunctionDeclaration(decl)) return decl;
    const init = constInitializer(decl);
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init;
  };

  visit(file, (node) => {
    if (!ts.isCallExpression(node)) return;
    calls.push(node);
    const fn = localFunction(node.expression);
    if (fn) {
      if (!callers.has(fn)) callers.set(fn, []);
      callers.get(fn).push(node);
    }
  });

  function clientScope(expr, seen = new Set()) {
    if (seen.has(expr)) return undefined;
    seen.add(expr);
    if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === 'captureConnection'
    )
      return clientScope(expr.expression.expression, seen);
    if (!ts.isIdentifier(expr)) return undefined;
    const binding = importBinding(checker, expr);
    if (binding?.from === 'axios' && binding.name === 'default') return 'raw';
    if (binding && ['./client', '@/services/api/client', '@/services/api'].includes(binding.from)) {
      if (binding.name === 'apiClient') return 'v8';
      if (binding.name === 'ltsExtensionClient') return 'lts';
    }
    const init = constInitializer(declarationOf(expr));
    if (init) return clientScope(init, seen);
  }

  function urlValues(expr, seen = new Set(), args = new Map()) {
    if (!expr || seen.has(expr)) return [segment];
    const next = new Set(seen).add(expr);
    const resolve = (child) => urlValues(child, next, args);
    if (ts.isStringLiteralLike(expr)) return [expr.text];
    if (ts.isTemplateExpression(expr)) {
      let paths = [expr.head.text];
      for (const span of expr.templateSpans) {
        const values = resolve(span.expression);
        paths = paths.flatMap((prefix) =>
          values.map((value) => prefix + value + span.literal.text)
        );
      }
      return paths;
    }
    if (ts.isConditionalExpression(expr))
      return [...resolve(expr.whenTrue), ...resolve(expr.whenFalse)];
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr))
      return resolve(expr.expression);
    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
      const decl = declarationOf(expr);
      if (decl && ts.isPropertyAssignment(decl)) return resolve(decl.initializer);
      const init = constInitializer(decl);
      if (init) return resolve(init);
      if (decl && ts.isParameter(decl)) {
        if (args.has(decl)) return resolve(args.get(decl));
        const sites = callers.get(decl.parent);
        if (sites) {
          const index = decl.parent.parameters.indexOf(decl);
          return sites.flatMap((site) => resolve(site.arguments[index]));
        }
      }
    }
    if (ts.isCallExpression(expr)) {
      const binding = importBinding(checker, expr.expression);
      if (binding?.from === '@/utils/connection' && binding.name === 'computeLtsExtensionApiUrl')
        return [ltsBase];
      const fn = localFunction(expr.expression);
      if (fn?.body) {
        const bound = new Map(args);
        fn.parameters.forEach((param, index) => bound.set(param, expr.arguments[index]));
        const returns = [];
        const collectReturns = (node) => {
          if (ts.isReturnStatement(node)) returns.push(node.expression);
          else if (!ts.isFunctionLike(node)) ts.forEachChild(node, collectReturns);
        };
        if (ts.isBlock(fn.body)) collectReturns(fn.body);
        else returns.push(fn.body);
        return returns.flatMap((value) => urlValues(value, next, bound));
      }
    }
    return [segment];
  }

  for (const call of calls) {
    const target = call.expression;
    let url = call.arguments[0];
    if (!url) continue;
    let scope;
    if (ts.isPropertyAccessExpression(target) && requestMethods.has(target.name.text)) {
      scope = clientScope(target.expression);
      if (target.name.text === 'requestRaw') {
        const prop =
          ts.isObjectLiteralExpression(url) &&
          url.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(file) === 'url');
        url = prop?.initializer;
      }
    } else if (ts.isIdentifier(target)) {
      const binding = importBinding(checker, target);
      if (
        binding &&
        ['./configValue', '@/services/api/configValue'].includes(binding.from) &&
        configMethods.has(binding.name)
      )
        scope = 'v8';
      if (target.text === 'fetch') {
        const decl = checker.getSymbolAtLocation(target)?.valueDeclaration;
        if (!decl || decl.getSourceFile().isDeclarationFile) scope = 'raw';
      }
    }
    if (!scope || !url) continue;
    for (const value of urlValues(url)) {
      const route = canonicalPath(value.split('?')[0]);
      if (scope !== 'raw') endpoints.add(scope + ':' + route);
      else if (route.startsWith(ltsBase + '/')) endpoints.add('lts:' + route.slice(ltsBase.length));
      else if (route.startsWith(segment + '/v1/'))
        endpoints.add('proxy:' + route.slice(segment.length));
      else if (route.startsWith('/v1/')) endpoints.add('proxy:' + route);
    }
  }
  return endpoints;
}

export function repositoryEndpointMatcher(repoRoot, clientFiles) {
  const configFile = path.join(repoRoot, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, repoRoot, { allowJs: true });
  const fileNames = Array.from(clientFiles, (file) => path.resolve(repoRoot, file));
  const program = ts.createProgram(fileNames, options);
  const byFile = new Map();
  return (relativePath, endpoint) => {
    if (!byFile.has(relativePath)) {
      const source = program.getSourceFile(path.resolve(repoRoot, relativePath));
      byFile.set(relativePath, source ? collectCalls(program, source) : new Set());
    }
    return byFile
      .get(relativePath)
      .has(endpoint.scope + ':' + canonicalPath(endpoint.relativePath));
  };
}

export function hasScopedEndpointMatch(source, endpoint) {
  if (!endpoint) return false;
  const options = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  const file = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
  host.getSourceFile = (name) => (name === file.fileName ? file : undefined);
  const program = ts.createProgram([file.fileName], options, host);
  return collectCalls(program, file).has(
    endpoint.scope + ':' + canonicalPath(endpoint.relativePath)
  );
}
