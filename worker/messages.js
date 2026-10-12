// Isolated-world HarmoNovaWorkerMessages module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
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

const previewKey = (sender, requestId) => sender.tab.id + ":" + (sender.documentId || "legacy") + ":" + requestId;
function dispatchWorkerMessage(message, sender, sendResponse) {
  if (!message) return;
  const reply = promise => {
    promise.then(sendResponse).catch(() => sendResponse({ ok: false, error: {
      code: "STORAGE_UNAVAILABLE", message: "Reader data could not be saved", retryable: true } }));
    return true;
  };
  if(message.type === "HARMONOVA_PREFERENCES_GET")return reply((sender.tab?.incognito ? dependencies.privatePreferencesSnapshot():dependencies.preferencesStore.snapshot()).then(value=>({ok:true,value})));
  if(message.type === "HARMONOVA_PREFERENCES_PATCH")return reply(dependencies.preferencesStore.patch(message.fields,message.enabled));
  if(message.type === "HARMONOVA_MIGRATE_PREFERENCES")return reply(dependencies.preferencesStore.migrate(message.appearance));
  if(message.type === "HARMONOVA_NETWORK_POLICY_GET") return reply(dependencies.currentNetworkPolicy().then(policy=>({ok:true,policy})));
  if(message.type === "HARMONOVA_NETWORK_POLICY_SAVE") return reply(dependencies.saveNetworkPolicy(message.policy));
  if(message.type === "HARMONOVA_PREVIEW_CANCEL") {dependencies.workerNetwork.previewConsumers.get(previewKey(sender,message.requestId))?.abort();sendResponse({ok:true});return true;}
  if (message.type === "HARMONOVA_LOCAL_STATE_GET")
    return reply(dependencies.readerStore.stateSnapshot().then(record => ({ ok: true,
      revision: record.revision, pageOriginMigrated: record.pageOriginMigrated === true,
      readStoryIds: record.readIds, harmonovaBookmarks: record.bookmarks,
      userTags: record.tags, blockedUsers: record.blockedUsers, seenTimes: record.seenTimes })));
  if (message.type === "HARMONOVA_MARK_READ") return reply(dependencies.readerStore.markRead(message.id));
  if (message.type === "HARMONOVA_SET_BOOKMARK") return reply(dependencies.readerStore.setBookmark(message.id, message.desired));
  if (message.type === "HARMONOVA_IMPORT_READER_DATA") return reply(dependencies.readerStore.importData(message.data));
  if (message.type === "HARMONOVA_MIGRATE_PAGE_DATA") return reply(dependencies.readerStore.migratePageData(message.data));
  if (message.type === "HARMONOVA_SET_TAG") return reply(dependencies.readerStore.setTag(message.username, message.tag));
  if (message.type === "HARMONOVA_SET_BLOCKED") return reply(dependencies.readerStore.setBlocked(message.username, message.desired));
  if (message.type === "HARMONOVA_MARK_SEEN") return reply(dependencies.readerStore.markSeen(message.id, message.timestamp));
  if (message.type === "HARMONOVA_DRAFT_BEGIN") return reply(dependencies.readerStore.beginDraft(message.username, message.parentId));
  if (message.type === "HARMONOVA_DRAFT_SET") return reply(dependencies.readerStore.saveDraft(message.username,
    message.parentId, message.token, message.revision, message.text));
  if (message.type === "HARMONOVA_DRAFT_CLEAR") return reply(dependencies.readerStore.clearDraft(message.username,
    message.parentId, message.token));
  if (message.type === "HARMONOVA_DRAFT_RETIRE") return reply(Promise.resolve(dependencies.readerStore.retireDraft(message.token)));
  if (message.type === "HARMONOVA_DRAFT_CLEAR_ALL") return reply(dependencies.readerStore.clearAccountDrafts(message.username));
  if (message.type === "HARMONOVA_AI_STATUS") {
    const caller = HarmoNovaMessageBoundary.senderKind(sender, chrome.runtime);
    Promise.all([dependencies.aiKeyStatus(), dependencies.currentAiPolicy()]).then(([status, policy]) => {
      if (caller === "options") sendResponse({ ...status, policy });
      else sendResponse({ ok: true, hasKey: Boolean(status.hasKey),
        ...HarmoNovaAiPolicy.view(policy) });
    }).catch(() => sendResponse({ ok: false,
      error: { code: "STORAGE_UNAVAILABLE", message: "Status unavailable", retryable: true } }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_POLICY_GET") {
    dependencies.currentAiPolicy().then(policy => sendResponse({ ok: true, policy }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_POLICY_SAVE") {
    dependencies.saveAiPolicy(message.policy).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (["HARMONOVA_AI_SAVE_KEY", "HARMONOVA_AI_CLEAR_KEY"].includes(message.type)
      && sender.url !== chrome.runtime.getURL("ai-settings.html")) {
    sendResponse({ ok: false, message: "Use the extension credential settings page" });
    return;
  }
  if (message.type === "HARMONOVA_AI_SAVE_KEY") {
    dependencies.saveAiKey(message.apiKey, message.storage)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Could not save API key" }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_CLEAR_KEY") {
    dependencies.clearAiKey().then(sendResponse).catch((error) => sendResponse({ ok: false, message: error?.message || "Could not clear API key" }));
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
      if (kind === "popup") await dependencies.verifiedHnTab(tabId);
      const ids = await dependencies.originalTabIds();
      sendResponse({ ok: true, original: ids.includes(tabId) });
    })().catch(() => sendResponse({ ok: false, original: false }));
    return true;
  }
  if (message.type === "HARMONOVA_OPEN_ORIGINAL") {
    (async () => {
      const kind = HarmoNovaMessageBoundary.senderKind(sender, chrome.runtime);
      const ownerTab = kind === "popup" ? await dependencies.verifiedHnTab(message.tabId) : sender.tab;
      const tabId = await dependencies.openOriginalTab(message.url, ownerTab.windowId);
      sendResponse({ ok: true, tabId });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_ENABLE_TAB") {
    dependencies.verifiedHnTab(message.tabId)
      .then(() => dependencies.setOriginalTab(message.tabId, false))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type !== "HARMONOVA_PREVIEW" || typeof message.url !== "string") return;
  if (!isTrustedHnContentSender(sender)) {
    sendResponse({ ok: false });
    return true;
  }
  const requestKey=previewKey(sender,message.requestId);
  if(dependencies.workerNetwork.previewConsumers.size>=100 || dependencies.workerNetwork.previewConsumers.has(requestKey)) {sendResponse({ok:false});return true;}
  const controller=new AbortController();dependencies.workerNetwork.previewConsumers.set(requestKey,controller);
  dependencies.getMetadata(message.url, message.rich === true, controller.signal)
    .then((value) => sendResponse({ ok: true, ...value }))
    .catch(() => sendResponse({ ok: false }))
    .finally(()=>dependencies.workerNetwork.previewConsumers.delete(requestKey));
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
  dependencies.workerReady.then(() => dispatchWorkerMessage(message, sender, sendResponse))
    .catch(() => sendResponse({
      ok: false, error: { code: "WORKER_UNAVAILABLE", message: "Extension storage is unavailable", retryable: true },
    }));
  return true;
});

    return Object.freeze({});
  }
  globalThis.HarmoNovaWorkerMessages=Object.freeze({create});
})();
