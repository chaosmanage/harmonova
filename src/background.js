importScripts("worker/messages.js", "worker/network.js", "worker/ai.js", "worker/storage.js", "settings-schema.js", "preferences-store.js", "url-policy.js", "message-boundary.js", "ai-policy.js", "reader-store.js", "resource-policy.js", "image-policy.js", "provider-policy.js", "release-updates.js");

const AI_KEY_LOCAL_STORAGE_KEY = "harmonovaAiApiKey";
const AI_KEY_SESSION_STORAGE_KEY = "harmonovaAiApiKeySession";
const AI_POLICY_LOCAL_STORAGE_KEY = "harmonovaAiPolicyV1";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const MAX_ARTICLE_CHARACTERS = 15_000;
const MAX_SUMMARY_CHARACTERS = 64 * 1024;

// Read old on-disk keys exactly once during upgrades, then store them under the
// HarmoNova namespace. Never overwrite existing new-format data.

  const workerStorage=HarmoNovaWorkerStorage.create({

  },undefined);
  function storageCall(...args){return workerStorage.storageCall(...args);}
const readerStore = HarmoNovaReaderStore.create({ localGet: workerStorage.localGet, localSet: workerStorage.localSet, sessionGet: workerStorage.sessionGet, sessionSet: workerStorage.sessionSet,
  broadcast: async (record) => {
    if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
    const tabs = await chrome.tabs.query({ url: "https://news.ycombinator.com/*" });
    await Promise.allSettled(tabs.filter(tab => !tab.incognito && Number.isSafeInteger(tab.id))
      .map(tab => chrome.tabs.sendMessage(tab.id, { type: "HARMONOVA_READER_SNAPSHOT",
        revision: record.revision, readStoryIds: record.readIds, bookmarks: record.bookmarks,
        userTags: record.tags, blockedUsers: record.blockedUsers, seenTimes: record.seenTimes })));
  },
});

const preferencesStore=HarmoNovaPreferencesStore.create({
  get:keys=>storageCall(chrome.storage.local,"get",keys),set:workerStorage.localSet,
  syncGet:keys=>storageCall(chrome.storage.sync,"get",keys),syncSet:values=>storageCall(chrome.storage.sync,"set",values),
  broadcast:async record=>{
    if(!chrome.tabs?.query||!chrome.tabs?.sendMessage)return;
    const tabs=await chrome.tabs.query({url:"https://news.ycombinator.com/*"});
    await Promise.allSettled(tabs.filter(t=>!t.incognito).map(t=>chrome.tabs.sendMessage(t.id,{type:"HARMONOVA_PREFERENCES_SNAPSHOT",value:record})));
  },
});
async function privatePreferencesSnapshot() {
  const record=await storageCall(chrome.storage.local,"get",["harmonovaPreferencesV1"]);
  const synced=await storageCall(chrome.storage.sync,"get",["harmonovaSettings","harmonicSettings","harmonovaEnabled","harmonicEnabled"]);
  return {settings:HarmoNovaSettingsSchema.normalize(record.harmonovaPreferencesV1?.settings||synced.harmonovaSettings||synced.harmonicSettings),enabled:(record.harmonovaPreferencesV1?.enabled??synced.harmonovaEnabled??synced.harmonicEnabled)!==false};
}

// Register listeners synchronously. Every privileged operation awaits the
// same fail-closed worker initialization promise.
const workerReady = Promise.all([chrome.storage.local, chrome.storage.session, chrome.storage.sync].map(async area => {
  if (typeof area.setAccessLevel !== "function") throw new Error("STORAGE_UNAVAILABLE");
  await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await storageCall(area,"get",[]);
}));

async function currentAiPolicy() {
  const stored = await workerStorage.localGet({ [AI_POLICY_LOCAL_STORAGE_KEY]: null });
  return HarmoNovaAiPolicy.fromStorage(stored[AI_POLICY_LOCAL_STORAGE_KEY]);
}
async function saveAiPolicy(value) {
  const policy = HarmoNovaAiPolicy.normalize(value);
  if (!policy) return { ok: false, error: { code: "INVALID_AI_POLICY", message: "Check AI settings", retryable: false } };
  await workerStorage.localSet({ [AI_POLICY_LOCAL_STORAGE_KEY]: policy });
  abortAllAiRequests(); // Existing consent/model is no longer authoritative.
  return { ok: true, policy };
}

const originalTabIds = () => readerStore.getOriginalTabs();

async function verifiedHnTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId <= 0 || typeof chrome.tabs.get !== "function")
    throw new Error("INVALID_TAB");
  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.id !== tabId || typeof tab.url !== "string") throw new Error("INVALID_TAB");
  try {
    if (new URL(tab.url).origin !== "https://news.ycombinator.com") throw new Error("INVALID_TAB");
  } catch { throw new Error("INVALID_TAB"); }
  return tab;
}
const setOriginalTab = (tabId, enabled) => readerStore.setOriginalTab(tabId, enabled);

function safeHackerNewsUrl(value) {
  if (!HarmoNovaMessageBoundary.isSafeOriginalUrl(value)) throw new Error("INVALID_NAVIGATION");
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

async function openOriginalTab(url, windowId) {
  const target = safeHackerNewsUrl(url);
  const tab = await chrome.tabs.create({
    url: "about:blank", active: true,
    ...(Number.isSafeInteger(windowId) ? { windowId } : {}),
  });
  if (!Number.isInteger(tab.id)) throw new Error("INVALID_TAB");
  try {
    await setOriginalTab(tab.id, true); // Must happen before navigation.
    await chrome.tabs.update(tab.id, { url: target });
    return tab.id;
  } catch (error) {
    await setOriginalTab(tab.id, false).catch(() => {});
    throw error;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  setOriginalTab(tabId, false).catch(() => {});
  for(const [key,controller] of workerNetwork.previewConsumers) if(key.startsWith(tabId+":")) {controller.abort();workerNetwork.previewConsumers.delete(key);}
});


  const workerNetwork=HarmoNovaWorkerNetwork.create({
    get MAX_ARTICLE_CHARACTERS(){return MAX_ARTICLE_CHARACTERS;},
    get decodeURIComponent(){return decodeURIComponent;},
    get encodeURIComponent(){return encodeURIComponent;},
    get workerStorage(){return workerStorage;}
  },undefined);
  const previewConsumers=workerNetwork.previewConsumers;
  function imageTint(...args){return workerNetwork.imageTint(...args);}
  function sanitizedImage(...args){return workerNetwork.sanitizedImage(...args);}
  function fetchPolicy(...args){return workerNetwork.fetchPolicy(...args);}
  function verifiedStoryArticleUrl(...args){return workerNetwork.verifiedStoryArticleUrl(...args);}
  function currentNetworkPolicy(...args){return workerNetwork.currentNetworkPolicy(...args);}
  function saveNetworkPolicy(...args){return workerNetwork.saveNetworkPolicy(...args);}
  function getMetadata(...args){return workerNetwork.getMetadata(...args);}
  function readResponseTextLimited(...args){return workerNetwork.readResponseTextLimited(...args);}
  function fetchArticleText(...args){return workerNetwork.fetchArticleText(...args);}
  const workerAI=HarmoNovaWorkerAi.create({
    get AI_KEY_LOCAL_STORAGE_KEY(){return AI_KEY_LOCAL_STORAGE_KEY;},
    get AI_KEY_SESSION_STORAGE_KEY(){return AI_KEY_SESSION_STORAGE_KEY;},
    get MAX_ARTICLE_CHARACTERS(){return MAX_ARTICLE_CHARACTERS;},
    get MAX_SUMMARY_CHARACTERS(){return MAX_SUMMARY_CHARACTERS;},
    get OPENROUTER_CHAT_URL(){return OPENROUTER_CHAT_URL;},
    get currentAiPolicy(){return currentAiPolicy;},
    get fetchArticleText(){return fetchArticleText;},
    get fetchPolicy(){return fetchPolicy;},
    get readResponseTextLimited(){return readResponseTextLimited;},
    get storageCall(){return storageCall;},
    get verifiedStoryArticleUrl(){return verifiedStoryArticleUrl;},
    get workerReady(){return workerReady;},
    get workerStorage(){return workerStorage;}
  },undefined);
  function streamOpenRouter(...args){return workerAI.streamOpenRouter(...args);}
  function jsonOpenRouterSummary(...args){return workerAI.jsonOpenRouterSummary(...args);}
  function summarizeWithOpenRouter(...args){return workerAI.summarizeWithOpenRouter(...args);}
  function aiKeyStatus(...args){return workerAI.aiKeyStatus(...args);}
  function saveAiKey(...args){return workerAI.saveAiKey(...args);}
  function clearAiKey(...args){return workerAI.clearAiKey(...args);}
  function abortAllAiRequests(...args){return workerAI.abortAllAiRequests(...args);}

  // Reset only extension-owned data. Keep minimal revision/migration markers to
  // prevent stale tabs or legacy page backups from resurrecting deleted records.
  async function resetUserData(scope) {
    if(scope==="history") return readerStore.resetHistory();
    if(scope==="saved") return readerStore.resetSaved();
    if(scope!=="settings"&&scope!=="all")return {ok:false};
    if(scope==="all")await readerStore.resetAll();
    const preferences=await preferencesStore.reset();
    if(!preferences.syncSaved)throw new Error("SYNC_UNAVAILABLE");
    await saveNetworkPolicy({version:1,externalPreviewsEnabled:true});
    abortAllAiRequests();
    // Clear both current and migration-era policy keys so stale consent cannot return.
    await workerStorage.localRemove([AI_POLICY_LOCAL_STORAGE_KEY,
      workerStorage.oldStorageKey(AI_POLICY_LOCAL_STORAGE_KEY)]);
    if(scope==="all"){
      await clearAiKey();
      // Remove release notices, old sync keys and obsolete reader backups.
      // A minimal clean reader/preferences state is retained by design.
      const protectedKeys={
        local:new Set(["harmonovaReaderStateV1","harmonovaPreferencesV1","harmonovaNetworkPolicyV1"]),
        sync:new Set(["harmonovaSettings","harmonovaEnabled"]),
        session:new Set(["harmonovaDraftsV2","harmonovaOriginalTabIds"]),
      };
      for(const [name,area] of [["local",chrome.storage.local],["sync",chrome.storage.sync],["session",chrome.storage.session]]){
        const all=await storageCall(area,"get",null);
        const removed=Object.keys(all).filter(key=>/^(harmonova|harmonic)/.test(key)&&!protectedKeys[name].has(key));
        if(removed.length)await storageCall(area,"remove",removed);
      }
    }
    return {ok:true};
  }

  // Delay release checks until after installation; recheck once per day.
  const releaseUpdates=HarmoNovaReleaseUpdates.create({
    localGet:workerStorage.localGet,localSet:workerStorage.localSet,
    fetchRelease:fetch,installedVersion:chrome.runtime.getManifest?.().version || "0.0.0",
    onAvailable:async result=>{
      const tabs=await chrome.tabs.query({url:"https://news.ycombinator.com/*"});
      await Promise.allSettled(tabs.filter(tab=>!tab.incognito&&Number.isInteger(tab.id))
        .map(tab=>chrome.tabs.sendMessage(tab.id,{type:"HARMONOVA_RELEASE_AVAILABLE",tag:result.tag})));
    }
  });
  const RELEASE_ALARM="harmonova-check-github-release";
  if(chrome.alarms?.get&&chrome.alarms?.onAlarm?.addListener){
    chrome.alarms.get(RELEASE_ALARM).then(alarm=>{
      if(!alarm)chrome.alarms.create(RELEASE_ALARM,{delayInMinutes:10,periodInMinutes:1440});
    }).catch(()=>{});
    chrome.alarms.onAlarm.addListener(alarm=>{
      if(alarm.name!==RELEASE_ALARM)return;
      workerReady.then(()=>preferencesStore.snapshot()).then(preferences=>
        releaseUpdates.check(preferences.settings.notifyUpdates!==false)).catch(()=>{});
    });
  }

  HarmoNovaWorkerMessages.create({
    get aiKeyStatus(){return aiKeyStatus;},
    get clearAiKey(){return clearAiKey;},
    get currentAiPolicy(){return currentAiPolicy;},
    get currentNetworkPolicy(){return currentNetworkPolicy;},
    get getMetadata(){return getMetadata;},
    get openOriginalTab(){return openOriginalTab;},
    get originalTabIds(){return originalTabIds;},
    get preferencesStore(){return preferencesStore;},
    get privatePreferencesSnapshot(){return privatePreferencesSnapshot;},
    get readerStore(){return readerStore;},
    get resetUserData(){return resetUserData;},
    get releaseUpdates(){return releaseUpdates;},
    get saveAiKey(){return saveAiKey;},
    get saveAiPolicy(){return saveAiPolicy;},
    get saveNetworkPolicy(){return saveNetworkPolicy;},
    get setOriginalTab(){return setOriginalTab;},
    get verifiedHnTab(){return verifiedHnTab;},
    get workerNetwork(){return workerNetwork;},
    get workerReady(){return workerReady;}
  },undefined);
