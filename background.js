importScripts("worker/network.js", "worker/ai.js", "worker/storage.js", "settings-schema.js", "preferences-store.js", "url-policy.js", "message-boundary.js", "ai-policy.js", "reader-store.js", "resource-policy.js", "image-policy.js", "provider-policy.js");

const AI_KEY_LOCAL_STORAGE_KEY = "harmonovaAiApiKey";
const AI_KEY_SESSION_STORAGE_KEY = "harmonovaAiApiKeySession";
const AI_POLICY_LOCAL_STORAGE_KEY = "harmonovaAiPolicyV1";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
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
// SEC-52: message senders that carry user data must be the extension's own
// top-frame content script running on Hacker News.
function isTrustedHnContentSender(sender) {
  return HarmoNovaMessageBoundary.senderKind(sender, chrome.runtime) === "hn";
}

// ---------------------------------------------------------------------------
// Composer drafts (Phase 3, SEC-50). Drafts live in chrome.storage.session —
// they vanish with the browser session, are keyed by acting username + parent
// item, are capped at 20 KB of text and 50 entries, and are only reachable
// from trusted HarmoNova content-script senders.
// ---------------------------------------------------------------------------

function dispatchWorkerMessage(message, sender, sendResponse) {
  if (!message) return;
  const reply = promise => {
    promise.then(sendResponse).catch(() => sendResponse({ ok: false, error: {
      code: "STORAGE_UNAVAILABLE", message: "Reader data could not be saved", retryable: true } }));
    return true;
  };
  if(message.type === "HARMONOVA_PREFERENCES_GET")return reply((sender.tab?.incognito ? privatePreferencesSnapshot():preferencesStore.snapshot()).then(value=>({ok:true,value})));
  if(message.type === "HARMONOVA_PREFERENCES_PATCH")return reply(preferencesStore.patch(message.fields,message.enabled));
  if(message.type === "HARMONOVA_MIGRATE_PREFERENCES")return reply(preferencesStore.migrate(message.appearance));
  if(message.type === "HARMONOVA_NETWORK_POLICY_GET") return reply(currentNetworkPolicy().then(policy=>({ok:true,policy})));
  if(message.type === "HARMONOVA_NETWORK_POLICY_SAVE") return reply(saveNetworkPolicy(message.policy));
  if(message.type === "HARMONOVA_PREVIEW_CANCEL") {workerNetwork.previewConsumers.get(sender.tab.id+":"+message.requestId)?.abort();sendResponse({ok:true});return true;}
  if (message.type === "HARMONOVA_LOCAL_STATE_GET")
    return reply(readerStore.stateSnapshot().then(record => ({ ok: true,
      revision: record.revision, pageOriginMigrated: record.pageOriginMigrated === true,
      readStoryIds: record.readIds, harmonovaBookmarks: record.bookmarks,
      userTags: record.tags, blockedUsers: record.blockedUsers, seenTimes: record.seenTimes })));
  if (message.type === "HARMONOVA_MARK_READ") return reply(readerStore.markRead(message.id));
  if (message.type === "HARMONOVA_SET_BOOKMARK") return reply(readerStore.setBookmark(message.id, message.desired));
  if (message.type === "HARMONOVA_IMPORT_READER_DATA") return reply(readerStore.importData(message.data));
  if (message.type === "HARMONOVA_MIGRATE_PAGE_DATA") return reply(readerStore.migratePageData(message.data));
  if (message.type === "HARMONOVA_SET_TAG") return reply(readerStore.setTag(message.username, message.tag));
  if (message.type === "HARMONOVA_SET_BLOCKED") return reply(readerStore.setBlocked(message.username, message.desired));
  if (message.type === "HARMONOVA_MARK_SEEN") return reply(readerStore.markSeen(message.id, message.timestamp));
  if (message.type === "HARMONOVA_DRAFT_BEGIN") return reply(readerStore.beginDraft(message.username, message.parentId));
  if (message.type === "HARMONOVA_DRAFT_SET") return reply(readerStore.saveDraft(message.username,
    message.parentId, message.token, message.revision, message.text));
  if (message.type === "HARMONOVA_DRAFT_CLEAR") return reply(readerStore.clearDraft(message.username,
    message.parentId, message.token));
  if (message.type === "HARMONOVA_DRAFT_RETIRE") return reply(Promise.resolve(readerStore.retireDraft(message.token)));
  if (message.type === "HARMONOVA_DRAFT_CLEAR_ALL") return reply(readerStore.clearAccountDrafts(message.username));
  if (message.type === "HARMONOVA_AI_STATUS") {
    const caller = HarmoNovaMessageBoundary.senderKind(sender, chrome.runtime);
    Promise.all([aiKeyStatus(), currentAiPolicy()]).then(([status, policy]) => {
      if (caller === "options") sendResponse({ ...status, policy });
      else sendResponse({ ok: true, hasKey: Boolean(status.hasKey),
        ...HarmoNovaAiPolicy.view(policy) });
    }).catch(() => sendResponse({ ok: false,
      error: { code: "STORAGE_UNAVAILABLE", message: "Status unavailable", retryable: true } }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_POLICY_GET") {
    currentAiPolicy().then(policy => sendResponse({ ok: true, policy }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_POLICY_SAVE") {
    saveAiPolicy(message.policy).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (["HARMONOVA_AI_SAVE_KEY", "HARMONOVA_AI_CLEAR_KEY"].includes(message.type)
      && sender.url !== chrome.runtime.getURL("ai-settings.html")) {
    sendResponse({ ok: false, message: "Use the extension credential settings page" });
    return;
  }
  if (message.type === "HARMONOVA_AI_SAVE_KEY") {
    saveAiKey(message.apiKey, message.storage)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Could not save API key" }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_CLEAR_KEY") {
    clearAiKey().then(sendResponse).catch((error) => sendResponse({ ok: false, message: error?.message || "Could not clear API key" }));
    return true;
  }
  if (message.type === "HARMONOVA_OPEN_AI_SETTINGS") {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_TAB_MODE") {
    (async () => {
      const kind = HarmoNovaMessageBoundary.senderKind(sender, chrome.runtime);
      const tabId = kind === "hn" ? sender.tab.id : message.tabId;
      if (kind === "popup") await verifiedHnTab(tabId);
      const ids = await originalTabIds();
      sendResponse({ ok: true, original: ids.includes(tabId) });
    })().catch(() => sendResponse({ ok: false, original: false }));
    return true;
  }
  if (message.type === "HARMONOVA_OPEN_ORIGINAL") {
    (async () => {
      const kind = HarmoNovaMessageBoundary.senderKind(sender, chrome.runtime);
      const ownerTab = kind === "popup" ? await verifiedHnTab(message.tabId) : sender.tab;
      const tabId = await openOriginalTab(message.url, ownerTab.windowId);
      sendResponse({ ok: true, tabId });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_ENABLE_TAB") {
    verifiedHnTab(message.tabId)
      .then(() => setOriginalTab(message.tabId, false))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type !== "HARMONOVA_PREVIEW" || typeof message.url !== "string") return;
  if (!isTrustedHnContentSender(sender)) {
    sendResponse({ ok: false });
    return true;
  }
  const requestKey=sender.tab.id+":"+message.requestId;
  if(workerNetwork.previewConsumers.size>=100 || workerNetwork.previewConsumers.has(requestKey)) {sendResponse({ok:false});return true;}
  const controller=new AbortController();workerNetwork.previewConsumers.set(requestKey,controller);
  getMetadata(message.url, message.rich === true, controller.signal)
    .then((value) => sendResponse({ ok: true, ...value }))
    .catch(() => sendResponse({ ok: false }))
    .finally(()=>workerNetwork.previewConsumers.delete(requestKey));
  return true;
}

// One synchronous registration and one validated, initialized dispatcher.
// Unknown senders/operations never reach business logic or storage.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const permission = HarmoNovaMessageBoundary.validateMessage(message, sender, chrome.runtime);
  if (!permission.ok) {
    sendResponse(permission);
    return true;
  }
  workerReady.then(() => dispatchWorkerMessage(message, sender, sendResponse))
    .catch(() => sendResponse({
      ok: false, error: { code: "WORKER_UNAVAILABLE", message: "Extension storage is unavailable", retryable: true },
    }));
  return true;
});
