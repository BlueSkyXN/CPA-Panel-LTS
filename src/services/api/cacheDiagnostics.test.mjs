import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const previousWindow = globalThis.window;
globalThis.window = new EventTarget();
globalThis.window.location={host:'cache-test.invalid'};
const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const {captureCacheDiagnosticsClient}=await vite.ssrLoadModule('/src/services/api/cacheDiagnostics.ts');
const {ltsExtensionClient:client}=await vite.ssrLoadModule('/src/services/api/client.ts');
const originalCapture=client.captureConnection;
test.after(async()=>{client.captureConnection=originalCapture;await vite.close();globalThis.window=previousWindow;});
test('connection ABA invalidates a pending diagnostic response',async()=>{
 let finish;
 client.captureConnection=()=>({get:()=>new Promise(resolve=>{finish=resolve;})});
 client.setConfig({apiBase:'https://one.invalid',managementKey:'synthetic'});
 const captured=captureCacheDiagnosticsClient();const pending=captured.trace('a'.repeat(64));
 client.setConfig({apiBase:'https://two.invalid',managementKey:'synthetic'});
 client.setConfig({apiBase:'https://one.invalid',managementKey:'synthetic'});
 finish({version:1,id:'a'.repeat(64),events:[],attempts:[]});
 assert.equal(await pending,null);assert.equal(captured.isCurrent(),false);
});
test('session query sends explicit scope and record and performs no mutation call',async()=>{
 let call;
 client.captureConnection=()=>({post:async(path,body)=>{call={path,body};return {status:'unbound',bindings:[]};}});
 await captureCacheDiagnosticsClient().session('codex','model','b'.repeat(64),'a'.repeat(64));
 assert.deepEqual(call,{path:'/cache-diagnostics/session',body:{provider:'codex',model:'model',session_hash:'b'.repeat(64),diagnostics_id:'a'.repeat(64)}});
});

test('trace lookup sends scoped parameters and drops results after connection ABA', async () => {
  let finish;
  let request;
  client.captureConnection = () => ({ get: (path, config) => {
    request = { path, params: config.params };
    return new Promise(resolve => { finish = resolve; });
  } });
  const query = { instance_id: 'instance-one', kind: 'pck', digest: 'a'.repeat(64), scope: 'b'.repeat(64) };
  client.setConfig({ apiBase: 'https://one.invalid', managementKey: 'synthetic' });
  const pending = captureCacheDiagnosticsClient().traces(query);
  assert.deepEqual(request, { path: '/cache-diagnostics/traces', params: query });
  client.setConfig({ apiBase: 'https://two.invalid', managementKey: 'synthetic' });
  client.setConfig({ apiBase: 'https://one.invalid', managementKey: 'synthetic' });
  finish({ version: 1, current_instance_id: 'instance-one', items: [], history_included: true });
  assert.equal(await pending, null);
});

test('capabilities preserves valid store active count and ignores invalid values', async () => {
  client.setConfig({ apiBase: 'https://one.invalid', managementKey: 'synthetic' });
  client.captureConnection = () => ({
    get: async () => ({
      version: 1,
      trace_search_version: 1,
      store: { instance_id: 'instance-one', active: 7 },
    }),
  });
  const valid = await captureCacheDiagnosticsClient().capabilities();
  assert.deepEqual(valid.store, { instance_id: 'instance-one', active: 7 });

  client.captureConnection = () => ({
    get: async () => ({
      version: 1,
      trace_search_version: 1,
      store: { instance_id: 'instance-one', active: -1 },
    }),
  });
  const invalid = await captureCacheDiagnosticsClient().capabilities();
  assert.deepEqual(invalid.store, { instance_id: 'instance-one' });
});
