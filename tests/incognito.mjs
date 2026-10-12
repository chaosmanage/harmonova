import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { loadBackground } from "./helpers/worker.mjs";

const source = fs.readFileSync(new URL("../src/incognito-state.js", import.meta.url), "utf8");
const extensionId = "test-extension-id";
const HN = "https://news.ycombinator.com/news";
function privateSender(windowId = 44) {
  return { id: extensionId, frameId: 0, origin: "https://news.ycombinator.com", url: HN,
    tab: { id: 31, windowId, url: HN, incognito: true } };
}
const normalSender = { ...privateSender(42), tab: { ...privateSender(42).tab, id: 7, incognito: false } };
const message = (listeners, payload, sender) => new Promise(resolve => listeners.message(payload, sender, resolve));
function newPrivateStore() {
  const context = vm.createContext({TextEncoder});
  vm.runInContext(source, context);
  return context.HarmoNovaPrivateStore.create();
}

test("P06 private reader data and drafts live only for this document", () => {
  const privateA = newPrivateStore();
  assert.deepEqual([...privateA.snapshot().readStoryIds], []);
  privateA.markRead(9);
  privateA.bookmark(8, true);
  privateA.tag("alice", "private tag");
  privateA.blocked("blockedauthor", true);
  privateA.markSeen(9, 1234);
  privateA.importData({ bookmarks: [10], readStoryIds: [11],
    userTags: {bob:"imported"}, blockedUsers: ["other"] });
  const old = privateA.beginDraft("alice", 6);
  assert.equal(privateA.saveDraft("alice", 6, old.token, 0, "private-only").ok, true);
  assert.equal(privateA.beginDraft("alice", 6).text, "private-only");
  assert.deepEqual([...privateA.snapshot().readStoryIds], [9, 11]);
  privateA.markUnread(9);
  assert.deepEqual([...privateA.snapshot().readStoryIds], [11]);
  assert.deepEqual([...privateA.snapshot().harmonovaBookmarks], [8, 10]);
  assert.equal(privateA.snapshot().userTags.alice, "private tag");
  const privateB = newPrivateStore();
  assert.deepEqual([...privateB.snapshot().readStoryIds], []);
  assert.deepEqual([...privateB.snapshot().harmonovaBookmarks], []);
  assert.equal(privateB.beginDraft("alice",6).text, "");
  privateA.clearAccountDrafts("alice");
  assert.equal(privateA.beginDraft("alice",6).text, "");
});

test("P06 private logout destroys only private drafts, not normal drafts", async () => {
  const worker = loadBackground({ fetchImpl: async () => { throw new Error("NO_REMOTE_ACCESS"); } });
  const begin = await message(worker.listeners, { type: "HARMONOVA_DRAFT_BEGIN", username: "alice", parentId: 6 }, normalSender);
  assert.equal(begin.ok, true);
  const saved = await message(worker.listeners, { type: "HARMONOVA_DRAFT_SET",
    username:"alice",parentId:6,token:begin.token,revision:0,text:"normal draft" }, normalSender);
  assert.equal(saved.ok,true);
  const privateStore = newPrivateStore();
  const privateBegin = privateStore.beginDraft("alice",6);
  privateStore.saveDraft("alice",6,privateBegin.token,0,"private draft");
  privateStore.clearAccountDrafts("alice");
  const normalAgain = await message(worker.listeners, { type:"HARMONOVA_DRAFT_BEGIN", username:"alice", parentId:6 }, normalSender);
  assert.equal(normalAgain.text, "normal draft");
  assert.equal(privateStore.beginDraft("alice",6).text, "");
});

test("P06 private sender cannot access normal storage, preview or AI port", async () => {
  const worker = loadBackground({ fetchImpl: async () => { throw new Error("OUTBOUND_REQUEST_OCCURRED"); } });
  await message(worker.listeners, { type: "HARMONOVA_SET_BOOKMARK", id:12, desired:true }, normalSender);
  const before = JSON.stringify(worker.stores);
  const privateTab = privateSender();
  const attempts = [
    {type:"HARMONOVA_LOCAL_STATE_GET"},
    {type:"HARMONOVA_MARK_READ",id:2},
    {type:"HARMONOVA_MARK_UNREAD",id:2},
    {type:"HARMONOVA_SET_BOOKMARK",id:2,desired:true},
    {type:"HARMONOVA_IMPORT_READER_DATA",data:{bookmarks:[4],readStoryIds:[7]}},
    {type:"HARMONOVA_MIGRATE_PAGE_DATA",data:{}},
    {type:"HARMONOVA_SET_TAG",username:"alice",tag:"private"},
    {type:"HARMONOVA_SET_BLOCKED",username:"alice",desired:true},
    {type:"HARMONOVA_MARK_SEEN",id:2,timestamp:42},
    {type:"HARMONOVA_DRAFT_BEGIN",username:"alice",parentId:2},
    {type:"HARMONOVA_DRAFT_SET",username:"alice",parentId:2,token:"test",revision:0,text:"private"},
    {type:"HARMONOVA_DRAFT_CLEAR",username:"alice",parentId:2,token:"test"},
    {type:"HARMONOVA_DRAFT_CLEAR_ALL",username:"alice"},
    {type:"HARMONOVA_AI_STATUS"},
    {type:"HARMONOVA_OPEN_AI_SETTINGS"},
    {type:"HARMONOVA_PREVIEW",url:"https://example.com/article"},
  ];
  for (const payload of attempts) {
    const result = await message(worker.listeners, payload, privateTab);
    assert.equal(result.ok, false, payload.type);
    assert.equal(result.error?.code, "PRIVATE_STATE_UNAVAILABLE", payload.type);
  }
  let disconnected = false;
  worker.listeners.connect({ name:"harmonova-ai", sender: privateTab,
    disconnect() { disconnected = true; } });
  assert.equal(disconnected, true);
  assert.equal(JSON.stringify(worker.stores), before);
});

test("P06 private original-HN handoff uses the sender incognito window", async () => {
  const tabsCreated = [], tabUpdates = [];
  const worker = loadBackground({ fetchImpl: async () => { throw new Error("NO_REMOTE_ACCESS"); },
    tabs: {
      async create(options) { tabsCreated.push(options); return { id: 101 }; },
      async update(id, options) { tabUpdates.push({id,options}); return {id}; },
    },
  });
  const result = await message(worker.listeners, { type:"HARMONOVA_OPEN_ORIGINAL",
    url:"https://news.ycombinator.com/item?id=42" }, privateSender(909));
  assert.equal(result.ok,true);
  assert.equal(tabsCreated.length,1);
  assert.equal(tabsCreated[0].windowId,909);
  assert.equal(tabUpdates[0].options.url, "https://news.ycombinator.com/item?id=42");
  const original = await message(worker.listeners,{ type:"HARMONOVA_TAB_MODE" },privateSender(909));
  assert.equal(original.ok,true);
  assert.equal(worker.stores.session.harmonovaOriginalTabIds.includes(101), true);
  assert.equal(JSON.stringify(worker.stores.local).includes("42"), false);
});

test("P06 source declares spanning and private module; browser gate separate", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.incognito,"spanning");
  assert.ok(manifest.content_scripts[0].js.includes("src/incognito-state.js"));
  assert.ok(!manifest.web_accessible_resources.some(entry => entry.resources.includes("src/incognito-state.js")));
});

test('P10 private cosmetic snapshot does not migrate or write legacy normal stores',async()=> {
  const w=loadBackground({fetchImpl:()=>{throw new Error('NO_REMOTE_ACCESS');}});
  w.stores.sync.harmonicSettings={uiTheme:'navy',aiEnabled:true,userTags:{private:'must not expose'}};
  const before=JSON.stringify(w.stores);
  const result=await message(w.listeners,{type:'HARMONOVA_PREFERENCES_GET'},privateSender());
  assert.equal(result.ok,true);assert.equal(result.value.settings.uiTheme,'navy');assert.equal(result.value.settings.aiEnabled,undefined);
  assert.equal(JSON.stringify(w.stores),before);
});
