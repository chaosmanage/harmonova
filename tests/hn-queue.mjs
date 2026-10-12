import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const c=vm.createContext({AbortController,Promise,Date,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(new URL('../hn-queue.js',import.meta.url),'utf8'),c);
const options={operationKind:'read',expectedIdentity:'alice:1',timeoutMs:25};
const make=(execute,extra={})=>c.HarmoNovaHnQueue.create({execute,identity:()=> 'alice:1',now:()=>Date.now()+100000,sleep:async()=>{},...extra});
test('P11 hung request releases queue; ambiguous mutation is sent once',async()=> {
  let calls=0;const q=make(async path=>{calls++;return path==='/vote'?new Promise(()=>{}):'next';});
  const hung=q.add('/vote',{...options,operationKind:'mutation'});const next=q.add('/news',options);
  await assert.rejects(hung,e=>e.status==='indeterminate');assert.equal(await next,'next');assert.equal(calls,2);
});
test('P11 stale account and handle are checked at dispatch after queue spacing',async()=> {
  let account='alice:1',unblock,calls=0;
  const q=make(async path=>{calls++;if(path==='/news')return new Promise(r=>unblock=r);return 'mutated';},{identity:()=>account});
  const first=q.add('/news',options);const action=q.add('/fave',{...options,operationKind:'mutation'});
  await Promise.resolve();account='bob:2';unblock('read');await first;
  await assert.rejects(action,e=>e.code==='STALE_ACCOUNT');assert.equal(calls,1);
  const stale=make(async()=>{throw new Error('MUST_NOT_SEND');},{validCredential:()=>false});
  await assert.rejects(stale.add('/comment',{...options,operationKind:'mutation'}),e=>e.code==='STALE_ACCOUNT');
});
test('P11 pending queue is bounded, cancellation removes jobs and dispose releases all consumers',async()=> {
  const q=make(()=>new Promise(()=>{}));const first=q.add('/news',options).catch(e=>e);
  const pending=[];for(let i=0;i<50;i++)pending.push(q.add('/item',options).catch(e=>e));
  assert.equal(q.depth,50);await assert.rejects(q.add('/overflow',options),e=>e.code==='QUEUE_FULL');
  q.dispose();await first;await Promise.all(pending);assert.equal(q.depth,0);
  const canceled=make(()=>new Promise(()=>{}));const hold=canceled.add('/news',options).catch(()=>{});
  const controller=new AbortController();const read=canceled.add('/item',{...options,signal:controller.signal});controller.abort();
  await assert.rejects(read,e=>e.code==='REQUEST_CANCELLED');assert.equal(canceled.depth,0);canceled.dispose();await hold;
});
test('P11 disposal and deep/large public data fail without recursively rendering',async()=> {
  const realm=vm.createContext({AbortController});vm.runInContext(fs.readFileSync(new URL('../lifecycle.js',import.meta.url),'utf8'),realm);
  const module=realm.HarmoNovaLifecycle;const scope=module.create();let cleaned=0;scope.own(()=>cleaned++);scope.dispose();scope.dispose();assert.equal(cleaned,1);assert.equal(scope.signal.aborted,true);
  let tree={children:[]};for(let i=0;i<70;i++)tree={children:[tree]};assert.throws(()=>module.validateTree(tree),/deeply/);
  assert.throws(()=>module.validateTree(new Array(5001)),/Too many/);
});
