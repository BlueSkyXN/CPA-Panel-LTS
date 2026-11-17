import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { reduceProviderSwitch, needsSwitchConfirmation } = await vite.ssrLoadModule(
  '/src/features/authFiles/editor/providerSwitchContract.ts'
);
test.after(() => vite.close());

const start = (provider = 'codex') => ({ provider, providerInput: provider, pending: null });
const DIRTY = true;
const CLEAN = false;

test('typing only moves the input; the editor target and drafts stay untouched', () => {
  // dba6c341 fed the typed text straight into `provider`, which reset the
  // drafts of another provider without any confirmation.
  let state = start('codex');
  state = reduceProviderSwitch(state, { kind: 'change', value: 'x' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'change', value: 'xa' }, DIRTY);
  assert.equal(state.provider, 'codex');
  assert.equal(state.providerInput, 'xa');
  assert.equal(state.pending, null);
});

test('commit with unsaved drafts and a different provider arms a confirmation', () => {
  // typing first, as in the real flow: the input already holds the filter
  // text; committing arms the dialog without switching the editor target
  let state = reduceProviderSwitch(start('codex'), { kind: 'change', value: 'xai' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'commit', value: 'xai' }, DIRTY);
  assert.equal(state.pending, 'xai');
  assert.equal(state.provider, 'codex', 'must not switch before the user confirms');
  assert.equal(state.providerInput, 'xai', 'the attempted target stays visible in the input');
});

test('stay restores the input to the provider still being edited', () => {
  let state = reduceProviderSwitch(start('codex'), { kind: 'commit', value: 'xai' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'stay' }, DIRTY);
  assert.deepEqual(state, start('codex'));
});

test('confirm applies the switch exactly once', () => {
  let state = reduceProviderSwitch(start('codex'), { kind: 'commit', value: 'xai' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'confirm' }, DIRTY);
  assert.deepEqual(state, start('xai'));
  // a late confirm after the dialog settled must be a no-op
  state = reduceProviderSwitch(state, { kind: 'confirm' }, DIRTY);
  assert.deepEqual(state, start('xai'));
});

test('commit on a clean page switches directly without confirmation', () => {
  const state = reduceProviderSwitch(start('codex'), { kind: 'commit', value: 'xai' }, CLEAN);
  assert.deepEqual(state, start('xai'));
});

test('re-committing the same provider never resets drafts or asks', () => {
  let state = reduceProviderSwitch(start('codex'), { kind: 'commit', value: 'codex' }, DIRTY);
  assert.deepEqual(state, start('codex'));
  // same key with different casing/whitespace is still the same provider
  state = reduceProviderSwitch(state, { kind: 'commit', value: '  CODEX  ' }, DIRTY);
  assert.deepEqual(state, { provider: 'CODEX', providerInput: 'CODEX', pending: null });
});

test('full chain: type, select, stay, retype, select, confirm', () => {
  let state = start('codex');
  state = reduceProviderSwitch(state, { kind: 'change', value: 'xa' }, DIRTY);
  assert.equal(state.provider, 'codex');
  state = reduceProviderSwitch(state, { kind: 'commit', value: 'xai' }, DIRTY);
  assert.equal(state.pending, 'xai');
  state = reduceProviderSwitch(state, { kind: 'stay' }, DIRTY);
  assert.equal(state.providerInput, 'codex');
  state = reduceProviderSwitch(state, { kind: 'change', value: 'k' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'commit', value: 'kimi' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'confirm' }, DIRTY);
  assert.deepEqual(state, start('kimi'));
});

test('a second commit while a confirmation is pending is ignored', () => {
  let state = reduceProviderSwitch(start('codex'), { kind: 'commit', value: 'xai' }, DIRTY);
  state = reduceProviderSwitch(state, { kind: 'commit', value: 'kimi' }, DIRTY);
  assert.equal(state.pending, 'xai', 'the first armed target owns the dialog');
});

test('needsSwitchConfirmation mirrors the arming condition', () => {
  assert.equal(needsSwitchConfirmation('xai', 'codex', DIRTY), true);
  assert.equal(needsSwitchConfirmation('codex', 'codex', DIRTY), false);
  assert.equal(needsSwitchConfirmation('xai', 'codex', CLEAN), false);
  assert.equal(needsSwitchConfirmation('  CODEX ', 'codex', DIRTY), false);
});

test('regression sentinel: the dba6c341 behavior fails this contract', () => {
  // Simulates the old faulty wiring: every keystroke was written into the
  // provider being edited. Any implementation that keeps that behavior cannot
  // pass the typing test above; this sentinel spells it out explicitly.
  const faulty = (state, value) => ({ ...state, provider: value, providerInput: value });
  const afterTyping = faulty(start('codex'), 'xa');
  assert.notEqual(afterTyping.provider, 'codex', 'sentinel sanity: faulty wiring switches provider');
  const correct = reduceProviderSwitch(start('codex'), { kind: 'change', value: 'xa' }, DIRTY);
  assert.equal(correct.provider, 'codex');
});
