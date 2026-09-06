import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTypeScript} from './testLoader.mjs';
const m=loadTypeScript('model.ts'),i=loadTypeScript('insights.ts'),{FlowSSEDecoder}=loadTypeScript('sse.ts');
const key='a'.repeat(64),account='b'.repeat(64);
const rule={id:'r',stage:'attempt',scope:'custom','group-by':['key','account'],models:['m1','m2'],'max-concurrent':3};
const values=rules=>({...m.FLOW_DEFAULT_VALUES,flowControlEnabled:true,flowControlVersion:'3',flowControlRulesText:JSON.stringify(rules)});
test('all eight main projections are configurable without a second account object',()=>{
 for(let mask=0;mask<8;mask++){const dims=['key','model','account'].filter((_,n)=>mask&(1<<n));assert.deepEqual(m.flowIssues(values([{...rule,'group-by':dims}])),[]);}
 assert(m.flowIssues(values([{...rule,'group-by':['credential']}] )).some(x=>x.code==='migrate_required'));
 assert(m.flowIssues(values([{...rule,credential:account}])).some(x=>x.code==='migrate_required'));
});
test('model collections require v3, empty does not mean all and incompatible scalar is rejected',()=>{
 assert(m.flowIssues({...values([rule]),flowControlVersion:'2'}).some(x=>x.code==='v3_required'));
 for(const models of [[],['*'],['p::'],['::m'],['m*bad']])assert(m.flowIssues(values([{...rule,models}])).length);
 assert(m.flowIssues(values([{...rule,model:'other'}])).some(x=>x.code==='selection_conflict'));
 assert.deepEqual(m.flowIssues(values([{...rule,models:undefined}])),[]);
});
test('explicit selection edits remove old scalars and preserve unrelated fields',()=>{
 const old={...rule,models:undefined,model:'m1',future:{keep:1}};
 const multi=m.setSelection(old,'models',['m1','m2','m1']);assert.deepEqual(multi.models,['m1','m2']);assert.equal(multi.model,undefined);assert.equal(multi.future,old.future);
 const all=m.setSelection(multi,'models',undefined);assert.equal(all.models,undefined);assert.equal(m.selectionOf(all,'models'),undefined);
 assert.deepEqual(m.selectionOf(m.setSelection(multi,'models',[]),'models'),[]);assert.equal(old.model,'m1');
});
test('one Auth reference list; caller selectors are distinct',()=>{
 const r={...rule,keys:[key],accounts:[account]};assert.deepEqual(m.flowIssues(values([r])),[]);
 const sentence=i.ruleSentence(r,{keys:[{ref:key,label:'Caller A'}],accounts:[{ref:account,label:'auth.json'}]},'en');
 assert(sentence.includes('Caller A'));assert(sentence.includes('auth.json'));assert(sentence.includes('Separately per'));assert(!sentence.includes('credential'));
});
test('shared and independent model counters are described differently in four locales',()=>{
 for(const locale of ['zh-CN','zh-TW','en','ru']){
 const shared=i.ruleSentence({...rule,'group-by':[]},{keys:[],accounts:[]},locale),separate=i.ruleSentence({...rule,'group-by':['model']},{keys:[],accounts:[]},locale);
 assert.notEqual(shared,separate);assert(shared.includes('m1'));assert(separate.includes('m2'));
 }
 assert.equal(i.scenarioRules,undefined);assert.equal(i.matchesRule,undefined);assert.equal(i.explainDraft,undefined);
});
test('observation defaults are off, bounded and independent of flow enabled',()=>{
 assert.equal(m.FLOW_DEFAULT_VALUES.flowControlRealtime,false);assert.equal(m.FLOW_DEFAULT_VALUES.flowControlResources,false);
 for(const [field,value] of [['flowControlIntervalMs','499'],['flowControlIntervalMs','30001'],['flowControlMaxObservers','17']])assert(m.flowIssues({...values([]),flowControlEnabled:false,[field]:value}).length);
 assert.deepEqual(m.flowIssues({...values([]),flowControlIntervalMs:'2000',flowControlMaxObservers:'4'}),[]);
});
test('zero waiting duration is a valid immediate-rejection v3 choice',()=>{
 assert.deepEqual(m.flowIssues({...values([rule]),flowControlMaxWaiting:'10',flowControlMaxWaitMs:'0'}),[]);
});
test('missing custom group array from JSON denotes a shared v3 total',()=>{
 assert.deepEqual(m.flowIssues(values([{...rule,'group-by':undefined}])),[]);
});
test('migration merges unknown fields, removes obsolete selectors and does not enable automatically',()=>{
 const merged=m.mergeMigration([{...rule,model:'old',credential:account,oldUnknown:'keep'}],[{...rule,models:['m1','m2'],accounts:[account]}]);
 assert.equal(merged[0].oldUnknown,'keep');assert.equal(merged[0].credential,undefined);assert.equal(merged[0].model,undefined);
 assert.equal(m.policyFromValues({...values(merged),flowControlEnabled:false}).enabled,false);
});
test('actual model references keep provider separate and request stage rejects provider selection',()=>{
 assert.deepEqual(m.identityForModel({stage:'attempt',key},'p::m'),{stage:'attempt',key,provider:'p',model:'m'});
 assert(m.flowIssues(values([{...rule,stage:'request','group-by':['key'],models:['p::m']}])).length);
});
test('fresh rules are generic with no model, rate window or special scenario values',()=>{
 const fresh=m.nextRule([]);assert.equal(fresh.models,undefined);assert.equal(fresh.windows,undefined);assert.equal(fresh['max-concurrent'],0);assert.equal(m.nextRule([fresh]).id,'rule-2');
});
test('server evaluations are preserved rather than recomputed in JavaScript',()=>{
 const row={identity:{stage:'attempt',model:'m2'},complete:false,'can-start':false,'policy-revision':3,'sampled-at':'fixture',draft:true,matches:[{rule,known:false,active:0,delta:1,remaining:null,'blocked-by':[],unresolved:['draft-policy']}]};
 const rows=m.readExplanations({results:[row]});assert.equal(rows[0].matches[0].known,false);assert.equal(rows[0].matches[0].remaining,null);assert.equal(m.readExplanations({results:[{}]}),null);
});
const state={'active-requests':1,'active-attempts':1,waiting:2,'queued-bytes':30,'sampled-at':'2026-09-06T00:00:00Z','process-id':'p','policy-revision':2};
test('schema 3 summary does not need activity or bucket arrays',()=>{
 assert(m.parseFlowEvent({'schema-version':3,state}));
 const parsed=m.parseFlowCapabilities({'schema-version':3,supported:true,state,policy:{version:3,enabled:true,rules:[rule]},'events-supported':true,'events-enabled':false});
 assert.equal(parsed.state.policy.version,3);assert.deepEqual(parsed.state.buckets,[]);assert.equal(m.canObserveLive(parsed),false);
 assert.equal(m.canObserveLive({...parsed,'events-enabled':true}),true);assert.equal(m.canObserveLive({...parsed,'events-enabled':true,'schema-version':2}),false);
});
test('summary refresh keeps catalogs/policy but never resurrects request detail polling',()=>{
 const old={...state,policy:{enabled:true,rules:[rule]},buckets:[],activity:[{id:'secret-detail'}]};const merged=m.mergeSummary(old,{...state,waiting:3});assert.equal(merged.policy,old.policy);assert.equal(merged.activity,undefined);assert.equal(merged.waiting,3);
});
test('SSE handles every chunk split, Unicode and CRLF',()=>{
 const frame='id: x\r\nevent: snapshot\r\ndata: {"label":"模型"}\r\n\r\n';for(let n=0;n<=frame.length;n++){const events=[],d=new FlowSSEDecoder(v=>events.push(v));d.feed(frame.slice(0,n));d.feed(frame.slice(n));assert.deepEqual(events,[{label:'模型'}]);}
});
test('server-disabled event is explicit; heartbeat and unrelated events are ignored',()=>{
 const events=[],d=new FlowSSEDecoder(v=>events.push(v),256);d.feed(': heartbeat\n\nevent: disabled\ndata: {"realtime-disabled":true}\n\nevent: other\ndata: 1\n\n');assert.deepEqual(events,[{'realtime-disabled':true}]);
 assert.throws(()=>new FlowSSEDecoder(()=>{},80).feed('a'.repeat(81)));assert.throws(()=>new FlowSSEDecoder(()=>{}).feed('event: snapshot\ndata: invalid\n\n'));
});
test('fingerprints reflect scope/filter semantics but ignore labels and selection order',()=>{
 assert.equal(i.policyFingerprint([rule]),i.policyFingerprint([{...rule,label:'new',models:['m2','m1'],'group-by':['account','key']}]));
 assert.notEqual(i.policyFingerprint([rule]),i.policyFingerprint([{...rule,'group-by':['model']}]));
});
