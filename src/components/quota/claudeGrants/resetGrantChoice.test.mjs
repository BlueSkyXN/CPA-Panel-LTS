import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { canChooseResetGrant, resetGrantKind } = await vite.ssrLoadModule('/src/components/quota/claudeGrants/resetGrantChoice.ts');
const {
  anthropicResetGrantBlocker,
  parseAnthropicResetGrantStatus,
  resetGrantHasNoUsage,
} = await vite.ssrLoadModule('/src/services/api/claudeResetGrants.ts');
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

test('P2-02: mixed 0 and null/undefined windows preserve 0% and block wasted gives_back_weekly grants', () => {
  const status = parseAnthropicResetGrantStatus({
    ...STATUS_BLOCK,
    grants: [
      {
        ...STATUS_BLOCK.grants[0],
        percent_used: { seven_day: 0, seven_day_sonnet: null, seven_day_opus: undefined },
      },
    ],
  });
  assert.ok(status);
  assert.deepEqual(status.grants[0].percentUsed, { seven_day: 0 });
  assert.equal(resetGrantHasNoUsage(status.grants[0]), true);
  assert.equal(anthropicResetGrantBlocker(status, 'grant-fable'), 'no_usage');
  assert.equal(canChooseResetGrant(status, undefined, 'grant-fable', NOW), false);
});

test('P2-02: mixed 0, non-zero, and null windows remain redeemable', () => {
  const status = parseAnthropicResetGrantStatus({
    ...STATUS_BLOCK,
    grants: [
      {
        ...STATUS_BLOCK.grants[0],
        percent_used: { seven_day: 0, seven_day_sonnet: 25, seven_day_opus: null },
      },
    ],
  });
  assert.ok(status);
  assert.deepEqual(status.grants[0].percentUsed, { seven_day: 0, seven_day_sonnet: 25 });
  assert.equal(resetGrantHasNoUsage(status.grants[0]), false);
  assert.equal(anthropicResetGrantBlocker(status, 'grant-fable'), null);
  assert.equal(canChooseResetGrant(status, undefined, 'grant-fable', NOW), true);
});

test('P2-02: absent, null, empty, or all-null percent_used resolves to empty unknown usage', () => {
  for (const percentUsed of [
    undefined,
    null,
    {},
    { seven_day: null, seven_day_sonnet: undefined },
  ]) {
    const grantPayload = { ...STATUS_BLOCK.grants[0] };
    if (percentUsed === undefined) delete grantPayload.percent_used;
    else grantPayload.percent_used = percentUsed;
    const status = parseAnthropicResetGrantStatus({
      ...STATUS_BLOCK,
      grants: [grantPayload],
    });
    assert.ok(status);
    assert.deepEqual(status.grants[0].percentUsed, {});
    assert.equal(resetGrantHasNoUsage(status.grants[0]), false);
    assert.equal(anthropicResetGrantBlocker(status, 'grant-fable'), null);
  }
});

test('P2-02: malformed non-null or non-record percent_used fails closed by rejecting the grant', () => {
  for (const badPercentUsed of [
    'bad',
    [],
    123,
    true,
    { seven_day: 0, seven_day_sonnet: '40' },
    { seven_day: -1 },
    { seven_day: 101 },
    { seven_day: Number.NaN },
    { seven_day: Number.POSITIVE_INFINITY },
    { seven_day: {} },
  ]) {
    const status = parseAnthropicResetGrantStatus({
      ...STATUS_BLOCK,
      grants: [{ ...STATUS_BLOCK.grants[0], percent_used: badPercentUsed }],
    });
    assert.equal(status, null);
  }
});
