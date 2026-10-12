// Worker-only message schemas. Page DOM fields are never sources of authority.
// This classic script is imported by background.js before listeners register.
(() => {
  "use strict";
  const HN = "https://news.ycombinator.com";
  const MAX_URL = 4096;
  const MAX_DRAFT = 20_000;
  const id = value => Number.isSafeInteger(value) && value > 0;
  const username = value => typeof value === "string" &&
    value.length <= 32 && /^[A-Za-z0-9_-]+$/.test(value);
  const text = (value, max) => typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <= max;
  const url = value => typeof value === "string" &&
    value.length <= MAX_URL && /^https?:\/\//i.test(value);
  const noFields = (message, fields) =>
    Object.keys(message).every(key => fields.includes(key));
  const fail = code => ({ ok: false, error: { code, message: "Request not permitted", retryable: false } });
  function senderKind(sender, runtime) {
    if (!sender || sender.id !== runtime.id || typeof sender.url !== "string") return null;
    if (sender.url === runtime.getURL("popup.html")) return "popup";
    if (sender.url === runtime.getURL("ai-settings.html")) return "options";
    if (sender.frameId !== 0 || !id(sender.tab?.id)) return null;
    try {
      const parsed = new URL(sender.url);
      if (parsed.origin !== HN || parsed.username || parsed.password) return null;
      if (sender.origin !== undefined && sender.origin !== HN) return null;
      return "hn";
    } catch { return null; }
  }
  const RULES = Object.freeze({
    HARMONOVA_LOCAL_STATE_GET: { from: ["hn"], fields: [], reader: true },
    HARMONOVA_MARK_READ: { from: ["hn"], fields: ["id"], reader: true,
      valid: m => id(m.id) },
    HARMONOVA_MARK_UNREAD: { from: ["hn"], fields: ["id"], reader: true,
      valid: m => id(m.id) },
    HARMONOVA_SET_BOOKMARK: { from: ["hn"], fields: ["id", "desired"], reader: true,
      valid: m => id(m.id) && typeof m.desired === "boolean" },
    HARMONOVA_IMPORT_READER_DATA: { from: ["hn"], fields: ["data"], reader: true,
      valid: m => m.data && typeof m.data === "object" && !Array.isArray(m.data) },
    HARMONOVA_MIGRATE_PAGE_DATA: { from: ["hn"], fields: ["data"], reader: true,
      valid: m => m.data && typeof m.data === "object" && !Array.isArray(m.data) },
    HARMONOVA_SET_TAG: { from: ["hn"], fields: ["username", "tag"], reader: true,
      valid: m => username(m.username) && (m.tag === null || text(m.tag, 40)) },
    HARMONOVA_SET_BLOCKED: { from: ["hn"], fields: ["username", "desired"], reader: true,
      valid: m => username(m.username) && typeof m.desired === "boolean" },
    HARMONOVA_MARK_SEEN: { from: ["hn"], fields: ["id", "timestamp"], reader: true,
      valid: m => id(m.id) && Number.isSafeInteger(m.timestamp) && m.timestamp >= 0 },
    HARMONOVA_DRAFT_BEGIN: { from: ["hn"], fields: ["username", "parentId"], reader: true,
      valid: m => username(m.username) && id(m.parentId) },
    HARMONOVA_DRAFT_SET: { from: ["hn"], fields: ["username", "parentId", "text", "token", "revision"], reader: true,
      valid: m => username(m.username) && id(m.parentId) && text(m.text, MAX_DRAFT) &&
        typeof m.token === "string" && m.token.length <= 100 && Number.isSafeInteger(m.revision) && m.revision >= 0 },
    HARMONOVA_DRAFT_CLEAR: { from: ["hn"], fields: ["username", "parentId", "token"], reader: true,
      valid: m => username(m.username) && id(m.parentId) && typeof m.token === "string" && m.token.length <= 100 },
    HARMONOVA_DRAFT_RETIRE: { from: ["hn"], fields: ["token"], reader: true,
      valid: m => typeof m.token === "string" && m.token.length <= 100 },
    HARMONOVA_DRAFT_CLEAR_ALL: { from: ["hn"], fields: ["username"], reader: true,
      valid: m => username(m.username) },
    HARMONOVA_RELEASE_STATUS: {from:["hn"],fields:[]},
    HARMONOVA_RELEASE_IGNORE: {from:["hn"],fields:["tag"],valid:m=>typeof m.tag==="string" && /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(m.tag)},
    HARMONOVA_PREFERENCES_GET: {from:["hn","popup","options"],fields:[]},
    HARMONOVA_PREFERENCES_PATCH: {from:["hn","popup"],fields:["fields","enabled"],valid:m=>HarmoNovaSettingsSchema.patch(m.fields)!==null && (m.enabled===undefined||typeof m.enabled==="boolean")},
    HARMONOVA_MIGRATE_PREFERENCES: {from:["hn"],fields:["appearance"],reader:true,valid:m=>m.appearance && typeof m.appearance==="object" && !Array.isArray(m.appearance)},
    HARMONOVA_NETWORK_POLICY_GET: {from:["hn","options"],fields:[]},
    HARMONOVA_NETWORK_POLICY_SAVE: {from:["options"],fields:["policy"],valid:m=>m.policy && typeof m.policy==="object" && !Array.isArray(m.policy)},
    HARMONOVA_AI_STATUS: { from: ["hn", "options"], fields: [] },
    HARMONOVA_AI_POLICY_GET: { from: ["options"], fields: [] },
    HARMONOVA_AI_POLICY_SAVE: { from: ["options"], fields: ["policy"],
      valid: m => m.policy && typeof m.policy === "object" && !Array.isArray(m.policy) },
    HARMONOVA_AI_SAVE_KEY: { from: ["options"], fields: ["apiKey", "storage"],
      valid: m => text(m.apiKey, 4096) && m.apiKey.length > 0 &&
        ["persistent", "session"].includes(m.storage) },
    HARMONOVA_AI_CLEAR_KEY: { from: ["options"], fields: [] },
    HARMONOVA_OPEN_AI_SETTINGS: { from: ["hn", "popup"], fields: [] },
    HARMONOVA_TAB_MODE: { from: ["hn", "popup"], fields: ["tabId"],
      valid: (m, kind) => kind === "hn" ? m.tabId === undefined : id(m.tabId) },
    HARMONOVA_OPEN_ORIGINAL: { from: ["hn", "popup"], fields: ["url", "tabId"],
      valid: (m, kind) => url(m.url) && isSafeOriginalUrl(m.url) &&
        (kind === "hn" ? m.tabId === undefined : id(m.tabId)) },
    HARMONOVA_ENABLE_TAB: { from: ["popup"], fields: ["tabId"],
      valid: m => id(m.tabId) },
    HARMONOVA_PREVIEW_CANCEL: {from:["hn"],fields:["requestId"],valid:m=>text(m.requestId,96)},
    HARMONOVA_PREVIEW: { from: ["hn"], fields: ["url", "rich", "requestId"],
      valid: m => url(m.url) && (m.requestId===undefined || text(m.requestId,96)) && (m.rich === undefined || typeof m.rich === "boolean") },
  });
  function isSafeOriginalUrl(value) {
    try {
      const target = new URL(value);
      if (target.origin !== HN || target.username || target.password || target.port) return false;
      const path = target.pathname;
      const fixed = new Set(["/", "/news", "/newest", "/past", "/front", "/newcomments",
        "/ask", "/show", "/jobs", "/submit", "/login", "/best", "/pool", "/active",
        "/bestcomments", "/launches", "/whoishiring", "/noobstories", "/classic"]);
      const named = new Set(["/user", "/threads", "/submitted", "/favorites", "/upvoted", "/hidden"]);
      const item = new Set(["/item", "/edit", "/reply", "/delete-confirm"]);
      const site = new Set(["/from"]);
      if (fixed.has(path)) return !target.search || (path === "/login" &&
        [...target.searchParams.keys()].every(k => k === "goto") &&
        ["news", "newest", "ask", "show", "jobs"].includes(target.searchParams.get("goto")));
      if (item.has(path)) return /^[1-9][0-9]*$/.test(target.searchParams.get("id") || "") &&
        id(Number(target.searchParams.get("id"))) &&
        [...target.searchParams.keys()].every(k => ["id", "p", "goto"].includes(k)) &&
        (!target.searchParams.has("goto") || ["/reply", "/delete-confirm"].includes(path)) &&
        (target.searchParams.get("goto") === null ||
          /^item\?id=[1-9][0-9]*$/.test(target.searchParams.get("goto")));
      if (named.has(path)) return username(target.searchParams.get("id")) &&
        [...target.searchParams.keys()].every(k => k === "id");
      if (site.has(path)) return text(target.searchParams.get("site"), 255) &&
        [...target.searchParams.keys()].every(k => k === "site");
      return false; // No logout, vote, fave, flag, hide, comment or auth handoff
    } catch { return false; }
  }
  function validateMessage(message, sender, runtime) {
    const kind = senderKind(sender, runtime);
    if (!kind || !message || typeof message !== "object" || Array.isArray(message)) return fail("INVALID_SENDER");
    const policy = typeof message.type === "string" && Object.hasOwn(RULES, message.type) ? RULES[message.type] : null;
    if (!policy || !policy.from.includes(kind)) return fail("UNAUTHORIZED_OPERATION");
    if (sender.tab?.incognito === true &&
        !["HARMONOVA_TAB_MODE", "HARMONOVA_OPEN_ORIGINAL", "HARMONOVA_PREFERENCES_GET"].includes(message.type))
      return fail("PRIVATE_STATE_UNAVAILABLE");
    if (!noFields(message, ["type", ...policy.fields]) || (policy.valid && !policy.valid(message, kind)))
      return fail("INVALID_REQUEST");
    return { ok: true, kind, tabId: kind === "hn" ? sender.tab.id : null,
      incognito: sender.tab?.incognito === true };
  }
  function validatePort(port, runtime) {
    if (port?.name !== "harmonova-ai") return fail("UNKNOWN_PORT");
    const kind = senderKind(port.sender, runtime);
    if (kind !== "hn" || port.sender.tab?.incognito === true)
      return fail("UNAUTHORIZED_AI_CALLER");
    return { ok: true, tabId: port.sender.tab.id, kind };
  }
  // P02 bounds the legacy AI protocol; P03 removes model/prompt/URL authority.
  const AI_FIELDS = ["type", "requestId", "storyId", "source", "discussionText", "url", "model", "systemPrompt", "streamResponses"];
  function validateAiMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return fail("INVALID_REQUEST");
    if (message.type === "cancel" && noFields(message, ["type", "requestId"]) &&
        typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(message.requestId))
      return { ok: true };
    if (message.type !== "summarize" || !noFields(message, AI_FIELDS) ||
      !id(message.storyId) ||
      (message.requestId !== undefined && (typeof message.requestId !== "string" ||
        message.requestId.length > 96 || !/^[A-Za-z0-9_-]+$/.test(message.requestId))) ||
      (message.url !== undefined && !url(message.url)) ||
      (message.model !== undefined && !text(message.model, 200)) ||
      (message.systemPrompt !== undefined && !text(message.systemPrompt, 8192)) ||
      (message.streamResponses !== undefined && typeof message.streamResponses !== "boolean") ||
      !["article", "discussion"].includes(message.source) ||
      (message.discussionText !== undefined && !text(message.discussionText, 16000)))
      return fail("INVALID_AI_REQUEST");
    return { ok: true };
  }
  globalThis.HarmoNovaMessageBoundary = Object.freeze({
    senderKind, validateMessage, validatePort, validateAiMessage,
    isSafeOriginalUrl, RULES,
  });
})();
