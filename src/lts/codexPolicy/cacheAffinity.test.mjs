import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createElement, useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nextProvider} from 'react-i18next';
import i18next from 'i18next';
import {parse} from 'yaml';
import {createServer} from 'vite';

const vite = await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
test.after(()=>vite.close());
const {useVisualConfig} = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const {DEFAULT_VISUAL_VALUES} = await vite.ssrLoadModule('/src/types/visualConfig.ts');
const {useCodexPolicyControls} = await vite.ssrLoadModule('/src/lts/codexPolicy/useCodexPolicyControls.tsx');
const {readCodexCacheAffinity} = await vite.ssrLoadModule('/src/lts/codexPolicy/cacheAffinity.ts');

function editYaml(source, patch, target=source) {
  let result;
  function Harness(){
    const config=useVisualConfig();const [phase,setPhase]=useState(0);
    if(phase===0){config.loadVisualValuesFromYaml(source);setPhase(1);}
    else if(phase===1){config.setVisualValues(patch);setPhase(2);}
    else {result={yaml:config.applyVisualChangesToYaml(target),values:config.visualValues,dirty:config.visualDirtyFields};}
    return null;
  }
  renderToStaticMarkup(createElement(Harness));return result;
}

for(const strategy of ['client-aware','stable-id','legacy']) {
  test(`select ${strategy}: update only strategy, keep unknown fields and comments`,()=>{
    const source='codex:\n  cache-affinity:\n    strategy: future-mode # retained-comment\n    future-limit: 7\n  unrelated: preserve\n';
    const result=editYaml(source,{codexCacheAffinityStrategy:strategy});
    assert.equal(parse(result.yaml).codex['cache-affinity'].strategy,strategy);
    assert.equal(parse(result.yaml).codex['cache-affinity']['future-limit'],7);
    assert.equal(parse(result.yaml).codex.unrelated,'preserve');
    assert.ok(result.yaml.includes('retained-comment'));
    assert.equal(editYaml(result.yaml,{}).values.codexCacheAffinityStrategy,strategy);
  });
  test(`${strategy} survives unrelated and sibling Codex edits`,()=>{
    const source=`debug: false\ncodex:\n  cache-affinity:\n    strategy: ${strategy}\n`;
    for(const patch of [{debug:true},{codexIdentityConfuse:true},{codexAbnormalReasoningRetryAction:'retry'}]) {
      assert.equal(parse(editYaml(source,patch).yaml).codex['cache-affinity'].strategy,strategy);
    }
  });
}

test('missing or empty value uses implicit default without writing strategy',()=>{
  for(const source of ['debug: false\n','codex:\n  cache-affinity:\n    strategy: ""\n','codex:\n  cache-affinity: null\n']) {
    const before=parse(source);const result=editYaml(source,{debug:true});
    assert.equal(result.values.codexCacheAffinityStrategy,'');
    assert.deepEqual(parse(result.yaml).codex,before.codex);
    assert.ok(!result.dirty.has('codexCacheAffinityStrategy'));
  }
});
test('editing another setting keeps latest server cache strategy',()=>{
  const source='codex:\n  cache-affinity:\n    strategy: legacy\n';
  const latest=source.replace('legacy','stable-id');
  assert.equal(parse(editYaml(source,{debug:true},latest).yaml).codex['cache-affinity'].strategy,'stable-id');
});
test('unknown strategy remains unknown and is preserved until explicitly edited',()=>{
  const source='codex:\n  cache-affinity:\n    strategy: future-mode\n';
  const result=editYaml(source,{debug:true});
  assert.equal(result.values.codexCacheAffinityStrategy,'future-mode');
  assert.equal(parse(result.yaml).codex['cache-affinity'].strategy,'future-mode');
  assert.throws(()=>editYaml(source,{codexCacheAffinityStrategy:'bad-new-mode'}),error=>error.code==='visual_apply_failed');
  assert.equal(readCodexCacheAffinity({strategy:42}),'__unsupported__');
  assert.equal(readCodexCacheAffinity('malformed'),'__unsupported__');
  assert.equal(readCodexCacheAffinity({strategy:' CLIENT-AWARE '}),'client-aware');
});
test('editing aliased Codex mappings fails safely rather than discarding siblings',()=>{
  for(const source of ['base: &cfg {cache-affinity: {strategy: legacy}, preserved: true}\ncodex: *cfg\n','base: &cfg {strategy: legacy, preserved: true}\ncodex:\n  cache-affinity: *cfg\n']) {
    assert.throws(()=>editYaml(source,{codexCacheAffinityStrategy:'stable-id'}),error=>error.code==='visual_apply_failed');
  }
});

for(const locale of ['zh-CN','zh-TW','en','ru']) {
  test(`${locale}: user-facing modes, default/unknown state and upstream cache explanation`,async()=>{
    const catalog=JSON.parse(fs.readFileSync(new URL(`../i18n/${locale}.lts.json`,import.meta.url)));
    const instance=i18next.createInstance();await instance.init({lng:locale,resources:{[locale]:{translation:catalog}}});
    function render(strategy,disabled=false){
      function Harness(){return useCodexPolicyControls({values:{...DEFAULT_VISUAL_VALUES,codexCacheAffinityStrategy:strategy},disabled,onChange:()=>{}}).codexCacheAffinityStrategy;}
      return renderToStaticMarkup(createElement(I18nextProvider,{i18n:instance},createElement(Harness)));
    }
    const strings=catalog.codex_cache_affinity;
    const implicit=render('');assert.ok(implicit.includes(strings.default_hint));
    assert.equal((implicit.match(/type="radio"/g)||[]).length,3);
    assert.equal((implicit.match(/checked=""/g)||[]).length,1);
    for(const mode of ['client-aware','stable-id','legacy']) assert.ok(implicit.includes(strings.options[mode].label));
    const unknown=render('future-mode');assert.ok(unknown.includes(strings.unknown_hint));assert.ok(!unknown.includes('checked=""'));
    assert.ok(render('legacy').includes(strings.troubleshooting_hint));
    assert.ok(render('legacy',true).includes('disabled=""'));
    assert.ok(!implicit.includes('codex_cache_affinity.'));
  });
}
