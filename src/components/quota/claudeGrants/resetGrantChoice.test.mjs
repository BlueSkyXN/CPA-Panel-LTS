import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { canChooseResetGrant, resetGrantKind } = await vite.ssrLoadModule('/src/components/quota/claudeGrants/resetGrantChoice.ts');
const { parseAnthropicResetGrantStatus } = await vite.ssrLoadModule('/src/services/api/claudeResetGrants.ts');
test.after(() => vite.close());

const NOW = Date.parse('2026-11-14T12:00:00Z');

const STATUS_BLOCK = {
  eligible: true,
  at_limit: true,
  cooldown_until: null,
  weekly_resets_at: '2026-11-16T00:00:00Z',
  grants: [
    {
      id: 'grant-fable',
      label: 'Fable refill',
      resets_left: 2,
      resets_total: 4,
      starts_at: '2026-11-01T00:00:00Z',
      ends_at: '2026-12-01T00:00:00Z',
      clears: ['five_hours'],
      paused: false,
      usable_now: true,
      use_requires_limit: true,
      percent_used: { five_hours: 40 },
      type: 'session',
      gives_back_weekly: true,
    },
    {
      id: 'grant-weekly',
      label: 'Weekly refill',
      resets_left: 1,
      resets_total: 1,
      starts_at: '2026-11-01T00:00:00Z',
      ends_at: '2026-12-01T00:00:00Z',
      clears: ['weekly'],
      paused: false,
      usable_now: true,
      use_requires_limit: true,
      percent_used: { weekly: 10 },
      type: 'weekly',
      gives_back_weekly: false,
    },
  ],
};

test('parse keeps resetType/givesBackWeekly and model-specific percent windows', () => {
  const status = parseAnthropicResetGrantStatus(STATUS_BLOCK);
  assert.ok(status);
  const fable = status.grants.find((grant) => grant.id === 'grant-fable');
  assert.equal(fable.resetType, 'session');
  assert.equal(fable.givesBackWeekly, true);
  // A model-specific window must survive parsing verbatim.
  assert.deepEqual(fable.percentUsed, { five_hours: 40 });
});

test('canChooseResetGrant never substitutes the recommendation for an explicit choice', () => {
  const status = parseAnthropicResetGrantStatus(STATUS_BLOCK);
  assert.ok(canChooseResetGrant(status, undefined, 'grant-weekly', NOW));
  assert.ok(canChooseResetGrant(status, undefined, 'grant-fable', NOW));
  assert.equal(canChooseResetGrant(status, undefined, 'grant-unknown', NOW), false);
  assert.equal(canChooseResetGrant(status, undefined, '', NOW), false);
  assert.equal(canChooseResetGrant(status, undefined, 42, NOW), false);
  // A pending claim can only retry its own identity.
  assert.equal(canChooseResetGrant(status, 'grant-fable', 'grant-weekly', NOW), false);
  assert.ok(canChooseResetGrant(null, 'grant-fable', 'grant-fable', NOW));
});

test('resetGrantKind classifies fable refills ahead of the raw reset type', () => {
  const status = parseAnthropicResetGrantStatus(STATUS_BLOCK);
  const fable = status.grants.find((grant) => grant.id === 'grant-fable');
  const weekly = status.grants.find((grant) => grant.id === 'grant-weekly');
  assert.equal(resetGrantKind(fable), 'fable');
  assert.equal(resetGrantKind(weekly), 'weekly');
  assert.equal(resetGrantKind(undefined), 'unknown');
});
