import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./serviceTier.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { classifyServiceTier, normalizeServiceTier, resolveServiceTier } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('normalizes and classifies the two supported display tiers', () => {
  assert.equal(normalizeServiceTier(' Priority '), 'Priority');
  assert.equal(classifyServiceTier('fast'), 'fast');
  assert.equal(classifyServiceTier('PRIORITY'), 'fast');
  assert.equal(classifyServiceTier('default'), 'std');
  assert.equal(classifyServiceTier('STANDARD'), 'std');
  assert.equal(classifyServiceTier('auto'), null);
  assert.equal(classifyServiceTier(undefined), null);
});

test('effective tier wins over response and request values', () => {
  assert.deepEqual(
    resolveServiceTier({
      serviceTier: 'priority',
      requestServiceTier: 'priority',
      responseServiceTier: 'default',
      effectiveServiceTier: 'standard',
    }),
    {
      tier: 'std',
      evidence: 'effective',
      rawRequest: 'priority',
      rawResponse: 'default',
      rawEffective: 'standard',
    }
  );
});

test('recognized response wins over request intent', () => {
  const resolved = resolveServiceTier({
    requestServiceTier: 'priority',
    responseServiceTier: 'default',
  });
  assert.equal(resolved.tier, 'std');
  assert.equal(resolved.evidence, 'response');
});

test('unknown effective tier blocks fallback to response or request Fast evidence', () => {
  const withResponse = resolveServiceTier({
    effectiveServiceTier: 'future-tier',
    responseServiceTier: 'priority',
    requestServiceTier: 'standard',
  });
  assert.equal(withResponse.tier, 'std');
  assert.equal(withResponse.evidence, 'assumed');
  assert.equal(withResponse.rawEffective, 'future-tier');

  const withRequest = resolveServiceTier({
    effectiveServiceTier: 'auto',
    requestServiceTier: 'priority',
  });
  assert.equal(withRequest.tier, 'std');
  assert.equal(withRequest.evidence, 'assumed');
  assert.equal(withRequest.rawEffective, 'auto');
});

test('unknown response blocks fallback to a Fast request', () => {
  const resolved = resolveServiceTier({
    requestServiceTier: 'priority',
    responseServiceTier: 'flex',
  });
  assert.equal(resolved.tier, 'std');
  assert.equal(resolved.evidence, 'assumed');
  assert.equal(resolved.rawResponse, 'flex');
});

test('request tier is used only when response evidence is absent', () => {
  const resolved = resolveServiceTier({ serviceTier: ' fast ' });
  assert.equal(resolved.tier, 'fast');
  assert.equal(resolved.evidence, 'request');
  assert.equal(resolved.rawRequest, 'fast');
});

test('legacy, auto, missing, and unknown values display as assumed Std', () => {
  for (const serviceTier of [undefined, null, '', 'auto', 'experimental']) {
    const resolved = resolveServiceTier({ serviceTier });
    assert.equal(resolved.tier, 'std');
    assert.equal(resolved.evidence, 'assumed');
  }
});
