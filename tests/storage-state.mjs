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
