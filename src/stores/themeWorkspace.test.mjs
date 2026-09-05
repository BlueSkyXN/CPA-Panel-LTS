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
  for (const value of ['paper', 'light', 'dark', 'auto', '', 'sepia', 'mist', null, undefined, 3]) {
    assert.equal(normalizeTheme(value), 'white');
  }
  assert.equal(normalizeTheme('white'), 'white');
  assert.equal(normalizeTheme('aurora-nebula'), 'aurora-nebula');
  assert.equal(normalizeTheme('aurora-dawn'), 'aurora-dawn');
});

test('keeps only the tower workspace layout', () => {
  assert.equal(normalizeWorkspaceLayout('tower'), 'tower');
  for (const value of ['studio', 'console', 'paper', 'classic', '', null, undefined, 3]) {
    assert.equal(normalizeWorkspaceLayout(value), 'tower');
  }
});
