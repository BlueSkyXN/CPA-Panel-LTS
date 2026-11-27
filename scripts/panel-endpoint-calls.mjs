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
const absentUrl = Symbol('object has no url');

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

// Only branches without a url retain the preceding object's value.
function overlayUrls(previous, overrides) {
  if (!overrides.includes(absentUrl)) return overrides;
  return [...new Set([...previous, ...overrides.filter((entry) => entry !== absentUrl)])];
}

function staticPropertyName(name) {
  if (!ts.isComputedPropertyName(name)) return name.text;
  if (ts.isStringLiteralLike(name.expression)) return name.expression.text;
}

function mayAssignUrl(source) {
  if (!ts.isObjectLiteralExpression(source)) return true;
  return source.properties.some((prop) => {
    if (ts.isSpreadAssignment(prop)) return true;
    const name = staticPropertyName(prop.name);
    return name === undefined || name === 'url';
  });
}

function returnedExpressions(fn) {
  if (!ts.isBlock(fn.body)) return [fn.body];
  const returns = [];
  const collect = (node) => {
    if (ts.isReturnStatement(node)) returns.push(node.expression);
    else if (!ts.isFunctionLike(node)) ts.forEachChild(node, collect);
  };
  collect(fn.body);
  return returns;
}

// Follow runtime initializers across lexical scopes and imported endpoint tables.
function collectCalls(program, file, bindings) {
  const checker = program.getTypeChecker();
  const calls = [];
  const callers = new Map();
  const endpoints = new Set();
  const modifiedConfigs = new Set();
  const writes = [];
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
    const written = writtenUrlObject(node);
    if (written) writes.push(written);
    if (!ts.isCallExpression(node)) return;
    calls.push(node);
    const fn = localFunction(node.expression);
    if (fn) {
      if (!callers.has(fn)) callers.set(fn, []);
      callers.get(fn).push(node);
    }
  });

  function bindCall(fn, call, outer) {
    const bound = new Map(outer);
    fn.parameters.forEach((param, index) => bound.set(param, call.arguments[index] ?? param.initializer));
    return bound;
  }

  // Keep all parameters from one invocation together, including through forwarding helpers.
  function invocationBindings(node, seen = new Set()) {
    const fn = ts.findAncestor(node, ts.isFunctionLike);
    if (!fn || seen.has(fn)) return [new Map()];
    const sites = callers.get(fn);
    if (!sites) return invocationBindings(fn.parent, seen);
    const next = new Set(seen).add(fn);
    return sites.flatMap((site) => invocationBindings(site, next).map((outer) => bindCall(fn, site, outer)));
  }

  function markMutation(expr) {
    if (!expr || modifiedConfigs.has(expr)) return;
    modifiedConfigs.add(expr);
    const wrapped = wrappedExpression(expr);
    if (wrapped) return markMutation(wrapped);
    if (ts.isConditionalExpression(expr)) {
      markMutation(expr.whenTrue);
      markMutation(expr.whenFalse);
      return;
    }
    if (ts.isCallExpression(expr)) {
      if (isObjectAssign(expr)) {
        markMutation(expr.arguments[0]); // Object.assign returns the target itself.
      } else {
        const fn = localFunction(expr.expression);
        if (fn?.body) returnedExpressions(fn).forEach(markMutation);
      }
      return;
    }
    const decl = declarationOf(expr);
    if (decl && ts.isParameter(decl)) {
      const index = decl.parent.parameters.indexOf(decl);
      for (const site of callers.get(decl.parent) ?? []) {
        markMutation(site.arguments[index] ?? decl.initializer);
      }
    } else if (decl && ts.isShorthandPropertyAssignment(decl)) {
      markMutation(decl.name);
    } else {
      markMutation(decl && ts.isPropertyAssignment(decl) ? decl.initializer : constInitializer(decl));
    }
  }

  function isObjectAssign(call) {
    const member = call.expression;
    if (
      !ts.isPropertyAccessExpression(member) || member.name.text !== 'assign' ||
      !ts.isIdentifier(member.expression) || member.expression.text !== 'Object'
    ) return false;
    const object = declarationOf(member.expression);
    return !object || object.getSourceFile().isDeclarationFile;
  }

  if (calls.some(({ expression }) => ts.isPropertyAccessExpression(expression) && expression.name.text === 'requestRaw')) {
    writes.forEach(markMutation);
    for (const call of calls) {
      const target = call.expression;
      if (localFunction(target)) continue; // Its writes are traced back to the actual arguments.
      if (ts.isPropertyAccessExpression(target) && requestMethods.has(target.name.text) && clientScope(target.expression)) continue;
      if (isObjectAssign(call)) {
        if (call.arguments.slice(1).some(mayAssignUrl)) markMutation(call.arguments[0]);
      } else {
        // An opaque helper receiving the config may change it before the transport reads it.
        call.arguments.forEach(markMutation);
      }
    }
  }

  function clientScope(expr, seen = new Set()) {
    if (seen.has(expr)) return undefined;
    seen.add(expr);
    const wrapped = wrappedExpression(expr);
    if (wrapped) return clientScope(wrapped, seen);
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

  function knownBoolean(expr, args, seen = new Set()) {
    if (!expr || seen.has(expr)) return undefined;
    seen.add(expr);
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
    const wrapped = wrappedExpression(expr);
    if (wrapped) return knownBoolean(wrapped, args, seen);
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
      const value = knownBoolean(expr.operand, args, seen);
      return value === undefined ? undefined : !value;
    }
    if (ts.isIdentifier(expr)) {
      const decl = declarationOf(expr);
      return knownBoolean(constInitializer(decl) ?? args.get(decl), args, seen);
    }
  }

  function urlValues(expr, fromConfig = false, seen = new Set(), args = new Map()) {
    if (!expr || seen.has(expr) || (fromConfig && modifiedConfigs.has(expr))) return [segment];
    const next = new Set(seen).add(expr);
    const resolve = (child, config = fromConfig) => urlValues(child, config, next, args);
    if (fromConfig && ts.isObjectLiteralExpression(expr)) {
      let urls = [absentUrl];
      for (const prop of expr.properties) {
        if (ts.isSpreadAssignment(prop)) {
          urls = overlayUrls(urls, resolve(prop.expression));
          continue;
        }
        const name = staticPropertyName(prop.name);
        if (name === undefined) {
          urls = [segment];
        } else if (name === 'url') {
          const value = ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer;
          urls = resolve(value, false);
        }
      }
      return urls;
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
    if (ts.isConditionalExpression(expr)) {
      const condition = knownBoolean(expr.condition, args);
      if (condition !== undefined) return resolve(condition ? expr.whenTrue : expr.whenFalse);
      return [...resolve(expr.whenTrue), ...resolve(expr.whenFalse)];
    }
    if (fromConfig && ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const condition = knownBoolean(expr.left, args);
      if (condition === false) return [absentUrl];
      const present = resolve(expr.right);
      return condition === true ? present : [absentUrl, ...present];
    }
    if (fromConfig && (expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.NullKeyword)) {
      return [absentUrl];
    }
    const wrapped = wrappedExpression(expr);
    if (wrapped) return resolve(wrapped);
    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
      const decl = declarationOf(expr);
      if (decl && ts.isPropertyAssignment(decl)) return resolve(decl.initializer);
      if (decl && ts.isShorthandPropertyAssignment(decl)) return resolve(decl.name);
      const init = constInitializer(decl);
      if (init) return resolve(init);
      if (decl && args.has(decl)) return resolve(args.get(decl));
    }
    if (ts.isCallExpression(expr)) {
      if (fromConfig && isObjectAssign(expr)) {
        return expr.arguments.reduce((urls, arg) => overlayUrls(urls, resolve(arg)), [absentUrl]);
      }
      if (!fromConfig && bindings.get(declarationOf(expr.expression)) === 'ltsBase')
        return [ltsBase];
      const fn = localFunction(expr.expression);
      if (fn?.body) {
        const bound = bindCall(fn, expr, args);
        return returnedExpressions(fn).flatMap((value) => urlValues(value, fromConfig, next, bound));
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
    const values = invocationBindings(call).flatMap((args) => urlValues(url, fromConfig, new Set(), args));
    for (const value of values) {
      if (value === absentUrl) continue;
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
