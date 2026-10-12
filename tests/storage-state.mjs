import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../reader-store.js", import.meta.url), "utf8");
function storeFixture() {
  const memory = { local: {}, session: {} };
  let failNext = false;
  const make = area => ({
    get: async defaults => ({ ...defaults, ...structuredClone(memory[area]) }),
    set: async data => {
      if (failNext) { failNext = false; throw new Error("QUOTA_EXCEEDED"); }
      Object.assign(memory[area], structuredClone(data));
    },
  });
  const local = make("local"), session = make("session");
  const makeReader = () => {
    const ctx = vm.createContext({ TextEncoder, structuredClone, Date, Math, Promise });
    vm.runInContext(source, ctx);
    return ctx.HarmoNovaReaderStore.create({
      localGet: local.get, localSet: local.set, sessionGet: session.get, sessionSet: session.set,
    });
  };
  return { memory, makeReader, failOnce: () => { failNext = true; } };
}
const plain = value => JSON.parse(JSON.stringify(value));

test("P05 distinct concurrent drafts both survive", async () => {
  const f = storeFixture(), repo = f.makeReader();
  const [a,b] = await Promise.all([repo.beginDraft("alice", 1), repo.beginDraft("alice", 2)]);
  const outcomes = await Promise.all([
    repo.saveDraft("alice", 1, a.token, 0, "first"),
    repo.saveDraft("alice", 2, b.token, 0, "second"),
  ]);
  assert.ok(outcomes.every(o => o.ok));
  assert.equal((await repo.beginDraft("alice", 1)).text, "first");
  assert.equal((await repo.beginDraft("alice", 2)).text, "second");
});

test("P05 stale draft save cannot resurrect post/clear", async () => {
  const f = storeFixture(), repo = f.makeReader();
  const d = await repo.beginDraft("alice", 99);
  assert.equal((await repo.saveDraft("alice", 99, d.token, 0, "draft")).ok, true);
  assert.equal((await repo.clearDraft("alice", 99, d.token)).ok, true);
  assert.equal((await repo.saveDraft("alice", 99, d.token, 1, "resurrection")).code, "STALE_DRAFT");
  assert.equal((await repo.beginDraft("alice", 99)).text, "");
  const e = await repo.beginDraft("alice", 99);
  await repo.clearAccountDrafts("alice");
  assert.equal((await repo.saveDraft("alice", 99, e.token, 0, "late")).code, "STALE_DRAFT");
});

test("P05 same draft competing writers see explicit revision conflict", async () => {
  const repo = storeFixture().makeReader();
  const [a,b] = await Promise.all([repo.beginDraft("alice", 1), repo.beginDraft("alice", 1)]);
  assert.equal((await repo.saveDraft("alice", 1, a.token, 0, "A")).ok, true);
  assert.equal((await repo.saveDraft("alice", 1, b.token, 0, "B")).code, "DRAFT_CONFLICT");
  assert.equal((await repo.beginDraft("alice", 1)).text, "A");
});

test("P05 idempotent cross-tab state mutations preserve concurrent changes", async () => {
  const repo = storeFixture().makeReader();
  await Promise.all([repo.setBookmark(1, true), repo.setBookmark(2, true),
    repo.markRead(9), repo.markRead(10)]);
  const before = await repo.stateSnapshot();
  await repo.setBookmark(1, true);
  await repo.markRead(10);
  const after = await repo.stateSnapshot();
  assert.deepEqual(plain(after.bookmarks), [1, 2]);
  assert.deepEqual(plain(after.readIds), [9, 10]);
  assert.equal(after.revision, before.revision);
  await repo.importData({ bookmarks: [3, 1], readStoryIds: [11, 10] });
  assert.deepEqual(plain((await repo.stateSnapshot()).bookmarks), [1, 2, 3]);
});

test("P05 failed write reports failure and does not poison subsequent mutation", async () => {
  const f = storeFixture(), repo = f.makeReader();
  await repo.stateSnapshot();
  f.failOnce();
  await assert.rejects(repo.setBookmark(7, true), /QUOTA_EXCEEDED/);
  assert.equal((await repo.stateSnapshot()).bookmarks.length, 0);
  assert.equal((await repo.setBookmark(8, true)).ok, true);
  assert.deepEqual(plain((await repo.stateSnapshot()).bookmarks), [8]);
});

test("P05 worker restart expires composer tokens but preserves durable clear markers", async () => {
  const f = storeFixture(), old = f.makeReader();
  const d = await old.beginDraft("alice", 7);
  await old.clearDraft("alice", 7, d.token);
  const fresh = f.makeReader();
  assert.equal((await fresh.saveDraft("alice", 7, d.token, 0, "stale")).code, "STALE_DRAFT");
  assert.equal((await fresh.beginDraft("alice", 7)).text, "");
  assert.equal((await fresh.setBookmark(99, true)).ok, true);
  assert.equal((await fresh.setBookmark(99, true)).changed, false);
});

test("P05 simultaneous original-tab creations and removal do not overwrite IDs", async () => {
  const repo = storeFixture().makeReader();
  await Promise.all([repo.setOriginalTab(1, true), repo.setOriginalTab(2, true),
    repo.setOriginalTab(3, true)]);
  await Promise.all([repo.setOriginalTab(2, false), repo.setOriginalTab(4, true)]);
  assert.deepEqual(plain(await repo.getOriginalTabs()), [1, 3, 4]);
});

function preferenceFixture({sync={},local={}}={}) {
  const ctx=vm.createContext({TextEncoder,Promise});
  for(const file of ['settings-schema.js','preferences-store.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
  let failLocal=false,failSync=false;
  const make=()=>ctx.HarmoNovaPreferencesStore.create({get:async()=>structuredClone(local),set:async v=>{if(failLocal)throw new Error('LOCAL_FAILED');Object.assign(local,structuredClone(v));},syncGet:async()=>structuredClone(sync),syncSet:async v=>{if(failSync)throw new Error('SYNC_QUOTA');Object.assign(sync,structuredClone(v));}});
  return {ctx,make,local,sync,failLocal:()=>failLocal=true,failSync:()=>failSync=true};
}
test('P10 old/current cosmetic keys normalize; current values win and AI never migrates as consent',async()=> {
  for(const sync of [{},{harmonicSettings:{uiTheme:'navy',aiEnabled:true}},{harmonovaSettings:{uiTheme:'charcoal'}},{harmonicSettings:{uiTheme:'navy'},harmonovaSettings:{uiTheme:'charcoal',constructor:'x',aiEnabled:true}}]) {
    const f=preferenceFixture({sync});const before=await f.make().snapshot();
    assert.equal(before.settings.uiTheme,sync.harmonovaSettings?.uiTheme||sync.harmonicSettings?.uiTheme||'amoled');
    assert.equal(before.settings.aiEnabled,undefined);assert.equal(Object.hasOwn(before.settings,'constructor'),false);
  }
});
test('P10 concurrent field patches preserve independent changes and migration is one-time',async()=> {
  const f=preferenceFixture({sync:{harmonovaSettings:{uiTheme:'navy'}}}),p=f.make();
  await Promise.all([p.patch({storyTextSize:19}),p.patch({commentTextSize:16})]);
  await p.migrate({uiTheme:'charcoal',uiFont:'serif',aiEnabled:true});
  await p.migrate({uiTheme:'amoled',uiFont:'system'});
  const current=await p.snapshot();assert.equal(current.settings.uiTheme,'navy');assert.equal(current.settings.uiFont,'serif');assert.equal(current.settings.storyTextSize,19);assert.equal(current.settings.commentTextSize,16);
  assert.equal((await f.make().snapshot()).settings.uiFont,'serif');
});
test('P10 failed migration preserves source; sync quota failure retains local recovery',async()=> {
  const legacy={harmonicSettings:{uiTheme:'navy'}};const failed=preferenceFixture({sync:structuredClone(legacy)});failed.failLocal();
  await assert.rejects(failed.make().migrate({uiTheme:'charcoal'}),/LOCAL_FAILED/);assert.deepEqual(failed.sync,legacy);assert.equal(failed.local.harmonovaPreferencesV1,undefined);
  const recover=preferenceFixture();recover.failSync();const result=await recover.make().patch({uiTheme:'charcoal'});
  assert.equal(result.ok,true);assert.equal(result.syncSaved,false);assert.equal((await recover.make().snapshot()).settings.uiTheme,'charcoal');
});
test('P10 unknown, prototype, invalid range and oversized fields cannot become preferences',async()=> {
  const f=preferenceFixture(),p=f.make();
  for(const fields of [{aiEnabled:true},{externalPreviewsEnabled:true},{storyTextSize:1000},{hiddenDomains:'x'.repeat(2001)},JSON.parse('{"__proto__":{}}')])await assert.rejects(p.patch(fields),/INVALID_PREFERENCES/);
  assert.equal(f.local.harmonovaPreferencesV1,undefined);
});
test('P10 reader migration survives failure, preserves new values and ignores recreated sources',async()=> {
  const f=storeFixture(),p=f.makeReader();await p.setTag('alice','new');
  f.failOnce();await assert.rejects(p.migratePageData({tags:{alice:'old',bob:'legacy'},blockedUsers:[],seenTimes:{'1':4}}));
  assert.equal((await p.stateSnapshot()).pageOriginMigrated,false);
  await p.migratePageData({tags:{alice:'old',bob:'legacy'},blockedUsers:[],seenTimes:{'1':4}});
  const current=await p.stateSnapshot();assert.equal(current.tags.alice,'new');assert.equal(current.tags.bob,'legacy');
  await p.migratePageData({tags:{alice:'recreated'},blockedUsers:[],seenTimes:{}});assert.equal((await p.stateSnapshot()).tags.alice,'new');
  await assert.rejects(p.importData({bookmarks:[],readStoryIds:[],userTags:JSON.parse('{"__proto__":"x"}')}),/INVALID_IMPORT/);
});
test('P10 newer schemas are never downgraded or deleted',async()=> {
  const f=storeFixture();f.memory.local.harmonovaReaderStateV1={version:99,bookmarks:[1]};await assert.rejects(f.makeReader().stateSnapshot(),/UNSUPPORTED_READER_SCHEMA/);assert.equal(f.memory.local.harmonovaReaderStateV1.version,99);
  const p=preferenceFixture({local:{harmonovaPreferencesV1:{version:99}}});await assert.rejects(p.make().snapshot(),/UNSUPPORTED_PREFERENCES_SCHEMA/);assert.equal(p.local.harmonovaPreferencesV1.version,99);
});

test('P13 reader import reports actual truncation and optional seen-time roundtrip', async()=>{
 const f=storeFixture(),repo=f.makeReader();
 const data={bookmarks:Array.from({length:2001},(_,i)=>i+1),readStoryIds:[],seenTimes:{'12':123456}};
 const saved=await repo.importData(data);
 assert.equal(saved.truncated,true);assert.equal(saved.value.bookmarks.length,2000);assert.equal(saved.value.seenTimes['12'],123456);
 const snapshot=plain(await repo.stateSnapshot());
 await assert.rejects(repo.importData({bookmarks:[],readStoryIds:[],userTags:{alice:'α'.repeat(21)}}),/INVALID_IMPORT/);
 assert.deepEqual(plain(await repo.stateSnapshot()),snapshot,'invalid UTF-8 tag import commits nothing');
 assert.equal((await repo.importData({bookmarks:[],readStoryIds:[]})).truncated,false,'at the exact bound no data was truncated');
});

test('P13 stalled tab broadcasts never hold the reader transaction lock',async()=>{
 const realm=vm.createContext({TextEncoder,structuredClone,Date,Math,Promise});vm.runInContext(source,realm);
 const local={},session={};
 const repo=realm.HarmoNovaReaderStore.create({localGet:async defaults=>({...defaults,...local}),localSet:async data=>Object.assign(local,structuredClone(data)),sessionGet:async defaults=>({...defaults,...session}),sessionSet:async data=>Object.assign(session,structuredClone(data)),broadcast:()=>new Promise(()=>{})});
 await repo.setBookmark(1,true);await repo.setBookmark(2,true);assert.deepEqual(plain((await repo.stateSnapshot()).bookmarks),[1,2]);
});
