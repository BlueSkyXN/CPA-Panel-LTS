import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: {middlewareMode:true} });
const { readCacheObservation, decodeCacheTrace, decodeCacheSession, compareCachePayloads } = await vite.ssrLoadModule('/src/utils/usage/cacheDiagnostics.ts');
test.after(() => vite.close());
const absent = {state:'absent'};
const obs = (read) => ({version:1,read,write:absent});
test('cache provenance distinguishes explicit zero, absence, invalid and legacy', () => {
 assert.equal(readCacheObservation(obs({state:'present',value:0,source:'input_tokens_details.cached_tokens'})).read.value,0);
 assert.equal(readCacheObservation(obs(absent)).read.state,'absent');
 assert.equal(readCacheObservation(obs({state:'invalid'})).read.state,'invalid');
 assert.equal(readCacheObservation(undefined),undefined);
 for (const value of [-1,0.5,'0',null,Number.MAX_SAFE_INTEGER+1]) assert.equal(readCacheObservation(obs({state:'present',value})),undefined);
 assert.equal(readCacheObservation(obs({state:'absent',value:0})),undefined);
});
const field = (char) => ({ digest:char.repeat(64) });
const body = (fields) => ({known:true,bytes:123,fields});
test('posthoc comparison is bounded JSON evidence, never a match decision', () => {
 const a=body({input:field('a'),reasoning:field('b')});
 const b=body({input:field('a'),reasoning:field('c'),prompt_cache_key:field('d')});
 assert.deepEqual(compareCachePayloads(a,b),['prompt_cache_key','reasoning']);
 assert.equal(compareCachePayloads({...a,known:false},b),null);
});

test('local comparison retains Chat, Claude and Gemini content digests', () => {
 for (const key of ['messages','system','contents','systemInstruction','system_instruction','generationConfig','generation_config','thinking','reasoning_effort','request']) {
  const trace = (digest) => decodeCacheTrace({version:1,id:'a'.repeat(64),instance_id:'instance-A',events:[],attempts:[],input:body({model:field('a'),[key]:field(digest)})});
  const before = trace('b');
  const after = trace('c');
  assert.equal(before.input.known,true);
  assert.deepEqual(compareCachePayloads(before.input,after.input),[key]);
 }
});
test('decoding retains instance, decision, execution and per-attempt absence independently', () => {
 const raw={version:1,id:'a'.repeat(64),instance_id:'instance-A',events:[{sequence:1,decision_id:'decision-A',layer:'account',result:'selected'}],attempts:[{number:1,execution_id:'execution-A',decision_id:'decision-A',status:503,request:body({input:field('a')})},{number:2,execution_id:'execution-B',decision_id:'decision-B',status:200,request:body({input:field('b')}),cache_observation:obs(absent),diagnostic_returned:true,diagnostic:{type:'unavailable'}}]};
 const decoded=decodeCacheTrace(raw);
 assert.equal(decoded.instance_id,'instance-A');
 assert.equal(decoded.attempts[0].cache_observation,undefined);
 assert.equal(decoded.attempts[1].cache_observation.read.state,'absent');
 assert.equal(decoded.attempts[1].decision_id,'decision-B');
 assert.equal(decoded.attempts[1].diagnostic.type,'unavailable');
 assert.equal(decodeCacheTrace({...raw,version:2}),null);
 assert.equal(decodeCacheTrace({...raw,events:Array(130).fill(raw.events[0])}).truncated,true);
 assert.equal(decodeCacheTrace({...raw,attempts:[{request:body({input:{digest:'bad'}})}]}).attempts[0].request.known,false);
});
test('current OAuth snapshot stays separate from historical decision evidence', () => {
 const result=decodeCacheSession({instance_id:'instance-A',status:'bound',bindings:[],oauth:{status:'available',rows:[{kind:'oauth_trajectory',group_hash:'g',expired:true}]}});
 assert.equal(result.instance_id,'instance-A');
 assert.equal(result.oauth.rows[0].expired,true);
 assert.equal(result.status,'bound');
});

test('both usage collectors retain field provenance and diagnostic correlation', async () => {
 const {collectUsageDetails,collectUsageDetailsWithEndpoint}=await vite.ssrLoadModule('/src/utils/usage.ts');
 const detail={timestamp:'2026-01-01T00:00:00Z',source:'synthetic',auth_index:'A',tokens:{input_tokens:100,total_tokens:100},request_id:'execution-A',diagnostics_id:'a'.repeat(64),diagnostics_instance_id:'instance-A',cache_observation:obs(absent)};
 const snapshot={apis:{endpoint:{models:{model:{details:[detail]}}}}};
 for(const collect of [collectUsageDetails,collectUsageDetailsWithEndpoint]){
  const [row]=collect(snapshot);
  assert.equal(row.diagnostics_id,detail.diagnostics_id);
  assert.equal(row.diagnostics_instance_id,'instance-A');
  assert.equal(row.request_id,'execution-A');
  assert.equal(row.cache_observation.read.state,'absent');
 }
});

test('import preflight rejects contradictory cache evidence without inventing old provenance', async () => {
 const {analyzeUsageImport}=await vite.ssrLoadModule('/src/utils/usage/importPreflight.ts');
 const detail={timestamp:'2026-01-01T00:00:00Z',source:'synthetic',auth_index:'A',tokens:{input_tokens:100,output_tokens:1,reasoning_tokens:0,cached_tokens:0,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:101},failed:false};
 const envelope=(observation)=>({version:3,usage:{apis:{endpoint:{models:{model:{details:[{...detail,...(observation ? {cache_observation:observation}: {})}]}}}}}});
 assert.equal(analyzeUsageImport(envelope(obs(absent))).valid,true);
 assert.equal(analyzeUsageImport(envelope()).valid,true);
 assert.equal(analyzeUsageImport(envelope(obs({state:'absent',value:0}))).valid,false);
 assert.equal(analyzeUsageImport(envelope(obs({state:'present',value:0,source:'x'.repeat(97)}))).valid,false);
});
