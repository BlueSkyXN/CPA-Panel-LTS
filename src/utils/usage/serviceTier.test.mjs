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

test('effective tier wins while matching response or outbound values refine its evidence', () => {
  assert.deepEqual(
    resolveServiceTier({
      serviceTier: 'priority',
      requestServiceTier: 'priority',
      outboundServiceTier: 'priority',
      responseServiceTier: 'default',
      effectiveServiceTier: 'standard',
    }),
    {
      tier: 'std',
      evidence: 'response',
      rawRequest: 'priority',
      rawOutbound: 'priority',
      rawResponse: 'default',
      rawEffective: 'standard',
    }
  );

  const outbound = resolveServiceTier({
    requestServiceTier: 'auto',
    outboundServiceTier: 'fast',
    effectiveServiceTier: 'priority',
  });
  assert.equal(outbound.tier, 'fast');
  assert.equal(outbound.evidence, 'outbound');
  assert.equal(outbound.rawOutbound, 'fast');

  const effective = resolveServiceTier({
    outboundServiceTier: 'default',
    effectiveServiceTier: 'priority',
  });
  assert.equal(effective.tier, 'fast');
  assert.equal(effective.evidence, 'effective');

  const unknownResponse = resolveServiceTier({
    responseServiceTier: 'future-tier',
    outboundServiceTier: 'priority',
    effectiveServiceTier: 'priority',
  });
  assert.equal(unknownResponse.tier, 'fast');
  assert.equal(unknownResponse.evidence, 'effective');

  const conflictingResponse = resolveServiceTier({
    responseServiceTier: 'default',
    outboundServiceTier: 'priority',
    effectiveServiceTier: 'priority',
  });
  assert.equal(conflictingResponse.tier, 'fast');
  assert.equal(conflictingResponse.evidence, 'effective');
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
    outboundServiceTier: 'priority',
    responseServiceTier: 'flex',
  });
  assert.equal(resolved.tier, 'std');
  assert.equal(resolved.evidence, 'assumed');
  assert.equal(resolved.rawResponse, 'flex');
});

test('outbound tier is the authoritative fallback before legacy request intent', () => {
  const resolved = resolveServiceTier({
    requestServiceTier: 'priority',
    outboundServiceTier: 'default',
  });
  assert.equal(resolved.tier, 'std');
  assert.equal(resolved.evidence, 'outbound');
  assert.equal(resolved.rawRequest, 'priority');
  assert.equal(resolved.rawOutbound, 'default');

  const unknown = resolveServiceTier({
    requestServiceTier: 'priority',
    outboundServiceTier: 'future-tier',
  });
  assert.equal(unknown.tier, 'std');
  assert.equal(unknown.evidence, 'assumed');
  assert.equal(unknown.rawOutbound, 'future-tier');
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
