const ORIGINAL_TAB_STORAGE_KEY = "harmonicOriginalTabIds";
const AI_KEY_LOCAL_STORAGE_KEY = "harmonicAiApiKey";
const AI_KEY_SESSION_STORAGE_KEY = "harmonicAiApiKeySession";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_CHARACTERS = 15_000;
const MAX_SUMMARY_CHARACTERS = 64 * 1024;

const localGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const localSet = (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve));
const localRemove = (keys) => new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
const sessionGet = (keys) => new Promise((resolve) => chrome.storage.session.get(keys, resolve));
const sessionSet = (value) => new Promise((resolve) => chrome.storage.session.set(value, resolve));
const sessionRemove = (keys) => new Promise((resolve) => chrome.storage.session.remove(keys, resolve));
const syncGet = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));

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

const HARMONIC_FONT_URL = "https://raw.githubusercontent.com/SimonHalvdansson/Harmonic-HN/main/resources/src/commonMain/composeResources/font/google_sans_flex_rounded_variable_latin.ttf";
let harmonicFontDataPromise = null;

async function getHarmonicFontDataUrl() {
  if (!harmonicFontDataPromise) {
    harmonicFontDataPromise = (async () => {
      const response = await fetch(HARMONIC_FONT_URL);
      if (!response.ok) throw new Error("font HTTP " + response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return "data:font/ttf;base64," + btoa(binary);
    })().catch((error) => {
      harmonicFontDataPromise = null;
      throw error;
    });
  }
  return harmonicFontDataPromise;
}

const metadataCache = new Map();
const paletteCache = new Map();

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

async function imageTint(url) {
  if (!url) return null;
  if (paletteCache.has(url)) return paletteCache.get(url);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
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

async function getMetadata(url) {
  const cached = metadataCache.get(url);
  if (cached && Date.now() - cached.time < 1800000) return cached.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let value = { image: null, favicon: null, pageUrl: url, tint: null };
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) throw new Error("not html");
    const html = (await response.text()).slice(0, 1500000);
    const base = response.url || url;
    const image = absolutize(metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]), base);
    const favicon = absolutize(linkHref(html, ["icon", "shortcut", "apple-touch-icon"]), base);
    // Harmonic tints from the preview image first, then the favicon when a story has no preview.
    value = { image, favicon, pageUrl: base, tint: await imageTint(image || favicon) };
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
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported article URL");
  const response = await fetch(parsed.href, {
    redirect: "follow",
    signal,
    headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
  });
  if (!response.ok) throw new Error("Article returned HTTP " + response.status);
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
  const synced = await syncGet({ harmonicAiKeyStorage: "persistent" });
  return synced.harmonicAiKeyStorage === "session" ? "session" : "persistent";
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
    await localRemove(AI_KEY_LOCAL_STORAGE_KEY);
  } else {
    await localSet({ [AI_KEY_LOCAL_STORAGE_KEY]: key });
    await sessionRemove(AI_KEY_SESSION_STORAGE_KEY);
  }
  await chrome.storage.sync.set({ harmonicAiKeyStorage: mode });
  return aiKeyStatus();
}

async function clearAiKey() {
  await Promise.all([
    localRemove(AI_KEY_LOCAL_STORAGE_KEY),
    sessionRemove(AI_KEY_SESSION_STORAGE_KEY),
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

async function streamOpenRouter(response, onProgress) {
  if (!response.body) throw new Error("OpenRouter returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary = "";

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
        if (!summary) throw new Error("OpenRouter returned an empty summary");
        return summary;
      }
    }
    if (done) break;
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (!summary) throw new Error("OpenRouter returned an empty summary");
  return summary;
}

async function summarizeWithOpenRouter(port, message, controller) {
  const storyId = Number(message.storyId);
  const model = String(message.model || "").trim();
  const prompt = String(message.systemPrompt || "").trim();
  if (!Number.isInteger(storyId) || !message.url) throw new Error("Invalid summary request");
  if (!model) throw new Error("Choose an OpenRouter model in Settings");
  if (!prompt) throw new Error("System prompt is empty");

  const { key } = await getAiKey();
  if (!key) throw new Error("OpenRouter API key is not configured");

  port.postMessage({ type: "status", storyId, status: "extracting" });
  const articleText = await fetchArticleText(message.url, controller.signal);
  port.postMessage({ type: "status", storyId, status: "generating", inputCharacters: articleText.length });

  const stream = message.streamResponses !== false;
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": stream ? "text/event-stream" : "application/json",
      "X-Title": "Harmonic for Hacker News",
    },
    body: JSON.stringify({
      model,
      stream,
      max_tokens: 1000,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: articleText },
      ],
    }),
  });
  if (!response.ok) {
    const body = await readResponseTextLimited(response, 16_000).catch(() => "");
    throw new Error(openRouterError(body.slice(0, 16_000), "OpenRouter returned HTTP " + response.status));
  }

  let summary;
  if (stream) {
    summary = await streamOpenRouter(response, (text) => {
      port.postMessage({ type: "progress", storyId, text });
    });
  } else {
    const json = JSON.parse(await readResponseTextLimited(response, MAX_SUMMARY_CHARACTERS * 2));
    if (json?.error) throw new Error(json.error.message || "OpenRouter request failed");
    summary = openRouterContent(json?.choices?.[0]?.message?.content).trim();
    if (!summary) throw new Error("OpenRouter returned an empty summary");
    if (summary.length > MAX_SUMMARY_CHARACTERS) throw new Error("Summary exceeded size limit");
  }
  port.postMessage({ type: "success", storyId, text: summary });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "harmonic-ai") return;
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "HARMONIC_LOCAL_STATE_GET") {
    localGet({ readStoryIds: [], harmonicBookmarks: [], harmonicSettings: null })
      .then((stored) => sendResponse({
        ok: true,
        readStoryIds: Array.isArray(stored.readStoryIds) ? stored.readStoryIds : [],
        harmonicBookmarks: Array.isArray(stored.harmonicBookmarks) ? stored.harmonicBookmarks : [],
        harmonicSettings: stored.harmonicSettings || null,
      }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONIC_READ_IDS_SET") {
    const ids = Array.isArray(message.ids) ? message.ids.filter(Number.isInteger).slice(-1500) : [];
    localSet({ readStoryIds: ids }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONIC_BOOKMARKS_SET") {
    const ids = Array.isArray(message.ids) ? message.ids.filter(Number.isInteger) : [];
    localSet({ harmonicBookmarks: ids }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONIC_AI_STATUS") {
    aiKeyStatus().then(sendResponse).catch((error) => sendResponse({ ok: false, message: error?.message || "Status unavailable" }));
    return true;
  }
  if (["HARMONIC_AI_SAVE_KEY", "HARMONIC_AI_CLEAR_KEY"].includes(message.type)
      && sender.url !== chrome.runtime.getURL("ai-settings.html")) {
    sendResponse({ ok: false, message: "Use the extension credential settings page" });
    return;
  }
  if (message.type === "HARMONIC_AI_SAVE_KEY") {
    saveAiKey(message.apiKey, message.storage)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Could not save API key" }));
    return true;
  }
  if (message.type === "HARMONIC_AI_CLEAR_KEY") {
    clearAiKey().then(sendResponse).catch((error) => sendResponse({ ok: false, message: error?.message || "Could not clear API key" }));
    return true;
  }
  if (message.type === "HARMONIC_OPEN_AI_SETTINGS") {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONIC_TAB_MODE") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    originalTabIds()
      .then((ids) => sendResponse({ ok: true, original: Number.isInteger(tabId) && ids.includes(tabId) }))
      .catch(() => sendResponse({ ok: false, original: false }));
    return true;
  }
  if (message.type === "HARMONIC_OPEN_ORIGINAL") {
    openOriginalTab(message.url)
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONIC_ENABLE_TAB") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    setOriginalTab(tabId, false)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "HARMONIC_FONT") {
    getHarmonicFontDataUrl()
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type !== "HARMONIC_PREVIEW" || typeof message.url !== "string") return;
  getMetadata(message.url)
    .then((value) => sendResponse({ ok: true, ...value }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
