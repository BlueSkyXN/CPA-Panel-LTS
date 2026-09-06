import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { loadTypeScript } from './testLoader.mjs';
const m=loadTypeScript('model.ts');
const values=(rules,extra={})=>({...m.FLOW_DEFAULT_VALUES,flowControlEnabled:true,flowControlRulesText:JSON.stringify(rules),...extra});
const rule=(extra={})=>({id:'r1',stage:'request',scope:'key-model','max-concurrent':2,...extra});
test('missing config remains disabled without new queue defaults',()=>{
 assert.deepEqual(m.readFlowControlValues({}),m.FLOW_DEFAULT_VALUES);
 assert.deepEqual(m.flowControlValidation(values([rule({stage:'future'})]),new Set(['port'])),{});
});
test('disabled malformed future rules can be retained and disabled',()=>{
 const v=m.readFlowControlValues({'flow-control':{enabled:false,rules:{future:1}}});
 assert.deepEqual(JSON.parse(v.flowControlRulesText),{future:1});
 assert.deepEqual(m.flowIssues(v),[]);
 assert.deepEqual(m.flowControlValidation(v,new Set(['flowControlEnabled'])),{});
});
test('all required dimensions and stage boundaries',()=>{
 for(const scope of m.FLOW_SCOPES){
  assert.deepEqual(m.flowIssues(values([rule({stage:'attempt',scope,...(scope==='custom'?{'group-by':['key','model']}: {})})])),[]);
  if(['provider','account','account-model'].includes(scope))assert(m.flowIssues(values([rule({scope})])).length);
 }
});
test('multiple request windows compose, exact or explicit prefix selectors',()=>{
 assert.deepEqual(m.flowIssues(values([rule({model:'gpt-*',windows:[{requests:6,'period-ms':1000},{requests:60,'period-ms':60000}]})])),[]);
 for(const model of ['*gpt','gpt*foo','gpt**','abc\nx'])assert(m.flowIssues(values([rule({model})])).length);
});
test('opaque key refs accepted, plaintext secrets rejected',()=>{
 for(const key of ['', '*','anonymous','a'.repeat(64)])assert.deepEqual(m.flowIssues(values([rule({key})])),[]);
 for(const key of ['sk-raw-secret','API Key 1','a'.repeat(63)])assert(m.flowIssues(values([rule({key})])).length);
});
test('bounded queue numbers, wait and per-key capacity',()=>{
 const v=values([rule()],{flowControlMaxWaiting:'4',flowControlMaxWaitMs:'15000',flowControlMaxWaitingPerKey:'2'});
 assert.deepEqual(m.flowIssues(v),[]);
 for(const patch of [{flowControlMaxWaitingPerKey:'5'},{flowControlMaxWaitMs:'0'},{flowControlMaxWaitMs:'300001'},{flowControlMaxBytes:'4294967297'},{flowControlMaxWaiting:'-1'}])assert(m.flowIssues({...v,...patch}).length);
});
test('rule ids and windows validated without changing saved values',()=>{
 assert(m.flowIssues(values([rule(),rule()])).some(i=>i.code==='invalid_id'));
 assert(m.flowIssues(values([rule({'max-concurrent':0})])).some(i=>i.code==='empty_limit'));
 assert(m.flowIssues(values([rule({windows:[{requests:1,'period-ms':1000},{requests:2,'period-ms':1000}]})])).some(i=>i.code==='invalid_windows'));
 const v=m.readFlowControlValues({'flow-control':{enabled:true,rules:[rule({future:{a:1}})]}});
 assert.deepEqual(m.parseRules(v.flowControlRulesText)[0].future,{a:1});
});
test('new rule receives unused stable id',()=>{
 assert.equal(m.nextRule([rule({id:'rule-1'}),rule({id:'rule-3'})]).id,'rule-2');
});
test('capability parser rejects old/unrelated Core response and filters raw refs',()=>{
 assert.equal(m.parseFlowCapabilities({modes:['legacy']}),null);
 const raw={'schema-version':1,supported:true,state:{'active-requests':0,'active-attempts':1,waiting:2,'queued-bytes':100,buckets:[]},keys:[{ref:'secret',label:'bad'},{ref:'a'.repeat(64),label:'Key 1'}]};
 assert.equal(m.parseFlowCapabilities(raw).keys.length,1);
 assert.equal(m.parseFlowCapabilities({...raw,state:{...raw.state,waiting:-1}}),null);
});
test('all four locales have matching feature keys and no empty values',()=>{
 const locales=['en','zh-CN','zh-TW','ru'].map(lang=>JSON.parse(fs.readFileSync(new URL(`../i18n/${lang}.lts.json`,import.meta.url))));
 const keys=Object.keys(locales[0].flow_control).sort();
 for(const locale of locales){assert.deepEqual(Object.keys(locale.flow_control).sort(),keys);for(const value of Object.values(locale.flow_control))assert(value.trim());}
});
