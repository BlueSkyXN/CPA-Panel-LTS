import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const segment = '{segment}';
const ltsBase = '{lts-base}';

function visit(node, handle) {
  handle(node);
  ts.forEachChild(node, (child) => visit(child, handle));
}

function valueDeclaration(checker, symbol) {
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.valueDeclaration;
}

function apiModules(root, options) {
  const client = path.join(root, 'src/services/api/client.ts');
  const modules = new Map([
    [client, { apiClient: 'v8', ltsExtensionClient: 'lts' }],
    [path.join(root, 'src/services/api/configValue.ts'), {
      getConfigValue: 'config', readConfigSnapshot: 'config',
      putConfigValue: 'config', deleteConfigValue: 'config',
    }],
    [path.join(root, 'src/utils/connection.ts'), { computeLtsExtensionApiUrl: 'ltsBase' }],
  ]);
  const axios = ts.resolveModuleName('axios', client, options, ts.sys).resolvedModule;
  if (axios) modules.set(axios.resolvedFileName, { default: 'raw' });
  return modules;
}

function apiBindings(program, modules) {
  const checker = program.getTypeChecker();
  const bindings = new Map();
  for (const [filename, names] of modules) {
    const source = program.getSourceFile(filename);
    const module = source && checker.getSymbolAtLocation(source);
    if (!module) continue;
    for (const symbol of checker.getExportsOfModule(module)) {
      const declaration = valueDeclaration(checker, symbol);
      if (declaration && Object.hasOwn(names, symbol.name)) {
        bindings.set(declaration, names[symbol.name]);
      }
    }
  }
  return bindings;
}

function canonicalPath(value) {
  return value
    .split('/')
    .map((part) => (/^:\w+$/.test(part) ? segment : part))
    .join('/');
}

function wrappedExpression(node) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) return node.expression;
}

function writtenUrlObject(node) {
  let target;
  if (ts.isDeleteExpression(node)) {
    target = node.expression;
  } else if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) {
      target = node.left;
    }
  }
  if (!target) return undefined;
  if (ts.isPropertyAccessExpression(target) && target.name.text === 'url') return target.expression;
  if (ts.isElementAccessExpression(target)) {
    const key = target.argumentExpression;
    if (!ts.isStringLiteralLike(key) || key.text === 'url') return target.expression;
  }
}

// Follow runtime initializers across lexical scopes and imported endpoint tables.
function collectCalls(program, file, bindings) {
  const checker = program.getTypeChecker();
  const calls = [];
  const callers = new Map();
  const endpoints = new Set();
  const modifiedConfigs = new Set();
  const declarationOf = (expr) => {
    const symbol = ts.isShorthandPropertyAssignment(expr.parent) && expr === expr.parent.name
      ? checker.getShorthandAssignmentValueSymbol(expr.parent)
      : checker.getSymbolAtLocation(expr);
    return valueDeclaration(checker, symbol);
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
    // A config object can be mutated even if its variable is const.
    let object = writtenUrlObject(node);
    while (object && !modifiedConfigs.has(object)) {
      modifiedConfigs.add(object);
      object = wrappedExpression(object) ?? constInitializer(declarationOf(object));
    }
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
    if (!ts.isIdentifier(expr) && !ts.isPropertyAccessExpression(expr)) return undefined;
    const decl = declarationOf(expr);
    const binding = bindings.get(decl);
    if (binding === 'raw' || binding === 'v8' || binding === 'lts') return binding;
    const init = constInitializer(decl);
    if (init) return clientScope(init, seen);
  }

  function urlValues(expr, fromConfig = false, seen = new Set(), args = new Map()) {
    if (!expr || seen.has(expr) || (fromConfig && modifiedConfigs.has(expr))) return [segment];
    const next = new Set(seen).add(expr);
    const resolve = (child, config = fromConfig) => urlValues(child, config, next, args);
    if (fromConfig && ts.isObjectLiteralExpression(expr)) {
      // A later spread can replace url. An empty result means a known object without that field.
      for (let index = expr.properties.length - 1; index >= 0; index--) {
        const prop = expr.properties[index];
        if (ts.isSpreadAssignment(prop)) {
          const urls = resolve(prop.expression);
          if (urls.length) return urls;
          continue;
        }
        let name = prop.name;
        if (ts.isComputedPropertyName(name)) {
          if (!ts.isStringLiteralLike(name.expression)) return [segment];
          name = name.expression;
        }
        if (name.text === 'url') {
          if (ts.isShorthandPropertyAssignment(prop)) return resolve(prop.name, false);
          return ts.isPropertyAssignment(prop) ? resolve(prop.initializer, false) : [segment];
        }
      }
      return [];
    }
    if (!fromConfig && ts.isStringLiteralLike(expr)) return [expr.text];
    if (!fromConfig && ts.isTemplateExpression(expr)) {
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
    const wrapped = wrappedExpression(expr);
    if (wrapped) return resolve(wrapped);
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
      if (!fromConfig && bindings.get(declarationOf(expr.expression)) === 'ltsBase')
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
        return returns.flatMap((value) => urlValues(value, fromConfig, next, bound));
      }
    }
    return [segment];
  }

  for (const call of calls) {
    const target = call.expression;
    const url = call.arguments[0];
    if (!url) continue;
    let scope;
    if (ts.isPropertyAccessExpression(target) && requestMethods.has(target.name.text)) {
      scope = clientScope(target.expression);
    } else if (bindings.get(declarationOf(target)) === 'config') {
      scope = 'v8';
    } else if (ts.isIdentifier(target) && target.text === 'fetch') {
      const decl = checker.getSymbolAtLocation(target)?.valueDeclaration;
      if (!decl || decl.getSourceFile().isDeclarationFile) scope = 'raw';
    }
    if (!scope) continue;
    const fromConfig = ts.isPropertyAccessExpression(target) && target.name.text === 'requestRaw';
    for (const value of urlValues(url, fromConfig)) {
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

function compilerOptions(repoRoot) {
  const configFile = path.join(repoRoot, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, repoRoot, { allowJs: true });
  return options;
}

export function repositoryEndpointMatcher(repoRoot, clientFiles) {
  repoRoot = path.resolve(repoRoot);
  const options = compilerOptions(repoRoot);
  const fileNames = Array.from(clientFiles, (file) => path.resolve(repoRoot, file));
  const program = ts.createProgram(fileNames, options);
  const bindings = apiBindings(program, apiModules(repoRoot, options));
  const byFile = new Map();
  return (relativePath, endpoint) => {
    if (!byFile.has(relativePath)) {
      const source = program.getSourceFile(path.resolve(repoRoot, relativePath));
      byFile.set(relativePath, source ? collectCalls(program, source, bindings) : new Set());
    }
    return byFile
      .get(relativePath)
      .has(endpoint.scope + ':' + canonicalPath(endpoint.relativePath));
  };
}

export function hasScopedEndpointMatch(source, endpoint) {
  if (!endpoint) return false;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const options = { ...compilerOptions(root), noLib: true, noResolve: true, types: [] };
  const modules = apiModules(root, options);
  const filename = path.join(root, 'src/services/api/__contract_fixture__.ts');
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile;
  host.getSourceFile = (name, ...args) => (name === filename ? file : readSource(name, ...args));
  const sources = [filename, ...modules.keys(), path.join(root, 'src/services/api/index.ts')];
  const program = ts.createProgram(sources, options, host);
  return collectCalls(program, file, apiBindings(program, modules)).has(
    endpoint.scope + ':' + canonicalPath(endpoint.relativePath)
  );
}
