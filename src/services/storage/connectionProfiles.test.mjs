import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const storage = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
    clear: () => values.clear(),
  };
};
globalThis.localStorage = storage();
globalThis.sessionStorage = storage();
globalThis.window = Object.assign(new EventTarget(), {
  location: { host: 'example.test', reload() {} },
});
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const profiles = await vite.ssrLoadModule('/src/services/storage/connectionProfiles.ts');
const runtime = await vite.ssrLoadModule('/src/services/connectionRuntime.ts');
const { obfuscatedStorage } = await vite.ssrLoadModule('/src/services/storage/secureStorage.ts');
const { STORAGE_KEY_AUTH } = await vite.ssrLoadModule('/src/utils/constants.ts');
const lifecycle = await vite.ssrLoadModule('/src/services/connectionSession.ts');
test.after(() => vite.close());
test.beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('partial browser mocks are not mistaken for managed connection frames', () => {
  const original = globalThis.window;
  try {
    for (const mock of [undefined, new EventTarget(), { location: { search: '' } }, { parent: {} }]) {
      globalThis.window = mock;
      assert.equal(runtime.isConnectionFrame(), false);
    }
    const top = { location: { search: '?cpa-session=synthetic' } };
    top.parent = top;
    globalThis.window = top;
    assert.equal(runtime.isConnectionFrame(), false);
    globalThis.window = { parent: {}, location: { search: '?cpa-session=synthetic' } };
    assert.equal(runtime.isConnectionFrame(), true);
  } finally {
    globalThis.window = original;
  }
});

test('legacy migration preserves opt-in and removes duplicate credential storage', () => {
  obfuscatedStorage.setItem(STORAGE_KEY_AUTH, {
    state: {
      apiBase: 'https://a.example.test',
      managementKey: 'synthetic-key',
      rememberPassword: true,
    },
    version: 1,
  });
  localStorage.setItem('isLoggedIn', 'true');
  profiles.migrateLegacyConnection();
  assert.equal(profiles.readProfiles().length, 1);
  assert.equal(profiles.readProfiles()[0].managementKey, 'synthetic-key');
  assert.equal(localStorage.getItem(STORAGE_KEY_AUTH), null);
  assert.equal(sessionStorage.getItem('isLoggedIn'), 'true');
  assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.managementKey, 'synthetic-key');
  profiles.migrateLegacyConnection();
  assert.equal(profiles.readProfiles().length, 1);
});

test('opt-out migration, forgetting and deleting never retain a saved key', () => {
  obfuscatedStorage.setItem(STORAGE_KEY_AUTH, {
    state: {
      apiBase: 'https://a.example.test',
      managementKey: 'synthetic-key',
      rememberPassword: false,
    },
  });
  profiles.migrateLegacyConnection();
  const profile = profiles.readProfiles()[0];
  assert.equal(profile.managementKey, undefined);
  profiles.saveProfile({ ...profile, managementKey: 'synthetic-key', rememberPassword: true });
  profiles.saveProfile({ ...profile, managementKey: '', rememberPassword: true });
  assert.equal(profiles.readProfiles()[0].managementKey, '');
  profiles.deleteProfile(profile.id);
  assert.deepEqual(profiles.readProfiles(), []);
});

test('handoff is consumed once and each tab restores its own profile', () => {
  const a = {
    id: 'a',
    name: 'A',
    apiBase: 'https://a.example.test',
    environment: '',
    rememberPassword: false,
  };
  const b = {
    ...a,
    id: 'b',
    name: 'B',
    apiBase: 'https://b.example.test',
    rememberPassword: true,
    managementKey: 'synthetic-b',
  };
  profiles.saveProfile(a);
  profiles.saveProfile(b);
  const tabA = sessionStorage;
  profiles.prepareHandoff(a, 'synthetic-a', '/usage');
  assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.managementKey, 'synthetic-a');
  assert.equal(sessionStorage.getItem('cpa-connection-handoff-v1'), null);
  assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.managementKey, '');
  globalThis.sessionStorage = storage();
  profiles.prepareHandoff(b, 'synthetic-b', '/config', 'a');
  assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.profileId, 'b');
  globalThis.sessionStorage = tabA;
  assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.profileId, 'a');
});

test('corrupt storage and expired handoff do not restore secrets', () => {
  localStorage.setItem(profiles.PROFILES_KEY, 'invalid');
  assert.deepEqual(profiles.readProfiles(), []);
  sessionStorage.setItem(profiles.TAB_SESSION_KEY, '{');
  assert.equal(profiles.tabAuthStorage.getItem(), null);
  const a = {
    id: 'a',
    name: 'A',
    apiBase: 'https://a.example.test',
    environment: '',
    rememberPassword: false,
  };
  profiles.saveProfile(a);
  profiles.tabAuthStorage.setItem(
    '',
    JSON.stringify({
      state: { profileId: a.id, apiBase: a.apiBase, rememberPassword: false },
      version: 1,
    })
  );
  profiles.prepareHandoff(a, 'synthetic', '/');
  sessionStorage.setItem(
    'cpa-connection-handoff-v1',
    JSON.stringify({ profileId: 'a', managementKey: 'expired', expiresAt: 0 })
  );
  assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.managementKey, '');
});

test('target URLs and route restoration exclude credentials and resource identities', () => {
  assert.throws(() => profiles.validateConnectionBase('https://user:secret@example.test'));
  assert.throws(() => profiles.validateConnectionBase('https://example.test/?key=secret'));
  assert.equal(lifecycle.safeSessionPath('/usage?source=a'), '/usage');
  assert.equal(lifecycle.safeSessionPath('/ai-providers/legacy/openai/2'), '/ai-providers');
  assert.equal(lifecycle.safeSessionPath('/plugin-pages/a/1'), '/core');
  assert.equal(lifecycle.safeSessionPath('//external.example'), '/core');
});

test('session leave guards and pending writes have explicit lifetimes', () => {
  const remove = lifecycle.registerSessionLeaveCheck(() => true);
  assert.equal(lifecycle.hasSessionChanges(), true);
  remove();
  assert.equal(lifecycle.hasSessionChanges(), false);
  const finish = lifecycle.beginSessionWrite();
  assert.equal(lifecycle.hasActiveWrites(), true);
  finish();
  assert.equal(lifecycle.hasActiveWrites(), false);
});

test('editing a shared profile address cannot send its new key to the old tab address', () => {
  const a = {
    id: 'a',
    name: 'A',
    apiBase: 'https://a.example.test',
    environment: '',
    rememberPassword: true,
    managementKey: 'synthetic-a',
  };
  profiles.saveProfile(a);
  profiles.prepareHandoff(a, 'synthetic-a', '/');
  profiles.tabAuthStorage.getItem();
  profiles.saveProfile({ ...a, apiBase: 'https://b.example.test', managementKey: 'synthetic-b' });
  const state = JSON.parse(profiles.tabAuthStorage.getItem()).state;
  assert.equal(state.apiBase, a.apiBase);
  assert.equal(state.managementKey, '');
});

test('handoff remains authoritative after old response callbacks or logout before reload', async () => {
  const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
  const target = {
    id: 'b',
    name: 'B',
    apiBase: 'https://b.example.test',
    environment: '',
    rememberPassword: false,
  };
  profiles.saveProfile(target);
  for (const lateAction of [
    () => useAuthStore.getState().updateServerVersion('old-A'),
    () => useAuthStore.getState().logout(),
  ]) {
    useAuthStore.setState({
      profileId: 'a',
      apiBase: 'https://a.example.test',
      managementKey: 'synthetic-a',
      rememberPassword: true,
      isAuthenticated: true,
    });
    profiles.prepareHandoff(target, 'synthetic-b', '/usage', 'a');
    lateAction();
    const restored = JSON.parse(profiles.tabAuthStorage.getItem()).state;
    assert.equal(restored.profileId, 'b');
    assert.equal(restored.apiBase, target.apiBase);
    assert.equal(restored.managementKey, 'synthetic-b');
    assert.equal(sessionStorage.getItem('isLoggedIn'), 'true');
    assert.equal(sessionStorage.getItem('cpa-session-path'), '/usage');
    assert.equal(sessionStorage.getItem('cpa-previous-profile'), 'a');
    assert.equal(sessionStorage.getItem('cpa-connection-handoff-v1'), null);
    assert.equal(JSON.parse(profiles.tabAuthStorage.getItem()).state.managementKey, '');
  }
});

for (const authorized of [true, false]) {
  test(`managed frame ${authorized ? 'uses its own in-memory credentials' : 'fails closed without a matching host session'}`, async () => {
    const previousWindow = globalThis.window;
    const isolated = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
    sessionStorage.setItem(profiles.TAB_SESSION_KEY, JSON.stringify({ state: { profileId: 'other-tab', managementKey: 'synthetic-other' }, version: 1 }));
    const original = sessionStorage.getItem(profiles.TAB_SESSION_KEY);
    globalThis.window = Object.assign(new EventTarget(), {
      location: { host: 'example.test', search: '?cpa-session=frame-a' },
      parent: { __cpaConnectionHost: {
        bootstrap: (id, source) => authorized && id === 'frame-a' && source === globalThis.window ? {
          profile: { id: 'a', name: 'A', apiBase: 'https://a.example.test', environment: '', rememberPassword: false },
          managementKey: 'synthetic-frame-a',
        } : null,
      } },
    });
    try {
      const module = await isolated.ssrLoadModule('/src/services/storage/connectionProfiles.ts');
      const runtime = await isolated.ssrLoadModule('/src/services/connectionRuntime.ts');
      const restored = module.tabAuthStorage.getItem();
      if (authorized) {
        assert.equal(JSON.parse(restored).state.profileId, 'a');
        assert.equal(JSON.parse(restored).state.managementKey, 'synthetic-frame-a');
        module.tabAuthStorage.setItem('', JSON.stringify({ state: { profileId: 'a' }, version: 1 }));
      } else assert.equal(restored, null);
      assert.equal(runtime.sessionWasLoggedIn(), authorized);
      runtime.setSessionLoggedIn(true);
      assert.equal(sessionStorage.getItem('isLoggedIn'), null);
      module.tabAuthStorage.removeItem();
      assert.equal(module.tabAuthStorage.getItem(), null);
      assert.equal(sessionStorage.getItem(profiles.TAB_SESSION_KEY), original);
    } finally {
      globalThis.window = previousWindow;
      await isolated.close();
    }
  });
}
