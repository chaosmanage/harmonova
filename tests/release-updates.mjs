import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({AbortSignal,TextDecoder});
vm.runInContext(fs.readFileSync(new URL('../src/release-updates.js',import.meta.url),'utf8'),context);
const {create,newer}=context.HarmoNovaReleaseUpdates;
test('GitHub versions compare numerically and reject invalid versions',()=>{
  assert.equal(newer('v0.15.0','0.14.9'),true);
  assert.equal(newer('0.9.0','0.14.0'),false);
  assert.equal(newer('v0.14.0','0.14.0'),false);
  assert.equal(newer('v0.15.0-beta','0.14.0'),false);
  assert.equal(newer('https://evil.example','0.14.0'),false);
});
test('release notices are bounded, ignorable and disabled without fetching',async()=>{
  const store={};let requests=0,announcements=0;
  const module=create({
    installedVersion:'0.14.0',
    localGet:async()=>store,localSet:async values=>Object.assign(store,values),
    fetchRelease:async(url,options)=>{
      requests++;
      assert.equal(url,'https://api.github.com/repos/chaosmanage/harmonova/releases/latest');
      assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
      return new Response(JSON.stringify({tag_name:'v0.15.0',draft:false,prerelease:false}),
        {status:200,headers:{'Content-Type':'application/json'}});
    },
    onAvailable:async()=>{announcements++;}
  });
  assert.equal((await module.status()).available,false);
  assert.equal((await module.check(false)).available,false);
  assert.equal(requests,0,'opt-out prevents all release fetches');
  const checked=await module.check();
  assert.equal(checked.available,true);
  assert.equal(checked.tag,'v0.15.0');
  assert.equal(checked.url,'https://github.com/chaosmanage/harmonova/releases/latest');
  assert.equal((await module.status()).available,true);
  assert.equal(announcements,1);
  assert.equal((await module.ignore('v0.999.0')).ok,false);
  assert.equal((await module.ignore('v0.15.0')).ok,true);
  assert.equal((await module.status()).available,false);
  assert.equal((await module.check()).available,false);
  assert.equal(announcements,1,'same release is not reannounced');
  assert.equal(requests,2);
});

test('manual update check ignores notification preferences and dismissed tags',async()=>{
  const store={};let requests=0,announcements=0,tag='v0.15.0';
  const module=create({
    installedVersion:'0.14.0',
    localGet:async()=>store,localSet:async values=>Object.assign(store,values),
    fetchRelease:async()=>{
      requests++;
      return new Response(JSON.stringify({tag_name:tag,draft:false,prerelease:false}),
        {status:200,headers:{'Content-Type':'application/json'}});
    },
    onAvailable:async()=>{announcements++;}
  });
  assert.equal((await module.check(false)).available,false,'automatic opt-out still blocks fetch');
  assert.equal(requests,0);
  assert.equal((await module.checkNow()).tag,'v0.15.0');
  assert.equal(announcements,0,'manual check must not generate a notification');
  await module.ignore('v0.15.0');
  assert.equal((await module.status()).available,false,'ignored version stays dismissed');
  assert.equal((await module.checkNow()).available,true,'manual check still reports ignored version');
  tag='v0.14.0';
  assert.equal((await module.checkNow()).available,false,'matching version is up to date');
  assert.equal(requests,3);
});
test('manual update check reports failed and malformed responses instead of up to date',async()=>{
  let fail=true;
  const module=create({
    installedVersion:'0.14.0',localGet:async()=>({}),localSet:async()=>{},
    fetchRelease:async()=>fail ? new Response('unavailable',{status:503,headers:{'Content-Type':'text/plain'}})
      : new Response(JSON.stringify({tag_name:'unexpected'}),{status:200,headers:{'Content-Type':'application/json'}})
  });
  assert.equal((await module.checkNow()).ok,false);
  fail=false;
  assert.equal((await module.checkNow()).ok,false);
  assert.equal((await module.check()).ok,true,'automatic checks silently tolerate failure');
});
