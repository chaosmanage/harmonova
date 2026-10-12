import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBackground} from './helpers/worker.mjs';
const send=(w,m,s={id:'test-extension-id',url:'chrome-extension://test-extension-id/ai-settings.html'})=>new Promise(r=>w.listeners.message(m,s,r));
test('P09 exact origins, operations, paths and methods are enforced before Fetch',async()=> {
  const calls=[];const w=loadBackground({fetchImpl:async(url)=> {calls.push(url);return new Response('{}',{headers:{'content-type':'application/json'}});}});
  for(const url of ['https://arbitrary.example/article','https://api.github.com/anything','https://api.github.com./repos/a/b','https://user:password@api.github.com/repos/a/b','https://api.github.com:8443/repos/a/b','https://127.0.0.1/repos/a/b','https://api.github.com/repos/a/b?x=1','https://xx.wikipedia.org/api/rest_v1/page/summary/Test'])await assert.rejects(w.context.fetchPolicy(url,{resourceKind:'richJson'}));
  assert.deepEqual(calls,[]);
  const r=await w.context.fetchPolicy('https://api.github.com/repos/a/b',{resourceKind:'richJson'});await w.context.readResponseTextLimited(r,100);
  assert.equal(calls.length,1);
  assert.equal(w.context.HarmoNovaProviderPolicy.allowed('https://openrouter.ai/api/v1/chat/completions','aiJson','GET'),false);
});
test('P09 previews start on; only extension options can change saved preference',async()=> {
  const calls=[];const w=loadBackground({fetchImpl:async url=>{calls.push(url);return new Response(JSON.stringify({title:'Allowed',extract:'Provider text',type:'standard'}),{headers:{'content-type':'application/json'}});}});
  const hn={id:'test-extension-id',url:'https://news.ycombinator.com/news',frameId:0,tab:{id:1}};
  assert.equal((await send(w,{type:'HARMONOVA_NETWORK_POLICY_GET'},hn)).policy.externalPreviewsEnabled,true);
  assert.equal((await send(w,{type:'HARMONOVA_NETWORK_POLICY_SAVE',policy:{version:1,externalPreviewsEnabled:true}},hn)).ok,false);
  assert.equal((await send(w,{type:'HARMONOVA_NETWORK_POLICY_SAVE',policy:{version:1,externalPreviewsEnabled:true}})).ok,true);
  const result=await w.context.getMetadata('https://en.wikipedia.org/wiki/Test',true);assert.equal(result.rich.provider,'wikipedia');assert.ok(calls.length>=1);const before=calls.length;
  await send(w,{type:'HARMONOVA_NETWORK_POLICY_SAVE',policy:{version:1,externalPreviewsEnabled:false}});
  await w.context.getMetadata('https://en.wikipedia.org/wiki/Other',true);assert.equal(calls.length,before);
});
test('P09 general websites are allowed but unsafe targets remain blocked',async()=> {
  const w=loadBackground({fetchImpl:()=>{throw new Error('NETWORK_FAILED');}});
  assert.equal(w.context.HarmoNovaProviderPolicy.allowed('https://unapproved.example/image.png','image'),true);
  for(const url of ['http://localhost/private','https://127.0.0.1/private','https://news.ycombinator.com/item?id=1'])
    await assert.rejects(w.context.fetchArticleText(url),/Unsupported|Hacker News/);
  await assert.rejects(w.context.fetchArticleText('https://arbitrary.example/article'),/REMOTE_FETCH_BLOCKED/);
  assert.equal(await w.context.sanitizedImage('https://unapproved.example/image.png'),null);
});
test('P09 release permissions support general websites but no local URL schemes',async()=> {
  const fs=await import('node:fs');const m=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url)));
  assert.deepEqual(m.host_permissions,['http://*/*','https://*/*']);
  assert.equal(m.permissions.includes('cookies'),false);
});
