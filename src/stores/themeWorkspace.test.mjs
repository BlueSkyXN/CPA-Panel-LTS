import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [{ normalizeTheme }, { normalizeWorkspaceLayout }] = await Promise.all([
  vite.ssrLoadModule('/src/stores/useThemeStore.ts'),
  vite.ssrLoadModule('/src/stores/useWorkspaceStore.ts'),
]);

test.after(async () => {
  await vite.close();
});

test('permanently migrates removed and invalid themes to white', () => {
  for (const value of ['paper', 'light', 'dark', 'auto', '', 'sepia', null, undefined, 3]) {
    assert.equal(normalizeTheme(value), 'white');
  }
  assert.equal(normalizeTheme('white'), 'white');
  assert.equal(normalizeTheme('mist'), 'mist');
});

test('keeps only the three supported workspace layouts', () => {
  assert.equal(normalizeWorkspaceLayout('tower'), 'tower');
  assert.equal(normalizeWorkspaceLayout('studio'), 'studio');
  assert.equal(normalizeWorkspaceLayout('console'), 'console');
  for (const value of ['paper', 'classic', '', null, undefined, 3]) {
    assert.equal(normalizeWorkspaceLayout(value), 'tower');
  }
});
