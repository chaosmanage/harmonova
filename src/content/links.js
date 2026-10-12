// Isolated-world HarmoNovaContentLinks module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  const relativeTime = (epochSeconds) => {
    const seconds = Math.max(1, Math.floor(Date.now() / 1000 - epochSeconds));
    if (seconds < 60) return "now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d";
    if (seconds < 8 * 604800) return Math.floor(seconds / 604800) + "w";
    if (seconds < 365 * 86400) return Math.floor(seconds / (30 * 86400)) + "mo";
    return Math.floor(seconds / (365 * 86400)) + "y";
  };

  const domainOf = (url) => {
    if (!url) return "news.ycombinator.com";
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return "news.ycombinator.com"; }
  };

  const compact = (value) => {
    const n = Number(value || 0);
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "") + "k";
    return (n / 1000000).toFixed(1).replace(".0", "") + "m";
  };

  const formatTime = (date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const hashTint = (text) => {
    let hash = 2166136261;
    for (const ch of String(text || "")) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const hue = Math.abs(hash) % 360;
    return "hsl(" + hue + " 64% 16%)";
  };

  const safeHref = (href) => {
    try {
      const url = new URL(href, "https://news.ycombinator.com");
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  };

  // Only worker-reencoded, bounded PNG bytes are rendered. There is no
  // original URL or credentialed network fallback in an error handler.
  const safeImageSrc = href => typeof href==="string" && href.length<=350000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(href) ? href : null;

  // SEC-41: every external link resolves through safeHref, falling back to the HN item.
  const articleHref = (story) => safeHref(story?.url) || "https://news.ycombinator.com/item?id=" + story.id;

  const setStoryLink = (anchor, story) => { anchor.href = articleHref(story); };
  // "View on archive": the article URL on the Wayback Machine (never HN fallbacks).
  const archiveHref = (story) => {
    const raw = safeHref(story?.url);
    return raw ? "https://web.archive.org/web/2/" + raw : null;
  };
  const openArchive = (story) => {
    const href = archiveHref(story);
    if (href) window.open(href, "_blank", "noopener");
  };


    return Object.freeze({get relativeTime(){return relativeTime;},
get domainOf(){return domainOf;},
get compact(){return compact;},
get formatTime(){return formatTime;},
get hashTint(){return hashTint;},
get safeHref(){return safeHref;},
get safeImageSrc(){return safeImageSrc;},
get articleHref(){return articleHref;},
get setStoryLink(){return setStoryLink;},
get archiveHref(){return archiveHref;},
get openArchive(){return openArchive;}});
  }
  globalThis.HarmoNovaContentLinks=Object.freeze({create});
})();
