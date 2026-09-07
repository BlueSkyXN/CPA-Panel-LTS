import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../../scripts/testTypeScript.mjs';

const { isSidebarToggleShortcut } = loadTypeScript(fileURLToPath(new URL('./sidebarShortcut.ts', import.meta.url)));
const base = { key: 'b', ctrlKey: true, metaKey: false };

test('sidebar toggle accepts Ctrl+B and Cmd+B only', () => {
  assert.equal(isSidebarToggleShortcut(base), true);
  assert.equal(isSidebarToggleShortcut({ key: 'B', ctrlKey: false, metaKey: true }), true);
  for (const patch of [
    { key: 'k' }, { ctrlKey: false }, { metaKey: true }, { altKey: true },
    { shiftKey: true }, { repeat: true }, { defaultPrevented: true }, { isComposing: true },
  ]) assert.equal(isSidebarToggleShortcut({ ...base, ...patch }), false);
});

test('sidebar toggle does not intercept editing controls', () => {
  for (const target of [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
    { tagName: 'SPAN', isContentEditable: true },
    { tagName: 'DIV', closest: () => ({ role: 'textbox' }) },
  ]) assert.equal(isSidebarToggleShortcut({ ...base, target }), false);
  assert.equal(isSidebarToggleShortcut({ ...base, target: { tagName: 'BUTTON' } }), true);
});
