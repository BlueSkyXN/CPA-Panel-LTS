import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
test.after(() => vite.close());
const { normalizeAuthFilesResponse } = await vite.ssrLoadModule('/src/services/api/authFiles.ts');
const { hasAuthFileStatusWarning, isProblemAuthFile } = await vite.ssrLoadModule('/src/features/authFiles/constants.ts');

test('Core reauth_required flags an active credential as needing a new login', () => {
  const { files } = normalizeAuthFilesResponse({
    files: [
      { name: 'a.json', provider: 'codex', status: 'active', status_message: 'refresh token rejected; re-login required', reauth_required: true, unavailable: false },
      { name: 'b.json', provider: 'codex', status: 'active', status_message: '', unavailable: false },
      { name: 'c.json', provider: 'codex', status: 'active', reauth_required: true },
    ],
  });
  const byName = Object.fromEntries(files.map((file) => [file.name, file]));
  assert.equal(byName['a.json'].reauthRequired, true);
  assert.equal(byName['b.json'].reauthRequired, undefined);
  assert.equal(hasAuthFileStatusWarning(byName['a.json']), true);
  assert.equal(hasAuthFileStatusWarning(byName['c.json']), true, 'flag alone triggers the warning');
  assert.equal(hasAuthFileStatusWarning(byName['b.json']), false);
  assert.equal(isProblemAuthFile(byName['c.json']), true);
});
