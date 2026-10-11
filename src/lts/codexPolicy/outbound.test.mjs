import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createElement, useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parse} from 'yaml';
import {createServer} from 'vite';

const vite = await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
test.after(()=>vite.close());
const {useVisualConfig} = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const {readCodexOutbound} = await vite.ssrLoadModule('/src/lts/codexPolicy/outbound.ts');

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

test('setting transport writes only codex.outbound.transport and keeps siblings and comments',()=>{
  const source='codex:\n  cache-affinity:\n    strategy: legacy # keep-me\n  outbound:\n    future-knob: 3\n';
  const result=editYaml(source,{codexOutboundTransport:'auto',codexOutboundWebsocketThresholdBytes:'524288'});
  const codex=parse(result.yaml).codex;
  assert.deepEqual(codex.outbound,{'future-knob':3,transport:'auto','websocket-threshold-bytes':524288});
  assert.equal(codex['cache-affinity'].strategy,'legacy');
  assert.ok(result.yaml.includes('keep-me'));
  const reloaded=editYaml(result.yaml,{}).values;
  assert.equal(reloaded.codexOutboundTransport,'auto');
  assert.equal(reloaded.codexOutboundWebsocketThresholdBytes,'524288');
});

test('absent outbound keys read as Core defaults and unrelated edits write nothing',()=>{
  const source='debug: false\ncodex:\n  identity-confuse: false\n';
  const result=editYaml(source,{debug:true});
  assert.equal(result.values.codexOutboundTransport,'');
  assert.equal(result.values.codexOutboundRequestCompression,'');
  assert.equal(result.values.codexOutboundAcceptEncoding,'');
  assert.equal(parse(result.yaml).codex.outbound,undefined);
});

test('compression and Accept-Encoding round-trip; clearing a value removes only that key',()=>{
  const source='codex:\n  outbound:\n    transport: auto\n';
  const set=editYaml(source,{codexOutboundRequestCompression:'none',codexOutboundAcceptEncoding:'legacy'});
  assert.deepEqual(parse(set.yaml).codex.outbound,{transport:'auto','request-compression':'none','accept-encoding':'legacy'});
  const cleared=editYaml(set.yaml,{codexOutboundRequestCompression:'',codexOutboundAcceptEncoding:'',codexOutboundTransport:''});
  assert.equal(parse(cleared.yaml)?.codex?.outbound,undefined);
});

test('unknown values stay untouched until edited; invalid edits fail safely',()=>{
  const source='codex:\n  outbound:\n    transport: future-mode\n    accept-encoding: br\n';
  const result=editYaml(source,{debug:true});
  assert.equal(result.values.codexOutboundTransport,'future-mode');
  assert.equal(parse(result.yaml).codex.outbound.transport,'future-mode');
  assert.equal(parse(result.yaml).codex.outbound['accept-encoding'],'br');
  assert.throws(()=>editYaml(source,{codexOutboundTransport:'grpc'}),error=>error.code==='visual_apply_failed');
  assert.throws(()=>editYaml('debug: false\n',{codexOutboundWebsocketThresholdBytes:'-1'}),error=>error.code==='visual_apply_failed');
  assert.equal(readCodexOutbound('malformed').transport,'__unsupported__');
  assert.equal(readCodexOutbound({transport:' AUTO '}).transport,'auto');
  assert.equal(readCodexOutbound({transport:7}).transport,'__unsupported__');
});

test('aliased Codex mappings fail safely instead of discarding anchors',()=>{
  const source='base: &cfg {outbound: {transport: auto}, preserved: true}\ncodex: *cfg\n';
  assert.throws(()=>editYaml(source,{codexOutboundTransport:'websocket'}),error=>error.code==='visual_apply_failed');
});

for(const locale of ['zh-CN','zh-TW','en','ru']) {
  test(`${locale}: outbound labels, options and hints exist`,()=>{
    const catalog=JSON.parse(fs.readFileSync(new URL(`../i18n/${locale}.lts.json`,import.meta.url)));
    const block=catalog.codex_outbound;
    assert.ok(block.unknown_hint);
    for(const [group,options] of [['transport',['follow','websocket','auto']],['request_compression',['auto','none']],['accept_encoding',['official','legacy']]]) {
      assert.ok(block[group].title && block[group].default_hint, `${group} title/default`);
      for(const option of options) assert.ok(block[group].options[option].label && block[group].options[option].description, `${group}.${option}`);
    }
    assert.ok(block.threshold.label && block.threshold.hint);
    assert.ok(catalog.config_management.editor.pages['codex-policy_outbound']);
    assert.ok(catalog.config_management.editor.guidance.pages['codex-policy'].outbound);
  });
}
