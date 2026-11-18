import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { needsSwitchConfirmation } = await vite.ssrLoadModule(
  '/src/features/authFiles/editor/providerSwitchContract.ts'
);
test.after(() => vite.close());

// Unit coverage for the shared guard condition used by all three edit
// pages. The full typing/commit/stay/navigation behavior is exercised
// against the real mounted pages by scripts/guard-provider-switch.mjs
// (wired as test:provider-switch), which fails on the wiring regressions
// this unit file cannot see.

test('clean page never asks', () => {
  assert.equal(needsSwitchConfirmation('xai', 'codex', false), false);
});

test('different provider with unsaved drafts asks', () => {
  assert.equal(needsSwitchConfirmation('xai', 'codex', true), true);
  assert.equal(needsSwitchConfirmation('  kimi ', 'codex', true), true);
});

test('same provider (any casing/whitespace) never asks and never resets drafts', () => {
  assert.equal(needsSwitchConfirmation('codex', 'codex', true), false);
  assert.equal(needsSwitchConfirmation('  CODEX  ', 'codex', true), false);
});

test('empty commit on a named provider is a switch, not a no-op', () => {
  assert.equal(needsSwitchConfirmation('', 'codex', true), true);
});
