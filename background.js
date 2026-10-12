importScripts("url-policy.js", "message-boundary.js", "ai-policy.js", "reader-store.js", "resource-policy.js", "image-policy.js");

const AI_KEY_LOCAL_STORAGE_KEY = "harmonovaAiApiKey";
const AI_KEY_SESSION_STORAGE_KEY = "harmonovaAiApiKeySession";
const AI_POLICY_LOCAL_STORAGE_KEY = "harmonovaAiPolicyV1";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_CHARACTERS = 15_000;
const MAX_SUMMARY_CHARACTERS = 64 * 1024;

// Read old on-disk keys exactly once during upgrades, then store them under the
// HarmoNova namespace. Never overwrite existing new-format data.
const oldStorageKey = (key) => key.replace(/^harmonova(?=[A-Z:])/, "harmonic");
function storageCall(area, method, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(new Error("STORAGE_UNAVAILABLE"));
      else resolve(result);
    };
    try {
      const pending = area[method](...args, (value) => {
        finish(chrome.runtime.lastError, value);
      });
      if (pending && typeof pending.then === "function") pending.then(
        value => finish(null, value), error => finish(error),
      );
    } catch (error) { finish(error); }
  });
}
async function migratedGet(area, keys) {
  const defaults = Array.isArray(keys) ? {} : { ...keys };
  const requested = Array.isArray(keys) ? keys : Object.keys(keys);
  const prior = requested.map(oldStorageKey);
  const raw = await storageCall(area, "get", [...requested, ...prior]);
  const updates = {};
  const removals = [];
  const result = { ...defaults };
  for (const key of requested) {
    const older = oldStorageKey(key);
    if (Object.hasOwn(raw, key)) {
      result[key] = raw[key];
    } else if (older !== key && Object.hasOwn(raw, older)) {
      result[key] = raw[older];
      updates[key] = raw[older];
      removals.push(older);
    }
  }
  if (Object.keys(updates).length) {
    await storageCall(area, "set", updates);
    await storageCall(area, "remove", removals);
  }
  return result;
}
const localGet = (keys) => migratedGet(chrome.storage.local, keys);
const localSet = (value) => storageCall(chrome.storage.local, "set", value);
const localRemove = (keys) => storageCall(chrome.storage.local, "remove", keys);
const sessionGet = (keys) => migratedGet(chrome.storage.session, keys);
const sessionSet = (value) => storageCall(chrome.storage.session, "set", value);
const sessionRemove = (keys) => storageCall(chrome.storage.session, "remove", keys);
const syncGet = (keys) => migratedGet(chrome.storage.sync, keys);
const readerStore = HarmoNovaReaderStore.create({ localGet, localSet, sessionGet, sessionSet,
  broadcast: async (record) => {
    if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
    const tabs = await chrome.tabs.query({ url: "https://news.ycombinator.com/*" });
    await Promise.allSettled(tabs.filter(tab => !tab.incognito && Number.isSafeInteger(tab.id))
      .map(tab => chrome.tabs.sendMessage(tab.id, { type: "HARMONOVA_READER_SNAPSHOT",
        revision: record.revision, readStoryIds: record.readIds, bookmarks: record.bookmarks,
        userTags: record.tags, blockedUsers: record.blockedUsers, seenTimes: record.seenTimes })));
  },
});

// Register listeners synchronously. Every privileged operation awaits the
// same fail-closed worker initialization promise.
const workerReady = Promise.all([chrome.storage.local, chrome.storage.session].map(async area => {
  if (typeof area.setAccessLevel !== "function") throw new Error("STORAGE_UNAVAILABLE");
  await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
})).then(async () => {
  await localGet({ harmonovaSettings: null });
  await sessionGet({ [AI_KEY_SESSION_STORAGE_KEY]: null });
  await localGet({ [AI_POLICY_LOCAL_STORAGE_KEY]: null });
  await readerStore.stateSnapshot();
  if (chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({});
    await readerStore.reconcileOriginalTabs(tabs.map(tab => tab.id));
  }
});
async function currentAiPolicy() {
  const stored = await localGet({ [AI_POLICY_LOCAL_STORAGE_KEY]: null });
  return HarmoNovaAiPolicy.fromStorage(stored[AI_POLICY_LOCAL_STORAGE_KEY]);
}
async function saveAiPolicy(value) {
  const policy = HarmoNovaAiPolicy.normalize(value);
  if (!policy) return { ok: false, error: { code: "INVALID_AI_POLICY", message: "Check AI settings", retryable: false } };
  await localSet({ [AI_POLICY_LOCAL_STORAGE_KEY]: policy });
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
  const budget=HarmoNovaResourcePolicy.Limits[resourceKind];
  if (!budget) throw remoteFetchBlocked();
  return HarmoNovaResourcePolicy.request(fetch,target,settings,budget,expectedTypes);
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
  const text = value.replace(/\s+/g, " ").trim();
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
      return { provider: "github", title: capText(data.full_name, 200), lines };
    },
  };
}

function wikipediaRich(url) {
  const m = /^https:\/\/([a-z-]{2,8})\.wikipedia\.org\/wiki\/([^\/?#]+?)(?:[\/?#]|$)/.exec(url);
  if (!m) return null;
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
      return { provider: "wikipedia", title: capText(data.title, 300), lines };
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

async function getMetadataWork(url, wantRich = false, signal) {
  const cached = metadataCache.get("meta:"+url);
  if (cached && Date.now() - cached.time < 1800000) {
    // A rich preview requested later than the page metadata is filled in once.
    if (wantRich && cached.value.richState === "notRequested") { cached.value.rich = await getRichPreview(url,signal); cached.value.richState=cached.value.rich ? "available" : "unavailable"; }
    return cached.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const richPromise = wantRich ? getRichPreview(url,signal).catch(() => null) : null;
  let value = { image: null, favicon: null, pageUrl: url, tint: null, refused: false, rich: null, richState: wantRich ? "unavailable" : "notRequested" };
  try {
    // SEC-23: never preview or summarize Hacker News pages.
    if (!HarmoNovaUrlPolicy.isAllowedRemoteUrl(url)) {
      value = { image: null, favicon: null, pageUrl: url, tint: null, refused: HarmoNovaUrlPolicy.isHackerNewsUrl(url), rich: null, richState: wantRich ? "unavailable" : "notRequested" };
      metadataCache.set("meta:"+url, { time: Date.now(), value }, !value.image && !value.rich);
      return value;
    }
    const response = await fetchPolicy(url, {
      signal: signal ? AbortSignal.any([signal,controller.signal]) : controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) { await response.body?.cancel(); throw new Error("not html"); }
    const html = await readResponseTextLimited(response, 1500000);
    const base = response.url || url;
    const image = safeImageSrc(absolutize(metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]), base));
    const favicon = safeImageSrc(absolutize(linkHref(html, ["icon", "shortcut", "apple-touch-icon"]), base));
    // HarmoNova tints from the preview image first, then the favicon when a story has no preview.
    const raster=await sanitizedImage(image,signal);
    const icon=await sanitizedImage(favicon,signal);
    value = { image:raster?.src || null, favicon:icon?.src || null,
      imageDimensions:raster ? {width:raster.width,height:raster.height} : null,
      pageUrl: base, tint:raster?.tint || icon?.tint || null, refused: false,
      rich:richPromise ? await richPromise : null, richState:wantRich ? "available" : "notRequested" };
  } catch {} finally {
    clearTimeout(timer);
  }
  metadataCache.set("meta:"+url, { time: Date.now(), value }, !value.image && !value.rich);
  return value;
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

async function fetchArticleText(url, signal) {
  // SEC-23/SEC-24: articles are public, non-HN http(s) documents only.
  if (!HarmoNovaUrlPolicy.isAllowedRemoteUrl(url)) {
    if (HarmoNovaUrlPolicy.isHackerNewsUrl(url)) throw new Error("Hacker News pages can't be summarized");
    throw new Error("Unsupported article URL");
  }
  const parsed = new URL(url);
  const response = await fetchPolicy(parsed.href, {
    resourceKind:"article", signal,
    headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      const error = new Error("Article access denied (HTTP " + response.status + "). This website does not allow HarmoNova to read the article automatically. You can open it in your browser or summarize the public Hacker News discussion instead.");
      error.code = "ARTICLE_ACCESS_DENIED";
      throw error;
    }
    if (response.status === 429) throw new Error("Article website is rate-limiting requests (HTTP 429). Please try later.");
    throw new Error("Article website returned HTTP " + response.status);
  }
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("html") && !contentType.includes("text/plain") && !contentType.includes("xml")) {
    await response.body?.cancel();
    throw new Error("Article is not readable text");
  }
  const raw = await readResponseTextLimited(response, MAX_ARTICLE_BYTES);
  const text = contentType.includes("text/plain") ? raw.trim() : articleTextFromHtml(raw);
  if (!text) throw new Error("Could not extract article text");
  return text.slice(0, MAX_ARTICLE_CHARACTERS);
}

async function aiKeyStorageMode() {
  const synced = await syncGet({ harmonovaAiKeyStorage: "persistent" });
  return synced.harmonovaAiKeyStorage === "session" ? "session" : "persistent";
}

async function getAiKey() {
  const mode = await aiKeyStorageMode();
  const key = mode === "session"
    ? (await sessionGet({ [AI_KEY_SESSION_STORAGE_KEY]: "" }))[AI_KEY_SESSION_STORAGE_KEY]
    : (await localGet({ [AI_KEY_LOCAL_STORAGE_KEY]: "" }))[AI_KEY_LOCAL_STORAGE_KEY];
  return { mode, key: typeof key === "string" ? key : "" };
}

async function aiKeyStatus() {
  const { mode, key } = await getAiKey();
  return {
    ok: true,
    storage: mode,
    hasKey: Boolean(key),
    preview: key ? key.slice(0, 8) + "…" : "Not set",
  };
}

async function saveAiKey(value, storage) {
  const key = String(value || "").trim();
  const mode = storage === "session" ? "session" : "persistent";
  if (!key) throw new Error("API key is required");
  if (mode === "session") {
    await sessionSet({ [AI_KEY_SESSION_STORAGE_KEY]: key });
    await localRemove([AI_KEY_LOCAL_STORAGE_KEY, oldStorageKey(AI_KEY_LOCAL_STORAGE_KEY)]);
  } else {
    await localSet({ [AI_KEY_LOCAL_STORAGE_KEY]: key });
    await sessionRemove([AI_KEY_SESSION_STORAGE_KEY, oldStorageKey(AI_KEY_SESSION_STORAGE_KEY)]);
  }
  await storageCall(chrome.storage.sync, "set", { harmonovaAiKeyStorage: mode });
  return aiKeyStatus();
}

async function clearAiKey() {
  abortAllAiRequests();
  await Promise.all([
    localRemove([AI_KEY_LOCAL_STORAGE_KEY, oldStorageKey(AI_KEY_LOCAL_STORAGE_KEY)]),
    sessionRemove([AI_KEY_SESSION_STORAGE_KEY, oldStorageKey(AI_KEY_SESSION_STORAGE_KEY)]),
  ]);
  return aiKeyStatus();
}

function openRouterError(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || fallback;
  } catch {
    return fallback;
  }
}

function openRouterContent(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    return "";
  }).join("");
}

function emptySummaryError(reason = "", usage = null) {
  const cause = reason === "length"
    ? "The model ran out of output tokens before producing visible text (possibly spent on reasoning)."
    : reason === "content_filter"
      ? "The model or provider filtered the output."
      : "The model returned no visible content.";
  const tokens = Number(usage?.completion_tokens);
  const detail = Number.isFinite(tokens) && tokens > 0 ? " Completion tokens used: " + tokens + "." : "";
  const error = new Error("OpenRouter returned an empty summary. " + cause + detail + " Try a different or non-reasoning model in AI settings.");
  error.code = "EMPTY_SUMMARY";
  return error;
}

async function streamOpenRouter(response, onProgress) {
  if (!response.body) throw new Error("OpenRouter returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary = "";
  let finishReason = "";
  let usage = null;
  let streamBytes = 0;
  let eventCount = 0;
  let finished = false;

  const consumeEvent = (event) => {
    eventCount++;
    if (eventCount > 10000) throw new Error("Streaming event count exceeded size limit");
    const data = event.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return data === "[DONE]";
    let parsed;
    try { parsed = JSON.parse(data); }
    catch { throw new Error("OpenRouter returned invalid streaming data"); }
    if (parsed?.choices?.[0]?.finish_reason === "error" && !parsed.error) throw new Error("OpenRouter stream failed");
    if (parsed?.error) throw new Error(parsed.error.message || "OpenRouter request failed");
    if (parsed?.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
    if (parsed?.usage) usage = parsed.usage;
    const chunk = openRouterContent(parsed?.choices?.[0]?.delta?.content);
    if (chunk) {
      if (summary.length + chunk.length > MAX_SUMMARY_CHARACTERS) throw new Error("Summary exceeded size limit");
      summary += chunk;
      onProgress(summary);
    }
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) throw new Error("Invalid streaming data");
      streamBytes += value.byteLength;
      if (streamBytes > 2 * 1024 * 1024) throw new Error("Streaming response exceeded size limit");
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 128 * 1024) throw new Error("Streaming event exceeded size limit");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (consumeEvent(event)) {
          if (!summary.trim()) throw emptySummaryError(finishReason, usage);
          return summary;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeEvent(buffer);
    if (!summary.trim()) throw emptySummaryError(finishReason, usage);
    return summary;
  } finally {
    if (!finished) try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

async function jsonOpenRouterSummary(response) {
  const json = JSON.parse(await readResponseTextLimited(response, MAX_SUMMARY_CHARACTERS * 2));
  if (json?.error) throw new Error(json.error.message || "OpenRouter request failed");
  const choice = json?.choices?.[0];
  const summary = openRouterContent(choice?.message?.content).trim();
  if (!summary) throw emptySummaryError(choice?.finish_reason, json?.usage);
  if (summary.length > MAX_SUMMARY_CHARACTERS) throw new Error("Summary exceeded size limit");
  return summary;
}

async function summarizeWithOpenRouter(port, message, controller) {
  const storyId = message.storyId;
  const policy = await currentAiPolicy();
  if (!policy.enabled || policy.consentVersion !== 1) {
    const error = new Error("AI consent required"); error.code = "AI_CONSENT_REQUIRED"; throw error;
  }
  const model = policy.model;
  const prompt = policy.systemPrompt;
  const discussion = message.source === "discussion";
  const { key } = await getAiKey();
  if (controller.signal.aborted) throw new Error("Summary cancelled");
  if (!key) throw new Error("OpenRouter API key is not configured");

  port.postMessage({ type: "status", requestId: message.requestId, storyId, status: "extracting" });
  const articleText = discussion
    ? String(message.discussionText || "").slice(0, MAX_ARTICLE_CHARACTERS)
    : await fetchArticleText(await verifiedStoryArticleUrl(storyId, controller.signal), controller.signal);
  if (discussion && articleText.length < 30) {
    throw new Error("Not enough public Hacker News discussion text to summarize.");
  }
  port.postMessage({ type: "status", requestId: message.requestId, storyId, status: "generating", inputCharacters: articleText.length });

  const stream = policy.streamResponses === true;
  const requestPayload = {
    model,
    stream,
    max_tokens: 2200,
    messages: [
      { role: "system", content: discussion
        ? "Summarize ONLY the public Hacker News discussion supplied. You have NOT read the linked article. Identify main points and disagreements without inventing article content."
        : prompt },
      { role: "user", content: articleText },
    ],
  };
  const response = await fetchPolicy(OPENROUTER_CHAT_URL, {
    resourceKind: stream ? "aiStream" : "aiJson",
    method: "POST",
    signal: controller.signal,
    credentials: "omit",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": stream ? "text/event-stream" : "application/json",
      "X-Title": "HarmoNova for Hacker News",
    },
    body: JSON.stringify(requestPayload),
  });
  if (!response.ok) {
    const body = await readResponseTextLimited(response, 16_000).catch(() => "");
    throw new Error(openRouterError(body.slice(0, 16_000), "OpenRouter returned HTTP " + response.status));
  }

  let summary;
  if (stream) {
    try {
      summary = await streamOpenRouter(response, (text) => {
        port.postMessage({ type: "progress", requestId: message.requestId, storyId, text });
      });
    } catch (error) {
      if (error?.code !== "EMPTY_SUMMARY" || controller.signal.aborted || !policy.allowEmptyRetry) throw error;
      // Reasoning-heavy models sometimes exhaust the first budget without text.
      // Make at most one non-streaming recovery attempt with a larger budget.
      port.postMessage({ type: "status", requestId: message.requestId, storyId, status: "generating", detail: "Retrying without streaming…" });
      const retry = await fetchPolicy(OPENROUTER_CHAT_URL, {
        resourceKind:"aiJson",
        method: "POST", signal: controller.signal, credentials: "omit",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json", "X-Title": "HarmoNova for Hacker News" },
        body: JSON.stringify({ ...requestPayload, stream: false, max_tokens: 3500 }),
      });
      if (!retry.ok) {
        const body = await readResponseTextLimited(retry, 16_000).catch(() => "");
        throw new Error("Empty summary retry failed (HTTP " + retry.status + "): " + openRouterError(body, "Provider rejected the retry"));
      }
      summary = await jsonOpenRouterSummary(retry);
    }
  } else {
    summary = await jsonOpenRouterSummary(response);
  }
  port.postMessage({ type: "success", requestId: message.requestId, storyId, text: summary });
}

const activeAiByTab = new Map();
function abortAllAiRequests() {
  for (const controller of activeAiByTab.values()) controller.abort();
  activeAiByTab.clear();
}
chrome.runtime.onConnect.addListener((port) => {
  const authorization = HarmoNovaMessageBoundary.validatePort(port, chrome.runtime);
  if (!authorization.ok) {
    port.disconnect();
    return;
  }
  let controller = null;
  port.onMessage.addListener((message) => {
    const validated = HarmoNovaMessageBoundary.validateAiMessage(message);
    if (!validated.ok) {
      try { port.postMessage({ type: "error", code: validated.error.code,
        message: "AI request rejected", storyId: null }); } catch {}
      return;
    }
    if (message?.type === "cancel") {
      if (controller) {
        controller.abort();
        if (activeAiByTab.get(authorization.tabId) === controller) activeAiByTab.delete(authorization.tabId);
      }
      controller = null;
      return;
    }
    if (message?.type !== "summarize") return;
    if (controller || activeAiByTab.has(authorization.tabId) || activeAiByTab.size >= 2) {
      try { port.postMessage({ type: "error", requestId: message.requestId, storyId: message.storyId,
        code: "AI_BUSY", message: "An AI request is already active" }); } catch {}
      return;
    }
    const requestController = new AbortController();
    controller = requestController;
    activeAiByTab.set(authorization.tabId, requestController);
    const timer = setTimeout(() => requestController.abort(new Error("Summary timed out. Try again.")), 120_000);
    workerReady.then(() => summarizeWithOpenRouter(port, message, requestController))
      .catch((error) => {
        if (controller !== requestController || error?.name === "AbortError") return;
        try {
          port.postMessage({
            type: "error",
            storyId: Number(message.storyId), requestId: message.requestId,
            message: error?.code === "REMOTE_FETCH_BLOCKED" ? "Source unavailable under network privacy rules" : "Summary unavailable",
            code: error?.code === "REMOTE_FETCH_BLOCKED" ? "REMOTE_FETCH_BLOCKED" : "AI_REQUEST_FAILED",
          });
        } catch {}
      })
      .finally(() => {
        clearTimeout(timer);
        if (controller === requestController) controller = null;
        if (activeAiByTab.get(authorization.tabId) === requestController)
          activeAiByTab.delete(authorization.tabId);
      });
  });
  port.onDisconnect.addListener(() => {
    if (controller) {
      controller.abort();
      if (activeAiByTab.get(authorization.tabId) === controller) activeAiByTab.delete(authorization.tabId);
      controller = null;
    }
  });
});

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
