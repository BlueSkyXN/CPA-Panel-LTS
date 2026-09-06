// Requires the repository's actual React/Vite dependencies. This is NOT a stub
// renderer and is intentionally not included in isolated dependency-free tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const originalWindow=globalThis.window;
const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const storage=new Map();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
globalThis.window=new EventTarget();globalThis.window.matchMedia=()=>({matches:false,media:'',addEventListener(){},removeEventListener(){}});
const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const [{FlowControlFieldsView:View},{LiveMonitor},models,i18nModule]=await Promise.all([
 vite.ssrLoadModule('/src/lts/flowControl/FlowControlFields.tsx'),vite.ssrLoadModule('/src/lts/flowControl/LiveMonitor.tsx'),
 vite.ssrLoadModule('/src/lts/flowControl/model.ts'),vite.ssrLoadModule('/src/i18n/index.ts')]);
await i18nModule.default.changeLanguage('zh-CN');
const key='a'.repeat(64),account='b'.repeat(64);
const rules=[{id:'shared-a',stage:'attempt',scope:'custom','group-by':['key','account'],keys:[key],accounts:[account],models:['model-a','model-b'],'max-concurrent':3},{id:'per-model',stage:'attempt',scope:'custom','group-by':['key','account','model'],models:['model-a','model-b'],'max-concurrent':2}];
const state={enabled:true,'active-requests':2,'active-attempts':3,waiting:1,'queued-bytes':42,buckets:[],admitted:4,rejected:0,'timed-out':0,canceled:0,waited:1,truncated:false,'blocked-by-rule':{},'sampled-at':'2026-09-06T00:00:00Z','process-id':'sample-process','policy-revision':1,policy:{version:3,enabled:true,rules},'oldest-wait-ms':2500};
const data={'schema-version':3,supported:true,keys:[{ref:key,label:'调用方 A'}],accounts:[{ref:account,label:'oauth-file.json',provider:'codex','auth-kind':'oauth'}],credentials:[],models:['model-a','model-b'],'model-options':[{ref:'codex::model-a',model:'model-a',provider:'codex'}],state,'events-supported':true,'events-enabled':false,'events-interval-ms':2000,'explain-supported':true};
const render=(support,version='3')=>renderToStaticMarkup(createElement(View,{values:{...models.FLOW_DEFAULT_VALUES,flowControlEnabled:true,flowControlVersion:version,flowControlRulesText:JSON.stringify(rules)},support,onChange(){},onRefresh(){}}));
test.after(async()=>{await vite.close();if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;});
test('generic selector shows model sets, one auth object and grouping choices',()=>{
 const html=render({state:'ready',data});for(const text of ['调用方 A','oauth-file.json','合计共享','各自计数','model-a','model-b'])assert(html.includes(text),text);
 assert(!html.includes('1 / 5 / 5 / 3 / 4'));assert(!html.includes('场景向导'));assert(!html.includes('scenario'));
});
test('summary defaults to manual and does not SSR-render hidden request details',()=>{
 const html=renderToStaticMarkup(createElement(LiveMonitor,{data:{...data,state:{...state,activity:[{id:'must-not-render'}]}},live:false,setLive(){},liveState:'off',history:[],onRefresh(){}}));
 assert(!html.includes('must-not-render'));assert(html.includes('按需查看请求详情'));assert(html.includes('不会自动轮询'));
});
test('old Core cannot edit version 3 collection settings',()=>{
 const html=render({state:'ready',data:{...data,'schema-version':2}});assert(html.includes('disabled'));assert(html.includes('需要支持 V3'));
});
test('legacy rules require an explicit migration preview before editing',()=>{
 const html=render({state:'ready',data},'2');assert(html.includes('旧规则迁移预览'));assert(html.includes('读取迁移建议'));assert(!html.includes('value="model-a"'));
});
test('resource metrics are labeled process-wide and unavailable space remains unknown',()=>{
 const resource={'sampled-at':'fixture','heap-object-bytes':2000,'go-managed-bytes':8000,goroutines:2,'filesystem-free-bytes':null,'filesystem-sampled-at':'fixture'};
 const html=renderToStaticMarkup(createElement(LiveMonitor,{data:{...data,state:{...state,resources:resource}},live:false,setLive(){},liveState:'off',history:[],onRefresh(){}}));assert(html.includes('进程级'));assert(html.includes('不是 RSS'));assert(html.includes('?'));
});

test('fresh disabled configuration exposes normal editor without migration',()=>{
 const html=renderToStaticMarkup(createElement(View,{values:models.readFlowControlValues({}),support:{state:'ready',data},onChange(){},onRefresh(){}}));
 assert(html.includes('草稿开关与实际开关'));assert(!html.includes('读取迁移建议'));
});

test('last-good failure is shown without disabling a supported editor',()=>{
 const html=render({state:'ready',data:{...data,'configuration-error':true,'configuration-failure':{code:'flow_control_rate_domain_change',message:'Retained history example',rule:'shared-a'}}});
 assert(html.includes('Retained history example'));assert(html.includes('上一次成功'));
});
