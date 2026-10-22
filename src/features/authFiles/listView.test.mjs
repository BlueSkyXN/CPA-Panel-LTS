import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const view = await vite.ssrLoadModule('/src/features/authFiles/listView.ts');
const state = await vite.ssrLoadModule('/src/features/authFiles/uiState.ts');
const { AuthFileCard } = await vite.ssrLoadModule('/src/features/authFiles/components/AuthFileCard.tsx');
const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
test.after(() => vite.close());
const names = (files) => files.map((file) => file.name);

test('provider tabs and grouped cards use the same stable order regardless of URL and input order', () => {
  const files = ['codebuddy', 'codex', 'xai', 'zcode-coding-plan', 'extension'].map((type) => ({ type, name: `${type}.json` }));
  const tabs = view.authFileProviderOptions(files);
  assert.deepEqual(view.authFileProviderOptions([...files].reverse(), 'zcode-coding-plan'), tabs);
  assert.deepEqual(view.sortAuthFiles(files, 'default', 'desc').map((file) => file.type), tabs.slice(1));
  assert.equal(view.authFileProviderOptions(files, 'empty-provider').includes('empty-provider'), true);
  assert.equal(view.authFileProviderOptions(files, 'all').filter((type) => type === 'all').length, 1);
});

test('name and filename sorts are distinct, natural, reversible, and do not mutate input', () => {
  const files = [{ name: 'account-10.json', label: 'Account 2' }, { name: 'account-2.json', label: 'Account 10' }];
  const before = structuredClone(files);
  assert.deepEqual(names(view.sortAuthFiles(files, 'az', 'asc')), ['account-2.json', 'account-10.json']);
  assert.deepEqual(names(view.sortAuthFiles(files, 'az', 'desc')), ['account-10.json', 'account-2.json']);
  assert.deepEqual(names(view.sortAuthFiles(files, 'name', 'asc')), ['account-10.json', 'account-2.json']);
  assert.deepEqual(files, before);
  assert.equal(view.authFileDisplayName({ name: 'fallback.json', label: '   ' }), 'fallback.json');
  assert.equal(view.authFileDisplayName({ name: 'fallback.json', label: 123 }), 'fallback.json');
});

test('priority treats unset and invalid values as zero and resolves ties by filename', () => {
  const files = [{ name: 'b', priority: 'bad' }, { name: 'a' }, { name: 'low', priority: -2 }, { name: 'high', priority: '10' }];
  assert.deepEqual(names(view.sortAuthFiles(files, 'priority', 'desc')), ['high', 'a', 'b', 'low']);
  assert.deepEqual(names(view.sortAuthFiles([...files].reverse(), 'priority', 'desc')), ['high', 'a', 'b', 'low']);
  assert.deepEqual(names(view.sortAuthFiles(files, 'priority', 'asc')), ['low', 'a', 'b', 'high']);
});

test('modification sort accepts ISO, seconds, milliseconds and keeps unknown dates last both ways', () => {
  const files = [
    { name: 'unknown', modtime: 'not-a-date' },
    { name: 'seconds', modtime: 1700000000 },
    { name: 'milliseconds', modified: 1800000000000 },
    { name: 'iso', modtime: '2020-01-01T00:00:00Z' },
    { name: 'refresh-only', last_refresh: '2030-01-01T00:00:00Z' },
  ];
  assert.deepEqual(names(view.sortAuthFiles(files, 'modified', 'asc')), ['iso', 'seconds', 'milliseconds', 'refresh-only', 'unknown']);
  assert.deepEqual(names(view.sortAuthFiles(files, 'modified', 'desc')), ['milliseconds', 'seconds', 'iso', 'refresh-only', 'unknown']);
  assert.equal(view.authFileModifiedTime({ name: 'fallback', modtime: '', updated_at: '2020-01-01T00:00:00Z' }), 1577836800000);
});

test('search includes visible labels, filenames and providers, escaping non-wildcard regex characters', () => {
  const file = { name: 'opaque-2.json', label: ' Work [2] ', type: 'zcode-coding-plan' };
  for (const search of ['work', 'WORK*[2]', 'opaque*json', 'zcode', '']) assert.equal(view.matchesAuthFileSearch(file, search), true);
  for (const search of ['work [3]', 'work.*[2]', 'other']) assert.equal(view.matchesAuthFileSearch(file, search), false);
});

test('status choices are exclusive and legacy overlapping flags migrate to disabled', () => {
  const files = [{ name: 'ok' }, { name: 'problem', unavailable: true }, { name: 'disabled', disabled: true, unavailable: true }];
  assert.deepEqual(names(files.filter((file) => view.matchesAuthFileStatus(file, 'problem'))), ['problem']);
  assert.deepEqual(names(files.filter((file) => view.matchesAuthFileStatus(file, 'disabled'))), ['disabled']);
  assert.equal(state.resolveAuthFilesStatusFilter({ problemOnly: true, disabledOnly: true }), 'disabled');
  assert.equal(state.resolveAuthFilesStatusFilter({ problemOnly: true }), 'problem');
  assert.equal(state.resolveAuthFilesStatusFilter({ statusFilter: 'all', problemOnly: true }), 'all');
  assert.equal(state.resolveAuthFilesStatusFilter({ statusFilter: 'invalid' }), 'all');
});

test('old sort modes retain their directions and invalid persisted values are safe', () => {
  assert.deepEqual(state.resolveAuthFilesSort({ sortMode: 'priority' }), { mode: 'priority', direction: 'desc' });
  assert.deepEqual(state.resolveAuthFilesSort({ sortMode: 'az' }), { mode: 'az', direction: 'asc' });
  assert.deepEqual(state.resolveAuthFilesSort({ sortMode: 'default' }), { mode: 'default', direction: 'asc' });
  assert.deepEqual(state.resolveAuthFilesSort({ sortMode: 'modified', sortDirection: 'asc' }), { mode: 'modified', direction: 'asc' });
  assert.deepEqual(state.resolveAuthFilesSort({ sortMode: 'bad', sortDirection: 'bad' }), { mode: 'default', direction: 'asc' });
});

test('full-result sorting precedes pagination and label ties have stable identity order', () => {
  const files = Array.from({ length: 14 }, (_, index) => ({ name: `file-${14 - index}`, priority: index, label: 'Same' }));
  const sorted = view.sortAuthFiles(files, 'priority', 'desc');
  assert.deepEqual(names(sorted.slice(0, 3)), ['file-1', 'file-2', 'file-3']);
  assert.deepEqual(names(sorted.slice(3, 6)), ['file-4', 'file-5', 'file-6']);
  assert.deepEqual(names(view.sortAuthFiles(files, 'name', 'desc')), names(view.sortAuthFiles([...files].reverse(), 'name', 'desc')));
});

test('all locales render account labels, filename access and credential actions without PAT mislabeling', async () => {
  const noop = () => {};
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    await i18n.changeLanguage(language);
    const html = renderToStaticMarkup(createElement(AuthFileCard, {
      file: { name: 'fixture-account.json', label: 'Fixture label', type: 'zcode-coding-plan' },
      compact: false, selected: false, disableControls: false, deleting: null, statusUpdating: {},
      quotaFilterType: null, patDetailActive: false, statusBarCache: new Map(),
      onShowModels: noop, onShowCodexRemoteCloudConnectEnvironments: noop, onDownload: noop,
      onCopyName: noop, onOpenPrefixProxyEditor: noop, onDelete: noop, onToggleStatus: noop,
      onToggleSelect: noop, onUpdatePat: noop,
    }));
    assert.equal(i18n.t('auth_files.filter_zcode-coding-plan'), 'ZCode');
    assert.ok(html.includes('ZCode'));
    assert.ok(html.includes('Fixture label'));
    assert.ok(html.includes('fixture-account.json'));
    assert.ok(html.includes(i18n.t('pat_accounts.update')));
    assert.ok(html.includes('aria-haspopup="menu"'));
    assert.ok(!html.includes('PAT'));
    assert.ok(!html.includes('auth_files.'));
    for (const key of ['sort_name', 'sort_modified', 'sort_direction', 'results_summary', 'status_filter_all', 'more_actions']) {
      assert.ok(i18n.exists(`auth_files.${key}`, { lng: language }));
    }
  }
});
