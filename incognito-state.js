// Per-document private reader adapter. Nothing is persisted or shared with
// the normal worker repository, and reloading creates a new empty adapter.
(() => {
  "use strict";
  function create() {
    const drafts = new Map();
    const tokens = new Map();
    const reads = new Set(), bookmarks = new Set(), blocks = new Set();
    const tags = new Map(), seen = new Map();
    let counter = 0, revision = 0;
    const trim = (collection, cap) => { while (collection.size > cap) collection.delete(collection.keys().next().value); };
    const key = (account, parent) => account + ":" + parent;
    const snapshot = () => ({ revision, readStoryIds: [...reads], harmonovaBookmarks: [...bookmarks],
      userTags: Object.fromEntries(tags), blockedUsers: [...blocks], seenTimes: Object.fromEntries(seen) });
    const markRead = id => { reads.add(id); trim(reads,1500); revision++; return { ok: true }; };
    const bookmark = (id, desired) => { if (desired) bookmarks.add(id); else bookmarks.delete(id); trim(bookmarks,2000); revision++; return { ok: true }; };
    const tag = (account, value) => { if (value === null) tags.delete(account); else tags.set(account, value); trim(tags,500); revision++; return { ok: true }; };
    const blocked = (account, value) => { if (value) blocks.add(account); else blocks.delete(account); trim(blocks,500); revision++; return { ok: true }; };
    const markSeen = (id, time) => { seen.set(id, time); trim(seen,400); revision++; return { ok: true }; };
    const importData = data => {
      for (const id of data.readStoryIds || []) reads.add(id);
      for (const id of data.bookmarks || []) bookmarks.add(id);
      for (const [name,value] of Object.entries(data.userTags || {})) tags.set(name,value);
      for (const name of data.blockedUsers || []) blocks.add(name);
      trim(reads,1500); trim(bookmarks,2000); trim(tags,500); trim(blocks,500);
      revision++;
      return { ok: true, value: snapshot() };
    };
    const beginDraft = (username, parentId) => {
      const k = key(username,parentId);
      const token = "private" + ++counter;
      tokens.set(token,k); trim(tokens,100);
      const current = drafts.get(k);
      return { ok: true, token, text: current?.text || "", revision: current?.revision || 0 };
    };
    const saveDraft = (username, parentId, token, expected, text) => {
      if (typeof text === "string" && new TextEncoder().encode(text).byteLength > 20000) return {ok:false,code:"INVALID_DRAFT"};
      const k = key(username,parentId);
      if (tokens.get(token) !== k) return { ok: false, code: "STALE_DRAFT" };
      const current = drafts.get(k);
      if ((current?.revision || 0) !== expected) return { ok: false, code: "DRAFT_CONFLICT" };
      const next = expected + 1;
      drafts.set(k, { username,parentId,text,revision:next });
      trim(drafts,50);
      return { ok: true, revision: next };
    };
    const clearDraft = (username, parentId, token) => {
      const k = key(username,parentId);
      if (tokens.get(token) !== k) return { ok:false, code:"STALE_DRAFT" };
      drafts.delete(k);
      for (const [id, value] of tokens) if (value === k) tokens.delete(id);
      return { ok: true };
    };
    const clearAccountDrafts = username => {
      for (const [k,value] of drafts) if (value.username === username) drafts.delete(k);
      for (const [id,k] of tokens) if (k.startsWith(username + ":")) tokens.delete(id);
      return { ok: true };
    };
    const retire = token => { tokens.delete(token); return {ok:true}; };
    return Object.freeze({snapshot,markRead,bookmark,tag,blocked,markSeen,importData,
      beginDraft,saveDraft,clearDraft,clearAccountDrafts,retire});
  }
  globalThis.HarmoNovaPrivateStore = Object.freeze({ create });
})();
