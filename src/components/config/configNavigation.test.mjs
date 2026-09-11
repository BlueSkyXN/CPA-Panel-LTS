import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createServer } from 'vite';
import i18next from 'i18next';

const vite = await createServer({ appType:'custom', logLevel:'silent', server:{middlewareMode:true} });
test.after(()=>vite.close());
const nav = await vite.ssrLoadModule('/src/components/config/configNavigation.ts');
const { DEFAULT_VISUAL_VALUES } = await vite.ssrLoadModule('/src/types/visualConfig.ts');
const resources = {};
for (const locale of ['en','zh-CN','zh-TW','ru']) {
  const shared=JSON.parse(fs.readFileSync(new URL(`../../i18n/locales/${locale}.json`,import.meta.url)));
  const lts=JSON.parse(fs.readFileSync(new URL(`../../lts/i18n/${locale}.lts.json`,import.meta.url)));
  const merge=(a,b)=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])].map(key=>[key,
    a[key] && b[key] && typeof a[key]==='object' && typeof b[key]==='object' && !Array.isArray(b[key]) ? merge(a[key],b[key]) : b[key] ?? a[key]]));
  resources[locale]={translation:merge(shared,lts)};
}
const i18n=i18next.createInstance(); await i18n.init({lng:'zh-CN',resources,fallbackLng:'en'});

test('nine domains own every editable field once, excluding only internal compatibility fields',()=>{
  const expected=Object.keys(DEFAULT_VISUAL_VALUES).filter(f=>!['streaming','flowControlVersion','codexAbnormalReasoningRetryEnabled'].includes(f));
  expected.push(...Object.keys(DEFAULT_VISUAL_VALUES.streaming).map(f=>`streaming.${f}`));
  const owned=nav.CONFIG_DOMAINS.flatMap(d=>d.pages.flatMap(p=>p.fields));
  assert.equal(nav.CONFIG_DOMAINS.length,9);
  assert.equal(new Set(owned).size,owned.length);
  assert.deepEqual([...owned].sort(),expected.sort());
  assert.deepEqual(Object.keys(nav.CONFIG_FIELDS).sort(),expected.sort());
  for(const id of owned) assert.equal(nav.locateConfigField(id).field,id);
});
test('legacy directory aliases preserve valid destinations without inventing fields',()=>{
  for(const [section,subsection,target] of [
    ['server','server-tls',['service','listener']],['auth','auth-credentials',['service','credentials']],
    ['system','headers',['headers','claude']],['system','runtime',['operations','runtime']],
    ['system','network',['routing','connection']],['system','plugins',['plugins','runtime']],
    ['quota',null,['routing','fallback']],['streaming',null,['routing','streaming']],
    ['payload','payload-overrides',['payload','overrides']],
  ]){
    const actual=nav.resolveConfigLocation(section,subsection); assert.deepEqual([actual.section,actual.subsection],target);assert.equal(actual.migrated,true);
  }
  assert.deepEqual(nav.resolveConfigLocation('unknown','invalid','not-a-field'),nav.DEFAULT_CONFIG_LOCATION);
  assert.equal(nav.resolveConfigLocation('codex-policy','hedging','invalid').subsection,'hedging');
  assert.equal(nav.resolveConfigLocation('operations','runtime','codexAbnormalReasoningRetryHedgeDelayMs').subsection,'hedging');
});
test('local search finds Chinese, English and exact YAML keys without receiving values',()=>{
  for(const [query,field] of [['对冲延迟','codexAbnormalReasoningRetryHedgeDelayMs'],['hedge-delay-ms','codexAbnormalReasoningRetryHedgeDelayMs'],['Redis 保留时间','redisUsageQueueRetentionSeconds'],['图像生成','disableImageGeneration']]) assert.equal(nav.searchConfigFields(query,i18n.t)[0]?.field,field);
  assert.deepEqual(nav.searchConfigFields('sk-not-part-of-the-static-catalogue',i18n.t),[]);
  assert.deepEqual(nav.searchConfigFields('  ',i18n.t),[]);
});
test('navigation metadata resolves in all four languages',()=>{
  for(const locale of Object.keys(resources)){
    const t=i18n.getFixedT(locale);
    for(const key of [...Object.values(nav.CONFIG_FIELDS).map(f=>f.labelKey),...nav.CONFIG_DOMAINS.flatMap(d=>[nav.domainLabelKey(d.id),...d.pages.map(p=>nav.pageLabelKey(d.id,p.id))])]){
      assert.equal(i18n.exists(key,{lng:locale,fallbackLng:false}),true,`${locale}: ${key}`);assert.notEqual(t(key),key);
    }
  }
});
test('only same-config navigation parameters bypass dirty-route protection',()=>{
  const current={pathname:'/config',search:'?section=operations&other=1',hash:''};
  assert.equal(nav.isConfigNavigationChange(current,{...current,search:'?other=1&section=codex-policy&subsection=hedging&field=codexAbnormalReasoningRetryHedgeDelayMs'}),true);
  for(const next of [{...current,pathname:'/login'},{...current,search:'?other=2'},{...current,hash:'#changed'}])assert.equal(nav.isConfigNavigationChange(current,next),false);
});

test('all pages provide localized task guidance and shared decision help', () => {
  const helpKeys = ['editor_help', 'reading', 'hedging_needs_retry', 'hedging_off', 'hedging_ready', 'open_scope', 'buffer_warning', 'default_reference'];
  for (const locale of Object.keys(resources)) {
    const guidance = resources[locale].translation.config_management.editor.guidance;
    assert.deepEqual(Object.keys(guidance.pages).sort(), nav.CONFIG_DOMAINS.map(d => d.id).sort());
    for (const domain of nav.CONFIG_DOMAINS) {
      assert.deepEqual(Object.keys(guidance.pages[domain.id]).sort(), domain.pages.map(p => p.id).sort());
      for (const page of domain.pages) assert.ok(guidance.pages[domain.id][page.id].length > 15);
    }
    for (const key of helpKeys) assert.ok(guidance[key]?.length, `${locale}: ${key}`);
    assert.ok(guidance.default_reference.includes('{{value}}'));
  }
  assert.equal(nav.CONFIG_FIELDS.codexAbnormalReasoningRetryHedgeDelayMs.defaultReference, '1000 ms');
  assert.equal(nav.CONFIG_FIELDS.codexAbnormalReasoningRetryMaxRetries.defaultReference, '2');
});
