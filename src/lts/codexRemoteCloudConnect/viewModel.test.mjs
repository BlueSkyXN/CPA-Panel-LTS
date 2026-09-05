import assert from 'node:assert/strict';
import test from 'node:test';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: [new URL('./viewModel.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false, target: 'es2022',
});
const views = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const environment = (envId, overrides = {}) => ({
  id: envId, envId, kind: null, name: envId, displayName: null, hostName: 'host',
  online: false, busy: false, os: null, osVersion: null, arch: null,
  appServerVersion: null, installationId: null, clientType: null,
  originator: null, terminal: null, clientName: null, clientVersion: null,
  lastSeenAt: null, isLikelyStale: false, ...overrides,
});
const latest = environment('latest', { online: true, lastSeenAt: '2026-09-05T10:00:00Z' });
const summary = (items) => views.createCodexRemoteCloudConnectEnvironmentSummary(items);

test('unknown connectivity is not evidence that an environment can be deleted', () => {
  const result = views.createCodexRemoteCloudConnectEnvironmentViewModel([
    latest, environment('unknown', { online: null }),
  ]);
  assert.equal(result.environments.find((v) => v.environment.envId === 'unknown').advice.level, 'caution');
});

test('explicitly offline old skeleton remains a cleanup candidate', () => {
  const result = views.createCodexRemoteCloudConnectEnvironmentViewModel([latest, environment('old')]);
  assert.equal(result.environments.find((v) => v.environment.envId === 'old').advice.level, 'cleanable');
});

test('busy environment is retained even when offline flag is false', () => {
  const result = views.createCodexRemoteCloudConnectEnvironmentViewModel([latest, environment('busy', { busy: true })]);
  assert.equal(result.environments.find((v) => v.environment.envId === 'busy').advice.level, 'keep');
});

for (const [field, value] of [['lastSeenAt', '2026-09-05T10:00:01Z'], ['clientVersion', '0.153.4'], ['installationId', 'replacement']]) {
  test(`recheck sees ${field} changes even when counts and advice are unchanged`, () => {
    const before = summary([latest]);
    const after = summary([{ ...latest, [field]: value }]);
    assert.equal(views.areCodexRemoteCloudConnectEnvironmentSummariesEqual(before, after), false);
  });
}

test('record order does not create a false change or mutate the input array', () => {
  const old = environment('old');
  const input = [old, latest];
  assert.equal(views.areCodexRemoteCloudConnectEnvironmentSummariesEqual(summary(input), summary([latest, old])), true);
  assert.equal(input[0], old);
});
