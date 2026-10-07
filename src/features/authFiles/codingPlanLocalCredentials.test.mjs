import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { isMacOSClient, CODING_PLAN_MAC_API_KEY_COMMANDS, CODING_PLAN_MAC_DEVICE_ID_COMMAND } =
  await vite.ssrLoadModule('/src/features/authFiles/codingPlanLocalCredentials.ts');
const { CodingPlanLocalCredentialsHelp } = await vite.ssrLoadModule(
  '/src/features/authFiles/components/CodingPlanLocalCredentialsHelp.tsx'
);
const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
test.after(() => vite.close());

const commands = [
  { command: CODING_PLAN_MAC_API_KEY_COMMANDS.bigmodel, provider: 'bigmodel', file: 'config.json' },
  { command: CODING_PLAN_MAC_API_KEY_COMMANDS.zai, provider: 'zai', file: 'config.json' },
  { command: CODING_PLAN_MAC_DEVICE_ID_COMMAND, file: 'telemetry-state.json' },
];

const dataFor = (item, value) =>
  item.provider
    ? { provider: { [`builtin:${item.provider}-coding-plan`]: { options: { apiKey: value } } } }
    : { deviceMid: value };

async function withSyntheticHome(run) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'coding-plan home-'));
  const directory = path.join(home, '.zcode/v2');
  const bin = path.join(home, 'bin');
  await mkdir(directory, { recursive: true });
  await mkdir(bin);
  // Use real plutil, but never touch the user's terminal or clipboard in tests.
  await writeFile(path.join(bin, 'tee'), '#!/bin/sh\nexec /usr/bin/tee "$HOME/displayed-value"\n', {
    mode: 0o700,
  });
  await writeFile(path.join(bin, 'pbcopy'), '#!/bin/sh\nexec /bin/cat > "$HOME/copied-value"\n', {
    mode: 0o700,
  });
  try {
    await run({
      home,
      directory,
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('macOS detection uses the browser and excludes iPad desktop mode and other devices', () => {
  for (const client of [
    { platform: 'MacIntel', maxTouchPoints: 0 },
    { userAgentData: { platform: 'macOS', mobile: false } },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  ])
    assert.equal(isMacOSClient(client), true);
  for (const client of [
    {},
    { platform: 'Win32' },
    { platform: 'Linux x86_64' },
    { platform: 'MacIntel', maxTouchPoints: 5 },
    { platform: 'MacIntel', userAgent: 'iPad' },
    { platform: 'iPhone', userAgent: 'iPhone; CPU iPhone OS 18_0 like Mac OS X' },
    { userAgentData: { platform: 'macOS', mobile: true } },
    { platform: 'Linux armv8', userAgent: 'Android' },
  ])
    assert.equal(isMacOSClient(client), false);
});

test('commands are fixed native local reads and stop before copying invalid values', () => {
  for (const { command } of commands) {
    assert.match(command, /^\(v=\$\(plutil -extract /);
    assert.match(command, /raw -expect string "\$HOME\/\.zcode\/v2\//);
    assert.ok(command.includes('&& [ -n "$v" ] && [ "${v#enc:}" = "$v" ]'));
    assert.ok(command.endsWith('printf \'%s\\n\' "$v" | tee /dev/tty | pbcopy)'));
    assert.doesNotMatch(command, /curl|wget|python|jq|\/Users\/|https?:|credentials\.json/);
  }
  assert.match(
    CODING_PLAN_MAC_API_KEY_COMMANDS.bigmodel,
    /provider\.builtin:bigmodel-coding-plan\.options\.apiKey/
  );
  assert.match(
    CODING_PLAN_MAC_API_KEY_COMMANDS.zai,
    /provider\.builtin:zai-coding-plan\.options\.apiKey/
  );
  assert.match(CODING_PLAN_MAC_DEVICE_ID_COMMAND, /-extract deviceMid /);
});

test('all locales render command text and warnings with a manual disclosure', async () => {
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    await i18n.changeLanguage(language);
    const markup = renderToStaticMarkup(createElement(CodingPlanLocalCredentialsHelp));
    assert.doesNotMatch(markup, /pat_accounts\./);
    assert.match(markup, /<details/);
    assert.match(markup, /<summary>/);
    assert.match(markup, /macOS/);
    assert.match(markup, /builtin:bigmodel-coding-plan/);
    assert.match(markup, /deviceMid/);
    assert.equal((markup.match(/type="button"/g) || []).length >= 2, true);
    for (const key of [
      'warning',
      'troubleshooting',
      'instructions',
      'copy_failed',
      'region_hint',
    ]) {
      assert.equal(
        i18n.exists(`pat_accounts.local_credentials.${key}`, { lng: language, fallbackLng: false }),
        true
      );
    }
  }
});

test(
  'real macOS extraction displays and copies synthetic values in both default shells',
  { skip: process.platform !== 'darwin' },
  async () => {
    await withSyntheticHome(async ({ home, directory, env }) => {
      for (const shell of ['/bin/zsh', '/bin/bash']) {
        for (const item of commands) {
          const value = item.provider
            ? 'synthetic-key.synthetic-secret'
            : '00000000-0000-4000-8000-000000000001';
          const source = JSON.stringify(dataFor(item, value));
          await writeFile(path.join(directory, item.file), source);
          const result = spawnSync(shell, ['-fc', item.command], { env, encoding: 'utf8' });
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stdout, '');
          assert.equal(await readFile(path.join(home, 'copied-value'), 'utf8'), `${value}\n`);
          assert.equal(await readFile(path.join(home, 'displayed-value'), 'utf8'), `${value}\n`);
          assert.equal(await readFile(path.join(directory, item.file), 'utf8'), source);
        }
      }
    });
  }
);

test(
  'missing, malformed, empty, non-string and encrypted fields leave the clipboard untouched',
  { skip: process.platform !== 'darwin' },
  async () => {
    await withSyntheticHome(async ({ home, directory, env }) => {
      for (const item of commands) {
        const file = path.join(directory, item.file);
        const invalidSources = [
          undefined,
          '{invalid-json',
          '{}',
          ...['', 42, null, false, [], {}, 'enc:v1:synthetic-ciphertext'].map((value) =>
            JSON.stringify(dataFor(item, value))
          ),
        ];
        for (const source of invalidSources) {
          if (source === undefined) await rm(file, { force: true });
          else await writeFile(file, source);
          for (const shell of ['/bin/zsh', '/bin/bash']) {
            await writeFile(path.join(home, 'copied-value'), 'clipboard-sentinel');
            await writeFile(path.join(home, 'displayed-value'), 'display-sentinel');
            const result = spawnSync(shell, ['-fc', item.command], { env, encoding: 'utf8' });
            assert.notEqual(result.status, 0);
            assert.equal(
              await readFile(path.join(home, 'copied-value'), 'utf8'),
              'clipboard-sentinel'
            );
            assert.equal(
              await readFile(path.join(home, 'displayed-value'), 'utf8'),
              'display-sentinel'
            );
            assert.doesNotMatch(result.stdout, /synthetic-ciphertext/);
          }
        }
      }
    });
  }
);
