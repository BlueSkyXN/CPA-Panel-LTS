// Requires the repository's real locked yaml dependency; do not substitute a mock.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { loadTypeScript } from './testLoader.mjs';
const {writeFlowControlValues}=loadTypeScript('yaml.ts');
const m=loadTypeScript('model.ts');
const raw=`# Keep global comment
port: 8317
codex:
  client-metadata:
    mode: repair
    workspace-policy: passthrough
flow-control:
  enabled: true
  future-field: keep
  queue:
    max-waiting: 4 # Queue comment
    max-wait-ms: 1000
  rules:
    # Rule comment
    - id: r1
      stage: request
      scope: key-model
      max-concurrent: 2 # Limit comment
      future-rule: keep
      windows:
        - requests: 10 # Window comment
          period-ms: 60000
`;
test('unrelated save is byte-for-byte unchanged',()=>{
 const doc=parseDocument(raw);const before=String(doc);writeFlowControlValues(doc,m.readFlowControlValues(doc.toJSON()),new Set(['port']));assert.equal(String(doc),before);
});
test('single rule edit reuses comments, future fields and client metadata settings',()=>{
 const doc=parseDocument(raw);const v=m.readFlowControlValues(doc.toJSON());const rules=m.parseRules(v.flowControlRulesText);rules[0]['max-concurrent']=3;
 writeFlowControlValues(doc,{...v,flowControlRulesText:JSON.stringify(rules)},new Set(['flowControlRulesText']));
 const out=String(doc);for(const text of ['Keep global comment','Rule comment','Limit comment','Window comment','future-rule: keep','future-field: keep','mode: repair'])assert(out.includes(text),text);
 assert.equal(doc.toJSON()['flow-control'].rules[0]['max-concurrent'],3);
});
test('disable leaves malformed draft unchanged',()=>{
 const doc=parseDocument('flow-control:\n  enabled: true\n  rules: future\n');const v=m.readFlowControlValues(doc.toJSON());
 writeFlowControlValues(doc,{...v,flowControlEnabled:false},new Set(['flowControlEnabled']));
 assert.equal(doc.toJSON()['flow-control'].rules,'future');assert.equal(doc.toJSON()['flow-control'].enabled,false);
});
test('adds dedicated block without duplicate roots; deletion of rule intentional',()=>{
 const doc=parseDocument('port: 8317\n');const v={...m.FLOW_DEFAULT_VALUES,flowControlEnabled:true,flowControlMaxWaiting:'3',flowControlMaxWaitMs:'1000',flowControlRulesText:JSON.stringify([m.nextRule([])])};
 writeFlowControlValues(doc,v,new Set(m.FLOW_FIELDS));
 assert.equal(doc.toJSON().port,8317);assert.equal(doc.toJSON()['flow-control'].queue['max-waiting'],3);
 writeFlowControlValues(doc,{...v,flowControlRulesText:'[]'},new Set(['flowControlRulesText']));assert.deepEqual(doc.toJSON()['flow-control'].rules,[]);
});

test('deleting a window does not transplant another window future fields',()=>{
 const doc=parseDocument('flow-control:\n  rules:\n    - id: r1\n      stage: request\n      scope: key\n      max-concurrent: 1\n      windows:\n        - requests: 2\n          period-ms: 1000\n          future-a: do-not-copy\n        - requests: 20 # keep survivor\n          period-ms: 60000\n          future-b: keep\n');
 const v=m.readFlowControlValues(doc.toJSON());const rules=m.parseRules(v.flowControlRulesText);rules[0].windows.shift();
 writeFlowControlValues(doc,{...v,flowControlRulesText:JSON.stringify(rules)},new Set(['flowControlRulesText']));
 const w=doc.toJSON()['flow-control'].rules[0].windows[0];assert.equal(w['future-a'],undefined);assert.equal(w['future-b'],'keep');assert(String(doc).includes('keep survivor'));
});

test('v2 custom dimensions and upstream credential are saved without erasing UA or unknown keys',()=>{
 const doc=parseDocument(raw);const v=m.readFlowControlValues(doc.toJSON());const rules=m.parseRules(v.flowControlRulesText);
 rules[0]={...rules[0],stage:'attempt',scope:'custom','group-by':['key','model','credential'],credential:'c'.repeat(64),'auth-kind':'oauth',label:'用户 × 模型 × 认证文件'};
 writeFlowControlValues(doc,{...v,flowControlRulesText:JSON.stringify(rules)},new Set(['flowControlRulesText']));
 const written=doc.toJSON()['flow-control'].rules[0];assert.deepEqual(written['group-by'],['key','model','credential']);assert.equal(written.credential,'c'.repeat(64));assert.equal(written['auth-kind'],'oauth');
 assert.equal(doc.toJSON().codex['client-metadata'].mode,'repair');assert.equal(doc.toJSON().codex['client-metadata']['workspace-policy'],'passthrough');assert.equal(written['future-rule'],'keep');assert(String(doc).includes('Rule comment'));
});

test('v3 model sets remove obsolete scalar fields but preserve surrounding YAML',()=>{
 const doc=parseDocument(raw);const v=m.readFlowControlValues(doc.toJSON());const rules=m.parseRules(v.flowControlRulesText);
 doc.setIn(['flow-control','rules',0,'model'],'model-a');
 rules[0]={...rules[0],scope:'custom','group-by':[],models:['model-a','model-b']};
 writeFlowControlValues(doc,{...v,flowControlVersion:'3',flowControlRulesText:JSON.stringify(rules)},new Set(['flowControlVersion','flowControlRulesText']));
 const flow=doc.toJSON()['flow-control'];assert.equal(flow.version,3);assert.equal(flow.rules[0].model,undefined);assert.deepEqual(flow.rules[0].models,['model-a','model-b']);assert.deepEqual(flow.rules[0]['group-by'],[]);assert.equal(flow.rules[0]['future-rule'],'keep');assert(String(doc).includes('Limit comment'));
});
test('choosing all removes only the targeted collection, not other rule fields',()=>{
 const doc=parseDocument(raw);const v=m.readFlowControlValues(doc.toJSON());doc.setIn(['flow-control','rules',0,'models'],['model-a']);
 const rules=m.parseRules(v.flowControlRulesText);writeFlowControlValues(doc,{...v,flowControlRulesText:JSON.stringify(rules)},new Set(['flowControlRulesText']));
 assert.equal(doc.toJSON()['flow-control'].rules[0].models,undefined);assert.equal(doc.toJSON()['flow-control'].rules[0]['future-rule'],'keep');
});
test('observation edits preserve legacy rule syntax and client metadata settings',()=>{
 const doc=parseDocument(raw);const v=m.readFlowControlValues(doc.toJSON());writeFlowControlValues(doc,{...v,flowControlRealtime:true,flowControlResources:false,flowControlIntervalMs:'5000'},new Set(['flowControlRealtime','flowControlResources','flowControlIntervalMs']));
 const flow=doc.toJSON()['flow-control'];assert.equal(flow.observation.realtime,true);assert.equal(flow.observation.resources,false);assert.equal(flow.observation['interval-ms'],5000);assert.equal(flow.rules[0].scope,'key-model');assert.equal(doc.toJSON().codex['client-metadata'].mode,'repair');assert.equal(doc.toJSON().codex['client-metadata']['workspace-policy'],'passthrough');
});

test('first Flow edit stamps V3 only when the existing policy is empty', () => {
 const doc=parseDocument('port: 8317 # keep\n'); const v=m.readFlowControlValues(doc.toJSON());
 writeFlowControlValues(doc,{...v,flowControlResources:true},new Set(['port']));
 assert.equal(doc.toJSON()['flow-control'],undefined);
 writeFlowControlValues(doc,{...v,flowControlResources:true},new Set(['flowControlResources']));
 assert.equal(doc.toJSON()['flow-control'].version,3);
 assert.equal(doc.toJSON()['flow-control'].enabled,undefined);
 assert.equal(doc.toJSON()['flow-control'].observation.resources,true);
 assert(String(doc).includes('# keep'));
});

test('editing observation never silently upgrades a populated legacy policy', () => {
 const doc=parseDocument(raw);const v=m.readFlowControlValues(doc.toJSON());
 writeFlowControlValues(doc,{...v,flowControlRealtime:true},new Set(['flowControlRealtime']));
 assert.equal(doc.toJSON()['flow-control'].version,undefined);
 assert.equal(doc.toJSON()['flow-control'].rules[0].id,'r1');
});
