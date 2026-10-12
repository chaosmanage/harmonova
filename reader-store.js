// Worker-owned serialized repository for normal reader data and session drafts.
// No direct page-origin write can replace a stale full state snapshot.
(() => {
  "use strict";
  const DATA_KEY = "harmonovaReaderStateV1";
  const DRAFT_KEY = "harmonovaDraftsV2";
  const TAB_KEY = "harmonovaOriginalTabIds";
  const validId = v => Number.isSafeInteger(v) && v > 0;
  const cappedIds = (items, max) => [...new Set((Array.isArray(items)?items:[]).slice(-10000).filter(validId))].slice(-max);
  const validUsername = value => typeof value==="string" && /^[A-Za-z0-9_-]{1,32}$/.test(value) && !["__proto__","prototype","constructor"].includes(value);
  const tags = value => Object.fromEntries(Object.entries(value && typeof value==="object" && !Array.isArray(value)?value:{}).slice(-500).filter(([key,v])=>validUsername(key)&&typeof v==="string"&&v.length<=40));
  const times = value => Object.fromEntries(Object.entries(value && typeof value==="object" && !Array.isArray(value)?value:{}).slice(-400).filter(([key,v])=>validId(Number(key))&&Number.isSafeInteger(v)&&v>=0));
  const emptyData = () => ({ version: 1, revision: 0, pageOriginMigrated: false, readIds: [], bookmarks: [], tags: {}, blockedUsers: [], seenTimes: {} });
  const emptyDrafts = () => ({ version: 2, drafts: {}, generations: {}, accountGenerations: {} });
  function create({ localGet, localSet, sessionGet, sessionSet, broadcast = async () => {} }) {
    let lock = Promise.resolve();
    const active = new Map(); // worker restart expires all outstanding composer tokens
    let nextToken = 0;
    const serial = fn => {
      const task = lock.then(fn);
      lock = task.catch(() => {}); // a failed write must not poison the queue
      return task;
    };
    const draftKey = (username, parentId) => username + ":" + parentId;
    const newToken = () => "d" + Date.now().toString(36) + "x" + (++nextToken).toString(36) + "x" + Math.random().toString(36).slice(2);
    const readDrafts = async () => {
      const stored = await sessionGet({ [DRAFT_KEY]: null, harmonovaDrafts: null });
      if(stored[DRAFT_KEY] && stored[DRAFT_KEY].version!==2)throw new Error("UNSUPPORTED_DRAFT_SCHEMA");
      if (stored[DRAFT_KEY]?.version === 2) {
        const record=stored[DRAFT_KEY];
        const drafts=Object.fromEntries(Object.entries(record.drafts||{}).slice(-50).filter(([key,entry])=>entry&&validUsername(entry.username)&&validId(entry.parentId)&&key===draftKey(entry.username,entry.parentId)&&typeof entry.text==="string"&&new TextEncoder().encode(entry.text).byteLength<=20000&&Number.isSafeInteger(entry.revision)&&entry.revision>=0));
        return {version:2,drafts,generations:Object.fromEntries(Object.entries(record.generations||{}).slice(-500)),accountGenerations:Object.fromEntries(Object.entries(record.accountGenerations||{}).filter(([name,v])=>validUsername(name)&&Number.isSafeInteger(v)&&v>=0).slice(-500))};
      }
      const initial = emptyDrafts();
      for (const [key, entry] of Object.entries(stored.harmonovaDrafts || {})) {
        if (entry && typeof entry.text === "string") initial.drafts[key] = { ...entry, revision: 1 };
      }
      await sessionSet({ [DRAFT_KEY]: initial });
      return initial;
    };
    const readData = async () => {
      const stored = await localGet({ [DATA_KEY]: null, readStoryIds: [], harmonovaBookmarks: [] });
      const record = stored[DATA_KEY];
      if(record && record.version!==1)throw new Error("UNSUPPORTED_READER_SCHEMA");
      if(record && (!Number.isSafeInteger(record.revision)||record.revision<0))throw new Error("INVALID_READER_SCHEMA");
      if (record?.version === 1 && Number.isSafeInteger(record.revision) && record.revision>=0) return {
        version:1,revision:record.revision,pageOriginMigrated:record.pageOriginMigrated===true,
        readIds:cappedIds(record.readIds,1500),bookmarks:cappedIds(record.bookmarks,2000),tags:tags(record.tags),
        blockedUsers:(Array.isArray(record.blockedUsers)?record.blockedUsers:[]).filter(validUsername).slice(-500),seenTimes:times(record.seenTimes),
      };
      const initial = emptyData();
      initial.readIds = cappedIds(stored.readStoryIds, 1500);
      initial.bookmarks = cappedIds(stored.harmonovaBookmarks, 2000);
      await localSet({ [DATA_KEY]: initial }); // keep legacy keys until P10 migration cleanup
      return initial;
    };
    const stateSnapshot = async () => serial(async () => structuredClone(await readData()));
    const mutateState = fn => serial(async () => {
      const before = await readData();
      const after = structuredClone(before);
      const result = fn(after);
      if (result?.changed === false) return { ...result, value: after };
      after.revision = before.revision + 1;
      await localSet({ [DATA_KEY]: after });
      await broadcast(after).catch(() => {});
      return { ok: true, ...result, value: after };
    });
    const markRead = id => mutateState(state => {
      if (!validId(id)) throw new Error("INVALID_ID");
      if (state.readIds.includes(id)) return { ok: true, changed: false };
      state.readIds = cappedIds([...state.readIds, id], 1500);
      return { changed: true };
    });
    const setBookmark = (id, desired) => mutateState(state => {
      if (!validId(id) || typeof desired !== "boolean") throw new Error("INVALID_BOOKMARK");
      const present = state.bookmarks.includes(id);
      if (present === desired) return { ok: true, changed: false };
      state.bookmarks = cappedIds(state.bookmarks.filter(item => item !== id).concat(desired ? [id] : []), 2000);
      return { changed: true };
    });
    const importData = data => mutateState(state => {
      if (!data || typeof data !== "object" || Array.isArray(data) || new TextEncoder().encode(JSON.stringify(data)).byteLength>262144) throw new Error("INVALID_IMPORT");
      for (const name of ["bookmarks", "readStoryIds"]) {
        if (!Array.isArray(data[name]) || data[name].length > 10000 || !data[name].every(validId))
          throw new Error("INVALID_IMPORT");
      }
      state.bookmarks = cappedIds([...state.bookmarks, ...data.bookmarks], 2000);
      state.readIds = cappedIds([...state.readIds, ...data.readStoryIds], 1500);
      if (data.userTags) {
        if (typeof data.userTags !== "object" || Array.isArray(data.userTags) || Object.keys(data.userTags).length>500) throw new Error("INVALID_IMPORT");
        for (const [name, tag] of Object.entries(data.userTags)) {
          if (!validUsername(name) || typeof tag !== "string" || tag.length > 40) throw new Error("INVALID_IMPORT");
          state.tags[name] = tag;
        }
        state.tags = Object.fromEntries(Object.entries(state.tags).slice(-500));
      }
      if (data.blockedUsers) {
        if (!Array.isArray(data.blockedUsers) || data.blockedUsers.length>500 || !data.blockedUsers.every(validUsername))
          throw new Error("INVALID_IMPORT");
        state.blockedUsers = [...new Set([...state.blockedUsers, ...data.blockedUsers])].slice(-500);
      }
      if (data.seenTimes) {
        if (!data.seenTimes || typeof data.seenTimes !== "object" || Array.isArray(data.seenTimes)) throw new Error("INVALID_IMPORT");
        for (const [id, ts] of Object.entries(data.seenTimes)) {
          if (!validId(Number(id)) || !Number.isSafeInteger(ts) || ts < 0) throw new Error("INVALID_IMPORT");
          state.seenTimes[id] = ts;
        }
        state.seenTimes = Object.fromEntries(Object.entries(state.seenTimes).slice(-400));
      }
      return { changed: true, counts: { bookmarks: state.bookmarks.length, readIds: state.readIds.length,
        tags: Object.keys(state.tags).length, blockedUsers: state.blockedUsers.length },
        truncated: state.bookmarks.length === 2000 || state.readIds.length === 1500 };
    });
    const migratePageData = data => mutateState(state => {
      if (state.pageOriginMigrated) return { ok: true, changed: false };
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INVALID_MIGRATION");
      const tags = data.tags || {};
      const blocked = data.blockedUsers || [];
      const seen = data.seenTimes || {};
      if (typeof tags !== "object" || Array.isArray(tags) || Object.keys(tags).length > 500 ||
        !Object.entries(tags).every(([name,value]) => validUsername(name) &&
          typeof value === "string" && value.length <= 40) ||
        !Array.isArray(blocked) || blocked.length > 500 ||
        !blocked.every(validUsername) ||
        typeof seen !== "object" || Array.isArray(seen) || Object.keys(seen).length > 400 ||
        !Object.entries(seen).every(([id,ts]) => validId(Number(id)) && Number.isSafeInteger(ts) && ts >= 0))
        throw new Error("INVALID_MIGRATION");
      state.tags = Object.fromEntries([...Object.entries(tags).filter(([key])=>!Object.hasOwn(state.tags,key)),...Object.entries(state.tags)].slice(-500)); // new values win
      state.blockedUsers = [...new Set([...blocked, ...state.blockedUsers])].slice(-500);
      state.seenTimes = Object.fromEntries([...Object.entries(seen).filter(([key])=>!Object.hasOwn(state.seenTimes,key)),...Object.entries(state.seenTimes)].slice(-400));
      state.pageOriginMigrated = true;
      return { changed: true };
    });
    const setTag = (name, value) => mutateState(state => {
      if (!validUsername(name) ||
        (value !== null && (typeof value !== "string" || value.length > 40)))
        throw new Error("INVALID_TAG");
      if (value === null) delete state.tags[name]; else state.tags[name] = value;
      state.tags = Object.fromEntries(Object.entries(state.tags).slice(-500));
      return { changed: true };
    });
    const setBlocked = (name, desired) => mutateState(state => {
      if (!validUsername(name) || typeof desired !== "boolean")
        throw new Error("INVALID_USER");
      state.blockedUsers = state.blockedUsers.filter(entry => entry !== name);
      if (desired) state.blockedUsers.push(name);
      state.blockedUsers = state.blockedUsers.slice(-500);
      return { changed: true };
    });
    const markSeen = (id, ts) => mutateState(state => {
      if (!validId(id) || !Number.isSafeInteger(ts) || ts < 0) throw new Error("INVALID_TIMESTAMP");
      state.seenTimes[id] = Math.max(ts, state.seenTimes[id] || 0);
      state.seenTimes = Object.fromEntries(Object.entries(state.seenTimes).slice(-400));
      return { changed: true };
    });
    const beginDraft = (username, parentId) => serial(async () => {
      if (!validUsername(username) || !validId(parentId))
        throw new Error("INVALID_DRAFT");
      const record = await readDrafts();
      const key = draftKey(username, parentId);
      const entry = record.drafts[key];
      if(active.size>=100)throw new Error("TOO_MANY_COMPOSERS");
      const token = newToken();
      active.set(token, { key, username, generation: record.generations[key] || 0,
        accountGeneration: record.accountGenerations[username] || 0 });
      return { ok: true, token, text: entry?.text || "", revision: entry?.revision || 0 };
    });
    const saveDraft = (username, parentId, token, revision, text) => serial(async () => {
      if (typeof text !== "string" || new TextEncoder().encode(text).length > 20000)
        throw new Error("DRAFT_TOO_LARGE");
      const record = await readDrafts();
      const key = draftKey(username, parentId);
      const lifecycle = active.get(token);
      if (!lifecycle || lifecycle.key !== key || lifecycle.username !== username ||
        lifecycle.generation !== (record.generations[key] || 0) ||
        lifecycle.accountGeneration !== (record.accountGenerations[username] || 0))
        return { ok: false, code: "STALE_DRAFT" };
      const existing = record.drafts[key];
      if ((existing?.revision || 0) !== revision) return {
        ok: false, code: "DRAFT_CONFLICT", revision: existing?.revision || 0 };
      const next = revision + 1;
      record.drafts[key] = { username, parentId, text, revision: next, updatedAt: Date.now() };
      const keys = Object.keys(record.drafts);
      if (keys.length > 50) for (const old of keys.sort((a,b) => record.drafts[a].updatedAt - record.drafts[b].updatedAt).slice(0,keys.length-50))
        delete record.drafts[old];
      await sessionSet({ [DRAFT_KEY]: record });
      return { ok: true, revision: next };
    });
    const clearDraft = (username, parentId, token) => serial(async () => {
      const record = await readDrafts();
      const key = draftKey(username, parentId);
      const lifecycle = active.get(token);
      if (!lifecycle || lifecycle.key !== key || lifecycle.username !== username ||
        lifecycle.generation !== (record.generations[key] || 0) ||
        lifecycle.accountGeneration !== (record.accountGenerations[username] || 0))
        return { ok: false, code: "STALE_DRAFT" };
      record.generations[key] = (record.generations[key] || 0) + 1;
      delete record.drafts[key];
      await sessionSet({ [DRAFT_KEY]: record });
      for (const [id, item] of active) if (item.key === key) active.delete(id);
      return { ok: true };
    });
    const clearAccountDrafts = username => serial(async () => {
      const record = await readDrafts();
      record.accountGenerations[username] = (record.accountGenerations[username] || 0) + 1;
      for (const [key, entry] of Object.entries(record.drafts)) {
        if (entry.username === username) delete record.drafts[key];
      }
      await sessionSet({ [DRAFT_KEY]: record });
      for (const [id, item] of active) if (item.username === username) active.delete(id);
      return { ok: true };
    });
    const retireDraft = token => { active.delete(token); return { ok: true }; };
    const getOriginalTabs = () => serial(async () => {
      const value = await sessionGet({ [TAB_KEY]: [] });
      return Array.isArray(value[TAB_KEY]) ? value[TAB_KEY].filter(validId) : [];
    });
    const setOriginalTab = (id, enabled) => serial(async () => {
      if (!validId(id)) throw new Error("INVALID_TAB");
      const value = await sessionGet({ [TAB_KEY]: [] });
      const entries = new Set(Array.isArray(value[TAB_KEY]) ? value[TAB_KEY].filter(validId) : []);
      if (enabled) entries.add(id); else entries.delete(id);
      await sessionSet({ [TAB_KEY]: [...entries] });
      return { ok: true, tabs: [...entries] };
    });
    const reconcileOriginalTabs = validIds => serial(async () => {
      const value = await sessionGet({ [TAB_KEY]: [] });
      const live = new Set(validIds.filter(validId));
      const retained = (Array.isArray(value[TAB_KEY]) ? value[TAB_KEY] : []).filter(v => live.has(v));
      await sessionSet({ [TAB_KEY]: retained });
      return { ok: true, tabs: retained };
    });
    return Object.freeze({ stateSnapshot, markRead, setBookmark, importData, migratePageData, setTag, setBlocked, markSeen,
      beginDraft, saveDraft, clearDraft, clearAccountDrafts, retireDraft,
      getOriginalTabs, setOriginalTab, reconcileOriginalTabs });
  }
  globalThis.HarmoNovaReaderStore = Object.freeze({ create });
})();
