importScripts("url-policy.js");

const ORIGINAL_TAB_STORAGE_KEY = "harmonovaOriginalTabIds";
const AI_KEY_LOCAL_STORAGE_KEY = "harmonovaAiApiKey";
const AI_KEY_SESSION_STORAGE_KEY = "harmonovaAiApiKeySession";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_CHARACTERS = 15_000;
const MAX_SUMMARY_CHARACTERS = 64 * 1024;

// Read old on-disk keys exactly once during upgrades, then store them under the
// HarmoNova namespace. Never overwrite existing new-format data.
const oldStorageKey = (key) => key.replace(/^harmonova(?=[A-Z:])/, "harmonic");
async function migratedGet(area, keys) {
  const defaults = Array.isArray(keys) ? {} : { ...keys };
  const requested = Array.isArray(keys) ? keys : Object.keys(keys);
  const prior = requested.map(oldStorageKey);
  const raw = await new Promise((resolve) => area.get([...requested, ...prior], resolve));
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
    await new Promise((resolve) => area.set(updates, resolve));
    await new Promise((resolve) => area.remove(removals, resolve));
  }
  return result;
}
const localGet = (keys) => migratedGet(chrome.storage.local, keys);
const localSet = (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve));
const localRemove = (keys) => new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
const sessionGet = (keys) => migratedGet(chrome.storage.session, keys);
const sessionSet = (value) => new Promise((resolve) => chrome.storage.session.set(value, resolve));
const sessionRemove = (keys) => new Promise((resolve) => chrome.storage.session.remove(keys, resolve));
const syncGet = (keys) => migratedGet(chrome.storage.sync, keys);

for (const area of [chrome.storage.local, chrome.storage.session]) {
  if (typeof area.setAccessLevel === "function") {
    area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
  }
}

async function originalTabIds() {
  const stored = await sessionGet({ [ORIGINAL_TAB_STORAGE_KEY]: [] });
  return Array.isArray(stored[ORIGINAL_TAB_STORAGE_KEY]) ? stored[ORIGINAL_TAB_STORAGE_KEY].filter(Number.isInteger) : [];
}

async function setOriginalTab(tabId, enabled) {
  if (!Number.isInteger(tabId)) return;
  const ids = new Set(await originalTabIds());
  if (enabled) ids.add(tabId);
  else ids.delete(tabId);
  await sessionSet({ [ORIGINAL_TAB_STORAGE_KEY]: [...ids] });
}

function safeHackerNewsUrl(value) {
  try {
    const url = new URL(value || "https://news.ycombinator.com/news");
    if (url.origin !== "https://news.ycombinator.com") throw new Error("invalid origin");
    url.hash = "";
    return url.href;
  } catch {
    return "https://news.ycombinator.com/news";
  }
}

async function openOriginalTab(url) {
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (!Number.isInteger(tab.id)) throw new Error("missing tab id");
  await setOriginalTab(tab.id, true);
  await chrome.tabs.update(tab.id, { url: safeHackerNewsUrl(url) });
  return tab.id;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  setOriginalTab(tabId, false).catch(() => {});
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
  let response;
  try {
    response = await fetch(target, { ...init, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    throw remoteFetchBlocked();
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) throw remoteFetchBlocked();
  return response;
}

const metadataCache = new Map();
const paletteCache = new Map();

// Phase 7 part 3: rich link previews. Public provider APIs only — fixed,
// allowlisted API hosts derived from the article URL by strict regexes. Every
// field is validated and capped before use; the content script renders the
// result as text only (never HTML). SEC-22/24: fetchPolicy sends no cookies
// and re-validates every redirect hop.
const richPendingCache = new Map();

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

async function fetchRichJson(url) {
  const response = await fetchPolicy(url, {
    signal: AbortSignal.timeout(6000),
    headers: { Accept: "application/json" },
  });
  const type = response.headers ? response.headers.get("content-type") || "" : "";
  if (!response.ok || !type.includes("json")) throw new Error("not json");
  const raw = await response.text();
  if (raw.length > 262144) throw new Error("too large");
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

async function getRichPreview(url) {
  const cached = richPendingCache.get(url);
  if (cached) return cached;
  const job = (async () => {
    const provider = githubRich(url) || wikipediaRich(url) || arxivRich(url);
    if (!provider) return null;
    try {
      if (provider.api.endsWith("/api/query") || provider.api.includes("export.arxiv.org")) {
        const response = await fetchPolicy(provider.api, {
          signal: AbortSignal.timeout(6000),
          headers: { Accept: "application/atom+xml, application/xml, text/xml" },
        });
        const raw = await response.text();
        if (!response.ok || raw.length > 524288) throw new Error("arxiv");
        return provider.parse(raw);
      }
      return provider.parse(await fetchRichJson(provider.api));
    } catch {
      return null;
    }
  })();
  richPendingCache.set(url, job);
  return job;
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

async function imageTint(url) {
  if (!url) return null;
  if (paletteCache.has(url)) return paletteCache.get(url);
  if (!HarmoNovaUrlPolicy.isAllowedRemoteUrl(url)) {
    paletteCache.set(url, null);
    return null;
  }
  try {
    const response = await fetchPolicy(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error("image");
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 32, 32);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let hx = 0, hy = 0, sat = 0, weightSum = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const a = pixels[i + 3] / 255;
      if (a < 0.4) continue;
      const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (l < 0.05 || l > 0.95) continue;
      const w = (0.25 + s) * a;
      const rad = h * Math.PI / 180;
      hx += Math.cos(rad) * w;
      hy += Math.sin(rad) * w;
      sat += s * w;
      weightSum += w;
    }
    if (!weightSum) throw new Error("palette");
    let hue = Math.atan2(hy, hx) * 180 / Math.PI;
    if (hue < 0) hue += 360;
    const sourceSat = sat / weightSum;
    const targetSat = sourceSat >= 0.05 ? Math.max(0.25, Math.min(1, sourceSat)) : sourceSat;
    const tint = hslToRgb(hue, targetSat, 0.42);
    const blended = tint.map((v) => Math.round(v * 0.34));
    const value = hex(blended);
    paletteCache.set(url, value);
    return value;
  } catch {
    paletteCache.set(url, null);
    return null;
  }
}

async function getMetadata(url, wantRich = false) {
  const cached = metadataCache.get(url);
  if (cached && Date.now() - cached.time < 1800000) {
    // A rich preview requested later than the page metadata is filled in once.
    if (wantRich && cached.value.rich === undefined) cached.value.rich = await getRichPreview(url);
    return cached.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const richPromise = wantRich ? getRichPreview(url).catch(() => null) : null;
  let value = { image: null, favicon: null, pageUrl: url, tint: null, refused: false, rich: null };
  try {
    // SEC-23: never preview or summarize Hacker News pages.
    if (!HarmoNovaUrlPolicy.isAllowedRemoteUrl(url)) {
      value = { image: null, favicon: null, pageUrl: url, tint: null, refused: HarmoNovaUrlPolicy.isHackerNewsUrl(url), rich: null };
      metadataCache.set(url, { time: Date.now(), value });
      return value;
    }
    const response = await fetchPolicy(url, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) throw new Error("not html");
    const html = (await response.text()).slice(0, 1500000);
    const base = response.url || url;
    const image = safeImageSrc(absolutize(metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]), base));
    const favicon = safeImageSrc(absolutize(linkHref(html, ["icon", "shortcut", "apple-touch-icon"]), base));
    // HarmoNova tints from the preview image first, then the favicon when a story has no preview.
    value = { image, favicon, pageUrl: base, tint: await imageTint(image || favicon), refused: false, rich: richPromise ? await richPromise : null };
  } catch {} finally {
    clearTimeout(timer);
  }
  metadataCache.set(url, { time: Date.now(), value });
  return value;
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
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeded size limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function fetchArticleText(url, signal) {
  // SEC-23/SEC-24: articles are public, non-HN http(s) documents only.
  if (!HarmoNovaUrlPolicy.isAllowedRemoteUrl(url)) {
    if (HarmoNovaUrlPolicy.isHackerNewsUrl(url)) throw new Error("Hacker News pages can't be summarized");
    throw new Error("Unsupported article URL");
  }
  const parsed = new URL(url);
  const response = await fetchPolicy(parsed.href, {
    signal,
    headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
  });
  if (!response.ok) {
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
  await chrome.storage.sync.set({ harmonovaAiKeyStorage: mode });
  return aiKeyStatus();
}

async function clearAiKey() {
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

  const consumeEvent = (event) => {
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

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.length > MAX_SUMMARY_CHARACTERS * 2) throw new Error("Streaming event exceeded size limit");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (consumeEvent(event)) {
        await reader.cancel();
        if (!summary.trim()) throw emptySummaryError(finishReason, usage);
        return summary;
      }
    }
    if (done) break;
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (!summary.trim()) throw emptySummaryError(finishReason, usage);
  return summary;
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
  const storyId = Number(message.storyId);
  const model = String(message.model || "").trim();
  const prompt = String(message.systemPrompt || "").trim();
  const discussion = message.source === "discussion";
  if (!Number.isInteger(storyId) || (!discussion && !message.url)) throw new Error("Invalid summary request");
  if (!model) throw new Error("Choose an OpenRouter model in Settings");
  if (!prompt) throw new Error("System prompt is empty");

  const { key } = await getAiKey();
  if (!key) throw new Error("OpenRouter API key is not configured");

  port.postMessage({ type: "status", storyId, status: "extracting" });
  const articleText = discussion
    ? String(message.discussionText || "").slice(0, MAX_ARTICLE_CHARACTERS)
    : await fetchArticleText(message.url, controller.signal);
  if (discussion && articleText.length < 30) {
    throw new Error("Not enough public Hacker News discussion text to summarize.");
  }
  port.postMessage({ type: "status", storyId, status: "generating", inputCharacters: articleText.length });

  const stream = message.streamResponses !== false;
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
        port.postMessage({ type: "progress", storyId, text });
      });
    } catch (error) {
      if (error?.code !== "EMPTY_SUMMARY" || controller.signal.aborted) throw error;
      // Reasoning-heavy models sometimes exhaust the first budget without text.
      // Make at most one non-streaming recovery attempt with a larger budget.
      port.postMessage({ type: "status", storyId, status: "generating", detail: "Retrying without streaming…" });
      const retry = await fetchPolicy(OPENROUTER_CHAT_URL, {
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
  port.postMessage({ type: "success", storyId, text: summary });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "harmonova-ai") return;
  let controller = null;
  port.onMessage.addListener((message) => {
    if (message?.type === "cancel") {
      controller?.abort();
      controller = null;
      return;
    }
    if (message?.type !== "summarize") return;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timer = setTimeout(() => requestController.abort(new Error("Summary timed out. Try again.")), 120_000);
    summarizeWithOpenRouter(port, message, requestController)
      .catch((error) => {
        if (controller !== requestController || error?.name === "AbortError") return;
        try {
          port.postMessage({
            type: "error",
            storyId: Number(message.storyId),
            message: error?.message || "Summary failed",
            code: error?.code || "",
          });
        } catch {}
      })
      .finally(() => {
        clearTimeout(timer);
        if (controller === requestController) controller = null;
      });
  });
  port.onDisconnect.addListener(() => controller?.abort());
});

// SEC-52: message senders that carry user data must be the extension's own
// top-frame content script running on Hacker News.
function isTrustedHnContentSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (sender.frameId !== 0) return false;
  const url = sender.tab?.url || sender.url || "";
  try {
    return new URL(url).origin === "https://news.ycombinator.com";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Composer drafts (Phase 3, SEC-50). Drafts live in chrome.storage.session —
// they vanish with the browser session, are keyed by acting username + parent
// item, are capped at 20 KB of text and 50 entries, and are only reachable
// from trusted HarmoNova content-script senders.
// ---------------------------------------------------------------------------

const DRAFTS_KEY = "harmonovaDrafts";
const DRAFT_MAX_BYTES = 20_000;
const DRAFT_MAX_COUNT = 50;

function draftKey(username, parentId) {
  return String(username || "") + ":" + Number(parentId);
}

async function getDrafts() {
  const stored = await sessionGet({ [DRAFTS_KEY]: null });
  const drafts = stored?.[DRAFTS_KEY];
  return drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
}

async function saveDrafts(drafts) {
  await sessionSet({ [DRAFTS_KEY]: drafts });
}

function draftTooLarge(text) {
  try {
    return new Blob([text]).size > DRAFT_MAX_BYTES;
  } catch {
    return text.length > DRAFT_MAX_BYTES;
  }
}

async function draftGet(username, parentId) {
  const drafts = await getDrafts();
  const entry = drafts[draftKey(username, parentId)];
  return entry && typeof entry.text === "string" ? entry.text : "";
}

async function draftSet(username, parentId, text) {
  const drafts = await getDrafts();
  const key = draftKey(username, parentId);
  if (draftTooLarge(text)) {
    const entry = drafts[key];
    return { ok: false, message: "Draft is over 20 KB and was not saved", kept: Boolean(entry) };
  }
  drafts[key] = { text, parentId, username: username || "", updatedAt: Date.now() };
  const keys = Object.keys(drafts);
  if (keys.length > DRAFT_MAX_COUNT) {
    keys
      .sort((a, b) => (drafts[a]?.updatedAt || 0) - (drafts[b]?.updatedAt || 0))
      .slice(0, keys.length - DRAFT_MAX_COUNT)
      .forEach((stale) => delete drafts[stale]);
  }
  await saveDrafts(drafts);
  return { ok: true };
}

async function draftClear(username, parentId) {
  const drafts = await getDrafts();
  delete drafts[draftKey(username, parentId)];
  await saveDrafts(drafts);
}

async function draftClearAll() {
  await sessionRemove([DRAFTS_KEY]);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "HARMONOVA_LOCAL_STATE_GET") {
    if (!isTrustedHnContentSender(sender)) {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    localGet({ readStoryIds: [], harmonovaBookmarks: [], harmonovaSettings: null })
      .then((stored) => sendResponse({
        ok: true,
        readStoryIds: Array.isArray(stored.readStoryIds) ? stored.readStoryIds : [],
        harmonovaBookmarks: Array.isArray(stored.harmonovaBookmarks) ? stored.harmonovaBookmarks : [],
        harmonovaSettings: stored.harmonovaSettings || null,
      }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_READ_IDS_SET") {
    if (!isTrustedHnContentSender(sender)) {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    const ids = Array.isArray(message.ids) ? message.ids.filter(Number.isInteger).slice(-1500) : [];
    localSet({ readStoryIds: ids }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_BOOKMARKS_SET") {
    if (!isTrustedHnContentSender(sender)) {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    const ids = Array.isArray(message.ids) ? message.ids.filter(Number.isInteger) : [];
    localSet({ harmonovaBookmarks: ids }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  // Composer drafts (SEC-50): trusted HN content-script senders only. The
  // acting username always comes from the content script's own session state.
  if (message.type === "HARMONOVA_DRAFT_GET") {
    if (!isTrustedHnContentSender(sender) || !Number.isInteger(message.parentId) || message.parentId <= 0) {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    draftGet(String(message.username || ""), message.parentId)
      .then((text) => sendResponse({ ok: true, text }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_DRAFT_SET") {
    if (!isTrustedHnContentSender(sender) || !Number.isInteger(message.parentId) || message.parentId <= 0 || typeof message.text !== "string") {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    draftSet(String(message.username || ""), message.parentId, message.text)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_DRAFT_CLEAR") {
    if (!isTrustedHnContentSender(sender) || !Number.isInteger(message.parentId) || message.parentId <= 0) {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    draftClear(String(message.username || ""), message.parentId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_DRAFT_CLEAR_ALL") {
    if (!isTrustedHnContentSender(sender)) {
      sendResponse({ ok: false, message: "Untrusted sender" });
      return true;
    }
    draftClearAll()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_AI_STATUS") {
    aiKeyStatus().then(sendResponse).catch((error) => sendResponse({ ok: false, message: error?.message || "Status unavailable" }));
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
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    originalTabIds()
      .then((ids) => sendResponse({ ok: true, original: Number.isInteger(tabId) && ids.includes(tabId) }))
      .catch(() => sendResponse({ ok: false, original: false }));
    return true;
  }
  if (message.type === "HARMONOVA_OPEN_ORIGINAL") {
    openOriginalTab(message.url)
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONOVA_ENABLE_TAB") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    setOriginalTab(tabId, false)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type !== "HARMONOVA_PREVIEW" || typeof message.url !== "string") return;
  if (!isTrustedHnContentSender(sender)) {
    sendResponse({ ok: false });
    return true;
  }
  getMetadata(message.url, message.rich === true)
    .then((value) => sendResponse({ ok: true, ...value }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
