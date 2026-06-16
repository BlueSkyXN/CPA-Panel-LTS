#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const contractPath = 'docs/lts/panel-feature-contracts.yaml';
const strictStatuses = new Set(['protected', 'lts-maintained', 'coexist', 'shared']);
const warningStatuses = new Set(['experimental']);
const failures = [];
const warnings = [];

const readText = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => existsSync(path.join(root, relativePath));

const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const endpointToRegex = (endpoint) => {
  const stripped = endpoint.replace(/^\/v0\/management/, '') || endpoint;
  const parts = stripped.split('/').map((part) => {
    if (!part) return '';
    if (part.startsWith(':')) {
      return "(?:[^/'\"`]+|\\$\\{[^}]+\\})";
    }
    return escapeRegex(part);
  });
  return new RegExp(parts.join('\\/'));
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
    .map((panelPath) => {
      const absolutePath = path.join(root, panelPath);
      return readSourceTree(absolutePath);
    })
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
} else {
  const contract = parse(readText(contractPath));
  const features = normalizeList(contract?.features);
  const routerSource = exists('src/router/MainRoutes.tsx')
    ? readText('src/router/MainRoutes.tsx')
    : '';

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
      if (panelPath.endsWith('/') && !statSync(path.join(root, panelPath)).isDirectory()) {
        reportFeatureIssue(feature, `panel path is not a directory: ${panelPath}`);
      }
    });

    normalizeList(feature.routes).forEach((route) => {
      if (typeof route !== 'string' || route.trim() === '') {
        reportFeatureIssue(feature, 'routes contains a non-string route');
        return;
      }
      if (!routerSource.includes(route)) {
        reportFeatureIssue(feature, `route is not registered or aliased: ${route}`);
      }
    });

    normalizeList(feature.capability_gates).forEach((gate) => {
      if (typeof gate !== 'string' || gate.trim() === '') {
        reportFeatureIssue(feature, 'capability_gates contains a non-string marker');
        return;
      }
      const repoHasGate =
        routerSource.includes(gate) ||
        exists('src/utils/constants.ts') && readText('src/utils/constants.ts').includes(gate) ||
        exists('src/stores/useAuthStore.ts') && readText('src/stores/useAuthStore.ts').includes(gate);
      if (!repoHasGate) {
        reportFeatureIssue(feature, `capability gate marker not found: ${gate}`);
      }
    });

    const serviceFiles = normalizeList(feature.panel_files)
      .filter((panelPath) => typeof panelPath === 'string')
      .filter((panelPath) => panelPath.startsWith('src/services/api/') && exists(panelPath));
    const serviceSource = serviceFiles.map((panelPath) => readText(panelPath)).join('\n');
    const featureSource = buildFeatureSearchSource(feature);

    normalizeList(feature.core_endpoints).forEach((endpoint) => {
      if (typeof endpoint !== 'string' || endpoint.trim() === '') {
        reportFeatureIssue(feature, 'core_endpoints contains a non-string endpoint');
        return;
      }

      if (serviceFiles.length === 0) {
        reportFeatureIssue(feature, `no service API client listed for endpoint: ${endpoint}`);
        return;
      }

      const endpointRegex = endpointToRegex(endpoint);
      if (!endpointRegex.test(serviceSource)) {
        reportFeatureIssue(feature, `endpoint marker not found in listed service clients: ${endpoint}`);
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
}

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
