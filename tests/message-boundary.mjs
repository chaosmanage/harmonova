import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBackground } from "./helpers/worker.mjs";

const ext = "test-extension-id";
const HN = "https://news.ycombinator.com/news";
const good = { id: ext, frameId: 0, url: HN, origin: "https://news.ycombinator.com",
  tab: { id: 23, url: HN, incognito: false } };
const sender = changes => ({ ...good, ...changes });
const invoke = (listeners, message, s = good) => new Promise((resolve, reject) => {
  try { listeners.message(message, s, resolve); } catch (e) { reject(e); }
});
const setup = (args = {}) => loadBackground({ fetchImpl: async () => {
  throw new Error("UNEXPECTED_NETWORK");
}, ...args });
test("P02 sender classification is based on document URL, not tab URL", async () => {
  const { listeners, stores } = setup();
  for (const s of [
    { ...good, id: "" },
    { ...good, url: undefined },
    { ...good, url: "https://attacker.example/path" },
    { ...good, url: "https://news.ycombinator.com.evil.test/" },
    { ...good, url: "https://evil.test", tab: { id: 23, url: HN } },
    { ...good, origin: "https://evil.test" },
    { ...good, frameId: 2 },
    { ...good, tab: undefined },
    { ...good, tab: { id: 0, url: HN } },
    { ...good, tab: { id: 23, url: HN, incognito: true } },
  ]) {
    const result = await invoke(listeners, { type: "HARMONOVA_SET_BOOKMARK", id: 3, desired: true }, s);
    assert.equal(result.ok, false);
    assert.notEqual(stores.local.harmonovaReaderStateV1?.bookmarks?.includes(3), true);
  }
});
test("P02 rejects malformed fields and unknown operations before side effects", async () => {
  const { listeners, stores } = setup();
  for (const m of [
    { type: "HARMONOVA_SET_BOOKMARK", id: -1, desired: true },
    { type: "HARMONOVA_SET_BOOKMARK", id: 2, desired: true, userGesture: true },
    { type: "HARMONOVA_MARK_READ", id: [1,2] },
    { type: "HARMONOVA_MARK_UNREAD", id: -1 },
    { type: "HARMONOVA_MARK_UNREAD", id: 5, desired: false },
    { type: "HARMONOVA_DRAFT_SET", parentId: 3, username: "alice", text: "a".repeat(20001) },
    { type: "HARMONOVA_DRAFT_SET", parentId: "3", username: "alice", text: "a" },
    { type: "HARMONOVA_DRAFT_SET", parentId: 3, username: {}, text: "a" },
    { type: "HARMONOVA_PREVIEW", url: "https://example.com", rich: "true" },
    { type: "HARMONOVA_TAB_MODE", tabId: 4 },
    { type: "HARMONOVA_OPEN_ORIGINAL", url: "https://news.ycombinator.com/logout?auth=dummy" },
    { type: "HARMONOVA_OPEN_ORIGINAL", url: "https://news.ycombinator.com/vote?id=1" },
    { type: "HARMONOVA_OPEN_ORIGINAL", url: "https://news.ycombinator.com/news?goto=logout" },
    { type: "HARMONOVA_AI_SAVE_KEY", apiKey: "secret", storage: "local" },
    { type: "UNLISTED_OPERATION" },
    { type: "__proto__" }, {type:"constructor"}, {type:"toString"}, {type:[]},
    { type: "HARMONOVA_DRAFT_CLEAR_ALL", username: "bad user" },
  ]) assert.equal((await invoke(listeners, m)).ok, false, JSON.stringify(m).slice(0,70));
  assert.notEqual(stores.local.harmonovaReaderStateV1?.bookmarks?.includes(3), true);
  assert.equal(stores.session.harmonovaDrafts, undefined);
});
test("P02 extension-page callers have narrow independent permissions", async () => {
  const { listeners } = setup();
  const options = { id: ext, url: "chrome-extension://test-extension-id/ai-settings.html" };
  const popup = { id: ext, url: "chrome-extension://test-extension-id/popup.html" };
  const fakePage = { id: ext, url: "chrome-extension://test-extension-id/not-options.html" };
  assert.equal((await invoke(listeners, { type: "HARMONOVA_AI_STATUS" }, options)).ok, true);
  assert.equal((await invoke(listeners, { type: "HARMONOVA_AI_STATUS" }, popup)).ok, false);
  assert.equal((await invoke(listeners, { type: "HARMONOVA_AI_STATUS" }, fakePage)).ok, false);
  assert.equal((await invoke(listeners, { type: "HARMONOVA_READ_IDS_SET", ids: [3] }, options)).ok, false);
});
test("P02 permits normal reader snapshots but refuses all private persistence", async () => {
  const { listeners, stores } = setup();
  assert.equal((await invoke(listeners, { type: "HARMONOVA_SET_BOOKMARK", id: 5, desired: true })).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stores.local.harmonovaReaderStateV1?.bookmarks)), [5]);
  const privateSender = sender({ tab: { ...good.tab, incognito: true } });
  for (const type of ["HARMONOVA_SET_BOOKMARK", "HARMONOVA_MARK_READ", "HARMONOVA_MARK_UNREAD",
    "HARMONOVA_DRAFT_SET", "HARMONOVA_DRAFT_GET", "HARMONOVA_LOCAL_STATE_GET"]) {
    const result = await invoke(listeners, { type, ids: [9], username: "alice",
      parentId: 3, text: "private" }, privateSender);
    assert.equal(result.ok, false, type);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(stores.local.harmonovaReaderStateV1?.bookmarks)), [5]);
  assert.equal(stores.session.harmonovaDrafts, undefined);
});
test("P02 options only see key preview; content receives boolean status", async () => {
  const { listeners, context } = setup();
  await context.saveAiKey("sk-secret-fixture", "session");
  const result = await invoke(listeners, { type: "HARMONOVA_AI_STATUS" }, good);
  assert.equal(result.ok, true);
  assert.equal(result.hasKey, true);
  assert.equal(result.preview, undefined);
  const options = { id: ext, url: "chrome-extension://test-extension-id/ai-settings.html" };
  const detail = await invoke(listeners, { type: "HARMONOVA_AI_STATUS" }, options);
  assert.ok(detail.preview);
});
test("P02 untrusted AI ports are disconnected without attaching listeners", () => {
  const { listeners } = setup();
  for (const s of [{ ...good, url: "https://evil.test" },
      { ...good, tab: { ...good.tab, incognito: true } },
      { ...good, frameId: 1 }, null]) {
    let disconnected = 0, registered = 0;
    const port = { name: "harmonova-ai", sender: s,
      disconnect() { disconnected++; },
      onMessage: { addListener() { registered++; } },
      onDisconnect: { addListener() { registered++; } } };
    listeners.connect(port);
    assert.equal(disconnected, 1);
    assert.equal(registered, 0);
  }
});
test("P02 AI message rejects forged policy and gesture overrides", () => {
  const { context } = setup();
  const check = m => context.HarmoNovaMessageBoundary.validateAiMessage(m);
  assert.equal(check({ type: "summarize", requestId: "r1", storyId: 5,
    source: "article", model: "paid/other", userGesture: true }).ok, false);
  assert.equal(check({ type: "summarize", requestId: "r1", storyId: 5,
    source: "article" }).ok, true);
  assert.equal(check({ type: "summarize", requestId: "r1", storyId: "5",
    source: "article" }).ok, false);
});

test("P02 initialization failures reject trusted requests before writes or fetch", async () => {
  for (const option of [{ failAccessLevel: true }, { failStorage: true }]) {
    const { listeners, stores } = setup(option);
    const reply = await invoke(listeners, { type: "HARMONOVA_SET_BOOKMARK", id: 9, desired: true });
    assert.equal(reply.ok, false);
    assert.equal(reply.error?.code, "WORKER_UNAVAILABLE");
    assert.notEqual(stores.local.harmonovaReaderStateV1?.bookmarks?.includes(3), true);
  }
});

test("P02 popup target validation prevents cross-tab control", async () => {
  const visited = [], updated = [];
  const { listeners } = setup({ tabs: {
    async get(id) { visited.push(id); return { id, url: id === 42 ? HN : "https://example.org", windowId: 7 }; },
    async create(args) { updated.push(args); return { id: 90 }; },
    async update(id, args) { updated.push({ id, ...args }); return { id }; },
  }});
  const popup = { id: ext, url: "chrome-extension://test-extension-id/popup.html" };
  for (const tabId of [0, -1, 43]) {
    const reply = await invoke(listeners, { type: "HARMONOVA_OPEN_ORIGINAL", tabId, url: HN }, popup);
    assert.equal(reply.ok, false);
  }
  assert.deepEqual(updated, []);
  const reply = await invoke(listeners, { type: "HARMONOVA_OPEN_ORIGINAL", tabId: 42, url: HN }, popup);
  assert.equal(reply.ok, true);
  assert.equal(updated.length, 2);
  assert.ok(updated.every(item => !JSON.stringify(item).includes("logout?auth=")));
});

test("P02 duplicate AI work is rejected rather than restarted", () => {
  const { listeners } = setup();
  let received;
  const posted = [];
  const port = {
    name: "harmonova-ai", sender: good,
    disconnect() { throw new Error("trusted port disconnected"); },
    postMessage(value) { posted.push(value); },
    onMessage: { addListener(callback) { received = callback; } },
    onDisconnect: { addListener() {} },
  };
  listeners.connect(port);
  assert.equal(typeof received, "function");
  const payload = { type: "summarize", storyId: 5, source: "article",
    url: "https://example.com/", model: "openrouter/free", systemPrompt: "Summarize" };
  received(payload);
  received(payload);
  assert.ok(posted.some(msg => msg.code === "AI_BUSY"));
  received({ type: "cancel" });
});

test("P13 opening the popup reads cosmetics without initiating normal migrations",async()=>{
 const {listeners,stores}=setup();stores.sync.harmonicSettings={uiTheme:'navy'};stores.sync.harmonicEnabled=false;
 const before=JSON.stringify(stores);
 const response=await invoke(listeners,{type:'HARMONOVA_PREFERENCES_GET'},{id:ext,url:'chrome-extension://test-extension-id/popup.html'});
 assert.equal(response.ok,true);assert.equal(response.value.enabled,false);assert.equal(response.value.settings.uiTheme,'navy');assert.equal(JSON.stringify(stores),before);
});
