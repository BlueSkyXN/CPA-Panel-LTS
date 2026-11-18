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
