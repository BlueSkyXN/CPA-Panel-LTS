#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const contractPath = 'docs/lts/panel-feature-contracts.yaml';
const strictStatuses = new Set(['protected', 'lts-maintained', 'coexist', 'shared']);
const warningStatuses = new Set(['experimental']);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const stripCodeComments = (source) => {
  let result = '';
  let index = 0;
  let quote = '';

  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];

    if (quote) {
      result += ch;
      if (ch === '\\' && index + 1 < source.length) {
        result += next;
        index += 2;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      result += ch;
      index += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        result += '  ';
        index += 2;
      }
      continue;
    }

    result += ch;
    index += 1;
  }

  return result;
};

export const parseContractEndpoint = (endpoint) => {
  if (typeof endpoint !== 'string') return null;
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed !== endpoint || /\s/.test(trimmed)) return null;

  const v8Match = trimmed.match(/^\/v8\/management(\/.+)$/);
  if (v8Match) {
    return { scope: 'v8', relativePath: v8Match[1] };
  }

  const ltsMatch = trimmed.match(/^\/v0\/management(\/.+)$/);
  if (ltsMatch) {
    return { scope: 'lts', relativePath: ltsMatch[1] };
  }

  const proxyMatch = trimmed.match(/^(\/v1\/.+)$/);
  if (proxyMatch) {
    return { scope: 'proxy', relativePath: proxyMatch[1] };
  }

  return null;
};

export const endpointPathToRegex = (relativePath, scope = 'v8', flags = '') => {
  const rawParts = relativePath.split('/');
  if (rawParts.length < 2 || rawParts[0] !== '' || rawParts.slice(1).some((part) => !part)) {
    throw new Error(`Invalid relative endpoint path: ${relativePath}`);
  }

  const body = rawParts
    .map((part, index) => {
      if (index === 0) return '';
      if (part.startsWith(':')) {
        return "(?::[A-Za-z0-9_]+|\\$\\{[^}'\"`]+\\})";
      }
      return escapeRegex(part);
    })
    .join('\\/');

  if (scope === 'proxy') {
    return new RegExp(`(?:(['"\`])${body}(?=\\1|\\?)|\\}${body}(?=[\\\`?]))`, flags);
  }

  return new RegExp(`(['"\`])${body}(?=\\1|\\?)`, flags);
};

export const hasRouteRegistration = (routerSource, route) => {
  if (typeof route !== 'string' || !route.startsWith('/') || route !== route.trim() || /\s/.test(route)) {
    return false;
  }
  const uncommented = stripCodeComments(routerSource);
  const pattern = new RegExp(`\\bpath\\s*(?::|=)\\s*(['"\`])${escapeRegex(route)}\\1`);
  return pattern.test(uncommented);
};

export const hasTokenBoundaryMatch = (source, token) => {
  if (typeof token !== 'string' || !token.trim() || token !== token.trim()) {
    return false;
  }
  const uncommented = stripCodeComments(source);
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(token)}(?![A-Za-z0-9_-])`);
  return pattern.test(uncommented);
};

const collectLtsClientAliases = (uncommentedSource) => {
  const aliases = new Set(['ltsExtensionClient']);
  const captureRegex = /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*ltsExtensionClient\.captureConnection\s*\(\s*\)/g;
  for (const match of uncommentedSource.matchAll(captureRegex)) {
    aliases.add(match[1]);
  }
  return Array.from(aliases);
};

const isLtsCallPrefix = (prefix, ltsAliases) => {
  const aliasAlternation = ltsAliases.map(escapeRegex).join('|');
  const callPattern = new RegExp(
    `\\b(?:${aliasAlternation})\\s*\\.\\s*(?:get|post|put|patch|delete|getRaw|postForm|requestRaw)\\b(?:\\s*<[^;()]*>)?\\s*\\(\\s*$`
  );
  return callPattern.test(prefix);
};

const isConstantPassedToLtsClient = (uncommentedSource, constName, ltsAliases) => {
  const aliasAlternation = ltsAliases.map(escapeRegex).join('|');
  const usagePattern = new RegExp(
    `\\b(?:${aliasAlternation})\\s*\\.\\s*(?:get|post|put|patch|delete|getRaw|postForm|requestRaw)\\b(?:\\s*<[^;()]*>)?\\s*\\(\\s*(?:\\\`\\$\\{\\s*)?${escapeRegex(constName)}\\b`
  );
  return usagePattern.test(uncommentedSource);
};

export const hasScopedEndpointMatch = (rawSource, parsed) => {
  if (!parsed) return false;
  const source = stripCodeComments(rawSource);

  const hasV8Client =
    /\b(?:apiClient|getConfigValue|readConfigSnapshot|putConfigValue|deleteConfigValue)\b/.test(
      source
    );
  const hasLtsClient = /\bltsExtensionClient\b/.test(source);
  const hasProxyClient = /\b(?:axios|fetch)\b/.test(source);

  if (parsed.scope === 'proxy') {
    if (!hasProxyClient) return false;
    return endpointPathToRegex(parsed.relativePath, 'proxy').test(source);
  }

  if (parsed.scope === 'v8' && !hasV8Client) return false;
  if (parsed.scope === 'lts' && !hasLtsClient) return false;

  const matches = Array.from(
    source.matchAll(endpointPathToRegex(parsed.relativePath, parsed.scope, 'g'))
  );
  if (matches.length === 0) return false;

  // Single-scope client module: every bounded endpoint literal in this module targets that scope.
  if (parsed.scope === 'v8' && !hasLtsClient) return true;
  if (parsed.scope === 'lts' && !hasV8Client) return true;

  // Dual-client module (imports both apiClient/configValue and ltsExtensionClient):
  // attribute each literal occurrence to lts vs v8 by its enclosing call or constant binding.
  const ltsAliases = collectLtsClientAliases(source);
  return matches.some((match) => {
    const start = match.index ?? 0;
    const prefix = source.slice(Math.max(0, start - 200), start);
    let matchIsLts = isLtsCallPrefix(prefix, ltsAliases);

    if (!matchIsLts) {
      const constBind = prefix.match(/\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/);
      if (constBind && isConstantPassedToLtsClient(source, constBind[1], ltsAliases)) {
        matchIsLts = true;
      }
    }

    return parsed.scope === 'lts' ? matchIsLts : !matchIsLts;
  });
};

export const isServiceClientCandidate = (panelPath) => {
  if (typeof panelPath !== 'string') return false;
  if (
    panelPath.endsWith('.test.mjs') ||
    panelPath.endsWith('.test.ts') ||
    panelPath.endsWith('.test.tsx') ||
    panelPath.includes('/testing/') ||
    panelPath === 'src/services/api/client.ts'
  ) {
    return false;
  }
  return panelPath.startsWith('src/services/api/') || panelPath.startsWith('src/stores/');
};

const normalizeList = (value) => (Array.isArray(value) ? value : []);

const sourceExtensions = new Set([
  '.css',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.scss',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

export const validateRepositoryContracts = (repoRoot) => {
  const failures = [];
  const warnings = [];

  const readText = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const exists = (relativePath) => existsSync(path.join(repoRoot, relativePath));
  const isFile = (relativePath) =>
    exists(relativePath) && statSync(path.join(repoRoot, relativePath)).isFile();

  const fail = (message) => failures.push(message);
  const warn = (message) => warnings.push(message);

  const readSourceTree = (absolutePath) => {
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      return readdirSync(absolutePath, { withFileTypes: true })
        .map((entry) => readSourceTree(path.join(absolutePath, entry.name)))
        .join('\n');
    }
    if (!stat.isFile()) {
      return '';
    }
    if (!sourceExtensions.has(path.extname(absolutePath))) {
      return '';
    }
    return readFileSync(absolutePath, 'utf8');
  };

  const buildFeatureSearchSource = (feature) =>
    normalizeList(feature.panel_files)
      .filter((panelPath) => typeof panelPath === 'string')
      .filter((panelPath) => exists(panelPath))
      .map((panelPath) => readSourceTree(path.join(repoRoot, panelPath)))
      .join('\n');

  const isStrictFeature = (feature) => strictStatuses.has(String(feature.status ?? ''));
  const isWarningFeature = (feature) => warningStatuses.has(String(feature.status ?? ''));

  const reportFeatureIssue = (feature, message) => {
    const prefix = `${feature.id ?? '<missing-id>'}: ${message}`;
    if (isWarningFeature(feature)) {
      warn(prefix);
    } else {
      fail(prefix);
    }
  };

  if (!exists(contractPath)) {
    fail(`missing contract file: ${contractPath}`);
    return { failures, warnings };
  }

  const contract = parse(readText(contractPath));
  const features = normalizeList(contract?.features);
  const routerSource = exists('src/router/MainRoutes.tsx')
    ? readText('src/router/MainRoutes.tsx')
    : '';
  const gateSources = [
    routerSource,
    exists('src/utils/constants.ts') ? readText('src/utils/constants.ts') : '',
    exists('src/stores/useAuthStore.ts') ? readText('src/stores/useAuthStore.ts') : '',
  ];

  if (features.length === 0) {
    fail(`${contractPath}: features must be a non-empty list`);
  }

  features.forEach((feature) => {
    if (!feature || typeof feature !== 'object') {
      fail(`${contractPath}: feature entry must be an object`);
      return;
    }

    if (!feature.id) {
      fail(`${contractPath}: feature missing id`);
    }

    const status = String(feature.status ?? '');
    if (!strictStatuses.has(status) && !warningStatuses.has(status)) {
      reportFeatureIssue(feature, `unknown status: ${status || '<empty>'}`);
    }

    normalizeList(feature.panel_files).forEach((panelPath) => {
      if (typeof panelPath !== 'string' || panelPath.trim() === '') {
        reportFeatureIssue(feature, 'panel_files contains a non-string path');
        return;
      }
      if (!exists(panelPath)) {
        reportFeatureIssue(feature, `missing panel file/path: ${panelPath}`);
        return;
      }
      if (panelPath.endsWith('/') && !statSync(path.join(repoRoot, panelPath)).isDirectory()) {
        reportFeatureIssue(feature, `panel path is not a directory: ${panelPath}`);
      }
    });

    normalizeList(feature.routes).forEach((route) => {
      if (typeof route !== 'string' || route.trim() === '') {
        reportFeatureIssue(feature, 'routes contains a non-string route');
        return;
      }
      if (!hasRouteRegistration(routerSource, route)) {
        reportFeatureIssue(feature, `route is not registered or aliased: ${route}`);
      }
    });

    normalizeList(feature.capability_gates).forEach((gate) => {
      if (typeof gate !== 'string' || gate.trim() === '') {
        reportFeatureIssue(feature, 'capability_gates contains a non-string marker');
        return;
      }
      const repoHasGate = gateSources.some((src) => hasTokenBoundaryMatch(src, gate));
      if (!repoHasGate) {
        reportFeatureIssue(feature, `capability gate marker not found: ${gate}`);
      }
    });

    const serviceFiles = normalizeList(feature.panel_files)
      .filter((panelPath) => isServiceClientCandidate(panelPath) && isFile(panelPath))
      .map((panelPath) => ({ path: panelPath, content: readText(panelPath) }));
    const featureSource = buildFeatureSearchSource(feature);

    normalizeList(feature.core_endpoints).forEach((endpoint) => {
      if (typeof endpoint !== 'string' || endpoint.trim() === '') {
        reportFeatureIssue(feature, 'core_endpoints contains a non-string endpoint');
        return;
      }

      const parsed = parseContractEndpoint(endpoint);
      if (!parsed) {
        reportFeatureIssue(
          feature,
          `endpoint must declare an explicit /v8/management, /v0/management, or /v1 prefix: ${endpoint}`
        );
        return;
      }

      if (serviceFiles.length === 0) {
        reportFeatureIssue(feature, `no service API client listed for endpoint: ${endpoint}`);
        return;
      }

      const matched = serviceFiles.some(({ content }) => hasScopedEndpointMatch(content, parsed));
      if (!matched) {
        reportFeatureIssue(
          feature,
          `endpoint marker not found in listed ${parsed.scope} service clients: ${endpoint}`
        );
      }
    });

    [
      ...normalizeList(feature.required_markers),
      ...normalizeList(feature.compatibility_markers),
    ].forEach((marker) => {
      if (typeof marker !== 'string' || marker.trim() === '') {
        reportFeatureIssue(feature, 'markers contains a non-string marker');
        return;
      }
      if (!featureSource.includes(marker)) {
        reportFeatureIssue(feature, `required marker not found in listed panel files: ${marker}`);
      }
    });

    if (!isStrictFeature(feature) && !isWarningFeature(feature)) {
      reportFeatureIssue(feature, 'feature status is not categorized');
    }
  });

  return { failures, warnings };
};

const runSelfTest = (repoRoot) => {
  // 1. Route boundary matching rejects prefix/substring spoofing and comments.
  const routerFixture = `
    const mainRoutes = [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/usage/events', element: <UsageEventsPage /> },
      { path: '/usage-something', element: <OtherPage /> },
      { path: '/redirect', element: <Navigate to="/usage" replace /> },
      // { path: '/commented', element: <CommentedPage /> },
      { path: '/plugin-pages/:pluginId/:menuIndex', element: <PluginResourcePage /> },
    ];
  `;
  assert.equal(hasRouteRegistration(routerFixture, '/dashboard'), true);
  assert.equal(hasRouteRegistration(routerFixture, '/usage/events'), true);
  assert.equal(hasRouteRegistration(routerFixture, '/plugin-pages/:pluginId/:menuIndex'), true);
  assert.equal(hasRouteRegistration(routerFixture, '/usage'), false, 'prefix/Navigate must not match /usage');
  assert.equal(hasRouteRegistration(routerFixture, '/'), false, 'non-root paths must not match /');
  assert.equal(hasRouteRegistration(routerFixture, '/plugin-pages/:pluginId'), false, 'partial dynamic route must not match');
  assert.equal(hasRouteRegistration(routerFixture, '/commented'), false, 'commented route must not match');

  // 2. Endpoint prefix enforcement rejects unprefixed paths.
  assert.equal(parseContractEndpoint('/usage/query/analytics'), null);
  assert.equal(parseContractEndpoint('/api-call'), null);
  assert.deepEqual(parseContractEndpoint('/v8/management/config.yaml'), {
    scope: 'v8',
    relativePath: '/config.yaml',
  });
  assert.deepEqual(parseContractEndpoint('/v0/management/usage'), {
    scope: 'lts',
    relativePath: '/usage',
  });
  assert.deepEqual(parseContractEndpoint('/v1/models'), {
    scope: 'proxy',
    relativePath: '/v1/models',
  });

  // 3. Single-client boundary & scope checks reject prefix/suffix/scope mismatches.
  const v8ConfigClient = `
    import { apiClient } from './client';
    export const fetchYaml = () => apiClient.getRaw('/config.yaml');
    export const fetchFamily = (family) => apiClient.get(\`/config/api-keys/\${family}\`);
    export const postApiCall = (body) => apiClient.post('/requests/api-call', body);
  `;
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v8/management/config.yaml')),
    true
  );
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v0/management/config.yaml')),
    false,
    'v8 client must not satisfy legacy /v0/management/config.yaml'
  );
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v8/management/config')),
    false,
    '/config.yaml and /config/api-keys/:family must not satisfy /v8/management/config'
  );
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v8/management/api-call')),
    false,
    '/requests/api-call must not satisfy suffix /api-call'
  );
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v0/management/api-call')),
    false
  );
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v8/management/requests/api-call')),
    true
  );
  assert.equal(
    hasScopedEndpointMatch(v8ConfigClient, parseContractEndpoint('/v8/management/config/api-keys/:family')),
    true
  );

  const ltsUsageClient = `
    import { ltsExtensionClient } from './client';
    export const getExport = () => ltsExtensionClient.get('/usage/export');
    export const getFlag = () => ltsExtensionClient.get('/usage-statistics-enabled');
  `;
  assert.equal(
    hasScopedEndpointMatch(ltsUsageClient, parseContractEndpoint('/v0/management/usage')),
    false,
    '/usage/export and /usage-statistics-enabled must not satisfy /v0/management/usage'
  );
  assert.equal(
    hasScopedEndpointMatch(ltsUsageClient, parseContractEndpoint('/v0/management/usage/export')),
    true
  );
  assert.equal(
    hasScopedEndpointMatch(ltsUsageClient, parseContractEndpoint('/v8/management/usage/export')),
    false,
    'ltsExtensionClient must not satisfy /v8/management'
  );

  // 4. Dual-client module attributes each endpoint literal to the client that calls it.
  const dualClient = `
    import { apiClient, ltsExtensionClient } from './client';
    export const listCredentials = () => apiClient.get<AuthFilesResponse>('/credentials');
    export const refreshModels = (name: string) =>
      ltsExtensionClient.post<{ models?: unknown }>(
        \`/auth-files/models/refresh?name=\${encodeURIComponent(name)}\`
      );
  `;
  assert.equal(
    hasScopedEndpointMatch(dualClient, parseContractEndpoint('/v8/management/credentials')),
    true
  );
  assert.equal(
    hasScopedEndpointMatch(dualClient, parseContractEndpoint('/v0/management/credentials')),
    false,
    'v8 endpoint in dual-client module must not match /v0/management'
  );
  assert.equal(
    hasScopedEndpointMatch(dualClient, parseContractEndpoint('/v0/management/auth-files/models/refresh')),
    true
  );
  assert.equal(
    hasScopedEndpointMatch(dualClient, parseContractEndpoint('/v8/management/auth-files/models/refresh')),
    false,
    'lts endpoint in dual-client module must not match /v8/management'
  );
  assert.equal(
    hasScopedEndpointMatch(dualClient, parseContractEndpoint('/v0/management/auth-files')),
    false,
    '/auth-files/models/refresh must not satisfy prefix /v0/management/auth-files'
  );

  // 5. Proxy /v1 endpoint boundary checks and service candidate exclusions.
  const modelsProxy = `
    import axios from 'axios';
    export const fetchModels = (trimmed) => axios.get(\`\${trimmed}/v1/models\`);
  `;
  assert.equal(hasScopedEndpointMatch(modelsProxy, parseContractEndpoint('/v1/models')), true);
  assert.equal(hasScopedEndpointMatch(modelsProxy, parseContractEndpoint('/v1/model')), false);
  assert.equal(isServiceClientCandidate('src/services/api/client.ts'), false);
  assert.equal(isServiceClientCandidate('src/services/api/usageQuery.test.mjs'), false);
  assert.equal(isServiceClientCandidate('src/services/api/testing/fakeV8Core.mjs'), false);
  assert.equal(isServiceClientCandidate('src/services/api/usage.ts'), true);
  assert.equal(isServiceClientCandidate('src/stores/useUsageQueryStore.ts'), true);

  // 6. Capability gate boundary checks.
  assert.equal(hasTokenBoundaryMatch("const H = 'x-cpa-support-plugin-extra';", 'x-cpa-support-plugin'), false);
  assert.equal(hasTokenBoundaryMatch("const H = 'x-cpa-support-plugin';", 'x-cpa-support-plugin'), true);

  // 7. Real repository contract registry passes cleanly under tightened rules.
  const { failures } = validateRepositoryContracts(repoRoot);
  assert.deepEqual(failures, []);
  console.log('Panel feature contract boundary self-test passed.');
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  if (process.argv.includes('--self-test')) {
    runSelfTest(root);
    process.exit(0);
  }

  const { failures, warnings } = validateRepositoryContracts(root);

  warnings.forEach((message) => {
    console.warn(`Panel feature contract warning: ${message}`);
  });

  if (failures.length > 0) {
    failures.forEach((message) => {
      console.error(`Panel feature contract violation: ${message}`);
    });
    console.error(`Panel feature contract check failed with ${failures.length} violation(s).`);
    process.exit(1);
  }

  console.log('Panel feature contract check passed.');
}
