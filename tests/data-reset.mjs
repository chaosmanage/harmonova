import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadBackground} from './helpers/worker.mjs';
const HN='https://news.ycombinator.com/news';
const sender={id:'test-extension-id',url:HN,origin:'https://news.ycombinator.com',
  frameId:0,tab:{id:14,url:HN,incognito:false}};
const send=(listeners,scope)=>new Promise(resolve=>listeners.message({type:'HARMONOVA_DATA_RESET',scope},sender,resolve));

test('scoped deletion preserves unrelated data and full deletion removes credentials and legacy backups',async()=>{
  const {context,stores,listeners}=loadBackground({fetchImpl:async()=>{throw Error('NO_NETWORK');}});
  const readerStore=vm.runInContext('readerStore',context);
  const preferencesStore=vm.runInContext('preferencesStore',context);
  await readerStore.markRead(910061);
  await readerStore.markSeen(910061,123456);
  await readerStore.setTag('alice','favorite');
  await readerStore.setBookmark(910061,true);
  await readerStore.setBlocked('someone',true);
  const draft=await readerStore.beginDraft('alice',910061);
  await readerStore.saveDraft('alice',910061,draft.token,0,'unsent');
  await preferencesStore.patch({notifyUpdates:false,uiTheme:'navy'});
  await context.saveNetworkPolicy({version:1,externalPreviewsEnabled:false});
  await context.saveAiKey('sk-synthetic-secret','persistent');
  await context.saveAiPolicy({...context.HarmoNovaAiPolicy.defaults,consentVersion:1,enabled:true});
  stores.local.harmonicLegacyBackup='old';
  stores.local.harmonicAiPolicyV1={enabled:true};
  stores.sync.harmonicSettings={notifyUpdates:false};
  stores.local.harmonovaReleaseStateV1={tag:'v0.16.0'};

  assert.equal((await send(listeners,'history')).ok,true);
  let r=await readerStore.stateSnapshot();
  assert.deepEqual(Array.from(r.readIds),[]);
  assert.deepEqual(Object.keys(r.seenTimes),[]);
  assert.equal(r.tags.alice,'favorite');
  assert.equal((await readerStore.beginDraft('alice',910061)).text,'unsent');
  assert.equal((await preferencesStore.snapshot()).settings.notifyUpdates,false);

  assert.equal((await send(listeners,'saved')).ok,true);
  r=await readerStore.stateSnapshot();
  assert.deepEqual(Array.from(r.bookmarks),[]);
  assert.deepEqual(Object.keys(r.tags),[]);
  assert.deepEqual(Array.from(r.blockedUsers),[]);
  assert.equal((await readerStore.beginDraft('alice',910061)).text,'');
  assert.equal((await preferencesStore.snapshot()).settings.uiTheme,'navy');

  assert.equal((await send(listeners,'settings')).ok,true);
  assert.equal((await preferencesStore.snapshot()).settings.notifyUpdates,true);
  assert.equal((await preferencesStore.snapshot()).settings.uiTheme,'amoled');
  assert.equal((await context.currentNetworkPolicy()).externalPreviewsEnabled,true);
  assert.equal((await context.currentAiPolicy()).enabled,false);
  assert.equal(stores.local.harmonicAiPolicyV1,undefined,'legacy AI consent cannot revive');
  assert.equal((await context.aiKeyStatus()).hasKey,true,'settings reset should not silently erase a credential');

  await readerStore.markRead(910061);
  await readerStore.setTag('alice','again');
  assert.equal((await send(listeners,'all')).ok,true);
  r=await readerStore.stateSnapshot();
  assert.deepEqual(Array.from(r.readIds),[]);
  assert.deepEqual(Object.keys(r.tags),[]);
  assert.equal(r.pageOriginMigrated,true,'old page data must not migrate back in');
  assert.equal((await context.aiKeyStatus()).hasKey,false);
  assert.equal(stores.local.harmonicLegacyBackup,undefined);
  assert.equal(stores.sync.harmonicSettings,undefined);
  assert.equal(stores.local.harmonovaReleaseStateV1,undefined);
  assert.deepEqual(Object.keys(stores.local).filter(key=>key.toLowerCase().includes('apikey')),[]);
  assert.equal((await preferencesStore.snapshot()).settings.notifyUpdates,true);
});
