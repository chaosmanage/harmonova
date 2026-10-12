importScripts("worker/ai.js", "worker/storage.js", "settings-schema.js", "preferences-store.js", "url-policy.js", "message-boundary.js", "ai-policy.js", "reader-store.js", "resource-policy.js", "image-policy.js", "provider-policy.js");

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
  for(const [key,controller] of previewConsumers) if(key.startsWith(tabId+":")) {controller.abort();previewConsumers.delete(key);}
});

// All privileged external fetches fail closed on redirects.
function remoteFetchBlocked() {
  const error = new Error("REMOTE_FETCH_BLOCKED");
  error.code = "REMOTE_FETCH_BLOCKED";
  return error;
}
async function fetchPolicy(value, init = {}) {
  const target = HarmoNovaUrlPolicy.canonicalRemoteUrl(value);
  if (!target) throw remoteFetchBlocked();
  const { resourceKind = "metadata", expectedTypes, ...settings } = init;
  if(!HarmoNovaProviderPolicy.allowed(value,resourceKind,settings.method || "GET"))throw remoteFetchBlocked();
  const budget=HarmoNovaResourcePolicy.Limits[resourceKind];
  if (!budget) throw remoteFetchBlocked();
  const types={storyLookup:["application/json"],richJson:["application/json"],atom:["application/atom+xml","application/xml","text/xml"],image:["image/png","image/jpeg","image/webp"],aiJson:["application/json"],aiStream:["text/event-stream"]};
  try {return await HarmoNovaResourcePolicy.request(fetch,target,settings,budget,types[resourceKind]);}
  catch(error) {if(error?.code?.startsWith("RESOURCE_") || ["RESPONSE_TOO_LARGE","UNSUPPORTED_CONTENT_TYPE"].includes(error?.code))throw error;throw remoteFetchBlocked();}
}

async function verifiedStoryArticleUrl(storyId, signal) {
  if (!Number.isSafeInteger(storyId) || storyId <= 0) throw remoteFetchBlocked();
  const response = await fetchPolicy(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`, { signal, resourceKind:"storyLookup" });
  if (!response.ok) throw remoteFetchBlocked();
  const record = JSON.parse(await readResponseTextLimited(response, 8192));
  if (record?.type !== "story" || record?.id !== storyId || typeof record.url !== "string")
    throw remoteFetchBlocked();
  const url = HarmoNovaUrlPolicy.canonicalRemoteUrl(record.url);
  if (!url) throw remoteFetchBlocked();
  return url;
}

const metadataCache = HarmoNovaResourcePolicy.lru();
const paletteCache = HarmoNovaResourcePolicy.lru({maxEntries:40,maxBytes:8*1024*1024,ttl:600000});

// Phase 7 part 3: rich link previews. Public provider APIs only — fixed,
// allowlisted API hosts derived from the article URL by strict regexes. Every
// field is validated and capped before use; the content script renders the
// result as text only (never HTML). SEC-22/24: fetchPolicy sends no cookies
// and re-validates every redirect hop.
const richPendingCache = metadataCache;

const capText = (value, max) => {
  if (typeof value !== "string") return null;
  const text = value.slice(0,max*4).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

const capCount = (value) => {
  // Strictly numeric: JSON null, strings, and booleans never become 0.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), 1e12);
};

const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

async function fetchRichJson(url, signal) {
  const response = await fetchPolicy(url, {
    resourceKind:"article", signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    resourceKind:"richJson", expectedTypes:["application/json"],
    headers: { Accept: "application/json" },
  });
  const type = response.headers ? response.headers.get("content-type") || "" : "";
  if (!response.ok || !type.includes("json")) { await response.body?.cancel(); throw new Error("not json"); }
  const raw = await readResponseTextLimited(response, 256 * 1024);
  return JSON.parse(raw);
}

function githubRich(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,100})\/([A-Za-z0-9._-]{1,100})(?:[\/?#]|$)/.exec(url);
  if (!m) return null;
  return {
    api: "https://api.github.com/repos/" + m[1] + "/" + m[2],
    parse: (data) => {
      if (!plainObject(data)) return null;
      const lines = [];
      const stars = capCount(data.stargazers_count);
      const forks = capCount(data.forks_count);
      const issues = capCount(data.open_issues_count);
      const stats = [
        stars !== null ? "★ " + stars.toLocaleString("en-US") : null,
        forks !== null ? forks.toLocaleString("en-US") + " forks" : null,
        issues !== null ? issues.toLocaleString("en-US") + " issues" : null,
      ].filter(Boolean);
      if (stats.length) lines.push(stats.join(" · "));
      const lang = capText(data.language, 60);
      if (lang) lines.push("Language: " + lang);
      const license = plainObject(data.license) ? capText(data.license.spdx_id, 40) : null;
      if (license && license !== "NOASSERTION") lines.push("License: " + license);
      return { provider: "github", title: capText(data.full_name, 200), lines, imageUrl:typeof data.owner?.avatar_url==="string" ? data.owner.avatar_url.slice(0,4096) : null };
    },
  };
}

function wikipediaRich(url) {
  const m = /^https:\/\/([a-z-]{2,8})\.wikipedia\.org\/wiki\/([^\/?#]+?)(?:[\/?#]|$)/.exec(url);
  if (!m || !HarmoNovaProviderPolicy.languages.includes(m[1])) return null;
  let title = "";
  try { title = decodeURIComponent(m[2]); } catch { title = m[2]; }
  title = title.slice(0, 300);
  if (!title) return null;
  return {
    api: "https://" + m[1] + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title),
    parse: (data) => {
      if (!plainObject(data) || data.type === "disambiguation") return null;
      const lines = [];
      const extract = capText(data.extract, 600);
      if (extract) lines.push(extract);
      return { provider: "wikipedia", title: capText(data.title, 300), lines, imageUrl:typeof data.thumbnail?.source==="string" ? data.thumbnail.source.slice(0,4096) : null };
    },
  };
}

function arxivRich(url) {
  const m = /^https:\/\/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]{2,30}\/[0-9]{7})(?:v[0-9]+)?(?:[?#]|$)/.exec(url);
  if (!m) return null;
  return {
    api: "https://export.arxiv.org/api/query?id_list=" + encodeURIComponent(m[1]) + "&max_results=1",
    parse: (raw) => {
      const entry = /<entry>[\s\S]*?<\/entry>/.exec(raw);
      if (!entry) return null;
      const pick = (tag, max) => {
        const value = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">").exec(entry[0]);
        return value ? capText(value[1].replace(/<[^>]+>/g, " "), max) : null;
      };
      const lines = [];
      const summary = pick("summary", 600);
      if (summary) lines.push(summary);
      const authors = [...entry[0].matchAll(/<name>([^<]{1,120})<\/name>/g)]
        .slice(0, 3)
        .map((match) => capText(match[1], 120))
        .filter(Boolean);
      if (authors.length) lines.push("By " + authors.join(", "));
      const published = /<published>(\d{4})-/.exec(entry[0]);
      if (published) lines.push("Published " + published[1]);
      return { provider: "arxiv", title: pick("title", 300), lines };
    },
  };
}

async function getRichPreview(url, signal) {
  const cached = richPendingCache.get("rich:"+url);
  if (cached) return cached;
  const job = (async () => {
    const provider = githubRich(url) || wikipediaRich(url) || arxivRich(url);
    if (!provider) return null;
    try {
      if (provider.api.endsWith("/api/query") || provider.api.includes("export.arxiv.org")) {
        const response = await fetchPolicy(provider.api, {
          signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
          resourceKind:"atom",
          headers: { Accept: "application/atom+xml, application/xml, text/xml" },
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error("arxiv"); }
        const raw = await readResponseTextLimited(response, 512 * 1024);
        return provider.parse(raw);
      }
      return provider.parse(await fetchRichJson(provider.api,signal));
    } catch {
      return null;
    }
  })();
  const result = await job;
  richPendingCache.set("rich:"+url,result,!result);
  return result;
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function absolutize(value, base) {
  if (!value) return null;
  try { return new URL(decodeEntities(value.trim()), base).href; }
  catch { return null; }
}

function metaContent(html, names) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const name of names) {
    for (const tag of tags) {
      const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (key !== name.toLowerCase()) continue;
      const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (content) return decodeEntities(content);
    }
  }
  return null;
}

function linkHref(html, relNames) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
    if (!relNames.some((name) => rel.split(/\s+/).includes(name))) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) return decodeEntities(href);
  }
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
  }
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

function hex(rgb) {
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// SEC-42: images used by HarmoNova must be https and must never point at HN.
function safeImageSrc(value, base) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value, base || undefined);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (HarmoNovaUrlPolicy.isHackerNewsHost(url.hostname)) return null;
  return url.href;
}

async function sanitizedImage(url,signal) {
  if(!url)return null;
  const canonical=HarmoNovaUrlPolicy.canonicalRemoteUrl(url);
  if(!canonical || !canonical.startsWith("https:"))return null;
  const cached=paletteCache.get(canonical);if(cached!==undefined)return cached;
  try {
    const response=await fetchPolicy(canonical,{signal,resourceKind:"image",expectedTypes:["image/png","image/jpeg","image/webp"]});
    if(!response.ok){await response.body?.cancel();throw new Error("IMAGE_UNAVAILABLE");}
    const mime=response.headers.get("content-type").split(";")[0].trim().toLowerCase();
    const bytes=await HarmoNovaResourcePolicy.readBytes(response,2*1024*1024);
    const value=await HarmoNovaImagePolicy.sanitize(bytes,mime,signal);
    paletteCache.set(canonical,value);return value;
  } catch {paletteCache.set(canonical,null,true);return null;}
}
async function imageTint(url,signal) {return (await sanitizedImage(url,signal))?.tint || null;}

const NETWORK_POLICY_KEY="harmonovaNetworkPolicyV1";
async function currentNetworkPolicy() {
  const value=(await workerStorage.localGet({[NETWORK_POLICY_KEY]:null}))[NETWORK_POLICY_KEY];
  return {version:1,externalPreviewsEnabled:value?.version===1 && value.externalPreviewsEnabled===true};
}
async function saveNetworkPolicy(policy) {
  if(!policy||Object.keys(policy).some(k=>!["version","externalPreviewsEnabled"].includes(k))||policy.version!==1||typeof policy.externalPreviewsEnabled!=="boolean")return {ok:false};
  await workerStorage.localSet({[NETWORK_POLICY_KEY]:policy});
  for(const controller of previewConsumers.values())controller.abort();
  previewConsumers.clear(); metadataCache.clear();paletteCache.clear();
  return {ok:true,policy};
}
async function getMetadataWork(url,wantRich=false,signal) {
  const empty={image:null,favicon:null,tint:null,rich:null,richState:wantRich?"unavailable":"notRequested",pageUrl:url,
    refused:HarmoNovaUrlPolicy.isHackerNewsUrl(url),unavailableReason:"Previews are available only for supported providers."};
  if(!(await currentNetworkPolicy()).externalPreviewsEnabled)return {...empty,unavailableReason:"External previews are disabled."};
  const canonical=HarmoNovaUrlPolicy.canonicalRemoteUrl(url);if(!canonical)return empty;
  const key="meta:"+wantRich+":"+canonical;
  const cached=metadataCache.get(key);if(cached)return cached;
  if(!wantRich)return empty;
  const facts=await getRichPreview(canonical,signal);
  const raster=await sanitizedImage(facts?.imageUrl,signal);
  if(signal?.aborted || !(await currentNetworkPolicy()).externalPreviewsEnabled)return empty;
  const value={...empty,image:raster?.src||null,tint:raster?.tint||null,
    imageDimensions:raster?{width:raster.width,height:raster.height}:null,
    rich:wantRich && facts ? {provider:facts.provider,title:facts.title,lines:facts.lines}:null,
    richState:wantRich?(facts?"available":"unavailable"):"notRequested"};
  metadataCache.set(key,value,!facts);return value;
}

const previewConsumers = new Map();
async function getMetadata(url, wantRich=false, signal) {
  const key=String(wantRich)+":"+url;
  return HarmoNovaResourcePolicy.shared(key, controller=>getMetadataWork(url,wantRich,controller.signal), signal);
}


function decodeHtmlText(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
    rdquo: "”", ldquo: "“",
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, token) => {
    if (token[0] === "#") {
      const hex = token[1]?.toLowerCase() === "x";
      const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(code)) {
        try { return String.fromCodePoint(code); } catch {}
      }
      return match;
    }
    return named[token.toLowerCase()] ?? match;
  });
}

function articleTextFromHtml(html) {
  let value = String(html || "");
  const body = value.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body) value = body[1];
  value = value
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|article|section|main|header|footer|li|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlText(value)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readResponseTextLimited(response, maxBytes) {
  return HarmoNovaResourcePolicy.readText(response, maxBytes);
}

async function fetchArticleText(url,signal) {
  if(HarmoNovaUrlPolicy.isHackerNewsUrl(url))throw new Error("Hacker News pages can't be summarized");
  const canonical=HarmoNovaUrlPolicy.canonicalRemoteUrl(url);
  if(!canonical)throw new Error("Unsupported article URL");
  if(!(githubRich(canonical)||wikipediaRich(canonical)||arxivRich(canonical)))throw remoteFetchBlocked();
  const facts=await getRichPreview(canonical,signal);
  const text=[facts?.title,...facts?.lines||[]].filter(Boolean).join("\n").slice(0,MAX_ARTICLE_CHARACTERS);
  if(!text)throw new Error("Provider text unavailable. Summarize the public Hacker News discussion instead.");
  return text;
}


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
  if(message.type === "HARMONOVA_PREVIEW_CANCEL") {previewConsumers.get(sender.tab.id+":"+message.requestId)?.abort();sendResponse({ok:true});return true;}
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
  if(previewConsumers.size>=100 || previewConsumers.has(requestKey)) {sendResponse({ok:false});return true;}
  const controller=new AbortController();previewConsumers.set(requestKey,controller);
  getMetadata(message.url, message.rich === true, controller.signal)
    .then((value) => sendResponse({ ok: true, ...value }))
    .catch(() => sendResponse({ ok: false }))
    .finally(()=>previewConsumers.delete(requestKey));
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
