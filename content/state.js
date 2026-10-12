// Isolated-world HarmoNovaContentState module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  const runtimeMessage = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, message: chrome.runtime.lastError.message });
      resolve(response || { ok: false });
    });
  });

  function pageStorageGet(key) {
    if (dependencies.INCOGNITO) return undefined; // never read page-origin storage in private mode
    try {
      let value = dependencies.localStorage.getItem(key);
      if (value === null && key.startsWith("harmonova")) {
        const legacy = key.replace(/^harmonova/, "harmonic");
        value = dependencies.localStorage.getItem(legacy);

      }
      if(value!==null && new TextEncoder().encode(value).byteLength>262144){model.recoveryNotice=true;return undefined;}
      return value === null ? undefined : JSON.parse(value);
    } catch {
      model.recoveryNotice=true;return undefined;
    }
  }

  function pageStorageSet(key, value) {
    if (dependencies.INCOGNITO) return; // SEC-51: no page-origin backups from incognito
    try { dependencies.localStorage.setItem(key, JSON.stringify(key===dependencies.SETTINGS_BACKUP_KEY ? HarmoNovaSettingsSchema.backup(value) : value)); } catch {}
  }

  let preferenceSnapshot=null;
  async function loadEnabledPreference() {
    const result=await runtimeMessage({type:"HARMONOVA_PREFERENCES_GET"});
    if(!result?.ok)return false;
    preferenceSnapshot=result.value;
    return result.value.enabled!==false;
  }

  async function isOriginalTab() {
    if (location.hash === dependencies.ORIGINAL_HASH) return true;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "HARMONOVA_TAB_MODE" }, (response) => {
        resolve(Boolean(response?.original));
      });
    });
  }

  const pendingSettings={};
  let settingsTimer=null, settingsWrite=Promise.resolve();
  async function flushSettings() {
    clearTimeout(settingsTimer);settingsTimer=null;
    const patch={...pendingSettings};
    if(!Object.keys(patch).length||dependencies.INCOGNITO)return true;
    settingsWrite=settingsWrite.then(async()=> {
      const result=await runtimeMessage({type:"HARMONOVA_PREFERENCES_PATCH",fields:patch});
      if(!result?.ok){dependencies.showToast("Could not save settings. Keep this panel open and retry.");return false;}
      for(const key of Object.keys(patch))if(JSON.stringify(pendingSettings[key])===JSON.stringify(patch[key]))delete pendingSettings[key];
      if(result.syncSaved===false)dependencies.showToast("Settings saved locally. Chrome sync is unavailable.");
      pageStorageSet(dependencies.SETTINGS_BACKUP_KEY,model.settings);return true;
    });
    return settingsWrite;
  }
  async function saveSettings(keys,debounce=false) {
    const names=Array.isArray(keys)?keys:[keys];
    const fields=Object.fromEntries(names.filter(Boolean).map(key=>[key,model.settings[key]]));
    if(!HarmoNovaSettingsSchema.patch(fields)){dependencies.showToast("Setting value is too large or invalid.");return false;}
    if(dependencies.INCOGNITO)return true;
    Object.assign(pendingSettings,fields);
    if(debounce){clearTimeout(settingsTimer);settingsTimer=setTimeout(()=>flushSettings(),500);return true;}
    return flushSettings();
  }
  function removeMigratedPageKeys(keys) {
    if(dependencies.INCOGNITO)return;
    for(const key of keys)try {dependencies.localStorage.removeItem(key);dependencies.localStorage.removeItem(key.replace(/^harmonova/,"harmonic"));}catch{}
  }

  async function loadPersistentState() {
    const synced={harmonovaSettings:preferenceSnapshot?.settings};
    let stored = dependencies.INCOGNITO ? dependencies.privateReader.snapshot()
      : await runtimeMessage({ type: "HARMONOVA_LOCAL_STATE_GET" });
    const backedUpSettings = pageStorageGet(dependencies.SETTINGS_BACKUP_KEY);
    model.readerRevision = Number.isSafeInteger(stored?.revision) ? stored.revision : 0;
    const readIds = Array.isArray(stored?.readStoryIds) ? stored.readStoryIds : [];
    const bookmarks = Array.isArray(stored?.harmonovaBookmarks) ? stored.harmonovaBookmarks : [];
    if(!dependencies.INCOGNITO && preferenceSnapshot && !preferenceSnapshot.pageMigrated) {
      const result=await runtimeMessage({type:"HARMONOVA_MIGRATE_PREFERENCES",appearance:HarmoNovaSettingsSchema.backup(backedUpSettings || {})});
      if(result?.ok){preferenceSnapshot=result.value;synced.harmonovaSettings=result.value.settings;removeMigratedPageKeys([dependencies.SETTINGS_BACKUP_KEY,dependencies.ENABLED_BACKUP_KEY]);}
    }
    const settings = HarmoNovaSettingsSchema.normalize(synced.harmonovaSettings);
    model.readIds = new Set(readIds);
    model.bookmarks = new Set(bookmarks);
    model.settings = HarmoNovaSettingsSchema.normalize(settings);
    // Existing installations may have selected the removed upstream font.
    if (model.settings.uiFont === "harmonic") model.settings.uiFont = "system";
    // One-time validated import of legacy page-origin data. Once accepted, the
    // extension repository is authoritative; stale page backups cannot revive
    // removed tags, blocks or seen history.
    if (!dependencies.INCOGNITO && stored?.ok && !stored.pageOriginMigrated) {
      const oldTags = pageStorageGet("harmonovaUserTags");
      const oldBlocked = pageStorageGet("harmonovaBlockedUsers");
      const oldSeen = pageStorageGet("harmonovaSeenComments");
      const tags = Object.fromEntries(Object.entries(oldTags && typeof oldTags === "object" && !Array.isArray(oldTags) ? oldTags : {})
        .filter(([key,value]) => HarmoNovaSettingsSchema.username(key) && typeof value === "string" && value.length <= 40).slice(-500));
      const blockedUsers = (Array.isArray(oldBlocked) ? oldBlocked : []).filter(value =>
        typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value)).slice(-500);
      const seenTimes = Object.fromEntries(Object.entries(oldSeen && typeof oldSeen === "object" && !Array.isArray(oldSeen) ? oldSeen : {})
        .filter(([id,ts]) => Number.isSafeInteger(Number(id)) && Number(id) > 0 && Number.isSafeInteger(ts) && ts >= 0).slice(-400));
      const outcome = await runtimeMessage({ type: "HARMONOVA_MIGRATE_PAGE_DATA", data: { tags, blockedUsers, seenTimes } });
      if (outcome?.ok && outcome.value) {
        stored = { ...stored, revision: outcome.value.revision,userTags: outcome.value.tags, blockedUsers: outcome.value.blockedUsers, seenTimes: outcome.value.seenTimes };
        removeMigratedPageKeys(["harmonovaUserTags","harmonovaBlockedUsers","harmonovaSeenComments"]);
      } else model.recoveryNotice=true;
    }
    if(!dependencies.INCOGNITO && stored?.pageOriginMigrated)removeMigratedPageKeys(["harmonovaUserTags","harmonovaBlockedUsers","harmonovaSeenComments"]);
    model.readerRevision = Number.isSafeInteger(stored?.revision) ? stored.revision : model.readerRevision;
    model.userTags = new Map(Object.entries(!dependencies.INCOGNITO ? (stored?.userTags || {}) : {}));
    model.blockedUsers = new Set(!dependencies.INCOGNITO ? (stored?.blockedUsers || []) : []);
    model.seenTimes = new Map(Object.entries(!dependencies.INCOGNITO ? (stored?.seenTimes || {}) : {})
      .map(([id,ts]) => [Number(id), ts]));
    if(preferenceSnapshot?.pageMigrated)pageStorageSet(dependencies.SETTINGS_BACKUP_KEY, model.settings);

  }

  function persistUserTags(author) {
    if (dependencies.INCOGNITO) return void dependencies.privateReader.tag(author, model.userTags.get(author) ?? null);
    runtimeMessage({ type: "HARMONOVA_SET_TAG", username: author,
      tag: model.userTags.get(author) ?? null }).then(result => {
      if (!result?.ok) dependencies.showToast("Could not save user tag");
    });
  }

  function persistBlockedUsers(author) {
    if (dependencies.INCOGNITO) return void dependencies.privateReader.blocked(author, model.blockedUsers.has(author));
    runtimeMessage({ type: "HARMONOVA_SET_BLOCKED", username: author,
      desired: model.blockedUsers.has(author) }).then(result => {
      if (!result?.ok) dependencies.showToast("Could not save blocked-user setting");
    });
  }

  function persistSeenTimes(id) {
    if (dependencies.INCOGNITO) return void dependencies.privateReader.markSeen(id, model.seenTimes.get(id));
    runtimeMessage({ type: "HARMONOVA_MARK_SEEN", id,
      timestamp: model.seenTimes.get(id) }).then(() => {});
  }

  async function markRead(id) {
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const previous = model.readIds.has(id);
    model.readIds.add(id);
    if (dependencies.INCOGNITO) dependencies.privateReader.markRead(id);
    document.querySelector('[data-story-id="' + id + '"]')?.classList.add("is-read");
    if (!dependencies.INCOGNITO) {
      const result = await runtimeMessage({ type: "HARMONOVA_MARK_READ", id });
      if (!result?.ok) {
        if (!previous) model.readIds.delete(id);
        dependencies.showToast("Could not save read status");
      }
    }
  }

  async function toggleBookmark(id) {
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const desired = !model.bookmarks.has(id);
    if (desired) model.bookmarks.add(id); else model.bookmarks.delete(id);
    if (dependencies.INCOGNITO) dependencies.privateReader.bookmark(id, desired);
    document.querySelectorAll('[data-bookmark-id="' + id + '"]').forEach((node) =>
      node.classList.toggle("active", desired));
    if (!dependencies.INCOGNITO) {
      const result = await runtimeMessage({ type: "HARMONOVA_SET_BOOKMARK", id, desired });
      if (!result?.ok) {
        if (desired) model.bookmarks.delete(id); else model.bookmarks.add(id);
        document.querySelectorAll('[data-bookmark-id="' + id + '"]').forEach((node) =>
          node.classList.toggle("active", !desired));
        dependencies.showToast("Bookmark could not be saved");
      }
    }
  }


    return Object.freeze({get runtimeMessage(){return runtimeMessage;},
pageStorageSet,
loadEnabledPreference,
isOriginalTab,
get pendingSettings(){return pendingSettings;},
flushSettings,
saveSettings,
loadPersistentState,
persistUserTags,
persistBlockedUsers,
persistSeenTimes,
markRead,
toggleBookmark});
  }
  globalThis.HarmoNovaContentState=Object.freeze({create});
})();
