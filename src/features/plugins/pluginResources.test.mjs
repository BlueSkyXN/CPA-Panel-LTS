import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const { isOfficialPlugin } = await vite.ssrLoadModule('/src/features/plugins/pluginResources.ts');

test.after(async () => {
  await vite.close();
});

const pluginEntry = (sourceId, repository) => ({ sourceId, repository });

test('trusts only the official source with an official GitHub repository', () => {
  assert.equal(isOfficialPlugin(pluginEntry('official', 'router-for-me/example-plugin')), true);
  assert.equal(isOfficialPlugin(pluginEntry('third-party', 'router-for-me/example-plugin')), false);
  assert.equal(isOfficialPlugin(pluginEntry('official', 'someone-else/example-plugin')), false);
  assert.equal(
    isOfficialPlugin(
      pluginEntry('official', 'https://github.com.evil.example/router-for-me/example-plugin')
    ),
    false
  );
  assert.equal(
    isOfficialPlugin(pluginEntry('official', 'https://github.com/someone-else/example-plugin')),
    false
  );
});
