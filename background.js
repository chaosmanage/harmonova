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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;
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
