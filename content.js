(() => {
  const HN_API = "https://hacker-news.firebaseio.com/v0";
  const ALGOLIA_API = "https://hn.algolia.com/api/v1";
  const FEED_BATCH_SIZE = 40;
  const SETTINGS_BACKUP_KEY = "harmonic:settings:v1";
  const ENABLED_BACKUP_KEY = "harmonic:enabled:v1";
  const SETTINGS_HASH = "#harmonic-settings";
  const ORIGINAL_HASH = "#harmonic-original";
  const FEEDS = {
    top: { path: "/news", label: "Top Stories", endpoint: "topstories" },
    new: { path: "/newest", label: "New Stories", endpoint: "newstories" },
    best: { path: "/best", label: "Best Stories", endpoint: "beststories" },
    ask: { path: "/ask", label: "Ask HN", endpoint: "askstories" },
    show: { path: "/show", label: "Show HN", endpoint: "showstories" },
    jobs: { path: "/jobs", label: "Jobs", endpoint: "jobstories" },
  };
  const PATH_TO_FEED = Object.fromEntries(Object.entries(FEEDS).map(([key, value]) => [value.path, key]));
  PATH_TO_FEED["/"] = "top";

  const DEFAULT_SETTINGS = {
    previewImages: "small",
    tintedCards: true,
    showFavicons: true,
    showPoints: true,
    showComments: true,
    showIndex: true,
    dimRead: true,
    commentStyle: "outlined",
    depthMode: "colors",
    roundedRails: true,
    continuousRails: false,
    storyTextSize: 17.5,
    commentTextSize: 15,
    contentScale: 100,
    commentSort: "Default",
    cardClickComments: false,
    alwaysOpenComments: false,
    headerTint: true,
    headerImage: true,
    aiEnabled: true,
    aiModel: "openrouter/free",
    aiSystemPrompt: "You are a helpful assistant that is an expert on summarizing articles into an information-dense, concise and brief bullet-point list. Focus on key takeaways and most important/note-worthy points in the article. Keep the summary under 500 characters where possible. Respond in markdown format. Respond with only the summarized content - nothing else before or after.",
    aiStreamResponses: true,
    aiAutoSummarize: false,
  };

  const ICONS = {
    chevron: '<path d="M7 10l5 5 5-5z"/>',
    search: '<path d="M9.5 3a6.5 6.5 0 104.08 11.56L19 20l1-1-5.44-5.42A6.5 6.5 0 009.5 3zm0 1.8a4.7 4.7 0 110 9.4 4.7 4.7 0 010-9.4z"/>',
    more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    comment: '<path d="M4 4.5h16v12H9l-4.2 3.1.7-3.1H4v-12zm1.8 1.8v8.4h2.3l-.3 1.4 1.6-1.4h8.8V6.3H5.8z"/>',
    up: '<path d="M12 3l6 7h-4v9h-4v-9H6l6-7z"/>',
    thumb: '<path d="M8.5 10.5 12 4c.9 0 1.6.7 1.6 1.6v3.2H19a2 2 0 0 1 1.9 2.5l-1.5 6A2.2 2.2 0 0 1 17.3 19H8.5V10.5Z"/><path d="M4 10.5h4.5V19H4z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<path d="M12 3.2a4 4 0 110 8 4 4 0 010-8zm0 9.8c4.4 0 7 2.2 7 5v1H5v-1c0-2.8 2.6-5 7-5z"/>',
    star: '<path d="M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.82l-5.5 2.9 1.05-6.12L3.1 9.27l6.15-.9L12 2.8zm0 4.1l-1.55 3.14-3.47.5 2.51 2.45-.59 3.45 3.1-1.63 3.1 1.63-.59-3.45 2.51-2.45-3.47-.5L12 6.9z"/>',
    sparkle: '<path d="M12 2l1.3 4.2L17.5 7.5l-4.2 1.3L12 13l-1.3-4.2-4.2-1.3 4.2-1.3L12 2zm6 9l.8 2.7 2.7.8-2.7.8L18 18l-.8-2.7-2.7-.8 2.7-.8L18 11zM6 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/>',
    share: '<path d="M18 16a3 3 0 00-2.4 1.2L8.9 13.4a3.4 3.4 0 000-2.8l6.7-3.8A3 3 0 1014.9 5L8.2 8.8a3 3 0 100 6.4l6.7 3.8A3 3 0 1018 16z"/>',
    link: '<path d="M9.2 15.8l-1.4 1.4a3.4 3.4 0 01-4.8-4.8l3-3a3.4 3.4 0 014.8 0l.8.8-1.3 1.3-.8-.8a1.6 1.6 0 00-2.2 0l-3 3a1.6 1.6 0 002.2 2.2l1.4-1.4 1.3 1.3zm5.6-7.6l1.4-1.4a3.4 3.4 0 014.8 4.8l-3 3a3.4 3.4 0 01-4.8 0l-.8-.8 1.3-1.3.8.8a1.6 1.6 0 002.2 0l3-3a1.6 1.6 0 00-2.2-2.2l-1.4 1.4-1.3-1.3zM8.6 14.1l5.5-5.5 1.3 1.3-5.5 5.5-1.3-1.3z"/>',
    settings: '<path d="M19.4 13a7.7 7.7 0 000-2l2-1.5-2-3.4-2.4 1a7 7 0 00-1.8-1L15 3.5h-4L10.6 6a7 7 0 00-1.8 1l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 000 2l-2 1.5 2 3.4 2.4-1a7 7 0 001.8 1l.4 2.5h4l.4-2.5a7 7 0 001.8-1l2.4 1 2-3.4-2-1.5zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>',
    refresh: '<path d="M12 20a8 8 0 1 1 5.65-13.65L20 4v7h-7l2.65-2.65A5.15 5.15 0 1 0 17.05 14h2.2A7.35 7.35 0 0 1 12 20z"/>',
    power: '<path d="M11 3h2v9h-2V3zm5.66 2.34 1.42-1.42A9 9 0 1 1 5.92 3.92l1.42 1.42A7 7 0 1 0 16.66 5.34z"/>',
    close: '<path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5z"/>',
    external: '<path d="M13 4h7v7h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H13V4zM5 6h6v2H7v9h9v-4h2v6H5V6z"/>',
  };

  const svg = (name, className = "") => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", "harmonic-icon " + className);
    s.innerHTML = ICONS[name] || "";
    return s;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = (iconName, label, className = "icon-button") => {
    const b = el("button", className);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(svg(iconName));
    return b;
  };

  const state = {
    feed: PATH_TO_FEED[location.pathname] || "top",
    stories: [],
    selectedId: location.pathname === "/item" ? Number(new URLSearchParams(location.search).get("id")) : null,
    selectedStory: null,
    thread: null,
    previewById: new Map(),
    readIds: new Set(),
    bookmarks: new Set(),
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: new Date(),
    feedGeneration: 0,
    feedIds: [],
    feedCursor: 0,
    loadingMore: false,
    hasMoreStories: true,
    summaries: new Map(),
    activeSummary: null,
    summaryGeneration: 0,
    search: {
      mode: "loaded", // "loaded" filters loaded stories; "global" searches all of HN
      active: false, // global search results are currently displayed
      tag: "story",
      range: "any", // any | day | week | month | year
      minPoints: "",
      author: "",
      sort: "relevance", // relevance | newest
      page: 0,
      nbPages: 1,
      hits: [],
      query: "",
      controller: null,
      debounceTimer: 0,
      seq: 0,
      recent: [], // memory only — never persisted (SEC-51)
    },
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  };

  const fetchItems = async (ids) => {
    const safeIds = ids.filter((id) => Number.isInteger(id) && id > 0).slice(0, 60);
    const results = new Array(safeIds.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(10, safeIds.length) }, async () => {
      while (cursor < safeIds.length) {
        const index = cursor++;
        results[index] = await fetchJson(HN_API + "/item/" + safeIds[index] + ".json");
      }
    });
    await Promise.all(workers);
    return results.filter(Boolean);
  };

  const relativeTime = (epochSeconds) => {
    const seconds = Math.max(1, Math.floor(Date.now() / 1000 - epochSeconds));
    if (seconds < 60) return "now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d";
    return Math.floor(seconds / 604800) + "w";
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

  // SEC-42: images must be https and must never point at the HN origin.
  const safeImageSrc = (href) => {
    try {
      const url = new URL(href, "https://news.ycombinator.com");
      if (url.protocol !== "https:") return null;
      if (url.hostname === "news.ycombinator.com" || url.hostname.endsWith(".ycombinator.com")) return null;
      return url.href;
    } catch { return null; }
  };

  // SEC-41: every external link resolves through safeHref, falling back to the HN item.
  const articleHref = (story) => safeHref(story?.url) || "https://news.ycombinator.com/item?id=" + story.id;

  // SEC-51: incognito keeps read state, bookmarks, drafts, and search history in memory only.
  const INCOGNITO = Boolean(chrome.extension?.inIncognitoContext);

  const normalizeQuotedParagraphs = (target) => {
    const stripQuoteMarkers = (quote) => {
      const walker = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        node.textContent = (node.textContent || "").replace(/(^|\n)(\s*)>\s?/g, "$1$2");
      }
    };

    target.querySelectorAll("blockquote").forEach((quote) => {
      quote.classList.add("harmonic-quote");
      stripQuoteMarkers(quote);
    });

    target.querySelectorAll("p").forEach((paragraph) => {
      const text = paragraph.textContent || "";
      if (!text.trimStart().startsWith(">")) return;
      const quote = document.createElement("blockquote");
      quote.className = "harmonic-quote";
      while (paragraph.firstChild) quote.appendChild(paragraph.firstChild);
      stripQuoteMarkers(quote);
      paragraph.replaceWith(quote);
    });

    for (const node of [...target.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || "";
      if (!text.trimStart().startsWith(">")) continue;
      const quote = document.createElement("blockquote");
      quote.className = "harmonic-quote";
      quote.textContent = text.replace(/(^|\n)(\s*)>\s?/g, "$1$2");
      node.replaceWith(quote);
    }
  };

  const appendSanitizedHtml = (target, html) => {
    if (!html) return;
    const parsed = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
    const allowed = new Set(["P", "A", "PRE", "CODE", "I", "EM", "B", "STRONG", "BR", "BLOCKQUOTE"]);
    const copy = (source, parent) => {
      for (const child of source.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          parent.appendChild(document.createTextNode(child.textContent || ""));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (!allowed.has(child.tagName)) {
          copy(child, parent);
          continue;
        }
        const out = document.createElement(child.tagName.toLowerCase());
        if (child.tagName === "A") {
          const href = safeHref(child.getAttribute("href") || "");
          if (!href) { copy(child, parent); continue; }
          out.href = href;
          out.target = "_blank";
          out.rel = "noopener noreferrer";
        }
        copy(child, out);
        parent.appendChild(out);
      }
    };
    copy(parsed.body, target);
    normalizeQuotedParagraphs(target);
  };

  const chromeSyncGet = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
  const chromeSyncSet = (value) => new Promise((resolve) => chrome.storage.sync.set(value, resolve));
  const runtimeMessage = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, message: chrome.runtime.lastError.message });
      resolve(response || { ok: false });
    });
  });

  function pageStorageGet(key) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? undefined : JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  function pageStorageSet(key, value) {
    if (INCOGNITO) return; // SEC-51: no page-origin backups from incognito
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  async function loadEnabledPreference() {
    const synced = await chromeSyncGet(["harmonicEnabled"]);
    let enabled = typeof synced.harmonicEnabled === "boolean" ? synced.harmonicEnabled : pageStorageGet(ENABLED_BACKUP_KEY);
    if (typeof enabled !== "boolean") enabled = true;
    if (typeof synced.harmonicEnabled !== "boolean") await chromeSyncSet({ harmonicEnabled: enabled });
    pageStorageSet(ENABLED_BACKUP_KEY, enabled);
    return enabled;
  }

  async function isOriginalTab() {
    if (location.hash === ORIGINAL_HASH) return true;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "HARMONIC_TAB_MODE" }, (response) => {
        resolve(Boolean(response?.original));
      });
    });
  }

  async function saveSettings() {
    const settings = { ...state.settings };
    pageStorageSet(SETTINGS_BACKUP_KEY, settings);
    await chromeSyncSet({ harmonicSettings: settings });
  }

  async function loadHarmonicFont() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "HARMONIC_FONT" }, (result) => resolve(result));
      });
      if (!response?.ok || !response.dataUrl || typeof FontFace !== "function") return false;
      const face = new FontFace("Google Sans Flex Rounded", `url(${response.dataUrl})`, {
        style: "normal",
        weight: "100 900",
        display: "swap",
      });
      await face.load();
      document.fonts.add(face);
      document.documentElement.classList.add("harmonic-font-loaded");
      return true;
    } catch {
      return false;
    }
  }

  async function loadPersistentState() {
    const [stored, synced] = await Promise.all([
      runtimeMessage({ type: "HARMONIC_LOCAL_STATE_GET" }),
      chromeSyncGet(["harmonicSettings"]),
    ]);
    const backedUpSettings = pageStorageGet(SETTINGS_BACKUP_KEY);
    const readIds = Array.isArray(stored?.readStoryIds) ? stored.readStoryIds : [];
    const bookmarks = Array.isArray(stored?.harmonicBookmarks) ? stored.harmonicBookmarks : [];
    const settings = synced.harmonicSettings || backedUpSettings || stored?.harmonicSettings || DEFAULT_SETTINGS;
    state.readIds = new Set(readIds);
    state.bookmarks = new Set(bookmarks);
    state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    pageStorageSet(SETTINGS_BACKUP_KEY, state.settings);
    if (!synced.harmonicSettings) await chromeSyncSet({ harmonicSettings: state.settings });
  }

  async function markRead(id) {
    if (!id) return;
    state.readIds.add(id);
    if (!INCOGNITO) {
      const readStoryIds = [...state.readIds].slice(-1500);
      await runtimeMessage({ type: "HARMONIC_READ_IDS_SET", ids: readStoryIds });
    }
    document.querySelector('[data-story-id="' + id + '"]')?.classList.add("is-read");
  }

  async function toggleBookmark(id) {
    if (state.bookmarks.has(id)) state.bookmarks.delete(id);
    else state.bookmarks.add(id);
    if (!INCOGNITO) {
      await runtimeMessage({ type: "HARMONIC_BOOKMARKS_SET", ids: [...state.bookmarks] });
    }
    document.querySelectorAll('[data-bookmark-id="' + id + '"]').forEach((node) => {
      node.classList.toggle("active", state.bookmarks.has(id));
    });
  }

  const getPreview = (story) => new Promise((resolve) => {
    if (!story?.url) return resolve({ image: null, tint: null, favicon: null });
    if (state.previewById.has(story.id)) return resolve(state.previewById.get(story.id));
    const timer = setTimeout(() => resolve({ image: null, tint: null, favicon: null }), 7000);
    chrome.runtime.sendMessage({ type: "HARMONIC_PREVIEW", url: story.url }, (response) => {
      clearTimeout(timer);
      const value = response?.ok ? response : { image: null, tint: null, favicon: null };
      state.previewById.set(story.id, value);
      resolve(value);
    });
  });

  const faviconUrl = (story) => {
    if (!story?.url) return null;
    try {
      const host = new URL(story.url).hostname;
      return safeImageSrc("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=128");
    } catch { return null; }
  };

  let app, feedPane, threadPane, storyList, feedTitle, updatedLabel, searchWrap, searchInput;
  let searchPanel, searchFilters, searchRecent, searchChips;

  function applySettings() {
    if (!app) return;
    app.dataset.preview = state.settings.previewImages;
    app.dataset.tint = String(state.settings.tintedCards);
    app.dataset.favicons = String(state.settings.showFavicons);
    app.dataset.points = String(state.settings.showPoints);
    app.dataset.comments = String(state.settings.showComments);
    app.dataset.index = String(state.settings.showIndex);
    app.dataset.dimread = String(state.settings.dimRead);
    app.dataset.commentStyle = state.settings.commentStyle;
    app.dataset.depth = state.settings.depthMode;
    app.dataset.roundedRails = String(state.settings.roundedRails);
    app.dataset.continuousRails = String(state.settings.continuousRails);
    app.dataset.headerTint = String(state.settings.headerTint);
    app.dataset.headerImage = String(state.settings.headerImage);
    const contentScale = Math.max(0.75, Math.min(1.25, Number(state.settings.contentScale || 100) / 100));
    const storySetting = Number(state.settings.storyTextSize || 17.5);
    const storyScale = storySetting / 17.5;
    const commentSetting = Number(state.settings.commentTextSize || 15);
    app.dataset.cardClickComments = String(state.settings.cardClickComments);
    // Harmonic's semantic settings rendered at desktop density. The Android app's dp/sp
    // values are physically larger on a high-density display, so this preserves the same
    // visual scale on a standard-density laptop instead of shrinking the UI.
    app.style.setProperty("--story-text-size", ((23 + (storySetting - 17.5) * 1.25) * contentScale) + "px");
    app.style.setProperty("--story-index-size", ((22 + (storySetting - 17.5) * 1.2) * contentScale) + "px");
    app.style.setProperty("--story-meta-size", (16.5 * storyScale * contentScale) + "px");
    app.style.setProperty("--story-comment-count-size", (19 * storyScale * contentScale) + "px");
    app.style.setProperty("--comment-text-size", ((19 + (commentSetting - 15) * 1.2) * contentScale) + "px");
    app.style.setProperty("--story-pad-y", (15 * contentScale) + "px");
    app.style.setProperty("--story-pad-x", (13 * contentScale) + "px");
    app.style.setProperty("--story-gap", (9 * contentScale) + "px");
    app.style.setProperty("--comment-pad-y", (14 * contentScale) + "px");
    app.style.setProperty("--comment-pad-x", (16 * contentScale) + "px");
    app.style.setProperty("--thread-title-size", (32 * contentScale) + "px");
    app.style.setProperty("--thread-meta-size", (17 * contentScale) + "px");
  }

  function showToast(message) {
    let toast = document.querySelector(".harmonic-toast");
    if (!toast) {
      toast = el("div", "harmonic-toast");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function createToolbar() {
    const toolbar = el("header", "feed-toolbar");
    const row = el("div", "feed-toolbar-row");
    const titleButton = el("button", "feed-title-button");
    feedTitle = el("span", "feed-title", FEEDS[state.feed].label);
    titleButton.append(feedTitle, svg("chevron", "feed-chevron"));
    titleButton.addEventListener("click", (event) => openFeedMenu(event.currentTarget));

    const actions = el("div", "feed-toolbar-actions");
    const searchButton = button("search", "Search");
    searchButton.addEventListener("click", toggleSearch);
    const refreshButton = button("refresh", "Refresh");
    refreshButton.addEventListener("click", refreshFeed);
    const moreButton = button("more", "More");
    moreButton.addEventListener("click", (event) => openMoreMenu(event.currentTarget));
    actions.append(searchButton, refreshButton, moreButton);
    row.append(titleButton, actions);

    updatedLabel = el("div", "last-updated", "Last updated: " + formatTime(state.updatedAt));
    searchWrap = el("div", "feed-search");
    searchInput = el("input", "feed-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search stories";
    searchInput.autocomplete = "off";
    searchInput.addEventListener("input", onSearchInput);
    searchInput.addEventListener("keydown", onSearchKeydown);
    searchInput.addEventListener("focus", renderRecentSearches);
    searchWrap.append(svg("search"), searchInput);
    toolbar.append(row, updatedLabel, searchWrap, createSearchPanel());
    return toolbar;
  }

  // The search panel hangs below the search pill: mode tabs, then (in
  // "All of Hacker News" mode) filter chips and controls, then recent
  // searches. Recent searches live in memory only (SEC-51).
  function createSearchPanel() {
    searchPanel = el("div", "hn-search-panel");

    const modes = el("div", "hn-search-modes");
    const loadedTab = el("button", "hn-search-mode active", "Loaded stories");
    loadedTab.type = "button";
    loadedTab.dataset.mode = "loaded";
    loadedTab.addEventListener("click", () => setSearchMode("loaded"));
    const globalTab = el("button", "hn-search-mode", "All of Hacker News");
    globalTab.type = "button";
    globalTab.dataset.mode = "global";
    globalTab.addEventListener("click", () => setSearchMode("global"));
    modes.append(loadedTab, globalTab);

    searchFilters = el("div", "hn-search-filters");
    searchFilters.hidden = true;

    searchChips = el("div", "hn-search-chips");
    const chips = [
      ["story", "Stories"],
      ["comment", "Comments"],
      ["ask_hn", "Ask"],
      ["show_hn", "Show"],
      ["poll", "Polls"],
      ["front_page", "Front page"],
    ];
    for (const [tag, label] of chips) {
      const chip = el("button", "hn-search-chip" + (state.search.tag === tag ? " active" : ""), label);
      chip.type = "button";
      chip.dataset.tag = tag;
      chip.addEventListener("click", () => {
        state.search.tag = tag;
        searchChips.querySelectorAll(".hn-search-chip").forEach((node) => node.classList.toggle("active", node === chip));
        queueGlobalSearch(0);
      });
      searchChips.appendChild(chip);
    }

    const controls = el("div", "hn-search-controls");
    const rangeSelect = el("select", "hn-search-select");
    rangeSelect.setAttribute("aria-label", "Date range");
    for (const [value, label] of [["any", "Any time"], ["day", "Past 24 hours"], ["week", "Past week"], ["month", "Past month"], ["year", "Past year"]]) {
      const option = el("option", "", label);
      option.value = value;
      if (value === state.search.range) option.selected = true;
      rangeSelect.appendChild(option);
    }
    rangeSelect.addEventListener("change", () => {
      state.search.range = rangeSelect.value;
      queueGlobalSearch(0);
    });

    const sortSelect = el("select", "hn-search-select");
    sortSelect.setAttribute("aria-label", "Sort");
    for (const [value, label] of [["relevance", "Relevance"], ["newest", "Newest"]]) {
      const option = el("option", "", label);
      option.value = value;
      if (value === state.search.sort) option.selected = true;
      sortSelect.appendChild(option);
    }
    sortSelect.addEventListener("change", () => {
      state.search.sort = sortSelect.value;
      queueGlobalSearch(0);
    });

    const pointsInput = el("input", "hn-search-number");
    pointsInput.type = "number";
    pointsInput.min = "0";
    pointsInput.step = "1";
    pointsInput.placeholder = "Min points";
    pointsInput.setAttribute("aria-label", "Minimum points");
    pointsInput.value = state.search.minPoints;
    pointsInput.addEventListener("input", () => {
      state.search.minPoints = pointsInput.value;
      queueGlobalSearch(0);
    });

    const authorInput = el("input", "hn-search-text");
    authorInput.type = "text";
    authorInput.placeholder = "Author";
    authorInput.setAttribute("aria-label", "Author");
    authorInput.spellcheck = false;
    authorInput.autocomplete = "off";
    authorInput.value = state.search.author;
    authorInput.addEventListener("input", () => {
      state.search.author = authorInput.value;
      queueGlobalSearch(0);
    });

    controls.append(rangeSelect, sortSelect, pointsInput, authorInput);
    searchFilters.append(searchChips, controls);

    searchRecent = el("div", "hn-search-recent");
    searchRecent.hidden = true;

    searchPanel.append(modes, searchFilters, searchRecent);
    return searchPanel;
  }

  function openPopup(anchor, items) {
    document.querySelector(".harmonic-popup")?.remove();
    const popup = el("div", "harmonic-popup");
    for (const item of items) {
      const row = el("button", "popup-item");
      row.type = "button";
      if (item.icon) row.appendChild(svg(item.icon));
      row.appendChild(el("span", "", item.label));
      row.addEventListener("click", () => {
        popup.remove();
        item.action();
      });
      popup.appendChild(row);
    }
    document.body.appendChild(popup);
    const rect = anchor.getBoundingClientRect();
    popup.style.top = Math.min(window.innerHeight - popup.offsetHeight - 10, rect.bottom + 8) + "px";
    popup.style.left = Math.max(10, rect.right - popup.offsetWidth) + "px";
    setTimeout(() => {
      const close = (e) => {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener("pointerdown", close, true);
        }
      };
      document.addEventListener("pointerdown", close, true);
    });
  }

  function openFeedMenu(anchor) {
    openPopup(anchor, Object.entries(FEEDS).map(([key, feed]) => ({
      label: feed.label,
      action: () => switchFeed(key),
    })));
  }

  function openOriginalHackerNews(path) {
    const url = "https://news.ycombinator.com" + path;
    chrome.runtime.sendMessage({ type: "HARMONIC_OPEN_ORIGINAL", url }, (response) => {
      if (response?.ok) return;
      window.open(url + ORIGINAL_HASH, "_blank", "noopener");
    });
  }

  async function disableHarmonic() {
    pageStorageSet(ENABLED_BACKUP_KEY, false);
    await chromeSyncSet({ harmonicEnabled: false });
    location.reload();
  }

  function openMoreMenu(anchor) {
    openPopup(anchor, [
      { label: "Settings", icon: "settings", action: openSettings },
      { label: "Open original Hacker News", icon: "external", action: () => openOriginalHackerNews(FEEDS[state.feed].path) },
      { label: "Disable Harmonic", icon: "power", action: disableHarmonic },
    ]);
  }

  function toggleSearch() {
    const opening = !searchWrap.classList.contains("open");
    searchWrap.classList.toggle("open");
    if (opening) {
      searchInput.focus();
      renderRecentSearches();
    } else {
      closeSearch();
    }
    syncSearchPanelSpace();
  }

  // The search panel overlays the list (the toolbar is an overlay by design);
  // reserve scroll space so results never hide behind it or lose clicks.
  function syncSearchPanelSpace() {
    if (!storyList) return;
    const open = Boolean(searchWrap?.classList.contains("open") && searchPanel);
    const height = open ? searchPanel.offsetHeight : 0;
    storyList.style.paddingTop = height ? 108 + height + 12 + "px" : "";
  }

  function closeSearch() {
    abortSearch();
    searchInput.value = "";
    if (state.search.active) {
      state.search.active = false;
      restoreFeedList();
    }
    filterStories();
  }

  function abortSearch() {
    clearTimeout(state.search.debounceTimer);
    state.search.debounceTimer = 0;
    state.search.controller?.abort();
    state.search.controller = null;
  }

  function setSearchMode(mode) {
    if (state.search.mode === mode) return;
    state.search.mode = mode;
    searchPanel.querySelectorAll(".hn-search-mode").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
    searchFilters.hidden = mode !== "global";
    if (mode === "loaded") {
      abortSearch();
      if (state.search.active) {
        state.search.active = false;
        restoreFeedList();
      }
      filterStories();
    } else {
      renderRecentSearches();
      queueGlobalSearch(0);
    }
    syncSearchPanelSpace();
  }

  function onSearchInput() {
    if (state.search.mode === "loaded") {
      filterStories();
      return;
    }
    renderRecentSearches();
    queueGlobalSearch(0);
  }

  function onSearchKeydown(event) {
    if (event.key === "Escape") {
      if (state.search.active) {
        event.preventDefault();
        state.search.active = false;
        restoreFeedList();
      } else {
        closeSearch();
      }
      return;
    }
    if (event.key === "Enter" && state.search.mode === "global") {
      event.preventDefault();
      runGlobalSearch(0);
    }
  }

  function filterStories() {
    if (state.search.mode !== "loaded") return;
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".story-card").forEach((card) => {
      const hay = (card.dataset.search || "").toLowerCase();
      card.hidden = Boolean(q) && !hay.includes(q);
    });
  }

  // ---------------------------------------------------------------------------
  // Site-wide search (Algolia via hn-search.js)
  // ---------------------------------------------------------------------------

  const RANGE_SECONDS = { day: 86400, week: 604800, month: 2592000, year: 31536000 };
  const AUTHOR_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

  function buildSearchOptions(page) {
    const author = state.search.author.trim();
    const authorValid = !author || AUTHOR_PATTERN.test(author);
    const tags = [state.search.tag];
    if (authorValid && author) tags.push("author_" + author);
    const options = {
      query: searchInput.value,
      tags,
      sort: state.search.sort,
      page,
      hitsPerPage: 30,
    };
    const range = RANGE_SECONDS[state.search.range];
    if (range) options.since = Math.floor(Date.now() / 1000) - range;
    const minPoints = state.search.minPoints.trim();
    if (/^\d+$/.test(minPoints)) options.minPoints = Number(minPoints);
    return { options, authorValid };
  }

  function queueGlobalSearch(page) {
    clearTimeout(state.search.debounceTimer);
    state.search.debounceTimer = setTimeout(() => runGlobalSearch(page), 300);
  }

  async function runGlobalSearch(page) {
    clearTimeout(state.search.debounceTimer);
    state.search.debounceTimer = 0;
    const query = searchInput.value.trim();
    if (query.length < 2) {
      if (state.search.active) {
        state.search.active = false;
        restoreFeedList();
      }
      return;
    }
    abortSearch();
    const controller = new AbortController();
    state.search.controller = controller;
    const seq = ++state.search.seq;
    const { options, authorValid } = buildSearchOptions(page);
    state.search.query = query;
    state.search.active = true;

    if (page === 0) {
      storyList.classList.add("search-results");
      storyList.replaceChildren(createLoading("Searching Hacker News…"));
    }

    const result = window.HarmonicSearch
      ? await window.HarmonicSearch.runSearch(options, { signal: controller.signal })
      : { hits: [], page: 0, nbPages: 1, error: "The search client is unavailable" };
    if (result.aborted || controller.signal.aborted || seq !== state.search.seq) return;
    state.search.controller = null;

    if (result.error) {
      renderSearchError(result.error);
      return;
    }
    if (page === 0) {
      state.search.hits = result.hits;
      state.search.page = result.page;
      state.search.nbPages = result.nbPages;
      pushRecentSearch(query);
      renderSearchResults({ authorValid });
    } else {
      state.search.hits.push(...result.hits);
      state.search.page = result.page;
      state.search.nbPages = result.nbPages;
      renderSearchResults({ authorValid });
    }
  }

  function renderHighlight(target, value) {
    // SEC-40: highlights arrive pre-tokenized as plain-text segments; hostile
    // markup can only ever render as text.
    for (const segment of window.HarmonicSearch.buildHighlightSegments(value)) {
      target.appendChild(el("span", segment.highlighted ? "search-hit-em" : "", segment.text));
    }
  }

  function renderSearchError(message) {
    storyList.classList.add("search-results");
    const fail = el("div", "harmonic-error");
    fail.append(el("strong", "", "Search failed"), el("span", "", message));
    const retry = el("button", "hn-search-retry", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => runGlobalSearch(0));
    fail.appendChild(retry);
    storyList.replaceChildren(fail);
  }

  function renderSearchResults({ authorValid }) {
    storyList.classList.add("search-results");
    const container = el("div", "hn-search-results");
    const header = el("div", "hn-search-header");
    const title = el("strong", "", "Results for “" + state.search.query + "”");
    const storyCount = state.search.hits.filter((hit) => hit.kind === "story").length;
    const commentCount = state.search.hits.length - storyCount;
    const meta = el("span", "hn-search-meta",
      storyCount + " stories · " + commentCount + " comments · page " + (state.search.page + 1) + " of " + state.search.nbPages);
    header.append(title, meta);
    if (!authorValid) {
      header.appendChild(el("span", "hn-search-hint", "Author names may only contain letters, numbers, dashes, and underscores — the author filter was skipped."));
    }
    container.appendChild(header);
    let storyIndex = 0;
    for (const hit of state.search.hits) {
      if (hit.kind === "story") {
        container.appendChild(createStoryCard({
          id: hit.id,
          title: hit.title || "(untitled)",
          url: hit.url,
          score: hit.points ?? 0,
          time: hit.created_at_i ?? 0,
          descendants: hit.numComments ?? 0,
          by: hit.author,
        }, storyIndex++));
      } else {
        container.appendChild(createCommentHitCard(hit));
      }
    }
    if (!state.search.hits.length) {
      container.appendChild(el("div", "hn-search-empty", "No results for “" + state.search.query + "”. Try fewer words or remove a filter."));
    }
    if (state.search.page + 1 < state.search.nbPages) {
      const more = el("button", "hn-search-more", "Load more results");
      more.type = "button";
      more.addEventListener("click", () => runGlobalSearch(state.search.page + 1));
      container.appendChild(more);
    }
    storyList.replaceChildren(container);
  }

  function createCommentHitCard(hit) {
    const card = el("article", "comment-hit");
    const storyTitle = el("button", "comment-hit-story");
    storyTitle.type = "button";
    const storyLine = el("span", "comment-hit-story-text");
    renderHighlight(storyLine, hit.titleHighlight || hit.story_title || hit.title || "(untitled story)");
    storyTitle.append(svg("comment", "comment-hit-icon"), storyLine);
    const meta = el("div", "comment-hit-meta");
    meta.append(
      el("span", "comment-hit-author", hit.author || "[deleted]"),
      el("span", "meta-dot", "•"),
      el("span", "meta-age", relativeTime(hit.created_at_i || 0))
    );
    const excerpt = el("div", "comment-hit-excerpt");
    renderHighlight(excerpt, hit.highlight || hit.commentText || "");
    const open = el("button", "comment-hit-open", "Open comment");
    open.type = "button";
    card.append(storyTitle, meta, excerpt, open);
    const openComment = () => openThreadAtComment(hit.storyId ?? hit.story_id, hit.id);
    storyTitle.addEventListener("click", openComment);
    open.addEventListener("click", openComment);
    return card;
  }

  function openThreadAtComment(storyId, commentId) {
    if (!Number.isInteger(storyId) || storyId <= 0) return;
    selectStory(storyId);
    const target = String(commentId);
    const deadline = Date.now() + 8000;
    const step = () => {
      const row = threadPane.querySelector('[data-comment-id="' + target + '"]');
      if (row) {
        row.classList.add("comment-flash");
        row.scrollIntoView({ block: "center" });
        setTimeout(() => row.classList.remove("comment-flash"), 2400);
        return;
      }
      if (Date.now() < deadline && state.selectedId === storyId) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function restoreFeedList() {
    storyList.classList.remove("search-results");
    storyList.replaceChildren();
    state.stories.forEach((story, index) => storyList.appendChild(createStoryCard(story, index)));
    filterStories();
  }

  function pushRecentSearch(query) {
    const recent = state.search.recent.filter((term) => term !== query);
    recent.unshift(query);
    state.search.recent = recent.slice(0, 8);
  }

  function renderRecentSearches() {
    if (!searchRecent) return;
    const searchOpen = searchWrap.classList.contains("open");
    const showRecents = state.search.mode === "global" && searchOpen && !searchInput.value.trim() && state.search.recent.length > 0;
    searchRecent.hidden = !showRecents;
    searchRecent.replaceChildren();
    if (showRecents) {
      searchRecent.appendChild(el("div", "hn-search-recent-label", "Recent searches"));
      for (const term of state.search.recent) {
        const row = el("button", "hn-search-recent-item", term);
        row.type = "button";
        row.addEventListener("click", () => {
          searchInput.value = term;
          runGlobalSearch(0);
        });
        searchRecent.appendChild(row);
      }
      const clear = el("button", "hn-search-recent-clear", "Clear recent searches");
      clear.type = "button";
      clear.addEventListener("click", () => {
        state.search.recent = [];
        renderRecentSearches();
      });
      searchRecent.appendChild(clear);
    }
    syncSearchPanelSpace();
  }

  async function switchFeed(key) {
    if (!FEEDS[key]) return;
    state.feed = key;
    feedTitle.textContent = FEEDS[key].label;
    history.pushState({ harmonicFeed: key }, "", FEEDS[key].path);
    await refreshFeed();
  }

  function storyMeta(story) {
    const meta = el("div", "story-meta");
    const fav = el("img", "story-favicon");
    const favUrl = faviconUrl(story);
    if (favUrl) fav.src = favUrl;
    fav.alt = "";
    const points = el("span", "meta-points", compact(story.score) + " points");
    const domain = el("span", "meta-domain", domainOf(story.url));
    const age = el("span", "meta-age", relativeTime(story.time));
    meta.append(fav, points, el("span", "meta-dot", "•"), domain, el("span", "meta-dot", "•"), age);
    return meta;
  }

  function createStoryCard(story, index) {
    const card = el("article", "story-card");
    card.dataset.storyId = String(story.id);
    card.dataset.search = (story.title || "") + " " + domainOf(story.url);
    card.style.setProperty("--fallback-tint", hashTint(domainOf(story.url)));
    if (state.readIds.has(story.id)) card.classList.add("is-read");
    if (state.selectedId === story.id) card.classList.add("selected");

    const main = el("div", "story-card-main");
    const title = el("a", "story-card-title", story.title || "(untitled)");
    title.href = articleHref(story);
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.addEventListener("click", (event) => {
      event.stopPropagation();
      markRead(story.id);
      if (state.settings.cardClickComments || !story.url) {
        event.preventDefault();
        selectStory(story);
      } else if (state.settings.alwaysOpenComments) {
        setTimeout(() => selectStory(story, false), 0);
      }
    });
    const rank = el("span", "story-index", (index + 1) + ".");
    const titleLine = el("div", "story-title-line");
    titleLine.append(rank, title);
    main.append(titleLine, storyMeta(story));

    const preview = el("a", "story-preview");
    preview.href = articleHref(story);
    preview.target = story.url ? "_blank" : "_self";
    preview.rel = "noopener noreferrer";
    preview.title = story.url ? "Open article" : "Open comments";
    const previewImg = el("img", "story-preview-image");
    previewImg.alt = "";
    previewImg.addEventListener("error", () => {
      card.classList.remove("has-preview");
      card.classList.add("no-preview");
    });
    preview.appendChild(previewImg);
    preview.addEventListener("click", (event) => {
      event.stopPropagation();
      markRead(story.id);
      if (state.settings.cardClickComments || !story.url) {
        event.preventDefault();
        selectStory(story);
      } else if (state.settings.alwaysOpenComments) {
        setTimeout(() => selectStory(story, false), 0);
      }
    });

    const commentButton = el("button", "story-comment-button");
    commentButton.type = "button";
    commentButton.title = "Open " + (story.descendants || 0) + " comments";
    commentButton.append(svg("comment"), el("strong", "", compact(story.descendants || 0)));
    commentButton.addEventListener("click", (event) => {
      event.stopPropagation();
      selectStory(story);
    });

    card.append(main, preview, commentButton);
    card.addEventListener("click", (event) => {
      if (event.target.closest("a,button")) return;
      markRead(story.id);
      if (state.settings.cardClickComments || !story.url) {
        selectStory(story);
      } else {
        window.open(articleHref(story), "_blank", "noopener");
      }
    });

    if (story.url) {
      getPreview(story).then((meta) => {
        const favicon = card.querySelector(".story-favicon");
        const faviconSrc = safeImageSrc(meta.favicon || "");
        if (faviconSrc && favicon) favicon.src = faviconSrc;
        const imageSrc = safeImageSrc(meta.image || "");
        if (imageSrc) {
          previewImg.src = imageSrc;
          card.classList.add("has-preview");
        } else {
          card.classList.add("no-preview");
        }
        if (meta.tint) card.style.setProperty("--story-tint", meta.tint);
      });
    } else {
      card.classList.add("no-preview");
    }
    return card;
  }

  function createLoading(label) {
    const wrap = el("div", "harmonic-loading");
    wrap.append(el("div", "harmonic-spinner"), el("span", "", label));
    return wrap;
  }

  async function loadMoreStories() {
    if (state.search.active || state.loadingMore || !state.hasMoreStories || !state.feedIds.length) return;
    const generation = state.feedGeneration;
    const batchIds = state.feedIds.slice(state.feedCursor, state.feedCursor + FEED_BATCH_SIZE);
    if (!batchIds.length) {
      state.hasMoreStories = false;
      return;
    }

    state.loadingMore = true;
    state.feedCursor += batchIds.length;
    const loading = createLoading("Loading more stories…");
    loading.classList.add("load-more-stories");
    storyList.appendChild(loading);
    try {
      const stories = await fetchItems(batchIds);
      if (generation !== state.feedGeneration) return;
      loading.remove();
      const startIndex = state.stories.length;
      state.stories.push(...stories);
      stories.forEach((story, index) => storyList.appendChild(createStoryCard(story, startIndex + index)));
      state.hasMoreStories = state.feedCursor < state.feedIds.length;
      filterStories();
    } catch {
      loading.remove();
      state.feedCursor -= batchIds.length;
      showToast("Couldn’t load more stories");
    } finally {
      if (generation === state.feedGeneration) state.loadingMore = false;
    }
  }

  async function refreshFeed() {
    abortSearch();
    state.search.active = false;
    const generation = ++state.feedGeneration;
    state.loadingMore = false;
    state.feedIds = [];
    state.feedCursor = 0;
    state.hasMoreStories = true;
    storyList.replaceChildren(createLoading("Loading stories…"));
    const key = state.feed;
    try {
      const ids = await fetchJson(HN_API + "/" + FEEDS[key].endpoint + ".json");
      if (generation !== state.feedGeneration) return;
      state.feedIds = ids.filter((id) => Number.isInteger(id) && id > 0);
      const batchIds = state.feedIds.slice(0, FEED_BATCH_SIZE);
      state.feedCursor = batchIds.length;
      const stories = await fetchItems(batchIds);
      if (generation !== state.feedGeneration) return;
      state.stories = stories;
      state.hasMoreStories = state.feedCursor < state.feedIds.length;
      state.updatedAt = new Date();
      updatedLabel.textContent = "Last updated: " + formatTime(state.updatedAt);
      storyList.replaceChildren();
      stories.forEach((story, index) => storyList.appendChild(createStoryCard(story, index)));
      filterStories();
      if (state.selectedId) {
        const match = stories.find((story) => story.id === state.selectedId);
        if (match) state.selectedStory = match;
      } else if (stories[0] && window.innerWidth >= 900) {
        selectStory(stories[0], false, false);
      }
    } catch (error) {
      const fail = el("div", "harmonic-error");
      fail.append(el("strong", "", "Couldn’t load Hacker News"), el("span", "", error.message));
      storyList.replaceChildren(fail);
    }
  }

  const replyCountCache = new WeakMap();
  const descendantCount = (comment) => {
    if (!comment || typeof comment !== "object") return 0;
    if (replyCountCache.has(comment)) return replyCountCache.get(comment);
    const count = (comment.children || []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
    replyCountCache.set(comment, count);
    return count;
  };

  const sortedComments = (comments) => {
    const list = [...(comments || [])];
    switch (state.settings.commentSort) {
      case "Newest first":
        list.sort((a, b) => (b.created_at_i || 0) - (a.created_at_i || 0));
        break;
      case "Oldest first":
        list.sort((a, b) => (a.created_at_i || 0) - (b.created_at_i || 0));
        break;
      case "Reply count":
        list.sort((a, b) => descendantCount(b) - descendantCount(a));
        break;
      default:
        break;
    }
    return list;
  };

  const COLOR_RAILS = ["#5E97F6", "#9CCC65", "#FFB74D", "#BA68C8", "#4DD0E1", "#EF5350", "#FFD54F"];
  const MATERIAL_RAILS = ["#526A78", "#7B94A2", "#6D7F89", "#8DA5B2", "#9AAEBB", "#41545F", "#72828B"];

  function authorRailColor(author) {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < String(author || "").length; i++) {
      hash ^= String(author || "").charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const hue = hash % 360;
    const saturation = 50 + (Math.floor(hash / 360) % 21);
    const lightness = 46 + (Math.floor(hash / (360 * 21)) % 17);
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  function railColor(depth, author) {
    const mode = state.settings.depthMode;
    if (mode === "none") return "transparent";
    if (mode === "mono" || mode === "monochrome") return "#808080";
    if (mode === "author") return authorRailColor(author);
    const palette = mode === "material" || mode === "material_you" ? MATERIAL_RAILS : COLOR_RAILS;
    return palette[Math.abs(depth) % palette.length];
  }

  function renderComment(comment, depth = 0) {
    const row = el("div", "comment-row");
    row.dataset.depth = String(depth);
    row.dataset.commentId = String(comment.id || 0); // used by search comment hits to scroll into view
    row.dataset.createdAt = String(comment.created_at_i || 0);
    row.dataset.replies = String(descendantCount(comment));
    row.style.setProperty("--depth", String(depth));
    row.style.setProperty("--rail", railColor(depth, comment.author || ""));

    const card = el("article", "comment-card");
    const meta = el("div", "comment-meta");
    const author = el("a", "comment-author", comment.author || "[deleted]");
    if (comment.author) {
      author.href = "https://news.ycombinator.com/user?id=" + encodeURIComponent(comment.author);
      author.target = "_blank";
      author.rel = "noopener";
    }
    const age = el("a", "comment-age", relativeTime(comment.created_at_i || 0));
    age.href = "https://news.ycombinator.com/item?id=" + comment.id;
    age.target = "_blank";
    age.rel = "noopener";
    meta.append(author, age);

    const body = el("div", "comment-body");
    if (comment.text) appendSanitizedHtml(body, comment.text);
    else body.textContent = "[deleted]";

    const collapsed = el("div", "collapsed-comment");
    collapsed.append(
      el("span", "collapsed-author", comment.author || "[deleted]"),
      el("span", "collapsed-preview", body.textContent.trim().slice(0, 90)),
      el("span", "collapsed-count", descendantCount(comment) ? descendantCount(comment) + " replies" : "")
    );

    card.append(meta, body, collapsed);
    row.appendChild(card);

    const children = el("div", "comment-children");
    for (const child of sortedComments(comment.children || [])) children.appendChild(renderComment(child, depth + 1));
    if (children.childElementCount) row.appendChild(children);

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button") || window.getSelection()?.toString()) return;
      row.classList.toggle("collapsed");
    });
    return row;
  }

  function appendSummaryInline(target, text) {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
    let cursor = 0;
    for (const match of String(text || "").matchAll(pattern)) {
      if (match.index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      // SEC-44: AI output never renders Markdown images. An image token is
      // demoted to plain text so no remote URL is ever fetched or embedded.
      if (text.slice(Math.max(0, match.index - 1), match.index) === "!") {
        target.appendChild(document.createTextNode(token));
        cursor = match.index + token.length;
        continue;
      }
      if (token.startsWith("`")) {
        target.appendChild(el("code", "", token.slice(1, -1)));
      } else if (token.startsWith("**")) {
        target.appendChild(el("strong", "", token.slice(2, -2)));
      } else if (token.startsWith("[")) {
        const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const href = parts ? safeHref(parts[2]) : null;
        if (parts && href) {
          const link = el("a", "", parts[1]);
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          target.appendChild(link);
        } else {
          target.appendChild(document.createTextNode(token));
        }
      } else {
        target.appendChild(el("em", "", token.slice(1, -1)));
      }
      cursor = match.index + token.length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function renderSummaryMarkdown(target, markdown) {
    target.replaceChildren();
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    let list = null;
    const flushList = () => {
      if (!list) return;
      target.appendChild(list);
      list = null;
    };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      if (bullet) {
        if (!list) list = el("ul", "summary-list");
        const item = el("li");
        appendSummaryInline(item, bullet[1]);
        list.appendChild(item);
        continue;
      }
      flushList();
      if (!line.trim()) continue;
      const paragraph = el("p");
      appendSummaryInline(paragraph, line.trim());
      target.appendChild(paragraph);
    }
    flushList();
  }

  function summaryStateFor(storyId) {
    return state.summaries.get(storyId) || { status: "idle", text: "", error: "" };
  }

  function updateSummarySurface(storyId) {
    const surface = document.querySelector('[data-summary-story-id="' + storyId + '"]');
    if (!surface) return;
    const current = summaryStateFor(storyId);
    surface.dataset.status = current.status;
    const status = surface.querySelector(".story-summary-status");
    const body = surface.querySelector(".story-summary-body");
    if (current.status === "extracting") status.textContent = "Reading article…";
    else if (current.status === "generating") status.textContent = "Summarizing…";
    else if (current.status === "error") status.textContent = "Summary failed";
    else status.textContent = "";
    if (current.status === "error") {
      body.replaceChildren(el("p", "story-summary-error", current.error || "Summary failed"));
    } else {
      renderSummaryMarkdown(body, current.text);
    }
    surface.hidden = current.status === "idle" && !current.text;
    const action = document.querySelector('[data-summary-action-id="' + storyId + '"]');
    if (action) {
      const running = current.status === "extracting" || current.status === "generating";
      action.disabled = false;
      action.classList.toggle("loading", running);
      action.classList.toggle("active", current.status === "success");
      action.title = running ? "Cancel summary" : (current.status === "success" ? "Regenerate summary" : "Story tools");
      action.setAttribute("aria-label", action.title);
    }
  }

  function createSummarySurface(storyId) {
    const card = el("section", "story-summary");
    card.dataset.summaryStoryId = String(storyId);
    const heading = el("div", "story-summary-heading");
    heading.append(svg("sparkle"), el("strong", "", "Summary"));
    const status = el("span", "story-summary-status");
    heading.appendChild(status);
    const body = el("div", "story-summary-body");
    card.append(heading, body);
    updateSummarySurface(storyId);
    return card;
  }

  function stopActiveSummary() {
    state.summaryGeneration++;
    const active = state.activeSummary;
    if (!active) return;
    state.activeSummary = null;
    state.summaries.set(active.storyId, { status: "idle", text: "", error: "" });
    try { active.port.postMessage({ type: "cancel" }); } catch {}
    try { active.port.disconnect(); } catch {}
    updateSummarySurface(active.storyId);
  }

  async function startStorySummary(item, options = {}) {
    const automatic = Boolean(options.automatic);
    if (state.activeSummary?.storyId === Number(item?.id)) {
      if (!automatic) stopActiveSummary();
      return;
    }
    const generation = ++state.summaryGeneration;
    if (!item?.url) {
      if (!automatic) showToast("This story has no linked article to summarize");
      return;
    }
    if (!state.settings.aiEnabled) {
      if (!automatic) {
        showToast("AI summarization is disabled in Settings");
        openSettings({ focusAi: true });
      }
      return;
    }
    if (!String(state.settings.aiModel || "").trim() || !String(state.settings.aiSystemPrompt || "").trim()) {
      if (!automatic) {
        showToast("Finish AI summarization setup in Settings");
        openSettings({ focusAi: true });
      }
      return;
    }
    const keyStatus = await runtimeMessage({ type: "HARMONIC_AI_STATUS" });
    if (generation !== state.summaryGeneration || Number(item.id) !== state.selectedId) return;
    if (!keyStatus?.hasKey) {
      if (!automatic) {
        showToast("Add your OpenRouter API key in Settings");
        openSettings({ focusAi: true });
      }
      return;
    }

    stopActiveSummary();
    const storyId = Number(item.id);
    state.summaries.set(storyId, { status: "extracting", text: "", error: "" });
    updateSummarySurface(storyId);
    const port = chrome.runtime.connect({ name: "harmonic-ai" });
    state.activeSummary = { storyId, port };

    port.onMessage.addListener((message) => {
      if (state.activeSummary?.port !== port || Number(message?.storyId) !== storyId) return;
      if (message.type === "status") {
        const current = summaryStateFor(storyId);
        state.summaries.set(storyId, { ...current, status: message.status, error: "" });
      } else if (message.type === "progress") {
        state.summaries.set(storyId, { status: "generating", text: String(message.text || ""), error: "" });
      } else if (message.type === "success") {
        state.summaries.set(storyId, { status: "success", text: String(message.text || ""), error: "" });
        if (state.activeSummary?.port === port) state.activeSummary = null;
        try { port.disconnect(); } catch {}
      } else if (message.type === "error") {
        state.summaries.set(storyId, { status: "error", text: "", error: String(message.message || "Summary failed") });
        if (state.activeSummary?.port === port) state.activeSummary = null;
        try { port.disconnect(); } catch {}
      }
      updateSummarySurface(storyId);
    });
    port.onDisconnect.addListener(() => {
      if (state.activeSummary?.port !== port) return;
      state.activeSummary = null;
      state.summaries.set(storyId, { status: "error", text: "", error: "Summary connection closed. Try again." });
      updateSummarySurface(storyId);
    });
    port.postMessage({
      type: "summarize",
      storyId,
      url: item.url,
      model: state.settings.aiModel,
      systemPrompt: state.settings.aiSystemPrompt,
      streamResponses: state.settings.aiStreamResponses,
    });
  }

  function threadAction(iconName, label, action, options = {}) {
    const b = button(iconName, label, "thread-action");
    if (options.id) b.dataset.bookmarkId = options.id;
    if (options.summaryId) b.dataset.summaryActionId = options.summaryId;
    if (options.active) b.classList.add("active");
    if (options.disabled) b.disabled = true;
    b.addEventListener("click", action);
    return b;
  }

  function createThreadPlaceholder() {
    const placeholder = el("div", "thread-placeholder");
    placeholder.append(
      el("div", "placeholder-logo", "Y"),
      el("h2", "", "Choose a story"),
      el("p", "", "Comments and story details appear here. Article links open in a new tab.")
    );
    return placeholder;
  }

  async function selectStory(storyOrId, push = true, scrollTop = true) {
    const id = typeof storyOrId === "number" ? storyOrId : storyOrId.id;
    state.selectedId = id;
    state.selectedStory = typeof storyOrId === "object" ? storyOrId : state.stories.find((s) => s.id === id) || null;
    if (app) app.classList.add("show-thread");
    markRead(id);
    document.querySelectorAll(".story-card.selected").forEach((node) => node.classList.remove("selected"));
    document.querySelector('[data-story-id="' + id + '"]')?.classList.add("selected");
    if (push) history.pushState({ harmonicItem: id }, "", "/item?id=" + id);
    document.body.classList.add("thread-active");
    if (scrollTop) threadPane.scrollTop = 0;
    await loadThread(id);
  }

  async function loadThread(id) {
    if (!state.activeSummary || state.activeSummary.storyId !== id) stopActiveSummary();
    threadPane.replaceChildren(createLoading("Loading discussion…"));
    try {
      const item = await fetchJson(ALGOLIA_API + "/items/" + id);
      if (state.selectedId !== id) return;
      state.thread = item;
      renderThread(item);
    } catch (error) {
      const fail = el("div", "harmonic-error");
      fail.append(el("strong", "", "Couldn’t load discussion"), el("span", "", error.message));
      threadPane.replaceChildren(fail);
    }
  }

  async function renderThread(item) {
    threadPane.replaceChildren();
    document.title = (item.title || "Discussion") + " — Harmonic";
    const header = el("header", "thread-header");
    const hero = el("a", "thread-hero");
    hero.href = articleHref(item);
    hero.target = "_blank";
    hero.rel = "noopener";
    const heroImg = el("img", "thread-hero-image");
    heroImg.alt = "";
    heroImg.addEventListener("error", () => {
      header.classList.remove("has-hero");
      hero.remove();
    });
    hero.appendChild(heroImg);

    const headerBody = el("div", "thread-header-body");
    const title = el("a", "thread-title", item.title || "(untitled)");
    title.href = articleHref(item);
    title.target = "_blank";
    title.rel = "noopener";
    const domain = el("a", "thread-domain");
    domain.href = articleHref(item);
    domain.target = "_blank";
    domain.rel = "noopener";
    domain.append(svg("link"), el("span", "", "(" + domainOf(item.url) + ")"));

    const totalComments = (item.children || []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
    const stat = (iconName, value) => {
      const node = el("span", "thread-stat");
      node.append(svg(iconName), el("span", "", value));
      return node;
    };
    const meta = el("div", "thread-meta");
    const authorLink = el("a", "thread-author");
    authorLink.href = "https://news.ycombinator.com/user?id=" + encodeURIComponent(item.author || "");
    authorLink.target = "_blank";
    authorLink.rel = "noopener";
    authorLink.append(svg("user"), el("span", "", item.author || "unknown"));
    meta.append(
      stat("thumb", compact(item.points || 0)),
      stat("comment", compact(totalComments)),
      stat("clock", relativeTime(item.created_at_i || 0)),
      authorLink
    );

    const actions = el("div", "thread-actions");
    actions.append(
      threadAction("user", "Open author", () => authorLink.click()),
      threadAction("comment", "Reply to post", () => showToast("Replying requires Hacker News sign-in")),
      threadAction("thumb", "Upvote", () => {
        showToast("Voting stays on Hacker News for now");
        window.open("https://news.ycombinator.com/item?id=" + item.id, "_blank", "noopener");
      }),
      threadAction("star", "Bookmark", () => toggleBookmark(item.id), { id: item.id, active: state.bookmarks.has(item.id) }),
      threadAction("sparkle", "Story tools", () => startStorySummary(item), { summaryId: item.id, disabled: !item.url }),
      threadAction("share", "Share", async () => {
        const url = item.url || ("https://news.ycombinator.com/item?id=" + item.id);
        if (navigator.share) {
          try { await navigator.share({ title: item.title, url }); return; } catch {}
        }
        await navigator.clipboard.writeText(url);
        showToast("Link copied");
      })
    );
    const more = threadAction("more", "More", (event) => {
      openPopup(event.currentTarget, [
        { label: "Sort comments · " + state.settings.commentSort, action: () => openSortMenu(more) },
        { label: "Open on Hacker News", icon: "external", action: () => openOriginalHackerNews("/item?id=" + item.id) },
        { label: "Collapse all comments", action: () => setAllCommentsCollapsed(true) },
        { label: "Expand all comments", action: () => setAllCommentsCollapsed(false) },
        { label: "Settings", icon: "settings", action: openSettings },
        { label: "Disable Harmonic", icon: "power", action: disableHarmonic },
      ]);
    });
    actions.appendChild(more);
    const article = threadAction("link", "Open article", () => window.open(title.href, "_blank", "noopener"), { active: false });
    article.classList.add("article-link-action");

    headerBody.append(title, domain, meta, article);
    if (item.text) {
      const storyText = el("div", "thread-story-text");
      appendSanitizedHtml(storyText, item.text);
      headerBody.appendChild(storyText);
    }
    headerBody.append(createSummarySurface(item.id), actions);
    updateSummarySurface(item.id);
    header.append(hero, headerBody);
    threadPane.appendChild(header);
    updateSummarySurface(item.id);
    const existingSummary = summaryStateFor(item.id);
    if (item.url && state.settings.aiAutoSummarize && existingSummary.status === "idle") {
      startStorySummary(item, { automatic: true });
    }

    const total = (item.children || []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
    const heading = el("div", "comments-heading");
    heading.append(el("h2", "", total + " comments"));
    threadPane.appendChild(heading);

    const comments = el("section", "comments");
    for (const comment of sortedComments(item.children || [])) comments.appendChild(renderComment(comment, 0));
    if (!comments.childElementCount) comments.appendChild(el("div", "empty-comments", "No comments yet."));
    threadPane.appendChild(comments);

    if (item.url) {
      const fakeStory = { id: item.id, url: item.url };
      const preview = await getPreview(fakeStory);
      if (state.selectedId !== item.id) return;
      const imageSrc = safeImageSrc(preview.image || "");
      if (imageSrc) {
        heroImg.src = imageSrc;
        header.classList.add("has-hero");
      } else {
        hero.remove();
      }
      if (preview.tint) header.style.setProperty("--header-tint", preview.tint);
    } else {
      hero.remove();
    }
  }

  function setAllCommentsCollapsed(collapsed) {
    document.querySelectorAll(".comment-row").forEach((row) => row.classList.toggle("collapsed", collapsed));
  }

  function openSortMenu(anchor) {
    const modes = ["Default", "Newest first", "Oldest first", "Reply count"];
    openPopup(anchor, modes.map((mode) => ({
      label: (state.settings.commentSort === mode ? "✓  " : "   ") + mode,
      action: async () => {
        const previousScroll = threadPane.scrollTop;
        state.settings.commentSort = mode;
        await saveSettings();
        if (state.thread) {
          await renderThread(state.thread);
          threadPane.scrollTop = previousScroll;
        }
      },
    })));
  }

  function settingToggle(label, key, description) {
    const row = el("label", "setting-row");
    const text = el("span", "setting-copy");
    text.append(el("strong", "", label), el("small", "", description));
    const input = el("input", "setting-switch");
    input.type = "checkbox";
    input.checked = Boolean(state.settings[key]);
    input.addEventListener("change", async () => {
      state.settings[key] = input.checked;
      await saveSettings();
      applySettings();
      if (key === "tintedCards") document.querySelectorAll(".story-card").forEach((card) => card.classList.toggle("no-tint", !input.checked));
    });
    row.append(text, input);
    return row;
  }

  function settingSlider(label, key, min, max, step, suffix = "") {
    const row = el("label", "setting-row setting-slider-row");
    const text = el("span", "setting-copy");
    const valueLabel = el("small", "setting-value", String(state.settings[key]) + suffix);
    text.append(el("strong", "", label), valueLabel);
    const input = el("input", "setting-slider");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(state.settings[key]);
    input.addEventListener("input", async () => {
      state.settings[key] = Number(input.value);
      valueLabel.textContent = String(state.settings[key]) + suffix;
      await saveSettings();
      applySettings();
    });
    row.append(text, input);
    return row;
  }

  function settingSelect(label, key, options) {
    const row = el("label", "setting-row");
    const text = el("span", "setting-copy");
    text.append(el("strong", "", label));
    const select = el("select", "setting-select");
    for (const [value, name] of options) {
      const option = el("option", "", name);
      option.value = value;
      option.selected = String(state.settings[key]) === String(value);
      select.appendChild(option);
    }
    select.addEventListener("change", async () => {
      const numeric = typeof state.settings[key] === "number";
      state.settings[key] = numeric ? Number(select.value) : select.value;
      await saveSettings();
      applySettings();
      if (state.thread && ["commentStyle", "depthMode", "commentSort"].includes(key)) renderThread(state.thread);
    });
    row.append(text, select);
    return row;
  }

  function settingText(label, key, description, options = {}) {
    const multiline = Boolean(options.multiline);
    const row = el("label", "setting-row setting-text-row");
    const text = el("span", "setting-copy");
    text.append(el("strong", "", label), el("small", "", description));
    const input = el(multiline ? "textarea" : "input", multiline ? "setting-textarea" : "setting-text");
    if (!multiline) input.type = "text";
    input.value = String(state.settings[key] ?? "");
    if (multiline) input.rows = 5;
    input.addEventListener("change", async () => {
      state.settings[key] = input.value.trim();
      await saveSettings();
    });
    row.append(text, input);
    return row;
  }

  function aiKeySettingRow() {
    const row = el("div", "setting-row setting-action-row ai-key-row");
    const text = el("span", "setting-copy");
    const summary = el("small", "ai-key-status", "Checking…");
    text.append(el("strong", "", "OpenRouter API key"), summary);
    const manage = el("button", "setting-button", "Configure");
    manage.type = "button";
    manage.addEventListener("click", async () => {
      const result = await runtimeMessage({ type: "HARMONIC_OPEN_AI_SETTINGS" });
      if (!result?.ok) showToast("Couldn’t open secure API key settings");
    });
    row.append(text, manage);
    runtimeMessage({ type: "HARMONIC_AI_STATUS" }).then((status) => {
      summary.textContent = status?.hasKey
        ? status.preview + (status.storage === "session" ? " · session only" : " · saved locally")
        : "Not set · stored separately from synced settings";
    });
    return row;
  }

  function openSettings(options = {}) {
    document.querySelector(".settings-overlay")?.remove();
    const overlay = el("div", "settings-overlay");
    const panel = el("section", "settings-panel");
    const header = el("header", "settings-header");
    header.append(el("h2", "", "Settings"));
    const close = button("close", "Close");
    close.addEventListener("click", () => overlay.remove());
    header.appendChild(close);

    const storySection = el("div", "settings-section");
    storySection.append(
      el("h3", "", "Stories"),
      settingSelect("Preview images", "previewImages", [["medium", "Medium"], ["small", "Small"], ["off", "Off"]]),
      settingToggle("Tint cards from images", "tintedCards", "Use each story preview to color its card"),
      settingToggle("Favicons", "showFavicons", "Show the source icon beside metadata"),
      settingToggle("Points", "showPoints", "Show story score"),
      settingToggle("Comment count", "showComments", "Show the large comments control"),
      settingToggle("Story number", "showIndex", "Show story position in the feed"),
      settingToggle("Dim read stories", "dimRead", "Fade stories after opening them"),
      settingSlider("Story text size", "storyTextSize", 14.5, 20.5, 0.5, " sp"),
      settingSlider("Content zoom", "contentScale", 75, 125, 5, "%")
    );

    const commentsSection = el("div", "settings-section");
    commentsSection.append(
      el("h3", "", "Comments"),
      settingSelect("Comment style", "commentStyle", [["outlined", "Outlined"], ["raised", "Raised"], ["standard", "Standard"], ["flat", "Flat"]]),
      settingSelect("Comment sorting", "commentSort", [["Default", "Default"], ["Newest first", "Newest first"], ["Oldest first", "Oldest first"], ["Reply count", "Reply count"]]),
      settingSelect("Thread colors", "depthMode", [["theme_default", "Theme default"], ["material_you", "Material You"], ["colors", "Colorful"], ["author", "Author"], ["monochrome", "Monochrome"], ["none", "None"]]),
      settingToggle("Rounded depth indicators", "roundedRails", "Round the thread indicator ends"),
      settingToggle("Continuous depth indicators", "continuousRails", "Continue ancestor rails through replies"),
      settingSlider("Comment text size", "commentTextSize", 12, 18, 0.5, " sp")
    );

    const headerDisplaySection = el("div", "settings-section");
    headerDisplaySection.append(
      el("h3", "", "Header display"),
      settingToggle("Background tint", "headerTint", "Tint the discussion header from the story preview"),
      settingToggle("Preview image", "headerImage", "Show the story preview above the discussion title")
    );

    const aiSection = el("div", "settings-section ai-settings-section");
    const resetPrompt = el("button", "setting-button", "Reset to Harmonic default");
    resetPrompt.type = "button";
    resetPrompt.addEventListener("click", async () => {
      state.settings.aiSystemPrompt = DEFAULT_SETTINGS.aiSystemPrompt;
      aiSection.querySelector("textarea").value = DEFAULT_SETTINGS.aiSystemPrompt;
      await saveSettings();
    });
    aiSection.append(
      el("h3", "", "AI summarization"),
      settingToggle("Use AI summarization", "aiEnabled", "One click on Story tools summarizes the linked article"),
      aiKeySettingRow(),
      settingText("OpenRouter model", "aiModel", "Use openrouter/free for the free-model router or enter any OpenRouter model ID"),
      settingText("System prompt", "aiSystemPrompt", "Harmonic’s concise article-summary instruction", { multiline: true }),
      resetPrompt,
      settingToggle("Stream responses", "aiStreamResponses", "Show the summary as OpenRouter generates it"),
      settingToggle("Automatically summarize articles", "aiAutoSummarize", "Start summarizing when a discussion with a linked article opens"),
      el("p", "settings-note", "OpenRouter is the only cloud provider in this lightweight release. The default model is openrouter/free. API keys never sync and never enter Hacker News page storage.")
    );

    const behaviorSection = el("div", "settings-section");
    behaviorSection.append(
      el("h3", "", "Behavior"),
      settingToggle("Card click opens comments", "cardClickComments", "Clicking anywhere on a story card, including its title or image, opens the discussion. Open the article from the story title inside the discussion."),
      settingToggle("Article links also open comments", "alwaysOpenComments", "When a title or preview opens an article in a new tab, also load its discussion here."),
      el("p", "settings-note", "The large comment button always opens the discussion. With card-click comments enabled, open the article from the title inside the discussion. Bookmarks and read state stay local to this Chrome profile.")
    );

    panel.append(header, storySection, commentsSection, headerDisplaySection, aiSection, behaviorSection);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (options.focusAi) {
      aiSection.scrollIntoView({ block: "start" });
      aiSection.classList.add("settings-section-highlight");
      setTimeout(() => aiSection.classList.remove("settings-section-highlight"), 1200);
    }
  }

  function handleSettingsHash() {
    if (location.hash !== SETTINGS_HASH || !app) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    openSettings();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "HARMONIC_OPEN_SETTINGS") return;
    if (!app) {
      sendResponse({ ok: false });
      return;
    }
    openSettings();
    sendResponse({ ok: true });
  });

  function mount() {
    document.body.className = "harmonic-body";
    document.body.replaceChildren();
    app = el("div", "harmonic-app");
    feedPane = el("section", "feed-pane");
    const feedInner = el("div", "feed-inner");
    storyList = el("div", "story-list");
    storyList.addEventListener("scroll", () => {
      const remaining = storyList.scrollHeight - storyList.scrollTop - storyList.clientHeight;
      if (remaining < 900) loadMoreStories();
    }, { passive: true });
    feedInner.append(createToolbar(), storyList);
    feedPane.append(feedInner);

    threadPane = el("section", "thread-pane");
    threadPane.appendChild(createThreadPlaceholder());
    app.append(feedPane, threadPane);
    document.body.appendChild(app);
    document.documentElement.classList.add("harmonic-ready");
    applySettings();
    if (state.selectedId) {
      app.classList.add("show-thread");
      document.body.classList.add("thread-active");
    }

    refreshFeed();
    if (state.selectedId) loadThread(state.selectedId);
    handleSettingsHash();
    window.addEventListener("hashchange", handleSettingsHash);

    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(location.search);
      const id = location.pathname === "/item" ? Number(params.get("id")) : null;
      const feed = PATH_TO_FEED[location.pathname];
      if (id) {
        state.selectedId = id;
        document.body.classList.add("thread-active");
        loadThread(id);
      } else if (feed) {
        stopActiveSummary();
        document.body.classList.remove("thread-active");
        state.feed = feed;
        feedTitle.textContent = FEEDS[feed].label;
        refreshFeed();
      }
    });
  }

  const supported = Boolean(PATH_TO_FEED[location.pathname]) || (location.pathname === "/item" && Number(new URLSearchParams(location.search).get("id")));
  if (!supported) return;

  (async () => {
    if (await isOriginalTab()) return;
    if (!(await loadEnabledPreference())) return;
    document.documentElement.classList.add("harmonic-hn");
    await Promise.all([loadPersistentState(), loadHarmonicFont()]);
    const start = () => {
      // Phase 0.4: harvest the original HN DOM (session state) before mount
      // replaces the body, then mount at DOMContentLoaded.
      try { window.HarmonicHN?.harvest(document); } catch {}
      mount();
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  })();
})();
