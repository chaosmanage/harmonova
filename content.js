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
    // Phase 7 (0.12.0): reading-parity lists without Firebase endpoints —
    // parsed from public Hacker News list pages through the rate-limited queue.
    pool: { path: "/pool", label: "Pool", listPath: "/pool" },
    active: { path: "/active", label: "Active Discussions", listPath: "/active" },
    bestcomments: { path: "/bestcomments", label: "Best Comments", listPath: "/bestcomments", kind: "comments" },
    launches: { path: "/launches", label: "Launch HN", listPath: "/launches" },
    whoishiring: { path: "/whoishiring", label: "Who is Hiring", listPath: "/whoishiring" },
    noobstories: { path: "/noobstories", label: "Newcomer Stories", listPath: "/noobstories" },
    classic: { path: "/classic", label: "Classic", listPath: "/classic" },
    front: { path: "/front", label: "Past Frontpages", dayBased: true },
  };
  const FEED_ORDER_DEFAULT = ["top", "new", "best", "ask", "show", "jobs", "pool", "active", "bestcomments", "launches", "whoishiring", "noobstories", "classic", "front"];
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
    // Phase 7 part 2 (0.12.1): comment parity
    markNewComments: true,
    hideDelayed: true,
    showAvatars: false,
    swapCommentActions: false,
    // Phase 7 (0.12.0): feed parity
    showDomain: true,
    compactPoints: false,
    hotnessColors: false,
    hideJobs: false,
    hideRead: false,
    hiddenDomains: "",
    hiddenKeywords: "",
    feedOrder: [],
    feedHidden: ["pool", "active", "bestcomments", "launches", "whoishiring", "noobstories", "classic", "front"],
    frontDate: "",
    faviconProvider: "google",
    // Phase 7 part 3 (0.12.2): links & appearance
    richPreviews: true,
    nitterRedirect: false,
    nitterInstance: "nitter.net",
    uiTheme: "amoled",
    uiFont: "harmonic",
  };

  const ICONS = {
    chevron: '<path d="M7 10l5 5 5-5z"/>',
    search: '<path d="M9.5 3a6.5 6.5 0 104.08 11.56L19 20l1-1-5.44-5.42A6.5 6.5 0 009.5 3zm0 1.8a4.7 4.7 0 110 9.4 4.7 4.7 0 010-9.4z"/>',
    more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    comment: '<path d="M4 4.5h16v12H9l-4.2 3.1.7-3.1H4v-12zm1.8 1.8v8.4h2.3l-.3 1.4 1.6-1.4h8.8V6.3H5.8z"/>',
    up: '<path d="M12 3l6 7h-4v9h-4v-9H6l6-7z"/>',
    down: '<path d="M12 21l-6-7h4V5h4v9h4l-6 7z"/>',
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
    edit: '<path d="M3 17.2V21h3.8L18.5 9.3l-3.8-3.8L3 17.2zM20.7 6.1c.4-.4.4-1 0-1.4l-2.4-2.4c-.4-.4-1-.4-1.4 0l-1.9 1.9 3.8 3.8 1.9-1.9z"/>',
    trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-.8 12H6.8L6 9z"/>',
    close: '<path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5z"/>',
    external: '<path d="M13 4h7v7h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H13V4zM5 6h6v2H7v9h9v-4h2v6H5V6z"/>',
    plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/>',
    heart: '<path d="M12 20.3l-1.3-1.2C6 15 3 12.3 3 8.9 3 6.2 5.1 4.1 7.8 4.1c1.5 0 3 .7 4.2 1.9 1.2-1.2 2.7-1.9 4.2-1.9C18.9 4.1 21 6.2 21 8.9c0 3.4-3 6.1-7.7 10.2l-1.3 1.2z"/>',
    flag: '<path d="M6 3h2v18H6V3zm2 1h11l-2.5 4L19 12H8V4z"/>',
    eyeOff: '<path d="M3.3 2.5l18.2 18.2-1.4 1.4-3.5-3.5c-1.4.6-3 .9-4.6.9-5 0-9.3-3-11.5-7.5 1-2 2.4-3.7 4.1-5L1.9 3.9l1.4-1.4zM12 5c5 0 9.3 3 11.5 7-.9 1.8-2.1 3.4-3.6 4.6l-3-3A4.5 4.5 0 0010.4 7L8.9 5.5c1-.3 2-.5 3.1-.5zm0 3.5c.5 0 1 .1 1.4.3l-4.6 4.6A4.5 4.5 0 0112 8.5z"/>',
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
    confirmedComments: new Map(), // story id -> Map of locally confirmed posts
    confirmedEdits: new Map(), // story id -> Map of locally confirmed edits
    confirmedDeletes: new Map(), // story id -> Set of locally confirmed deletions
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
      keyboardIndex: -1,
    },
    // Phase 1+2 (account actions): per-thread HN document state (story vote
    // links, comment vote links) fetched from news.ycombinator.com on demand.
    itemState: null,
    itemStateTimer: 0,
    itemStateToken: 0,
    feedVotes: new Map(), // story id -> "up" | "down" (seen on the feed document)
    pollOptions: null, // [{id, text, points}] for the currently open poll
    pollOptionsRenderedKey: "", // guards poll re-renders from stomping in-flight votes
    composer: null, // open reply/edit composer { parentId, mode, handle, node, textarea, status, submitting }
    listView: null, // open account list view { kind, path, pendingMore, done, loading, seen }
    sessionToastReady: false, // suppress "Signed in as…" toast during startup harvest
    threadAuthor: "", // Phase 7: OP highlight
    userTags: new Map(), // author -> short tag (local, exportable)
    blockedUsers: new Set(), // locally blocked authors
    seenTimes: new Map(), // story id -> last-visit timestamp for new-comment markers
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

  // Phase 7 part 3: optional Nitter redirect for X/Twitter links.
  const NITTER_HOSTS = new Set(["twitter.com", "www.twitter.com", "mobile.twitter.com", "m.twitter.com", "x.com", "www.x.com"]);
  const nitterInstanceHost = () => {
    const raw = String(state.settings.nitterInstance || "nitter.net").trim().replace(/^https?:\/\//i, "").replace(/[\/?#].*$/, "");
    return /^[a-z0-9][a-z0-9.-]{2,79}$/i.test(raw) ? raw.toLowerCase() : null;
  };
  const nitterize = (href) => {
    if (!state.settings.nitterRedirect || typeof href !== "string") return href;
    try {
      const url = new URL(href);
      if (!NITTER_HOSTS.has(url.hostname)) return href;
      // An unparseable instance falls back to the default rather than dropping the redirect.
      const instance = nitterInstanceHost() || "nitter.net";
      return "https://" + instance + url.pathname + url.search + url.hash;
    } catch {
      return href;
    }
  };
  // Anchors remember the un-rewritten article URL so a settings change can
  // refresh every visible link without re-rendering the feed.
  const setStoryLink = (anchor, story) => {
    const raw = articleHref(story);
    anchor.dataset.rawHref = raw;
    anchor.href = nitterize(raw);
  };
  const refreshStoryLinks = () => {
    document.querySelectorAll("a[data-raw-href]").forEach((anchor) => {
      anchor.href = nitterize(anchor.dataset.rawHref);
    });
  };
  // "View on archive": the article URL on the Wayback Machine (never HN fallbacks).
  const archiveHref = (story) => {
    const raw = safeHref(story?.url);
    return raw ? "https://web.archive.org/web/2/" + raw : null;
  };
  const openArchive = (story) => {
    const href = archiveHref(story);
    if (href) window.open(href, "_blank", "noopener");
  };

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
          out.href = nitterize(href);
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
    // Phase 7 part 2: local, exportable user data lives in page storage
    // (pageStorage helpers already (de)serialize JSON).
    const tags = pageStorageGet("harmonicUserTags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
      state.userTags = new Map(Object.entries(tags).slice(0, 500).map(([author, tag]) => [String(author).slice(0, 40), String(tag).slice(0, 40)]));
    }
    const blocked = pageStorageGet("harmonicBlockedUsers");
    if (Array.isArray(blocked)) state.blockedUsers = new Set(blocked.filter((entry) => typeof entry === "string").slice(0, 500));
    const seen = pageStorageGet("harmonicSeenComments");
    if (seen && typeof seen === "object" && !Array.isArray(seen)) {
      state.seenTimes = new Map(Object.entries(seen).slice(-400).map(([id, ts]) => [Number(id), Number(ts) || 0]).filter(([id, ts]) => Number.isInteger(id) && id > 0));
    }
    pageStorageSet(SETTINGS_BACKUP_KEY, state.settings);
    if (!synced.harmonicSettings) await chromeSyncSet({ harmonicSettings: state.settings });
  }

  function persistUserTags() {
    pageStorageSet("harmonicUserTags", Object.fromEntries([...state.userTags].slice(0, 500)));
  }

  function persistBlockedUsers() {
    pageStorageSet("harmonicBlockedUsers", [...state.blockedUsers].slice(0, 500));
  }

  function persistSeenTimes() {
    if (INCOGNITO) return; // memory-only in incognito
    pageStorageSet("harmonicSeenComments", Object.fromEntries([...state.seenTimes].slice(-400)));
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
    const cached = state.previewById.get(story.id);
    if (cached && (!cached.failedUntil || cached.failedUntil > Date.now())) return resolve(cached);
    if (cached?.failedUntil) state.previewById.delete(story.id);
    const timer = setTimeout(() => resolve({ image: null, tint: null, favicon: null }), 7000);
    const wantRich = state.settings.richPreviews !== false;
    chrome.runtime.sendMessage({ type: "HARMONIC_PREVIEW", url: story.url, rich: wantRich }, (response) => {
      clearTimeout(timer);
      const value = response?.ok ? response : { image: null, tint: null, favicon: null };
      // Without rich facts the response stays uncached while the toggle is
      // on, so enabling the feature refetches instead of waiting out the TTL.
      if (value.rich || !wantRich) state.previewById.set(story.id, value);
      resolve(value);
    });
  });

  // Preview requests are lazy for global-search results, with at most three
  // concurrent metadata fetches. The same queue serves feed cards too.
  const previewJobs = [];
  let previewRunning = 0;
  let previewObserver = null;
  const pumpPreviews = () => {
    while (previewRunning < 3 && previewJobs.length) {
      const task = previewJobs.shift();
      previewRunning++;
      getPreview(task.story).then((result) => {
        if (task.card.isConnected) task.show(result);
      }).finally(() => { previewRunning--; pumpPreviews(); });
    }
  };
  const requestCardPreview = (card, story, show) => {
    const add = () => {
      previewJobs.push({ card, story, show });
      pumpPreviews();
    };
    if (state.search.active && typeof IntersectionObserver !== "undefined") {
      if (!previewObserver) previewObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          previewObserver.unobserve(entry.target);
          entry.target._loadHarmonicPreview?.();
          delete entry.target._loadHarmonicPreview;
        }
      }, { root: storyList, rootMargin: "300px" });
      card._loadHarmonicPreview = add;
      previewObserver.observe(card);
    } else add();
  };

  const faviconUrl = (story) => {
    if (!story?.url) return null;
    try {
      const host = new URL(story.url).hostname;
      const provider = state.settings.faviconProvider || "google";
      const url = provider === "duckduckgo"
        ? "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(host) + ".ico"
        : provider === "direct"
          ? "https://" + host + "/favicon.ico"
          : "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=128";
      return safeImageSrc(url);
    } catch { return null; }
  };

  let app, feedPane, threadPane, storyList, feedTitle, updatedLabel, searchWrap, searchInput;
  let frontDateInput;
  let searchPanel, searchFilters, searchRecent, searchChips, searchSubmit;
  let accountChip;

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
    app.dataset.compactPoints = String(state.settings.compactPoints);
    app.dataset.showDomain = String(state.settings.showDomain !== false);
    if (state.search.mode === "loaded") filterStories();
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
    // Phase 7 part 3: appearance — surface theme and interface font live on
    // the document element so they reach the body background as well.
    const root = document.documentElement;
    const themes = ["amoled", "charcoal", "navy"];
    root.dataset.theme = themes.includes(state.settings.uiTheme) ? state.settings.uiTheme : "amoled";
    const fonts = ["harmonic", "system", "serif"];
    root.dataset.font = fonts.includes(state.settings.uiFont) ? state.settings.uiFont : "harmonic";
  }

  function showToast(message, options = {}) {
    let toast = document.querySelector(".harmonic-toast");
    if (!toast) {
      toast = el("div", "harmonic-toast");
      document.body.appendChild(toast);
    }
    // Phase 4: toasts can carry one action button (e.g. Undo for hide).
    toast.replaceChildren();
    toast.appendChild(el("span", "harmonic-toast-message", message));
    if (options.actionLabel && typeof options.onAction === "function") {
      const action = el("button", "harmonic-toast-action", options.actionLabel);
      action.type = "button";
      action.addEventListener("click", () => {
        clearTimeout(showToast.timer);
        toast.classList.remove("show");
        options.onAction();
      });
      toast.appendChild(action);
    }
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), options.duration || 2200);
  }

  function createToolbar() {
    const toolbar = el("header", "feed-toolbar");
    const row = el("div", "feed-toolbar-row");
    const titleButton = el("button", "feed-title-button");
    feedTitle = el("span", "feed-title", FEEDS[state.feed].label);
    titleButton.append(feedTitle, svg("chevron", "feed-chevron"));
    titleButton.addEventListener("click", (event) => openFeedMenu(event.currentTarget));
    // Phase 7: date picker for the Past Frontpages feed.
    frontDateInput = el("input", "feed-date-input");
    frontDateInput.type = "date";
    frontDateInput.value = validFrontDate(state.settings.frontDate) || frontDayOffset(1);
    frontDateInput.max = frontDayOffset(0);
    frontDateInput.addEventListener("change", async () => {
      state.settings.frontDate = validFrontDate(frontDateInput.value) ? frontDateInput.value : "";
      await saveSettings();
      refreshFeed();
    });

    const actions = el("div", "feed-toolbar-actions");
    const searchButton = button("search", "Search");
    searchButton.addEventListener("click", toggleSearch);
    const refreshButton = button("refresh", "Refresh");
    refreshButton.addEventListener("click", refreshFeed);
    const newPostButton = button("plus", "New post");
    newPostButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // SEC-30
      startNewPost();
    });
    const moreButton = button("more", "More");
    moreButton.addEventListener("click", (event) => openMoreMenu(event.currentTarget));
    accountChip = el("button", "account-chip");
    accountChip.type = "button";
    accountChip.id = "harmonic-account-chip";
    accountChip.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // SEC-30: scripted clicks never open menus
      openAccountMenu(event.currentTarget);
    });
    actions.append(searchButton, refreshButton, moreButton);
    accountChip.classList.add("thread-secondary-action");
    row.append(titleButton, frontDateInput, actions, accountChip);
    updateAccountChip();

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

    searchSubmit = el("button", "hn-search-submit");
    searchSubmit.type = "button";
    searchSubmit.hidden = true;
    searchSubmit.addEventListener("click", () => {
      setSearchMode("global");
      runGlobalSearch(0);
    });
    searchRecent = el("div", "hn-search-recent");
    searchRecent.hidden = true;

    searchPanel.append(modes, searchSubmit, searchFilters, searchRecent);
    return searchPanel;
  }

  function openPopup(anchor, items, pointer = null) {
    document.querySelector(".harmonic-popup")?.remove();
    const popup = el("div", "harmonic-popup");
    for (const item of items) {
      if (item.heading) {
        popup.appendChild(el("div", "popup-heading", item.heading));
        continue;
      }
      const row = el("button", "popup-item");
      row.type = "button";
      if (item.icon) {
        row.dataset.icon = item.icon;
        row.appendChild(svg(item.icon));
      }
      row.appendChild(el("span", "", item.label));
      row.addEventListener("click", (event) => {
        if (!event.isTrusted) return; // SEC-30: scripted menu clicks never act
        popup.remove();
        item.action(event);
      });
      popup.appendChild(row);
    }
    document.body.appendChild(popup);
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const targetX = pointer ? pointer.x : rect.right - width;
    const targetY = pointer ? pointer.y : rect.bottom + margin;
    popup.style.left = Math.max(margin, Math.min(targetX, window.innerWidth - width - margin)) + "px";
    popup.style.top = Math.max(margin, Math.min(targetY, window.innerHeight - height - margin)) + "px";
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

  // ---------------------------------------------------------------------------
// Phase 1: account chip (session chip, login hand-off, logout)
// ---------------------------------------------------------------------------

// SEC-02: the only login hand-off. The goto value is built from an allowlist of
// Harmonic's own known paths — user-supplied query strings are never reflected.
function currentGotoPath() {
  if (location.pathname === "/item") {
    const id = Number(new URLSearchParams(location.search).get("id"));
    if (Number.isInteger(id) && id > 0) return "item?id=" + id;
  }
  const feedPath = FEEDS[state.feed]?.path;
  if (feedPath && ["top", "new", "best", "ask", "show", "jobs"].includes(state.feed)) {
    const path = feedPath.replace(/^\//, "");
    if (["news", "newest", "front", "best", "ask", "show", "jobs"].includes(path)) return path;
  }
  return "news";
}

function goToLogin() {
  const goto = currentGotoPath();
  location.href = "https://news.ycombinator.com/login?goto=" + encodeURIComponent(goto);
}

function openHnPage(path) {
  location.href = "https://news.ycombinator.com" + path;
}

function updateAccountChip() {
  if (!accountChip) return;
  const session = window.HarmonicHN?.session?.() || null;
  accountChip.replaceChildren();
  accountChip.classList.toggle("logged-in", Boolean(session));
  if (session?.username) {
    const karma = session.karma === null || session.karma === undefined ? "" : " · " + compact(session.karma) + " karma";
    accountChip.append(svg("user", "account-chip-icon"), el("span", "account-chip-name", session.username));
    accountChip.title = "Account: " + session.username + karma;
    accountChip.setAttribute("aria-label", "Account menu for " + session.username);
  } else {
    accountChip.append(svg("user", "account-chip-icon"), el("span", "account-chip-name", "Log in"));
    accountChip.title = "Log in to Hacker News";
    accountChip.setAttribute("aria-label", "Log in to Hacker News");
  }
}

function openAccountMenu(anchor) {
  const session = window.HarmonicHN?.session?.() || null;
  if (!session) {
    openPopup(anchor, [
      { label: "Log in", icon: "user", action: goToLogin },
      { label: "Create account", icon: "external", action: goToLogin },
    ]);
    return;
  }
  const karma = session.karma === null || session.karma === undefined ? "" : " · " + compact(session.karma) + " karma";
  openPopup(anchor, [
    { heading: session.username + karma },
    { label: "Profile", icon: "user", action: () => openUserPanel(session.username) },
    { label: "Threads", icon: "comment", action: () => openListView("threads") },
    { label: "Upvoted", icon: "up", action: () => openListView("upvoted") },
    { label: "Favorites", icon: "star", action: () => openListView("favorites") },
    { label: "Submissions", icon: "link", action: () => openListView("submissions") },
    { label: "Hidden", icon: "eyeOff", action: () => openListView("hidden") },
    { label: "Log out", icon: "power", action: performLogout },
  ]);
}

// SEC-04: logout is a signed-in fetch handled by HarmonicHN, not a navigation
// to /logout, so tokens are never pasted into URLs. Afterwards we reload the
// feed so the page reflects the signed-out state.
async function performLogout() {
  const outcome = await window.HarmonicHN?.logout?.();
  if (!outcome || outcome.status !== "success") {
    showToast(outcome?.message || "Sign-out needs Hacker News");
    return;
  }
  draftClearAll(); // drafts are keyed by username; signing out clears them all
  state.feedVotes.clear();
  state.itemState = null;
  state.pollOptions = null;
  showToast("Signed out");
  location.reload();
}

// ---------------------------------------------------------------------------
// Phase 2: voting (story upvote, comment up/down votes, poll options)
// ---------------------------------------------------------------------------

// Vote state seen on the feed document when Harmonic first mounted. Used to
// light up "already voted" affordances before per-item state is fetched.
function seedFeedVotes() {
  const docVotes = window.HarmonicHN?.documentVoteState?.() || {};
  for (const [id, direction] of Object.entries(docVotes)) {
    const numeric = Number(id);
    if (Number.isInteger(numeric) && numeric > 0) state.feedVotes.set(numeric, direction === "down" ? "down" : "up");
  }
}

// SEC-30: Harmonic never sends an action unless the click is a real user
// gesture. Scripted element.click() from page code has isTrusted === false.
function requireTrustedEvent(event) {
  if (event?.isTrusted) return true;
  showToast("That action needs a real click");
  return false;
}

function cancelItemState() {
  clearTimeout(state.itemStateTimer);
  state.itemStateTimer = 0;
  state.itemStateToken++;
}

// Once a story has been open for 600ms, ask Hacker News (via HarmonicHN) for
// the document state: the story's vote links and every comment's vote links.
// This is a single signed-in GET, queued through the module's rate limiter.
function scheduleItemState(id) {
  cancelItemState();
  const token = state.itemStateToken;
  state.itemStateTimer = setTimeout(async () => {
    if (!window.HarmonicHN || state.selectedId !== id || token !== state.itemStateToken) return;
    await loadThreadItemState(id, token);
  }, 600);
}

async function loadThreadItemState(id, token) {
  try {
    const itemState = await window.HarmonicHN.ensureItemState(id);
    if (token !== state.itemStateToken || state.selectedId !== id) return;
    state.itemState = itemState || null;
    if (itemState?.story?.voted) state.feedVotes.set(id, itemState.story.votedDirection === "down" ? "down" : "up");
    else if (itemState?.status === "ok") state.feedVotes.delete(id);
    applyItemState();
  } catch {
    /* non-fatal: voting falls back to "sign in" prompts */
  }
}

function applyItemState() {
  updateThreadVoteUi();
  renderPollOptions();
  updateFeedVoteBadges();
}

function updateThreadVoteUi() {
  const story = state.itemState?.story || null;
  const voteButton = threadPane.querySelector("[data-thread-vote]");
  if (voteButton) {
    const pending = voteButton.dataset.pending === "1";
    voteButton.classList.toggle("active", !pending && Boolean(story?.voted));
    voteButton.title = story ? (story.voted ? "Unvote" : "Upvote") : "Loading vote state…";
    voteButton.classList.toggle("loading", !story);
    voteButton.setAttribute("aria-label", voteButton.title);
    if (!pending) voteButton.disabled = false;
  }
  const favoriteButton = threadPane.querySelector("[data-thread-favorite]");
  if (favoriteButton) {
    const pending = favoriteButton.dataset.pending === "1";
    favoriteButton.classList.toggle("active", !pending && Boolean(story?.favorited));
    favoriteButton.title = story?.favorited ? "Unfavorite" : "Favorite";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    // Phase 4: hide the control when the fetched document shows no favorite
    // link (unknown state keeps the control visible until the fetch lands).
    favoriteButton.hidden = !pending && story !== null && story.favoriteAvailable === false;
    if (!pending) favoriteButton.disabled = false;
  }
  const hideButton = threadPane.querySelector("[data-thread-hide]");
  if (hideButton) {
    const pending = hideButton.dataset.pending === "1";
    hideButton.classList.toggle("active", !pending && Boolean(story?.hidden));
    hideButton.title = story?.hidden ? "Unhide" : "Hide";
    hideButton.setAttribute("aria-label", hideButton.title);
    hideButton.hidden = !pending && story !== null && story.hideAvailable === false;
    if (!pending) hideButton.disabled = false;
  }
  for (const row of threadPane.querySelectorAll(".comment-row[data-comment-id]")) {
    const id = Number(row.dataset.commentId);
    if (id > 0) syncCommentVoteUi(id);
  }
}

function syncCommentVoteUi(commentId) {
  const row = threadPane.querySelector('.comment-row[data-comment-id="' + commentId + '"]');
  if (!row) return;
  const cs = state.itemState?.comments?.[commentId] || null;
  const voteMark = row.querySelector("[data-comment-vote-mark]");
  if (voteMark) {
    voteMark.hidden = !cs?.voted;
    voteMark.textContent = cs?.votedDirection === "down" ? "↓" : "↑";
  }
  const voteButton = row.querySelector("[data-comment-vote]");
  if (voteButton) {
    const pending = voteButton.dataset.pending === "1";
    const voted = Boolean(cs?.voted);
    voteButton.classList.toggle("active", !pending && voted && cs?.votedDirection !== "down");
    voteButton.title = voted ? "Unvote" : "Upvote";
    voteButton.setAttribute("aria-label", voteButton.title);
  }
  const downButton = row.querySelector("[data-comment-vote-down]");
  if (downButton) {
    const pending = downButton.dataset.pending === "1";
    // The down arrow stays visible while a downvote is active: the filled
    // arrow is Hacker News's own undown affordance.
    downButton.hidden = pending ? downButton.hidden : !(cs?.canDown || (cs?.voted && cs?.votedDirection === "down"));
    downButton.classList.toggle("active", !pending && Boolean(cs?.voted && cs?.votedDirection === "down"));
  }
}

function bumpThreadPoints(delta) {
  const statNode = threadPane.querySelector("[data-thread-points]");
  const valueNode = statNode?.querySelector("span:last-child");
  if (!valueNode) return;
  const current = Number(valueNode.dataset.threadPointsValue || valueNode.textContent.replace(/\D/g, "") || 0);
  const next = Math.max(0, current + delta);
  valueNode.dataset.threadPointsValue = String(next);
  valueNode.textContent = compact(next);
}

async function handleStoryVote(event) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to vote");
    goToLogin();
    return;
  }
  const storyId = state.selectedId;
  if (!Number.isInteger(storyId) || storyId <= 0) return;
  const voteButton = threadPane.querySelector("[data-thread-vote]");
  if (!voteButton || voteButton.dataset.pending === "1") return; // one vote in flight (SEC-32)
  voteButton.dataset.pending = "1";
  voteButton.disabled = true;
  // Defer a fast click until we have the actual voted state from HN.
  if (state.itemState?.status !== "ok" || state.itemState.itemId !== storyId) {
    clearTimeout(state.itemStateTimer);
    await loadThreadItemState(storyId, state.itemStateToken);
    if (state.selectedId !== storyId || state.itemState?.status !== "ok") {
      delete voteButton.dataset.pending;
      voteButton.disabled = false;
      showToast("Couldn't load your vote state");
      return;
    }
  }
  const voted = Boolean(state.itemState.story.voted);
  const direction = voted ? "un" : "up";
  // Optimistic UI — rolled back below if Hacker News rejects the vote.
  voteButton.classList.toggle("active", !voted);
  bumpThreadPoints(voted ? -1 : 1);
  const rollback = () => {
    voteButton.disabled = false;
    delete voteButton.dataset.pending;
    voteButton.classList.toggle("active", voted);
    bumpThreadPoints(voted ? 1 : -1);
  };
  try {
    const outcome = await window.HarmonicHN.vote(storyId, direction);
    if (outcome.status !== "success") {
      rollback();
      showToast(outcome.message || "The vote did not go through");
      if (outcome.status === "rateLimited") showToast("Hacker News rate limit — try again soon, or open the story there");
      if (outcome.status === "loginRequired") updateAccountChip();
      return;
    }
    const nextState = outcome.state || null;
    if (state.itemState) {
      state.itemState = { ...state.itemState, story: { ...state.itemState.story, ...(nextState || {}) } };
    }
    voteButton.disabled = false;
    delete voteButton.dataset.pending;
    voteButton.classList.toggle("active", Boolean(nextState?.voted));
    voteButton.title = nextState?.voted ? "Unvote" : "Upvote";
    if (direction === "up") state.feedVotes.set(storyId, "up");
    else state.feedVotes.delete(storyId);
    updateFeedVoteBadges();
  } catch {
    rollback();
    showToast("The vote did not go through");
  }
}

async function handleCommentVote(event, commentId, requestedDown = null) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to vote");
    return;
  }
  if (!Number.isInteger(commentId) || commentId <= 0) return;
  const buttonNode = event.currentTarget;
  if (!buttonNode || buttonNode.dataset.pending === "1") return;
  const isDown = requestedDown === null ? buttonNode.hasAttribute("data-comment-vote-down") : requestedDown;
  buttonNode.dataset.pending = "1";
  if (state.itemState?.status !== "ok" || state.itemState.itemId !== state.selectedId) {
    await loadThreadItemState(state.selectedId, state.itemStateToken);
    if (state.itemState?.status !== "ok") {
      delete buttonNode.dataset.pending;
      showToast("Couldn't load your vote state");
      return;
    }
  }
  const cs = state.itemState?.comments?.[commentId] || {};
  const voted = Boolean(cs.voted);
  const direction = voted ? "un" : isDown ? "down" : "up";
  buttonNode.dataset.pending = "1";
  buttonNode.classList.add("pending");
  buttonNode.classList.toggle("active", !voted);
  try {
    const outcome = await window.HarmonicHN.vote(commentId, direction);
    if (outcome.status !== "success") {
      showToast(outcome.message || "The vote did not go through");
      if (outcome.status === "loginRequired") updateAccountChip();
    } else if (state.itemState) {
      state.itemState.comments[commentId] = { ...(state.itemState.comments[commentId] || {}), ...(outcome.state || {}) };
    }
  } catch {
    showToast("The vote did not go through");
  } finally {
    delete buttonNode.dataset.pending;
    buttonNode.classList.remove("pending");
    const cs = state.itemState?.comments?.[commentId] || null;
    const votedNow = Boolean(cs?.voted);
    buttonNode.classList.toggle("active", votedNow && cs?.votedDirection !== "down");
    if (buttonNode.hasAttribute("data-comment-vote-down")) {
      buttonNode.classList.toggle("active", Boolean(votedNow && cs?.votedDirection === "down"));
    }
    syncCommentVoteUi(commentId);
  }
}

// ---------------------------------------------------------------------------
// Phase 4: favorite, hide (with undo), flag
// ---------------------------------------------------------------------------

async function handleStoryFavorite(event) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to favorite");
    goToLogin();
    return;
  }
  const storyId = state.selectedId;
  if (!Number.isInteger(storyId) || storyId <= 0) return;
  const favoriteButton = threadPane.querySelector("[data-thread-favorite]");
  if (!favoriteButton || favoriteButton.dataset.pending === "1") return; // one action in flight (SEC-32)
  const favorited = Boolean(state.itemState?.story?.favorited);
  favoriteButton.dataset.pending = "1";
  favoriteButton.classList.add("pending");
  favoriteButton.classList.toggle("active", !favorited); // optimistic
  try {
    const outcome = await window.HarmonicHN.setFavorite(storyId, !favorited);
    if (outcome.status === "success") {
      if (state.itemState && state.itemState.itemId === storyId && outcome.state) {
        state.itemState.story = { ...state.itemState.story, ...outcome.state };
      }
      showToast(favorited ? "Removed from favorites" : "Favorited");
    } else {
      if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
      showToast(outcome.message || "Favoriting did not go through");
    }
  } catch {
    showToast("Favoriting did not go through");
  } finally {
    delete favoriteButton.dataset.pending;
    favoriteButton.classList.remove("pending");
    updateThreadVoteUi();
  }
}

async function handleStoryHide(event) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to hide");
    goToLogin();
    return;
  }
  const storyId = state.selectedId;
  if (!Number.isInteger(storyId) || storyId <= 0) return;
  const hideButton = threadPane.querySelector("[data-thread-hide]");
  if (!hideButton || hideButton.dataset.pending === "1") return;
  const hidden = Boolean(state.itemState?.story?.hidden);
  hideButton.dataset.pending = "1";
  hideButton.classList.add("pending");
  try {
    const outcome = await window.HarmonicHN.setHidden(storyId, !hidden);
    if (outcome.status === "success") {
      if (state.itemState && state.itemState.itemId === storyId) {
        state.itemState.story = { ...state.itemState.story, hidden: !hidden };
      }
      if (!hidden) {
        showToast("Story hidden", {
          actionLabel: "Undo",
          duration: 6000,
          onAction: () => unhideStory(storyId),
        });
      } else {
        showToast("Story unhidden");
      }
    } else {
      if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
      showToast(outcome.message || "The story could not be hidden");
    }
  } catch {
    showToast("The story could not be hidden");
  } finally {
    delete hideButton.dataset.pending;
    hideButton.classList.remove("pending");
    updateThreadVoteUi();
  }
}

async function unhideStory(storyId) {
  try {
    const outcome = await window.HarmonicHN.setHidden(storyId, false);
    if (outcome.status === "success") {
      if (state.itemState && state.itemState.itemId === storyId) state.itemState.story.hidden = false;
      showToast("Story unhidden");
    } else {
      showToast(outcome.message || "The story is still hidden");
    }
  } catch {
    showToast("The story is still hidden");
  }
}

// SEC-36: flagging runs only behind an explicit confirmation dialog, and only
// when Hacker News actually offers a flag link for the item.
function confirmFlagItem(event, itemId, kind) {
  if (!requireTrustedEvent(event)) return;
  openConfirmDialog({
    title: "Flag this " + kind + "?",
    message:
      "Flagging tells Hacker News's moderators that this " + kind +
      " may break the site rules. Flags are weighed by the moderators and can lead to penalties — flag only when you're sure.",
    confirmLabel: "Flag",
    danger: true,
    onConfirm: async () => {
      try {
        const outcome = await window.HarmonicHN.setFlagged(itemId, true);
        showToast(outcome.status === "success" ? capitalize(kind) + " flagged" : outcome.message || "Flagging did not go through");
      } catch {
        showToast("Flagging did not go through");
      }
    },
  });
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Hide from the feed card overflow: HN hides the story, the card disappears,
// and an undo toast brings it back without reloading the feed.
async function hideFromFeed(event, storyId) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to hide");
    return;
  }
  const card = document.querySelector('.story-card[data-story-id="' + storyId + '"]');
  try {
    const outcome = await window.HarmonicHN.setHidden(storyId, true);
    if (outcome.status !== "success") {
      if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
      showToast(outcome.message || "The story could not be hidden");
      return;
    }
    if (card) card.classList.add("is-hidden");
    showToast("Story hidden", {
      actionLabel: "Undo",
      duration: 6000,
      onAction: async () => {
        try {
          const undo = await window.HarmonicHN.setHidden(storyId, false);
          if (undo.status === "success") {
            card?.classList.remove("is-hidden");
            showToast("Story unhidden");
          } else {
            showToast(undo.message || "The story is still hidden");
          }
        } catch {
          showToast("The story is still hidden");
        }
      },
    });
  } catch {
    showToast("The story could not be hidden");
  }
}

// SEC-37: bulk favorites run serially through the module's rate-limited queue
// and stay cancellable between items.
let bulkFavoritesCancelled = false;
function addBookmarksToFavorites() {
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to use your Hacker News favorites");
    return;
  }
  const ids = [...state.bookmarks];
  if (!ids.length) {
    showToast("No bookmarks yet");
    return;
  }
  const seconds = Math.max(1, Math.ceil((ids.length * 1500) / 1000));
  openConfirmDialog({
    title: "Add bookmarks to favorites?",
    message:
      "Adds " + ids.length + " bookmarked " + (ids.length === 1 ? "story" : "stories") +
      " to your Hacker News favorites, one at a time (roughly " + seconds + " seconds). You can cancel while it runs.",
    confirmLabel: "Add to favorites",
    onConfirm: () => runBulkFavorites(ids),
  });
}

async function runBulkFavorites(ids) {
  bulkFavoritesCancelled = false;
  let added = 0;
  let failed = 0;
  for (let index = 0; index < ids.length; index++) {
    if (bulkFavoritesCancelled) {
      showToast("Bulk favorite cancelled");
      return;
    }
    showToast("Adding to favorites… " + (index + 1) + " of " + ids.length, {
      actionLabel: "Cancel",
      duration: 60000,
      onAction: () => {
        bulkFavoritesCancelled = true;
      },
    });
    try {
      const outcome = await window.HarmonicHN.setFavorite(ids[index], true);
      if (outcome.status === "success") {
        added++;
      } else if (outcome.status === "loginRequired" || outcome.status === "accountChanged") {
        updateAccountChip();
        showToast("Your Hacker News session ended partway through — " + added + " of " + ids.length + " favorited");
        return;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  showToast(added + " of " + ids.length + " added to favorites" + (failed ? " · " + failed + " failed" : ""));
}

// ---------------------------------------------------------------------------
// Phase 5: story submission
// ---------------------------------------------------------------------------

function startNewPost() {
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to submit");
    return;
  }
  openSubmitModal();
}

function openSubmitModal() {
  document.querySelector(".harmonic-submit-overlay")?.remove();
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to submit");
    return;
  }
  const overlay = el("div", "harmonic-submit-overlay");
  const panel = el("div", "harmonic-submit");
  const header = el("div", "submit-header");
  header.append(
    el("h3", "", "New post"),
    (() => {
      const close = el("button", "submit-close");
      close.type = "button";
      close.setAttribute("aria-label", "Close submit form");
      close.append(svg("close"));
      close.addEventListener("click", () => overlay.remove());
      return close;
    })()
  );
  const asUser = el("div", "submit-as", "Posting as " + session.username);
  const titleLabel = el("label", "submit-label", "Title");
  const titleInput = el("input", "submit-title");
  titleInput.type = "text";
  titleInput.maxLength = 80;
  titleInput.placeholder = "A factual, neutral title";
  const titleCount = el("div", "submit-count", "0/80");
  const urlLabel = el("label", "submit-label", "URL");
  const urlInput = el("input", "submit-url");
  urlInput.type = "url";
  urlInput.placeholder = "https://… (leave empty for a text post)";
  const textLabel = el("label", "submit-label", "Text");
  const textInput = el("textarea", "submit-text");
  textInput.rows = 5;
  textInput.placeholder = "The text of your post (use either URL or text)";
  const guidelines = el("a", "submit-guidelines", "Read the Hacker News guidelines before posting");
  guidelines.href = "https://news.ycombinator.com/newsguidelines.html";
  guidelines.target = "_blank";
  guidelines.rel = "noopener noreferrer";
  const status = el("div", "submit-status");
  status.hidden = true;
  const actionsRow = el("div", "submit-actions");
  const cancel = el("button", "submit-cancel", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => overlay.remove());
  const submit = el("button", "submit-go", "Submit story");
  submit.type = "button";
  actionsRow.append(cancel, submit);
  panel.append(header, asUser, titleLabel, titleInput, titleCount, urlLabel, urlInput, textLabel, textInput, guidelines, status, actionsRow);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  titleInput.focus();

  titleInput.addEventListener("input", () => {
    titleCount.textContent = titleInput.value.length + "/80";
  });

  const fail = (message, handoff = false) => {
    submit.disabled = false;
    status.hidden = false;
    status.replaceChildren(document.createTextNode(message));
    status.classList.add("error");
    if (handoff) {
      const open = el("button", "submit-hn-open", "Continue on Hacker News");
      open.type = "button";
      open.addEventListener("click", () => openOriginalHackerNews("/submit"));
      status.appendChild(open);
    }
  };

  submit.addEventListener("click", (event) => {
    if (!event.isTrusted) return; // SEC-30
    let title = titleInput.value.trim();
    let url = urlInput.value.trim();
    let text = textInput.value.replace(/\s+$/, "");
    if (!title) {
      fail("A title is required");
      return;
    }
    title = title.slice(0, 80);
    const hasUrl = Boolean(url);
    const hasText = Boolean(text.trim());
    if (!hasUrl && !hasText) {
      fail("Add a URL or some text");
      return;
    }
    if (hasUrl) {
      const safe = safeHref(url);
      if (!safe) {
        fail("That URL is not allowed. Use a public http(s) link.");
        return;
      }
      url = safe;
    }
    submit.disabled = true;
    status.hidden = false;
    status.classList.remove("error");
    status.textContent = "Opening the Hacker News submit form…";
    (async () => {
      try {
        const opened = await window.HarmonicHN.openSubmitForm();
        if (opened.status !== "ok") {
          if (opened.status === "loginRequired") updateAccountChip();
          fail(opened.message || "Could not open the Hacker News submit form. Open it on Hacker News instead.", true);
          return;
        }
        status.textContent = "Posting your story…";
        const outcome = await window.HarmonicHN.submitStory(opened.handle, { title, url, text });
        handleSubmitOutcome(outcome);
      } catch {
        fail("The request to Hacker News failed. Your values are kept.");
      }
    })();
  });

  function handleSubmitOutcome(outcome) {
    if (outcome.status === "success") {
      overlay.remove();
      showToast("Story submitted");
      refreshFeed();
      return;
    }
    if (outcome.status === "alreadySubmitted") {
      overlay.remove();
      showToast("Hacker News already has this story");
      if (Number.isInteger(outcome.existingId) && outcome.existingId > 0) loadThread(outcome.existingId);
      return;
    }
    if (outcome.status === "validationRequired") {
      // Keep the entered values and hand off to HN's own stock form —
      // Harmonic never auto-fills a form on hacker news itself.
      const open = el("button", "submit-hn-open", "Open the Hacker News submit form");
      open.type = "button";
      open.addEventListener("click", () => openOriginalHackerNews("/submit"));
      status.hidden = false;
      status.classList.add("error");
      status.replaceChildren(
        document.createTextNode("Hacker News asks for verification before submitting. Your values are kept."),
        document.createElement("br"),
        open
      );
      submit.disabled = false;
      return;
    }
    if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
    fail(outcome.message || "Hacker News did not confirm the submission. Check /newest before posting again.");
  }
}

// ---------------------------------------------------------------------------
// Phase 6: user panel + own account lists
// ---------------------------------------------------------------------------

const LIST_VIEWS = {
  threads: { title: "Your threads", path: (u) => "/threads?id=" + u, kind: "comments", public: false },
  upvoted: { title: "Your upvoted", path: (u) => "/upvoted?id=" + u, kind: "stories", public: false },
  favorites: { title: "Your favorites", path: (u) => "/favorites?id=" + u, kind: "stories", public: true },
  submissions: { title: "Your submissions", path: (u) => "/submitted?id=" + u, kind: "stories", public: true },
  hidden: { title: "Your hidden", path: (u) => "/hidden?id=" + u, kind: "stories", public: false },
  comments: { title: "Your comments", path: (u) => "/comments?id=" + u, kind: "comments", public: true },
};

// kind "comments" is also used for other users' comment lists.
const PUBLIC_LIST_TITLES = {
  submissions: (u) => u + "'s submissions",
  comments: (u) => u + "'s comments",
  favorites: (u) => u + "'s favorites",
};

async function openListView(kind, username) {
  const config = LIST_VIEWS[kind];
  if (!config) return;
  const session = window.HarmonicHN?.session?.();
  const own = !username || username === session?.username;
  if (!own && !config.public) {
    showToast("That list is private on Hacker News");
    return;
  }
  if (own && !session) {
    showToast("Sign in to see your lists");
    return;
  }
  const target = own ? encodeURIComponent(session.username) : encodeURIComponent(username);
  state.listView = {
    kind,
    own,
    path: config.path(target),
    pendingMore: null,
    done: false,
    loading: false,
    seen: new Set(),
  };
  renderListViewShell(own ? config.title : (PUBLIC_LIST_TITLES[kind] || ((u) => u + "'s " + kind))(username));
  await loadListViewBatch();
}

function renderListViewShell(title) {
  abortSearch();
  state.search.active = false;
  const pane = el("div", "list-view");
  const header = el("div", "list-view-header");
  const back = el("button", "list-view-back");
  back.type = "button";
  back.append(svg("chevron"), el("span", "", "Back to feed"));
  back.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    state.listView = null;
    refreshFeed();
  });
  header.append(back, el("h2", "", title));
  const body = el("div", "list-view-body");
  const more = el("button", "list-view-more", "Load more");
  more.type = "button";
  more.hidden = true;
  more.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    loadListViewBatch();
  });
  pane.append(header, body, more);
  storyList.replaceChildren(pane);
}

async function loadListViewBatch() {
  const view = state.listView;
  if (!view || view.loading) return;
  view.loading = true;
  const pane = storyList.querySelector(".list-view");
  const body = pane?.querySelector(".list-view-body");
  const moreButton = pane?.querySelector(".list-view-more");
  const firstBatch = !view.pendingMore;
  const path = view.pendingMore || view.path;
  if (body && firstBatch) body.replaceChildren(createLoading("Loading your " + view.kind + "…"));
  try {
    const result = await window.HarmonicHN.fetchListPage(path);
    if (state.listView !== view) return;
    if (result.status !== "ok") {
      if (body) body.replaceChildren(el("div", "harmonic-error", result.message || "Hacker News did not return the list"));
      view.loading = false;
      if (moreButton) moreButton.hidden = true;
      return;
    }
    if (body && firstBatch) body.replaceChildren();
    view.pendingMore = result.morePath;
    view.done = !result.morePath;
    const freshIds = result.ids.filter((id) => !view.seen.has(id));
    freshIds.forEach((id) => view.seen.add(id));
    if (LIST_VIEWS[view.kind].kind === "comments") {
      const rows = await Promise.all(freshIds.map((id) => renderThreadListItem(id)));
      if (state.listView !== view) return;
      rows.forEach((row) => row && body.appendChild(row));
    } else {
      const stories = await fetchItems(freshIds);
      if (state.listView !== view) return;
      const startIndex = body.querySelectorAll(".story-card").length;
      stories.forEach((story, index) => story && body.appendChild(createStoryCard(story, startIndex + index)));
    }
    view.loading = false;
    if (moreButton) moreButton.hidden = view.done;
    if (body && !body.childElementCount) body.appendChild(el("div", "list-empty", "Nothing here yet."));
  } catch {
    view.loading = false;
    if (body) body.replaceChildren(el("div", "harmonic-error", "The list could not be loaded. Try again shortly."));
    if (moreButton) moreButton.hidden = true;
  }
}

// Threads (reply inbox): one Algolia item fetch per comment carries the text,
// the story it belongs to, and the story title — everything the row needs.
async function renderThreadListItem(commentId) {
  try {
    const hit = await fetchJson(ALGOLIA_API + "/items/" + commentId);
    if (!hit || !Number.isInteger(hit.story_id)) return el("div", "list-empty", "A comment is no longer visible.");
    const row = el("article", "thread-list-item");
    const storyButton = el("button", "thread-list-story");
    storyButton.type = "button";
    storyButton.append(
      el("span", "thread-list-story-title", hit.story_title || "A discussion"),
      el("span", "thread-list-story-meta", "open discussion")
    );
    storyButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      loadThread(hit.story_id);
    });
    const meta = el("div", "thread-list-meta", (hit.author || "unknown") + " · " + relativeTime(hit.created_at_i || 0));
    const text = el("div", "thread-list-text");
    appendSanitizedHtml(text, hit.text || "");
    row.append(storyButton, meta, text);
    return row;
  } catch {
    return el("div", "list-empty", "A comment could not be loaded.");
  }
}

function memberSince(created) {
  const seconds = Number(created) || 0;
  if (!seconds) return "";
  try {
    return new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// SEC-05: the user panel reads the public Firebase user record — Hacker News
// profile HTML is never fetched, so no cookies or tokens flow to /user.
async function openUserPanel(username) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(username || "")) return;
  document.querySelector(".harmonic-user-overlay")?.remove();
  const overlay = el("div", "harmonic-user-overlay");
  const panel = el("div", "harmonic-user");
  const header = el("div", "user-header");
  header.append(
    el("h3", "", username),
    (() => {
      const close = el("button", "user-close");
      close.type = "button";
      close.setAttribute("aria-label", "Close profile panel");
      close.append(svg("close"));
      close.addEventListener("click", () => overlay.remove());
      return close;
    })()
  );
  const karmaRow = el("div", "user-karma", "Loading…");
  const about = el("div", "user-about");
  const submissionsTitle = el("h4", "", "Recent items");
  const submissions = el("div", "user-submissions");
  const links = el("div", "user-links");
  // Segmented public-list tabs open inside Harmonic, for own and other users.
  const tabs = el("nav", "user-tabs");
  for (const kind of ["submissions", "comments", "favorites"]) {
    const tab = el("button", "user-tab", kind[0].toUpperCase() + kind.slice(1));
    tab.type = "button";
    tab.addEventListener("click", () => {
      overlay.remove();
      openListView(kind, username);
    });
    tabs.append(tab);
  }
  const profileHref = safeHref("https://news.ycombinator.com/user?id=" + encodeURIComponent(username));
  if (profileHref) {
    const profileLink = el("a", "user-hn-link", "Open profile on Hacker News");
    profileLink.href = profileHref;
    profileLink.target = "_blank";
    profileLink.rel = "noopener noreferrer";
    links.appendChild(profileLink);
  }
  panel.append(header, karmaRow, about, tabs, submissionsTitle, submissions, links);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  const escapeHandler = (event) => {
    if (event.key === "Escape") {
      document.removeEventListener("keydown", escapeHandler);
      close();
    }
  };
  document.addEventListener("keydown", escapeHandler);

  try {
    const user = await fetchJson(HN_API + "/user/" + encodeURIComponent(username) + ".json");
    if (!overlay.isConnected) return;
    if (!user || typeof user !== "object" || !user.id) {
      karmaRow.textContent = "This profile is not available.";
      submissionsTitle.hidden = true;
      submissions.hidden = true;
      return;
    }
    karmaRow.replaceChildren(
      el("strong", "", compact(Number(user.karma) || 0) + " karma"),
      el("span", "", memberSince(user.created) ? " · member since " + memberSince(user.created) : "")
    );
    if (user.about) appendSanitizedHtml(about, String(user.about));
    else about.hidden = true;
    const ids = Array.isArray(user.submitted)
      ? user.submitted.filter((id) => Number.isInteger(id) && id > 0).slice(0, 8)
      : [];
    if (!ids.length) {
      submissions.appendChild(el("div", "list-empty", "No submissions yet."));
      return;
    }
    const items = await fetchItems(ids);
    if (!overlay.isConnected) return;
    if (!items.length) {
      submissions.appendChild(el("div", "list-empty", "No submissions yet."));
      return;
    }
    for (const item of items) {
      if (!item || !Number.isInteger(item.id)) continue;
      const row = el("button", "user-submission");
      row.type = "button";
      const label = item.title || (item.text ? String(item.text).replace(/\s+/g, " ").slice(0, 140) : "(untitled)");
      row.append(
        el("span", "user-submission-title", label),
        el("span", "user-submission-meta", (item.type === "comment" ? "comment · " : "") + compact(item.score || item.descendants || 0))
      );
      row.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        overlay.remove();
        loadThread(item.id);
      });
      submissions.appendChild(row);
    }
  } catch {
    karmaRow.textContent = "The profile could not be loaded. Open it on Hacker News instead.";
  }
}

// ---------------------------------------------------------------------------
async function loadPollOptions(storyId) {
  state.pollOptions = null;
  try {
    const item = await fetchJson(HN_API + "/item/" + storyId + ".json");
    if (state.selectedId !== storyId || item?.type !== "poll" || !Array.isArray(item.parts)) return;
    const options = await fetchItems(item.parts);
    if (state.selectedId !== storyId) return;
    state.pollOptions = options
      .filter((option) => Number.isInteger(option.id) && option.id > 0)
      .map((option) => ({ id: option.id, text: option.text || "", points: option.points || 0 }));
    renderPollOptions();
  } catch {
    /* polls are optional decoration */
  }
}

function renderPollOptions() {
    // Idempotent: applyItemState runs after every item-state refresh and must
    // not stomp in-flight votes by recreating the buttons.
    const key = (state.pollOptions || []).map((option) => option.id + ":" + option.points).join(",");
    if (threadPane.querySelector(".thread-poll") && key === state.pollOptionsRenderedKey) return;
    state.pollOptionsRenderedKey = key;
    threadPane.querySelector(".thread-poll")?.remove();
    if (!state.pollOptions?.length || state.pollOptions.some((option) => !option.text)) return;
    const poll = el("section", "thread-poll");
    poll.append(el("h2", "", "Poll"));
    for (const option of state.pollOptions) {
      const row = el("div", "poll-option");
      const voteButton = el("button", "poll-option-vote");
      voteButton.type = "button";
      voteButton.title = "Vote";
      voteButton.setAttribute("aria-label", "Vote: " + (option.text || "option"));
      voteButton.append(svg("up"));
      const known = state.itemState?.comments?.[option.id];
      if (known) voteButton.classList.toggle("active", Boolean(known.voted && known.votedDirection !== "down"));
      voteButton.addEventListener("click", (event) => handleCommentVote(event, option.id));
      const text = el("div", "poll-option-text");
      appendSanitizedHtml(text, option.text);
      const score = el("span", "poll-option-points", compact(option.points) + " points");
      row.append(voteButton, text, score);
      poll.appendChild(row);
    }
    const commentsSection = threadPane.querySelector(".comments");
    if (commentsSection) threadPane.insertBefore(poll, commentsSection);
    else threadPane.appendChild(poll);
  }

function updateFeedVoteBadges() {
  for (const card of storyList.querySelectorAll(".story-card[data-story-id]")) {
    const id = Number(card.dataset.storyId);
    if (!Number.isInteger(id) || id <= 0) continue;
    applyCardVotedState(card, id);
  }
}

// ---------------------------------------------------------------------------
// Phase 3: composer (replies + edits) and drafts
// ---------------------------------------------------------------------------

// Drafts live in chrome.storage.session via the background worker (SEC-50):
// keyed by acting username + parent item, ≤20 KB each, ≤50 entries, cleared on
// logout and after a successful post. They never touch disk or sync.
const draftGet = (parentId) =>
  new Promise((resolve) => {
    const session = window.HarmonicHN?.session?.();
    chrome.runtime.sendMessage({ type: "HARMONIC_DRAFT_GET", parentId, username: session?.username || "" }, (response) => {
      resolve(chrome.runtime.lastError ? "" : response?.ok ? response.text || "" : "");
    });
  });
const draftSet = (parentId, text) => {
  const session = window.HarmonicHN?.session?.();
  chrome.runtime.sendMessage({ type: "HARMONIC_DRAFT_SET", parentId, username: session?.username || "", text }, () => {});
};
const draftClear = (parentId) => {
  const session = window.HarmonicHN?.session?.();
  chrome.runtime.sendMessage({ type: "HARMONIC_DRAFT_CLEAR", parentId, username: session?.username || "" }, () => {});
};
const draftClearAll = () => chrome.runtime.sendMessage({ type: "HARMONIC_DRAFT_CLEAR_ALL" }, () => {});

// SEC-36: destructive actions (delete comment) run only behind a real
// confirmation dialog with a Cancel button.
function openConfirmDialog({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  document.querySelector(".harmonic-confirm-overlay")?.remove();
  const overlay = el("div", "harmonic-confirm-overlay");
  const panel = el("div", "harmonic-confirm");
  panel.append(el("h3", "", title), el("p", "harmonic-confirm-message", message));
  const row = el("div", "harmonic-confirm-actions");
  const cancel = el("button", "harmonic-confirm-cancel", "Cancel");
  cancel.type = "button";
  const confirm = el("button", "harmonic-confirm-confirm" + (danger ? " danger" : ""), confirmLabel);
  confirm.type = "button";
  cancel.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  confirm.addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });
  row.append(cancel, confirm);
  panel.appendChild(row);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  confirm.focus();
}

// HN formatting preview. All content is text nodes, including URL labels.
function formatHnPreview(target, source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraph = [];
  const inline = (node, value) => {
    const pattern = /(https?:\/\/[^\s<>]+)|\*([^*\n]+)\*/g;
    let start = 0;
    for (const match of value.matchAll(pattern)) {
      node.append(document.createTextNode(value.slice(start, match.index)));
      if (match[1]) {
        const link = el("a", "", match[1]);
        link.href = match[1];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        node.append(link);
      } else node.append(el("em", "", match[2]));
      start = match.index + match[0].length;
    }
    node.append(document.createTextNode(value.slice(start)));
  };
  const flush = () => {
    if (!paragraph.length) return;
    const p = el("p");
    inline(p, paragraph.join(" "));
    target.append(p);
    paragraph = [];
  };
  let code = [];
  const flushCode = () => {
    if (code.length) target.append(el("pre", "", code.join("\n")));
    code = [];
  };
  for (const line of lines) {
    if (/^ {2,}\S/.test(line)) {
      flush();
      code.push(line.slice(2));
    } else {
      flushCode();
      if (!line.trim()) flush();
      else paragraph.push(line.trim());
    }
  }
  flush();
  flushCode();
}

// Reply/edit composer. mode "reply" posts through postComment; mode "edit"
// posts through saveEdit. The draft key is the parent (reply) or the comment
// being edited (edit).
function openComposer(options) {
  const { parentId, storyId, mode = "reply", handle = null, initialText = "", anchor = null, onDone = null } = options;
  if (!Number.isInteger(parentId) || parentId <= 0) return;
  closeComposer({ keepDraft: true });
  const session = window.HarmonicHN?.session?.();
  if (!session) {
    showToast("Sign in to reply");
    return;
  }
  const verb = mode === "edit" ? "Editing comment" : parentId === storyId ? "Commenting on" : "Replying to";
  const node = el("section", "composer");
  if (parentId !== storyId) {
    const parent = findCommentNode(state.thread, parentId);
    if (parent) {
      const context = el("div", "composer-parent-context");
      const excerpt = el("div", "composer-parent-excerpt");
      excerpt.textContent = String(parent.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
      const expand = el("button", "composer-secondary", "Show parent");
      expand.type = "button";
      expand.addEventListener("click", () => {
        const open = excerpt.classList.toggle("expanded");
        expand.textContent = open ? "Hide parent" : "Show parent";
      });
      context.append(el("strong", "", "Replying to " + (parent.author || "[deleted]")), expand, excerpt);
      node.appendChild(context);
    }
  }
  const header = el("div", "composer-header");
  header.append(
    el("span", "composer-identity", verb + " as " + session.username),
    el("span", "composer-chars", "0 characters"),
    (() => {
      const close = el("button", "composer-close");
      close.type = "button";
      close.title = "Close composer (draft stays saved)";
      close.setAttribute("aria-label", "Close composer");
      close.append(svg("close"));
      close.addEventListener("click", () => closeComposer({ keepDraft: true }));
      return close;
    })()
  );
  const textarea = el("textarea", "composer-input");
  textarea.rows = 4;
  textarea.maxLength = 8000; // HN's own maxcommentchar limit
  textarea.placeholder = mode === "edit" ? "Edit your comment" : "Say something useful";
  textarea.value = initialText;
  const previewWrap = el("div", "composer-preview");
  previewWrap.hidden = true;
  const status = el("div", "composer-status");
  status.hidden = true;
  const actions = el("div", "composer-actions");
  const previewToggle = el("button", "composer-secondary", "Preview");
  previewToggle.type = "button";
  const discard = el("button", "composer-secondary composer-discard", "Discard draft");
  discard.type = "button";
  const cancel = el("button", "composer-secondary composer-cancel", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => closeComposer({ keepDraft: true }));
  const help = el("a", "composer-format-help", "Formatting help");
  help.href = "https://news.ycombinator.com/formatdoc";
  help.target = "_blank";
  help.rel = "noopener noreferrer";
  const submit = el("button", "composer-submit", mode === "edit" ? "Save edit" : "Post reply");
  submit.type = "button";
  submit.disabled = mode !== "edit";
  actions.append(help, previewToggle, discard, (() => {
    const spacer = el("span", "composer-spacer");
    return spacer;
  })(), cancel, submit);
  const footnote = el("div", "composer-footnote", "Posting as " + session.username + " · Ctrl+Enter posts · Esc keeps your draft");
  node.append(header, textarea, previewWrap, status, actions, footnote);

  // Draft restore note + autosave (debounced).
  let draftTimer = 0;
  let previewDirty = true;
  const chars = header.querySelector(".composer-chars");
  const syncChars = () => {
    chars.textContent = textarea.value.length + (textarea.value.length === 1 ? " character" : " characters");
  };
  const renderPreview = () => {
    previewWrap.replaceChildren();
    if (!textarea.value.trim()) {
      previewWrap.append(el("span", "composer-preview-empty", "Nothing to preview yet."));
      return;
    }
    formatHnPreview(previewWrap, textarea.value);
  };
  const autosave = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      if (textarea.value.trim()) draftSet(mode === "edit" ? parentId : parentId, textarea.value);
    }, 500);
  };
  const grow = () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(420, textarea.scrollHeight + 2) + "px";
  };
  textarea.addEventListener("input", () => {
    syncChars();
    grow();
    previewDirty = true;
    if (!previewWrap.hidden) renderPreview();
    autosave();
  });
  previewToggle.addEventListener("click", () => {
    const showing = !previewWrap.hidden;
    previewWrap.hidden = showing;
    previewToggle.textContent = showing ? "Preview" : "Write";
    if (!showing) renderPreview();
    textarea.hidden = !showing;
  });
  discard.addEventListener("click", () => {
    draftClear(parentId);
    textarea.value = "";
    syncChars();
    grow();
    if (!previewWrap.hidden) renderPreview();
    showToast("Draft discarded");
  });
  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submitComposer();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer({ keepDraft: true });
      showToast("Draft saved");
    }
  });
  submit.addEventListener("click", submitComposer);

  const composer = { parentId, storyId, mode, handle, node, textarea, status, submit, previewToggle, previewWrap, discard, draftTimer, submitting: false, onDone };
  state.composer = composer;
  if (mode === "reply") {
    status.hidden = false;
    status.textContent = "Checking availability on Hacker News…";
    window.HarmonicHN.openReplyForm(parentId, { storyId }).then((opened) => {
      if (state.composer !== composer) return;
      if (opened.status === "ok") {
        composer.handle = opened.handle;
        submit.disabled = false;
        status.hidden = true;
      } else {
        status.textContent = opened.message || "Reply unavailable. Open Hacker News to continue.";
        status.classList.add("error");
        const escape = el("button", "composer-hn-open", "Open reply on Hacker News");
        escape.type = "button";
        escape.addEventListener("click", () => openOriginalHackerNews(
          "/reply?id=" + parentId + "&goto=" + encodeURIComponent("item?id=" + storyId)));
        status.append(document.createTextNode(" "), escape);
      }
    }).catch(() => {
      if (state.composer !== composer) return;
      status.textContent = "Could not load the reply form. Your draft is kept.";
      status.classList.add("error");
    });
  }
  // Insert: inline under the anchored comment row, else above the comments.
  if (anchor) {
    anchor.insertBefore(node, anchor.querySelector(".comment-children"));
  } else {
    const heading = threadPane.querySelector(".comments-heading");
    if (heading) threadPane.insertBefore(node, heading.nextSibling);
    else threadPane.appendChild(node);
  }
  syncChars();
  grow();
  textarea.focus();
  // Surface a previously saved draft for this parent.
  draftGet(parentId).then((saved) => {
    if (!saved || !state.composer || state.composer.parentId !== parentId) return;
    if (!textarea.value) {
      textarea.value = saved;
      status.hidden = false;
      status.textContent = "Draft restored.";
      status.classList.remove("error");
      syncChars();
      grow();
    }
  });

  function submitComposer() {
    const composer = state.composer;
    if (!composer || composer.submitting || !composer.handle) return;
    const text = textarea.value;
    if (!text.trim()) {
      status.hidden = false;
      status.textContent = "Write something first.";
      status.classList.add("error");
      return;
    }
    composer.submitting = true;
    submit.disabled = true;
    previewToggle.disabled = true;
    status.hidden = false;
    status.classList.remove("error");
    status.textContent = mode === "edit" ? "Saving your edit on Hacker News…" : "Posting your reply…";
    (async () => {
      try {
        let outcome;
        if (mode === "edit") {
          outcome = await window.HarmonicHN.saveEdit(handle, text);
        } else {
          outcome = await window.HarmonicHN.postComment(composer.handle, text);
        }
        handleComposerOutcome(composer, outcome, text);
      } catch {
        composer.submitting = false;
        submit.disabled = false;
        previewToggle.disabled = false;
        status.textContent = "The request to Hacker News failed. Your draft is kept.";
        status.classList.add("error");
      }
    })();
  }
}

function findCommentNode(tree, id) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.id === id) return tree;
  for (const child of tree.children || []) {
    const found = findCommentNode(child, id);
    if (found) return found;
  }
  return null;
}

// A confirmed comment is inserted without re-fetching lagging Algolia data.
function applyLocalComment(composer, outcome, text) {
  if (!state.thread || state.thread.id !== composer.storyId) return;
  if (composer.mode === "edit") {
    const comment = findCommentNode(state.thread, composer.parentId);
    if (comment) comment.text = text;
    const edits = state.confirmedEdits.get(composer.storyId) || new Map();
    edits.set(composer.parentId, text);
    state.confirmedEdits.set(composer.storyId, edits);
    const row = threadPane.querySelector('[data-comment-id="' + composer.parentId + '"]');
    const body = row?.querySelector(":scope > .comment-card .comment-body");
    if (body) {
      body.replaceChildren();
      // Text was entered by the user, not already-sanitized HTML.
      body.textContent = text;
    }
    return;
  }
  const posted = outcome.newComment;
  if (!posted || !Number.isSafeInteger(posted.id)) return;
  const entry = {
    id: posted.id,
    author: window.HarmonicHN.session()?.username || null,
    created_at_i: Math.floor(Date.now() / 1000),
    text: posted.html,
    children: [],
  };
  const parent = composer.parentId === composer.storyId
    ? state.thread
    : findCommentNode(state.thread, composer.parentId);
  if (!parent) return;
  if (!findCommentNode(state.thread, posted.id)) parent.children = [entry, ...(parent.children || [])];
  const local = state.confirmedComments.get(composer.storyId) || new Map();
  local.set(posted.id, { parentId: composer.parentId, entry });
  state.confirmedComments.set(composer.storyId, local);
  const parentRow = composer.parentId === composer.storyId ? null
    : threadPane.querySelector('[data-comment-id="' + composer.parentId + '"]');
  let container = composer.parentId === composer.storyId
    ? threadPane.querySelector(".comments")
    : parentRow?.querySelector(":scope > .comment-children");
  if (!container && parentRow) {
    container = el("div", "comment-children");
    parentRow.appendChild(container);
  }
  if (!container || container.querySelector('[data-comment-id="' + posted.id + '"]')) return;
  container.querySelector(":scope > .empty-comments")?.remove();
  const depth = composer.parentId === composer.storyId ? 0
    : Number(container.closest(".comment-row")?.dataset.depth || 0) + 1;
  const row = renderComment(entry, depth);
  row.classList.add("just-posted");
  row.querySelector(".comment-meta")?.append(el("span", "posted-marker", "Posted"));
  container.prepend(row);
  row.scrollIntoView({ block: "center", behavior: "smooth" });
}

function mergeConfirmedComments(item) {
  const local = state.confirmedComments.get(item.id);
  if (local) for (const { parentId, entry } of local.values()) {
    if (findCommentNode(item, entry.id)) continue;
    const parent = parentId === item.id ? item : findCommentNode(item, parentId);
    if (parent) parent.children = [entry, ...(parent.children || [])];
  }
  for (const [id, text] of state.confirmedEdits.get(item.id) || []) {
    const comment = findCommentNode(item, id);
    if (comment) comment.text = text;
  }
  for (const id of state.confirmedDeletes.get(item.id) || []) {
    const comment = findCommentNode(item, id);
    if (comment) { comment.text = null; comment.author = null; comment.deleted = true; }
  }
}

function handleComposerOutcome(composer, outcome, text) {
  const { status, submit, previewToggle } = composer;
  composer.submitting = false;
  submit.disabled = false;
  previewToggle.disabled = false;
  if (outcome?.status === "success") {
    draftClear(composer.parentId);
    applyLocalComment(composer, outcome, text);
    closeComposer({ keepDraft: false });
    showToast(composer.mode === "edit" ? "Edit saved" : "Reply posted");
    return;
  }
  status.hidden = false;
  const message = outcome?.message || "Hacker News did not confirm the post. Your draft is kept.";
  status.textContent = message;
  status.classList.add("error");
  // Draft is kept in all non-success outcomes (module outcomes say "draft kept").
  draftSet(composer.parentId, text);
  if (outcome?.status !== "loginRequired" && outcome?.status !== "accountChanged") {
    const open = el("button", "composer-hn-open", "Check on Hacker News");
    open.type = "button";
    open.addEventListener("click", () => openOriginalHackerNews("/item?id=" + composer.storyId));
    status.appendChild(document.createElement("br"));
    status.appendChild(open);
  }
  if (outcome?.status === "loginRequired" || outcome?.status === "accountChanged") updateAccountChip();
}

function closeComposer({ keepDraft = true } = {}) {
  const composer = state.composer;
  if (!composer) return;
  clearTimeout(composer.draftTimer);
  if (keepDraft && composer.mode === "reply" && composer.textarea.value.trim()) {
    draftSet(composer.parentId, composer.textarea.value);
  }
  composer.node?.remove();
  state.composer = null;
}

function openFeedMenu(anchor) {
    const entries = visibleFeeds().map((key) => ({
      label: FEEDS[key].label + (state.feed === key ? "  ✓" : ""),
      action: () => switchFeed(key),
    }));
    entries.push({ label: "Manage feeds", icon: "settings", action: openManageFeeds });
    openPopup(anchor, entries);
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
    const session = window.HarmonicHN?.session?.();
    const karma = session?.karma == null ? "" : " · " + compact(session.karma) + " karma";
    openPopup(anchor, [
      { label: session ? session.username + karma : "Log in", icon: "user", action: () => openAccountMenu(anchor) },
      { label: "New post", icon: "plus", action: () => startNewPost() },
      { label: "Add bookmarks to HN favorites", icon: "heart", action: () => addBookmarksToFavorites() },
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
    // Header, search and results are in layout flow; no calculated gap.
  }

  function closeSearch() {
    abortSearch();
    searchInput.value = "";
    if (state.search.active) {
      state.search.active = false;
      restoreFeedList();
    }
    filterStories();
    searchWrap.classList.remove("open");
    state.search.mode = "loaded";
    searchPanel.querySelectorAll(".hn-search-mode").forEach((tab) =>
      tab.classList.toggle("active", tab.dataset.mode === "loaded"));
    searchFilters.hidden = true;
    searchSubmit.hidden = true;
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
      searchInput.focus();
    }
    syncSearchPanelSpace();
  }

  function onSearchInput() {
    if (state.search.active) {
      abortSearch();
      state.search.active = false;
      restoreFeedList();
    }
    filterStories();
    renderRecentSearches();
  }

  function onSearchKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && state.search.active) {
      const cards = [...storyList.querySelectorAll(".hn-search-results > .story-card, .hn-search-results > .comment-hit")];
      if (cards.length) {
        event.preventDefault();
        state.search.keyboardIndex = event.key === "ArrowDown"
          ? (state.search.keyboardIndex + 1) % cards.length
          : (state.search.keyboardIndex + cards.length) % cards.length;
        cards.forEach((node, index) => node.classList.toggle("search-keyboard-selected", index === state.search.keyboardIndex));
        cards[state.search.keyboardIndex].scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const current = state.search.active && state.search.keyboardIndex >= 0
        ? state.search.hits[state.search.keyboardIndex] : null;
      if (current) {
        if (current.kind === "comment") openThreadAtComment(current.storyId ?? current.story_id, current.id);
        else selectStory(current.id);
        closeSearch();
      } else {
        setSearchMode("global");
        runGlobalSearch(0);
      }
    }
  }

  function parseListSetting(value) {
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  function filterStories() {
    if (state.search.active) return;
    const q = searchInput.value.trim().toLowerCase();
    const domains = parseListSetting(state.settings.hiddenDomains);
    const keywords = parseListSetting(state.settings.hiddenKeywords);
    const hideJobs = state.settings.hideJobs;
    const hideRead = state.settings.hideRead;
    document.querySelectorAll(".story-card").forEach((card) => {
      const hay = (card.dataset.search || "").toLowerCase();
      let hidden = Boolean(q) && !hay.includes(q);
      if (!hidden && domains.length) hidden = domains.some((entry) => (card.dataset.domain || "").endsWith(entry));
      if (!hidden && keywords.length) hidden = keywords.some((entry) => hay.includes(entry));
      if (!hidden && hideJobs && card.dataset.type === "job") hidden = true;
      if (!hidden && hideRead && card.classList.contains("is-read")) hidden = true;
      card.hidden = hidden;
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
      query: state.search.query || searchInput.value,
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
    if (state.search.query) state.search.debounceTimer = setTimeout(() => runGlobalSearch(page, true), 300);
  }

  async function runGlobalSearch(page, reuseQuery = false) {
    clearTimeout(state.search.debounceTimer);
    state.search.debounceTimer = 0;
    const query = reuseQuery ? state.search.query : searchInput.value.trim();
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
    if (!state.search.active) state.search.feedScrollTop = storyList.scrollTop;
    state.search.query = query;
    const { options, authorValid } = buildSearchOptions(page);
    state.search.active = true;
    searchSubmit.hidden = true;
    pushRecentSearch(query);

    if (page === 0) {
      state.search.keyboardIndex = -1;
      storyList.classList.add("search-results");
      const existing = storyList.querySelector(".hn-search-results");
      if (existing) existing.classList.add("search-refining");
      else storyList.replaceChildren(createLoading("Searching Hacker News…"));
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
    // Continue automatically when the last result enters the feed viewport.
    // The button remains available for keyboard access and browsers without
    // IntersectionObserver, while the existing request guard prevents overlap.
    const more = container.querySelector(".hn-search-more");
    if (more && typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (state.search.active && !state.search.controller && more.isConnected)
          more.click();
      }, { root: storyList, rootMargin: "280px" });
      observer.observe(more);
    }
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
        let ancestor = row.parentElement?.closest(".comment-row");
        while (ancestor) {
          ancestor.classList.remove("collapsed");
          ancestor = ancestor.parentElement?.closest(".comment-row");
        }
        row.classList.add("comment-flash");
        row.scrollIntoView({ block: "center" });
        setTimeout(() => row.classList.remove("comment-flash"), 2400);
        return;
      }
      if (Date.now() < deadline && state.selectedId === storyId) requestAnimationFrame(step);
      else if (state.selectedId === storyId) showToast("That comment is no longer in the thread");
    };
    requestAnimationFrame(step);
  }

  function restoreFeedList() {
    storyList.classList.remove("search-results");
    storyList.replaceChildren();
    state.stories.forEach((story, index) => storyList.appendChild(createStoryCard(story, index)));
    filterStories();
    if (Number.isFinite(state.search.feedScrollTop)) storyList.scrollTop = state.search.feedScrollTop;
  }

  function pushRecentSearch(query) {
    const recent = state.search.recent.filter((term) => term !== query);
    recent.unshift(query);
    state.search.recent = recent.slice(0, 8);
  }

  function renderRecentSearches() {
    if (!searchRecent) return;
    const query = searchInput.value.trim();
    searchSubmit.hidden = !searchWrap.classList.contains("open") || query.length < 2 || state.search.active;
    searchSubmit.textContent = 'Search Hacker News for “' + query.slice(0, 200) + '” ↵';
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
    const points = el("span", "meta-points", compact(story.score) + (state.settings.compactPoints ? "" : " points"));
    if (state.settings.hotnessColors) points.classList.add("hotness-" + hotnessClass(story));
    const domain = el("span", "meta-domain", domainOf(story.url));
    const age = el("span", "meta-age", relativeTime(story.time));
    meta.append(fav, points, el("span", "meta-dot", "•"));
    if (state.settings.showDomain !== false) meta.append(domain, el("span", "meta-dot", "•"));
    meta.append(age);
    return meta;
  }

  // Phase 7: score-per-hour "hotness" — hot / warm / cool classes for CSS.
  function hotnessClass(story) {
    const score = Number(story.score) || 0;
    const hours = Math.max(1, (Date.now() / 1000 - (Number(story.time) || 0)) / 3600);
    const perHour = score / hours;
    if (perHour >= 15) return "hot";
    if (perHour >= 3) return "warm";
    return "cool";
  }

  async function hideDomain(story) {
    const domain = domainOf(story.url);
    if (!domain) return;
    const current = parseListSetting(state.settings.hiddenDomains);
    if (!current.includes(domain.toLowerCase())) {
      state.settings.hiddenDomains = [...current, domain.toLowerCase()].join(", ");
      await saveSettings();
    }
    filterStories();
    showToast("Hiding " + domain);
  }

  function isJobStory(story) {
    if (story.type === "job") return true;
    // Some HN lists expose hiring submissions as regular stories.
    // Match explicit hiring announcements, not general articles about employment.
    return /\b(?:is hiring|we(?:'|’)?re hiring|we are hiring|hiring for)\b/i.test(story.title || "")
      && (/\bYC\s*[A-Z]\d{2}\b/i.test(story.title || "")
        || /\b(?:jobs?\.|jobs?\/|careers?\.|careers?\/|ashbyhq\.|greenhouse\.|lever\.)/i.test(story.url || ""));
  }

  function createStoryCard(story, index) {
    const card = el("article", "story-card");
    card.dataset.storyId = String(story.id);
    card.dataset.search = (story.title || "") + " " + domainOf(story.url);
    card.dataset.domain = domainOf(story.url);
    card.dataset.type = isJobStory(story) ? "job" : (story.type || "story");
    card.style.setProperty("--fallback-tint", hashTint(domainOf(story.url)));
    if (state.readIds.has(story.id)) card.classList.add("is-read");
    if (state.selectedId === story.id) card.classList.add("selected");

    const main = el("div", "story-card-main");
    const title = el("a", "story-card-title", story.title || "(untitled)");
    setStoryLink(title, story);
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
    const meta = storyMeta(story);
    // Actions are available on right-click / long-press, not another
    // permanent button under the story metadata.
    const showStoryActions = (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      openPopup(card, [
        { label: "Open discussion", icon: "comment", action: () => selectStory(story) },
        ...(story.url ? [{ label: "Open article", icon: "external", action: () => window.open(nitterize(articleHref(story)), "_blank", "noopener") }] : []),
        ...(archiveHref(story) ? [{ label: "View on archive", icon: "clock", action: () => openArchive(story) }] : []),
        { label: state.feedVotes.has(story.id) ? "Unvote" : "Upvote", icon: "up", action: (e) => voteFromFeed(e, story.id) },
        ...(window.HarmonicHN?.session?.() ? [{ label: "Hide story", icon: "eyeOff", action: (e) => hideFromFeed(e, story.id) }] : []),
        ...(story.url ? [{ label: "Hide this domain", icon: "eyeOff", action: () => hideDomain(story) }] : []),
        { label: state.bookmarks.has(story.id) ? "Remove bookmark" : "Bookmark", icon: "star", action: () => toggleBookmark(story.id) },
        { label: "Open on Hacker News", icon: "external", action: () => window.open("https://news.ycombinator.com/item?id=" + story.id, "_blank", "noopener") },
      ], event.type === "contextmenu" || event.type === "pointerdown" ? { x: event.clientX, y: event.clientY } : null);
    };
    card.addEventListener("contextmenu", showStoryActions);
    let cardHoldTimer;
    card.addEventListener("pointerdown", (event) => {
      if (!event.isTrusted || event.button !== 0 || event.target.closest("button, a")) return;
      cardHoldTimer = setTimeout(() => showStoryActions(event), 600);
    });
    for (const name of ["pointerup", "pointercancel", "pointerleave"])
      card.addEventListener(name, () => clearTimeout(cardHoldTimer));
    main.append(titleLine, meta);

    const preview = el("a", "story-preview");
    preview.href = articleHref(story);
    preview.target = story.url ? "_blank" : "_self";
    preview.rel = "noopener noreferrer";
    preview.title = story.url ? "Open article" : "Open comments";
    const previewImg = el("img", "story-preview-image");
    previewImg.alt = "";
    previewImg.addEventListener("error", () => {
      previewImg.removeAttribute("src");
      previewImg.remove();
      card.classList.remove("has-preview");
      card.classList.add("no-preview");
      const previous = state.previewById.get(story.id) || {};
      state.previewById.set(story.id, { ...previous, image: null, failedUntil: Date.now() + 86400000 });
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
      requestCardPreview(card, story, (meta) => {
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

    card.append(main, preview, commentButton);
    // Phase 2: feed-level vote affordances — "already voted" badge from the
    // harvested document plus an overflow menu with a functional Upvote.
    applyCardVotedState(card, story.id);
    return card;
  }

  function applyCardVotedState(card, id) {
    const voted = state.feedVotes.has(id);
    card.classList.toggle("voted", voted);
    card.dataset.votedDirection = voted ? (state.feedVotes.get(id) === "down" ? "down" : "up") : "";
    if (!card.querySelector(".story-voted-badge")) {
      const badge = el("span", "story-voted-badge", "▲");
      badge.title = "You upvoted this";
      card.appendChild(badge);
    }
  }

  // Upvote/unvote straight from a feed card, using the token harvested from
  // the feed document (or an on-demand item fetch when the story isn't on it).
  async function voteFromFeed(event, storyId) {
    if (!requireTrustedEvent(event)) return;
    const session = window.HarmonicHN?.session?.();
    if (!session) {
      showToast("Sign in to vote");
      return;
    }
    if (!Number.isInteger(storyId) || storyId <= 0) return;
    const direction = state.feedVotes.get(storyId) ? "un" : "up";
    const outcome = await window.HarmonicHN.vote(storyId, direction);
    if (outcome.status === "success") {
      if (direction === "up") state.feedVotes.set(storyId, outcome.state?.votedDirection === "down" ? "down" : "up");
      else state.feedVotes.delete(storyId);
      updateFeedVoteBadges();
      showToast(direction === "up" ? "Upvoted" : "Vote removed");
    } else {
      showToast(outcome.message || "The vote did not go through");
      if (outcome.status === "loginRequired") updateAccountChip();
    }
  }

  function createLoading(label) {
    const wrap = el("div", "harmonic-loading");
    wrap.append(el("div", "harmonic-spinner"), el("span", "", label));
    return wrap;
  }

  async function loadMoreStories() {
    if (state.listView || state.search.active || state.loadingMore || !state.hasMoreStories || !state.feedIds.length) return;
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

  // ---------------------------------------------------------------------------
// Phase 7 (0.12.0): feed parity helpers
// ---------------------------------------------------------------------------

function frontDayOffset(days) {
  const date = new Date(Date.now() - days * 86400000);
  return date.toISOString().slice(0, 10);
}

function validFrontDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

// Parity-list feeds have no Firebase id list; pull ids from public HN list
// pages through the queue. Two pages are enough for a comfortable feed.
async function fetchListFeedIds(listPath) {
  const first = await window.HarmonicHN.fetchListPage(listPath);
  if (first.status !== "ok") {
    const error = new Error(first.message || "Hacker News did not return the list");
    error.status = first.status;
    throw error;
  }
  const ids = [...first.ids];
  if (window.HarmonicHN.session() && first.votes) {
    for (const [id, direction] of Object.entries(first.votes)) state.feedVotes.set(Number(id), direction);
  }
  if (first.morePath && first.ids.length < FEED_BATCH_SIZE) {
    const second = await window.HarmonicHN.fetchListPage(first.morePath);
    if (second.status === "ok") for (const id of second.ids) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function visibleFeeds() {
  const order = (Array.isArray(state.settings.feedOrder) ? state.settings.feedOrder : [])
    .filter((key) => FEEDS[key]);
  const hidden = new Set((Array.isArray(state.settings.feedHidden) ? state.settings.feedHidden : []).filter((key) => FEEDS[key]));
  const ordered = [...order, ...FEED_ORDER_DEFAULT.filter((key) => !order.includes(key))];
  return ordered.filter((key) => !hidden.has(key));
}

function syncFrontDateInput() {
  if (!frontDateInput) return;
  const show = FEEDS[state.feed]?.dayBased;
  frontDateInput.hidden = !show;
  if (show) frontDateInput.value = validFrontDate(state.settings.frontDate) || frontDayOffset(1);
}

function openManageFeeds() {
  document.querySelector(".feeds-overlay")?.remove();
  const overlay = el("div", "feeds-overlay");
  const panel = el("section", "feeds-panel");
  const header = el("header", "feeds-header");
  header.append(el("h2", "", "Manage frontpages"), el("p", "feeds-note", "Reorder the feed menu and hide the lists you never read. Settings stay local to this profile."));
  const close = button("close", "Close");
  close.type = "button";
  close.addEventListener("click", () => overlay.remove());
  header.appendChild(close);
  panel.appendChild(header);

  const save = async (order, hidden) => {
    state.settings.feedOrder = order;
    state.settings.feedHidden = hidden;
    await saveSettings();
  };

  const renderRows = () => {
    panel.querySelectorAll(".feeds-row").forEach((node) => node.remove());
    const hidden = new Set(state.settings.feedHidden || []);
    const order = (state.settings.feedOrder || []).filter((key) => FEEDS[key]);
    const all = [...order, ...FEED_ORDER_DEFAULT.filter((key) => !order.includes(key))];
    all.forEach((key, index) => {
      const row = el("div", "feeds-row" + (hidden.has(key) ? " feeds-row-hidden" : ""));
      const check = el("input", "feeds-check");
      check.type = "checkbox";
      check.checked = !hidden.has(key);
      check.addEventListener("change", () => {
        const nextHidden = new Set(state.settings.feedHidden || []);
        if (check.checked) nextHidden.delete(key); else nextHidden.add(key);
        save(state.settings.feedOrder || [], [...nextHidden]).then(renderRows);
      });
      const label = el("span", "feeds-label", FEEDS[key].label);
      const up = el("button", "feeds-move", "↑");
      up.type = "button";
      up.setAttribute("aria-label", "Move " + FEEDS[key].label + " up");
      up.disabled = index === 0;
      up.addEventListener("click", () => {
        const list = [...all];
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        save(list, state.settings.feedHidden || []).then(renderRows);
      });
      const down = el("button", "feeds-move", "↓");
      down.type = "button";
      down.setAttribute("aria-label", "Move " + FEEDS[key].label + " down");
      down.disabled = index === all.length - 1;
      down.addEventListener("click", () => {
        const list = [...all];
        [list[index + 1], list[index]] = [list[index], list[index + 1]];
        save(list, state.settings.feedHidden || []).then(renderRows);
      });
      row.append(check, label, up, down);
      panel.appendChild(row);
    });
  };
  renderRows();
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
}

async function refreshFeed() {
    abortSearch();
    state.search.active = false;
    // A manual refresh closes an open account list view and rebuilds the feed.
    state.listView = null;
    const generation = ++state.feedGeneration;
    state.loadingMore = false;
    state.feedIds = [];
    state.feedCursor = 0;
    state.hasMoreStories = true;
    storyList.replaceChildren(createLoading("Loading stories…"));
    const key = state.feed;
    const feed = FEEDS[key];
    syncFrontDateInput();
    try {
      // Phase 7: parity lists have no Firebase endpoint — their ids come from
      // public HN list pages fetched through the rate-limited queue (SEC-05
      // allowlist applies). Past frontpages add the day parameter.
      const listPath = feed.dayBased
        ? "/front?day=" + encodeURIComponent(validFrontDate(state.settings.frontDate) || frontDayOffset(1))
        : feed.listPath;
      const ids = feed.endpoint
        ? await fetchJson(HN_API + "/" + feed.endpoint + ".json")
        : await fetchListFeedIds(listPath);
      // /news is the canonical HN list for the Top feed.
      if (feed.endpoint === "topstories" && window.HarmonicHN?.session?.()) {
        const hnList = await window.HarmonicHN.fetchListPage("/news");
        if (hnList.status === "ok") {
          const shown = new Set(ids.slice(0, FEED_BATCH_SIZE));
          for (const [id, direction] of Object.entries(hnList.votes || {})) {
            if (shown.has(Number(id))) state.feedVotes.set(Number(id), direction);
          }
        }
      }
      if (generation !== state.feedGeneration) return;
      state.feedIds = ids.filter((id) => Number.isInteger(id) && id > 0);
      const batchIds = state.feedIds.slice(0, FEED_BATCH_SIZE);
      state.feedCursor = batchIds.length;
      const stories = await fetchItems(batchIds);
      if (generation !== state.feedGeneration) return;
      state.stories = stories;
      // Parity lists have no reliable "more" cursor; everything fetched is shown.
      state.hasMoreStories = feed.endpoint ? state.feedCursor < state.feedIds.length : false;
      state.updatedAt = new Date();
      updatedLabel.textContent = "Last updated: " + formatTime(state.updatedAt);
      storyList.replaceChildren();
      if (feed.kind === "comments") {
        // Best-comments style feeds: comment rows with story context (Algolia).
        const rows = await Promise.all(batchIds.map((id) => renderThreadListItem(id)));
        if (generation !== state.feedGeneration) return;
        rows.forEach((row, index) => row && storyList.appendChild(row));
      } else {
        stories.forEach((story, index) => storyList.appendChild(createStoryCard(story, index)));
        filterStories();
      }
      if (state.selectedId) {
        const match = stories.find((story) => story.id === state.selectedId);
        if (match) state.selectedStory = match;
      } else if (stories[0] && window.innerWidth >= 900 && feed.kind !== "comments") {
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
    if (comment.author) row.dataset.author = comment.author;
    row.style.setProperty("--depth", String(depth));
    row.style.setProperty("--rail", railColor(depth, comment.author || ""));

    // Phase 7 part 2: OP highlight, new-comment marker, [delayed] hiding.
    if (comment.author && comment.author === state.threadAuthor) row.classList.add("by-op");
    if (state.settings.hideDelayed && comment.text && /\[delayed\]/i.test(comment.text)) row.classList.add("is-delayed");
    const storyId = Number.isInteger(state.selectedId) ? state.selectedId : null;
    if (state.settings.markNewComments && storyId && state.seenTimes.has(storyId) && Number(comment.created_at_i || 0) > state.seenTimes.get(storyId)) {
      row.classList.add("is-new");
    }
    const isBlockedAuthor = comment.author && state.blockedUsers.has(comment.author);
    if (isBlockedAuthor) row.classList.add("is-blocked");

    const card = el("article", "comment-card");
    card.tabIndex = 0;
    const meta = el("div", "comment-meta");
    // Generated avatars: deterministic, purely local color + initial.
    if (state.settings.showAvatars && comment.author) {
      const avatar = el("span", "comment-avatar", comment.author.charAt(0).toUpperCase());
      avatar.style.background = hashTint(comment.author);
      meta.appendChild(avatar);
    }
    const author = el("a", "comment-author", comment.author || "[deleted]");
    if (comment.author) {
      author.href = "https://news.ycombinator.com/user?id=" + encodeURIComponent(comment.author);
      author.target = "_blank";
      author.rel = "noopener";
    }
    if (comment.author && comment.author === state.threadAuthor) {
      author.appendChild(el("span", "op-badge", "(OP)"));
    }
    meta.appendChild(author);
    const tag = comment.author ? state.userTags.get(comment.author) : null;
    if (tag) {
      const tagChip = el("button", "comment-tag", tag);
      tagChip.type = "button";
      tagChip.title = "Edit tag for " + comment.author;
      tagChip.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        openTagDialog(comment.author);
      });
      meta.appendChild(tagChip);
    }
    // Newness is a thin rail, not a badge on every comment.
    const age = el("a", "comment-age", relativeTime(comment.created_at_i || 0));
    age.href = "https://news.ycombinator.com/item?id=" + comment.id;
    age.target = "_blank";
    age.rel = "noopener";
    const voteMark = el("span", "comment-vote-mark", "↑");
    voteMark.dataset.commentVoteMark = "1";
    voteMark.hidden = !state.itemState?.comments?.[comment.id]?.voted;
    if (state.itemState?.comments?.[comment.id]?.votedDirection === "down") voteMark.textContent = "↓";
    meta.append(voteMark, age);

    const body = el("div", "comment-body");
    if (comment.text) appendSanitizedHtml(body, comment.text);
    else body.textContent = "[deleted]";

    const collapsed = el("div", "collapsed-comment");
    collapsed.append(
      el("span", "collapsed-author", comment.author || "[deleted]"),
      el("span", "collapsed-preview", body.textContent.trim().slice(0, 90)),
      el("span", "collapsed-count", descendantCount(comment) ? descendantCount(comment) + " replies" : "")
    );

    // Phase 2: per-comment action row — vote, downvote (when HN offers it),
    // reply hand-off, and a "More" menu (share/copy/parent/top-level/user).
    const session = window.HarmonicHN?.session?.() || null;
    const actionsRow = el("div", "comment-actions");
    const voteButton = el("button", "comment-action");
    voteButton.type = "button";
    voteButton.title = "Upvote";
    voteButton.setAttribute("aria-label", "Upvote");
    voteButton.setAttribute("data-comment-vote", "1");
    voteButton.append(svg("up"));
    voteButton.addEventListener("click", (event) => handleCommentVote(event, comment.id));
    const downButton = el("button", "comment-action");
    downButton.type = "button";
    downButton.setAttribute("data-comment-vote-down", "1");
    downButton.hidden = true; // shown once item state says HN allows it
    downButton.append(svg("down"));
    downButton.addEventListener("click", (event) => handleCommentVote(event, comment.id));
    // Apply any already-known item state (e.g. after a re-render) so buttons
    // don't briefly flash as unvoted.
    const known = state.itemState?.comments?.[comment.id] || null;
    if (known) {
      voteButton.classList.toggle("active", Boolean(known.voted && known.votedDirection !== "down"));
      voteButton.title = known.voted ? "Unvote" : "Upvote";
      voteButton.setAttribute("aria-label", voteButton.title);
      downButton.hidden = !known.canDown;
      downButton.classList.toggle("active", Boolean(known.voted && known.votedDirection === "down"));
    }
    const replyButton = el("button", "comment-action");
    replyButton.type = "button";
    replyButton.title = session ? "Reply" : "Sign in to reply";
    replyButton.setAttribute("aria-label", replyButton.title);
    replyButton.append(svg("comment"));
    const beginReply = (event) => {
      if (!event.isTrusted) return;
      if (!session) {
        showToast("Sign in to reply");
        return;
      }
      openComposer({ parentId: comment.id, storyId: state.selectedId || comment.id, anchor: row });
    };
    replyButton.addEventListener("click", beginReply);
    const isOwn = session && comment.author && comment.author === session.username;
    const canEditOwn = Boolean(isOwn && comment.created_at_i && Date.now() / 1000 - comment.created_at_i < 2 * 3600);
    const editButton = el("button", "comment-action");
    editButton.type = "button";
    editButton.title = "Edit";
    editButton.setAttribute("aria-label", "Edit comment");
    editButton.append(svg("edit"));
    editButton.hidden = !canEditOwn;
    const beginEdit = async (event) => {
      if (!event.isTrusted || !canEditOwn) return;
      editButton.disabled = true;
      try {
        const opened = await window.HarmonicHN.openEditForm(comment.id, { storyId: state.selectedId || comment.id });
        if (opened.status !== "ok") {
          showToast(opened.message || "Hacker News did not offer an edit form for this comment.");
          return;
        }
        openComposer({ parentId: comment.id, storyId: state.selectedId || comment.id, mode: "edit", handle: opened.handle, initialText: opened.currentText || "", anchor: row });
      } finally {
        editButton.disabled = false;
      }
    };
    editButton.addEventListener("click", beginEdit);
    const deleteButton = el("button", "comment-action");
    deleteButton.type = "button";
    deleteButton.title = "Delete";
    deleteButton.setAttribute("aria-label", "Delete comment");
    deleteButton.append(svg("trash"));
    deleteButton.hidden = !canEditOwn;
    const beginDelete = (event) => {
      if (!event.isTrusted || !canEditOwn) return;
      // SEC-36: deletes run only behind an explicit confirmation.
      openConfirmDialog({
        title: "Delete this comment?",
        message: "This permanently deletes your comment on Hacker News. It cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          deleteButton.disabled = true;
          try {
            const opened = await window.HarmonicHN.openDeleteForm(comment.id, { storyId: state.selectedId || comment.id });
            if (opened.status !== "ok") {
              showToast(opened.message || "Hacker News did not offer a delete form for this comment.");
              return;
            }
            const outcome = await window.HarmonicHN.deleteComment(opened.handle);
            if (outcome.status === "success") {
              const storyId = state.selectedId;
              const deleted = state.confirmedDeletes.get(storyId) || new Set();
              deleted.add(comment.id);
              state.confirmedDeletes.set(storyId, deleted);
              const model = findCommentNode(state.thread, comment.id);
              if (model) {
                model.text = null;
                model.author = null;
                model.deleted = true;
              }
              const existing = threadPane.querySelector('[data-comment-id="' + comment.id + '"]');
              if (existing && model) existing.replaceWith(renderComment(model, depth));
              showToast("Comment deleted");
            } else {
              showToast(outcome.message || "The delete did not go through");
            }
          } finally {
            deleteButton.disabled = false;
          }
        },
      });
    };
    deleteButton.addEventListener("click", beginDelete);
    const moreButton = el("button", "comment-action");
    moreButton.type = "button";
    moreButton.title = "More";
    moreButton.setAttribute("aria-label", "More comment actions");
    moreButton.append(svg("more"));
    const showCommentActions = (event) => {
      if (!event.isTrusted) return;
      const parentRow = row.parentElement?.closest?.(".comment-row");
      const parentId = parentRow?.dataset?.commentId;
      const hnLink = "https://news.ycombinator.com/item?id=" + comment.id;
      const offeredByHn = state.itemState?.status === "ok"
        && state.itemState?.comments?.[comment.id]?.replyAvailable === true;
      const canReply = Boolean(session && offeredByHn && comment.author && comment.text
        && !comment.dead && !comment.deleted
        && Date.now() / 1000 - (comment.created_at_i || 0) < 14 * 86400);
      const voteState = state.itemState?.comments?.[comment.id] || null;
      openPopup(moreButton, [
        { heading: (comment.author || "[deleted]") +
          (comment.author === state.threadAuthor ? " (OP)" : "") },
        { heading: (body.textContent || "").trim().slice(0, 250) },
        ...(session ? [
          { label: voteState?.voted ? "Unvote" : "Vote up", icon: "up",
            action: (clicked) => handleCommentVote(clicked, comment.id, false) },
          ...(voteState?.canDown || voteState?.votedDirection === "down"
            ? [{ label: voteState?.votedDirection === "down" ? "Undown" : "Vote down",
              icon: "down", action: (clicked) => handleCommentVote(clicked, comment.id, true) }] : []),
        ] : []),
        { label: state.bookmarks.has(comment.id) ? "Remove bookmark" : "Bookmark",
          icon: "star", action: () => toggleBookmark(comment.id) },
        ...(session ? [{ label: "Favorite", icon: "heart",
          action: async () => {
            const result = await window.HarmonicHN.setFavorite(comment.id, true);
            showToast(result.status === "success" ? "Favorited" : result.message || "Favorite unavailable");
          } }] : []),
        ...(canEditOwn ? [
          { label: "Edit", icon: "edit", action: beginEdit },
          { label: "Delete", icon: "trash", action: beginDelete },
        ] : []),
        ...(canReply ? [{ label: "Reply", icon: "comment", action: beginReply }] : []),
        {
          label: "Share link",
          icon: "share",
          action: async () => {
            try {
              await navigator.clipboard.writeText(hnLink);
              showToast("Link copied");
            } catch {
              window.open(hnLink, "_blank", "noopener");
            }
          },
        },
        {
          label: "Copy text",
          icon: "comment",
          action: async () => {
            const text = body.textContent || "";
            try {
              await navigator.clipboard.writeText(text);
              showToast("Comment text copied");
            } catch {}
          },
        },
        ...(parentId && Number(parentId) > 0
          ? [{ label: "Open parent", icon: "link", action: () => window.open("https://news.ycombinator.com/item?id=" + parentId, "_blank", "noopener") }]
          : []),
        {
          label: "Open top level",
          icon: "link",
          action: () => window.open("https://news.ycombinator.com/item?id=" + (state.selectedId || comment.id), "_blank", "noopener"),
        },
        ...(comment.author
          ? [{ label: "View user", icon: "user", action: () => openUserPanel(comment.author) }]
          : []),
        ...(comment.author
          ? [
              { label: state.userTags.has(comment.author) ? "Edit user tag" : "Set user tag", icon: "star", action: () => openTagDialog(comment.author) },
              {
                label: state.blockedUsers.has(comment.author) ? "Unblock user" : "Block user",
                icon: "eyeOff",
                action: async () => {
                  if (state.blockedUsers.has(comment.author)) {
                    state.blockedUsers.delete(comment.author);
                    showToast("Unblocked " + comment.author);
                  } else {
                    state.blockedUsers.add(comment.author);
                    showToast("Blocked " + comment.author + " — their comments stay hidden here");
                  }
                  persistBlockedUsers();
                  if (state.thread) await renderThread(state.thread);
                },
              },
            ]
          : []),
        // Phase 4: flag a comment only when HN offers the link (SEC-36 dialog).
        ...(state.itemState?.comments?.[comment.id]?.flagAvailable
          ? [{ label: "Flag comment", icon: "flag", action: (popupEvent) => confirmFlagItem(popupEvent, comment.id, "comment") }]
          : []),
      ], event.type === "contextmenu" || event.type === "pointerdown" ? { x: event.clientX, y: event.clientY } : null);
    };
    moreButton.addEventListener("click", showCommentActions);
    meta.appendChild(moreButton);
    card.append(meta, body, collapsed);
    row.appendChild(card);

    const children = el("div", "comment-children");
    for (const child of sortedComments(comment.children || [])) children.appendChild(renderComment(child, depth + 1));
    if (children.childElementCount) row.appendChild(children);

    // Blocked authors keep their place in the thread but collapse into a note.
    if (isBlockedAuthor) {
      const note = el("div", "blocked-note");
      note.append(el("span", "", "Hidden comment from a blocked user (" + comment.author + ")"));
      const unblock = el("button", "blocked-unblock", "Unblock");
      unblock.type = "button";
      unblock.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        state.blockedUsers.delete(comment.author);
        persistBlockedUsers();
        row.classList.remove("is-blocked");
        note.remove();
      });
      note.appendChild(unblock);
      row.insertBefore(note, card);
    }

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button") || window.getSelection()?.toString()) return;
      if (state.settings.swapCommentActions) showCommentActions(event);
      else row.classList.toggle("collapsed");
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showCommentActions(event);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "a" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        showCommentActions(event);
      }
    });
    let held = 0;
    card.addEventListener("pointerdown", (event) => {
      if (!event.isTrusted || event.button !== 0 || event.target.closest("a, button")) return;
      held = setTimeout(() => {
        if (state.settings.swapCommentActions) row.classList.toggle("collapsed");
        else showCommentActions(event);
      }, 550);
    });
    for (const name of ["pointerup", "pointercancel", "pointerleave"]) {
      card.addEventListener(name, () => clearTimeout(held));
    }
    return row;
  }

  // Phase 7 part 2: per-author tags — a small local dialog, no prompts.
  function openTagDialog(author) {
    document.querySelector(".tag-overlay")?.remove();
    const overlay = el("div", "tag-overlay");
    const panel = el("section", "tag-panel");
    panel.append(el("h3", "", "Tag for " + author));
    const input = el("input", "tag-input");
    input.type = "text";
    input.maxLength = 40;
    input.value = state.userTags.get(author) || "";
    input.placeholder = "e.g. HN legend, careful reviewer";
    const row = el("div", "tag-actions");
    const save = el("button", "tag-save", "Save");
    save.type = "button";
    save.addEventListener("click", () => {
      const value = input.value.trim().slice(0, 40);
      if (value) state.userTags.set(author, value);
      else state.userTags.delete(author);
      persistUserTags();
      overlay.remove();
      if (state.thread) renderThread(state.thread);
    });
    const remove = el("button", "tag-remove", "Remove tag");
    remove.type = "button";
    remove.hidden = !state.userTags.has(author);
    remove.addEventListener("click", () => {
      state.userTags.delete(author);
      persistUserTags();
      overlay.remove();
      if (state.thread) renderThread(state.thread);
    });
    const cancel = el("button", "tag-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => overlay.remove());
    row.append(save, remove, cancel);
    panel.append(input, row);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.isTrusted) save.click();
      if (event.key === "Escape" && event.isTrusted) overlay.remove();
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
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
    else if (current.status === "generating") status.textContent = current.detail || "Summarizing…";
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
        state.summaries.set(storyId, { ...current, status: message.status, detail: String(message.detail || ""), error: "" });
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
    b.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // SEC-30: programmatic clicks never trigger thread actions
      action(event);
    });
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
    cancelItemState();
    closeComposer({ keepDraft: true });
    // Direct thread switches (e.g. "already submitted" → open the existing
    // story) must retarget the selection, or the fetched payloads are dropped
    // when the stale selectedId fails the guard below.
    state.selectedId = id;
    state.itemState = null;
    state.pollOptions = null;
    state.pollOptionsRenderedKey = "";
    threadPane.replaceChildren(createLoading("Loading discussion…"));
    scheduleItemState(id);
    loadPollOptions(id);
    try {
      const item = await fetchJson(ALGOLIA_API + "/items/" + id);
      if (state.selectedId !== id) return;
      mergeConfirmedComments(item);
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
    setStoryLink(title, item);
    title.target = "_blank";
    title.rel = "noopener";
    const domain = el("a", "thread-domain");
    setStoryLink(domain, item);
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
    const pointsStat = stat("thumb", compact(item.points || 0));
    pointsStat.dataset.threadPoints = "1";
    const pointsValue = pointsStat.querySelector("span:last-child");
    pointsValue.dataset.threadPointsValue = String(item.points || 0); // optimistic vote updates target this
    meta.append(
      pointsStat,
      stat("comment", compact(totalComments)),
      stat("clock", relativeTime(item.created_at_i || 0)),
      authorLink
    );

    const session = window.HarmonicHN?.session?.() || null;
    const replyAction = threadAction("comment", "Comments", () => {
      threadPane.querySelector(".comments")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    const storyState = state.itemState && state.itemState.itemId === item.id ? state.itemState.story : null;
    const preVoted = Boolean(storyState?.voted) || Boolean(state.feedVotes.get(item.id));
    const upvoteButton = threadAction("thumb", preVoted ? "Unvote" : "Upvote", handleStoryVote);
    upvoteButton.setAttribute("data-thread-vote", "1");
    upvoteButton.classList.toggle("active", preVoted);
    if (!session) {
      upvoteButton.title = "Sign in to vote";
      upvoteButton.setAttribute("aria-label", "Sign in to vote");
    }
    // Phase 4: favorite + hide controls. Availability gating happens in
    // updateThreadVoteUi once the fetched item document lands.
    const favoriteButton = threadAction("heart", storyState?.favorited ? "Unfavorite" : "Favorite", handleStoryFavorite);
    favoriteButton.setAttribute("data-thread-favorite", "1");
    favoriteButton.classList.toggle("active", Boolean(storyState?.favorited));
    if (!session) {
      favoriteButton.title = "Sign in to favorite";
      favoriteButton.setAttribute("aria-label", "Sign in to favorite");
    }
    const hideButton = threadAction("eyeOff", storyState?.hidden ? "Unhide" : "Hide", handleStoryHide);
    hideButton.setAttribute("data-thread-hide", "1");
    hideButton.classList.toggle("active", Boolean(storyState?.hidden));
    if (!session) {
      hideButton.title = "Sign in to hide";
      hideButton.setAttribute("aria-label", "Sign in to hide");
    }

    const actions = el("div", "thread-actions");
    actions.append(
      threadAction("user", "Open author", () => authorLink.click()),
      replyAction,
      upvoteButton,
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
      const storyState = state.itemState && state.itemState.itemId === item.id ? state.itemState.story : null;
      openPopup(event.currentTarget, [
        { label: "Reply to story", icon: "comment", action: () => session
          ? openComposer({ parentId: item.id, storyId: item.id })
          : showToast("Sign in to reply") },
        ...(session && storyState?.favoriteAvailable
          ? [{ label: storyState.favorited ? "Unfavorite" : "Favorite", icon: "heart", action: handleStoryFavorite }]
          : []),
        ...(session && storyState?.hideAvailable
          ? [{ label: storyState.hidden ? "Unhide" : "Hide", icon: "eyeOff", action: handleStoryHide }]
          : []),
        { label: "Search in comments", icon: "search", action: () => {
          const heading = threadPane.querySelector(".comments-heading");
          const input = heading?.querySelector(".comment-search");
          heading?.classList.add("searching");
          input?.focus();
        } },
        { label: "Sort comments · " + state.settings.commentSort, action: () => openSortMenu(more) },
        { label: "Open on Hacker News", icon: "external", action: () => openOriginalHackerNews("/item?id=" + item.id) },
        ...(archiveHref(item) ? [{ label: "View on archive", icon: "clock", action: () => openArchive(item) }] : []),
        { label: "Collapse all comments", action: () => setAllCommentsCollapsed(true) },
        { label: "Expand all comments", action: () => setAllCommentsCollapsed(false) },
        // Phase 4: flag only when Hacker News offers the link, behind a
        // confirmation dialog (SEC-36).
        ...(session && storyState?.flagAvailable
          ? [{
              label: storyState.flagged ? "Unflag story" : "Flag story",
              icon: "flag",
              action: (popupEvent) => {
                if (storyState.flagged) {
                  window.HarmonicHN.setFlagged(item.id, false).then((outcome) =>
                    showToast(outcome.status === "success" ? "Flag removed" : outcome.message || "The flag could not be removed")
                  );
                } else {
                  confirmFlagItem(popupEvent, item.id, "story");
                }
              },
            }]
          : []),
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
    favoriteButton.classList.add("thread-secondary-action");
    hideButton.classList.add("thread-secondary-action");
    headerBody.append(createSummarySurface(item.id), actions, favoriteButton, hideButton);
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

    // Phase 7 part 2: in-thread comment filter with a live match count.
    state.threadAuthor = item.author || "";
    const searchBox = el("input", "comment-search");
    searchBox.type = "search";
    searchBox.placeholder = "Filter comments";
    searchBox.autocomplete = "off";
    const matchLabel = el("span", "comment-search-count", "");
    searchBox.addEventListener("input", () => filterThreadComments(searchBox.value, matchLabel, total));
    const nav = el("div", "comments-nav");
    const upButton = el("button", "comments-nav-button", "↑ Top");
    upButton.type = "button";
    upButton.title = "Back to the story";
    upButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      threadPane.querySelector(".thread-header")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    let topLevelIndex = -1;
    const topLevelRows = () => [...threadPane.querySelectorAll(".comments > .comment-row")].filter((row) => !row.hidden);
    const jumpTopLevel = (delta) => {
      const rows = topLevelRows();
      if (!rows.length) return;
      topLevelIndex = Math.min(rows.length - 1, Math.max(0, topLevelIndex + delta));
      const target = rows[topLevelIndex];
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.remove("nav-flash");
      // restart the flash animation
      void target.offsetWidth;
      target.classList.add("nav-flash");
    };
    const prevButton = el("button", "comments-nav-button", "‹ Prev");
    prevButton.type = "button";
    prevButton.title = "Previous top-level comment";
    prevButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      jumpTopLevel(-1);
    });
    const nextButton = el("button", "comments-nav-button", "Next ›");
    nextButton.type = "button";
    nextButton.title = "Next top-level comment";
    nextButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      jumpTopLevel(1);
    });
    nav.append(upButton, prevButton, nextButton);
    heading.append(nav, searchBox, matchLabel);
    threadPane.appendChild(heading);

    const comments = el("section", "comments");
    for (const comment of sortedComments(item.children || [])) comments.appendChild(renderComment(comment, 0));
    if (!comments.childElementCount) comments.appendChild(el("div", "empty-comments", "No comments yet."));
    threadPane.appendChild(comments);
    // Once the discussion has been read, its comments are never "new" again.
    if (state.settings.markNewComments && Number.isInteger(item.id)) {
      setTimeout(() => {
        if (state.selectedId !== item.id) return;
        state.seenTimes.set(item.id, Math.floor(Date.now() / 1000));
        persistSeenTimes();
      }, 4000);
    }
    // Re-apply any item state that arrived (or was cached) for this story.
    if (state.itemState && state.itemState.itemId === item.id) {
      updateThreadVoteUi();
      renderPollOptions();
    }

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
      // Phase 7 part 3: rich link previews — text-only facts from public
      // provider APIs (GitHub, Wikipedia, arXiv), re-validated here and
      // rendered with textContent only.
      const rich = state.settings.richPreviews === false ? null : preview.rich;
      if (rich && typeof rich === "object" && !Array.isArray(rich) && typeof rich.provider === "string") {
        const providerLabels = { github: "GitHub", wikipedia: "Wikipedia", arxiv: "arXiv" };
        const box = el("div", "rich-preview rich-preview-" + rich.provider.replace(/[^a-z0-9-]/g, ""));
        const head = el("div", "rich-preview-head");
        head.append(el("span", "rich-preview-provider", providerLabels[rich.provider] || "Facts"));
        const richTitle = typeof rich.title === "string" ? rich.title.slice(0, 200) : "";
        if (richTitle) head.append(el("strong", "rich-preview-title", richTitle));
        box.append(head);
        let shown = 0;
        for (const line of Array.isArray(rich.lines) ? rich.lines : []) {
          if (typeof line !== "string" || !line.trim()) continue;
          if (shown >= 4) break;
          box.append(el("p", "rich-preview-line", line.slice(0, 700)));
          shown += 1;
        }
        if (shown) {
          const summarySurface = headerBody.querySelector(".story-summary");
          if (summarySurface) headerBody.insertBefore(box, summarySurface);
          else headerBody.appendChild(box);
        }
      }
    } else {
      hero.remove();
    }
  }

  function setAllCommentsCollapsed(collapsed) {
    document.querySelectorAll(".comment-row").forEach((row) => row.classList.toggle("collapsed", collapsed));
  }

  // Phase 7 part 2: in-thread comment filter. A top-level branch stays visible
  // when any comment inside it matches; non-matching branches hide entirely.
  function filterThreadComments(query, matchLabel, total) {
    const q = String(query || "").trim().toLowerCase();
    const rows = [...threadPane.querySelectorAll(".comment-row")];
    if (!q) {
      rows.forEach((row) => { row.hidden = false; });
      if (matchLabel) matchLabel.textContent = "";
      return;
    }
    const ownMatch = new Map();
    for (const row of rows) {
      const card = row.querySelector(":scope > .comment-card");
      const text = ((card?.textContent || "") + " " + (row.dataset.author || "")).toLowerCase();
      ownMatch.set(row, text.includes(q));
    }
    // Children appear after their parent in DOM order, so reverse iteration
    // settles every subtree before its ancestor is decided.
    let kept = 0;
    for (const row of [...rows].reverse()) {
      const childKept = [...row.querySelectorAll(":scope > .comment-children .comment-row")].some((child) => !child.hidden);
      const keep = ownMatch.get(row) || childKept;
      row.hidden = !keep;
      if (keep) kept++;
    }
    if (matchLabel) matchLabel.textContent = kept + " of " + total + " match";
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
      if (state.thread && ["markNewComments", "hideDelayed", "showAvatars", "nitterRedirect", "richPreviews"].includes(key)) renderThread(state.thread);
      if (key === "nitterRedirect" || key === "nitterInstance") refreshStoryLinks();
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
      if (key === "hiddenDomains" || key === "hiddenKeywords") filterStories();
      if (typeof options.onChange === "function") options.onChange();
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
      settingToggle("Hotness colors", "hotnessColors", "Color scores by how fast a story is moving"),
      settingToggle("Compact points", "compactPoints", "Show abbreviated scores without the word points"),
      settingToggle("Show domain", "showDomain", "Show the story's source domain in the metadata"),
      settingToggle("Hide jobs", "hideJobs", "Filter job stories out of every feed"),
      settingToggle("Hide read stories", "hideRead", "Filter stories you have already opened out of the feed"),
      settingText("Hidden domains", "hiddenDomains", "Comma-separated domains to filter, e.g. example.com, sub.example.org"),
      settingText("Hidden keywords", "hiddenKeywords", "Comma-separated title keywords to filter, case-insensitive"),
      settingSelect("Favicon provider", "faviconProvider", [["google", "Google (default)"], ["duckduckgo", "DuckDuckGo"], ["direct", "Direct from the site"]]),
      el("p", "settings-note", "Favicon providers receive the story's hostname to fetch an icon. Direct requests go to the site itself; Google and DuckDuckGo see the hostname only. Nothing else about you is sent."),
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
      settingToggle("Mark new comments", "markNewComments", "Highlight comments posted since your last visit to a story"),
      settingToggle("Hide [delayed]", "hideDelayed", "Collapse HN's [delayed] placeholder comments"),
      settingToggle("Comment avatars", "showAvatars", "Show generated local avatars beside comment authors"),
      settingToggle("Swap comment actions", "swapCommentActions", "Tap opens actions; long-press collapses"),
      settingSlider("Comment text size", "commentTextSize", 12, 18, 0.5, " sp")
    );

    const userDataSection = el("div", "settings-section");
    const exportButton = el("button", "setting-button", "Export user data (JSON)");
    exportButton.type = "button";
    exportButton.addEventListener("click", exportUserData);
    const importButton = el("button", "setting-button", "Import user data");
    importButton.type = "button";
    importButton.addEventListener("click", () => importFileInput.click());
    const importFileInput = el("input", "setting-import-input");
    importFileInput.type = "file";
    importFileInput.accept = "application/json,.json";
    importFileInput.hidden = true;
    importFileInput.addEventListener("change", () => importUserData(importFileInput));
    userDataSection.append(
      el("h3", "", "Your local data"),
      exportButton,
      importButton,
      importFileInput,
      el("p", "settings-note", "Bookmarks, read stories, user tags, and blocked users are stored on this profile. Export saves them as a JSON file; import merges a previously exported file after schema validation (integers for ids, small strings for tags, 256 KB cap). Nothing here is synced to Hacker News or any server.")
    );

    const headerDisplaySection = el("div", "settings-section");
    headerDisplaySection.append(
      el("h3", "", "Header display"),
      settingToggle("Background tint", "headerTint", "Tint the discussion header from the story preview"),
      settingToggle("Preview image", "headerImage", "Show the story preview above the discussion title")
    );

    // Phase 7 part 3: appearance (theme + font) and link behavior.
    const appearanceSection = el("div", "settings-section");
    appearanceSection.append(
      el("h3", "", "Appearance"),
      settingSelect("Theme", "uiTheme", [["amoled", "AMOLED black"], ["charcoal", "Charcoal"], ["navy", "Deep navy"]]),
      settingSelect("Font", "uiFont", [["harmonic", "Harmonic"], ["system", "System UI"], ["serif", "Serif"]]),
      el("p", "settings-note", "Themes restyle Harmonic's own surfaces only; pages opened through Open original HN keep Hacker News's own look.")
    );

    const linksSection = el("div", "settings-section");
    linksSection.append(
      el("h3", "", "Links"),
      settingToggle("Rich link previews", "richPreviews", "Fetch public GitHub, Wikipedia, and arXiv facts for matching articles and show them under the thread title"),
      settingToggle("Open X/Twitter links via Nitter", "nitterRedirect", "Rewrite twitter.com and x.com links (story titles and comment links) to a Nitter instance"),
      settingText("Nitter instance", "nitterInstance", "Bare hostname only, e.g. nitter.net", {
        onChange: () => {
          refreshStoryLinks();
          if (state.settings.nitterInstance && !nitterInstanceHost()) showToast("That doesn't look like a hostname — Nitter links keep the default");
        },
      }),
      el("p", "settings-note", "Rich previews talk only to api.github.com, wikipedia.org, and export.arxiv.org; responses are validated field-by-field and rendered as plain text. Nitter replaces the host and keeps the path; nothing is sent to Harmonic.")
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

    // Phase 1: Account explainer. Harmonic has no password field (SEC-01);
    // sign-in happens on Hacker News's own page and the session lives in
    // Hacker News's cookie.
    const session = window.HarmonicHN?.session?.() || null;
    const accountSection = el("div", "settings-section");
    accountSection.append(
      el("h3", "", "Account"),
      el("p", "settings-note", session?.username
        ? "Signed in to Hacker News as " + session.username + (session.karma !== null && session.karma !== undefined ? " (" + compact(session.karma) + " karma)" : "") + ". Use the account chip in the toolbar to open your profile or log out."
        : "Not signed in to Hacker News. Use the Log in chip in the toolbar — sign-in happens on Hacker News's own page in this tab."),
      el("p", "settings-note", "Harmonic never sees or stores your Hacker News password. Your session lives in Hacker News's own cookie. When you vote, favorite, or reply, Harmonic sends the action directly to Hacker News through the same signed-in browser session; one-time tokens read from Hacker News pages stay in memory for this tab only and never reach Harmonic's storage or sync.")
    );

    // A category index keeps the settings compact without changing any
    // persisted keys or dropping advanced controls.
    const categories = [
      ["Appearance", [appearanceSection, headerDisplaySection]],
      ["Stories", [storySection, behaviorSection]],
      ["Comments", [commentsSection]],
      ["Web and links", [linksSection]],
      ["Account", [accountSection]],
      ["Data", [userDataSection]],
      ["AI", [aiSection]],
    ];
    const index = el("nav", "settings-categories");
    const back = button("chevron", "Back to settings categories", "settings-back");
    back.hidden = true;
    back.addEventListener("click", showIndex);
    header.insertBefore(back, header.firstChild);
    const sections = el("div", "settings-pages");
    for (const [name, children] of categories) {
      const link = el("button", "settings-category");
      link.type = "button";
      link.append(el("strong", "", name), el("span", "", "›"));
      link.addEventListener("click", () => showCategory(name));
      index.append(link);
      for (const section of children) {
        section.hidden = true;
        sections.append(section);
      }
    }
    function showIndex() {
      index.hidden = false;
      back.hidden = true;
      header.querySelector("h2").textContent = "Settings";
      for (const section of sections.children) section.hidden = true;
      panel.scrollTop = 0;
    }
    function showCategory(name) {
      index.hidden = true;
      back.hidden = false;
      header.querySelector("h2").textContent = name;
      const group = categories.find(([label]) => label === name)?.[1] || [];
      for (const section of sections.children) section.hidden = !group.includes(section);
      panel.scrollTop = 0;
    }
    panel.append(header, index, sections);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (options.focusAi) {
      showCategory("AI");
      aiSection.classList.add("settings-section-highlight");
      setTimeout(() => aiSection.classList.remove("settings-section-highlight"), 1200);
    }
  }

  // Phase 7 part 2: export/import of local user data (bookmarks, read ids,
  // user tags, blocked users). Strict schema validation on import; integers
  // only for ids; hard size caps everywhere.
  const USER_DATA_VERSION = 1;
  const USER_DATA_MAX_BYTES = 262144;

  function exportUserData() {
    const payload = {
      version: USER_DATA_VERSION,
      exportedAt: new Date().toISOString(),
      bookmarks: [...state.bookmarks].filter((id) => Number.isInteger(id) && id > 0).slice(0, 2000),
      readStoryIds: [...state.readIds].filter((id) => Number.isInteger(id) && id > 0).slice(0, 1500),
      userTags: Object.fromEntries([...state.userTags].slice(0, 500)),
      blockedUsers: [...state.blockedUsers].slice(0, 500),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "harmonic-user-data.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("User data exported");
  }

  const sanitizeIdList = (value, cap) => {
    if (!Array.isArray(value)) return null;
    const ids = value.filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length !== value.length) return null; // integers only, no coercion
    return ids.slice(0, cap);
  };

  async function importUserData(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > USER_DATA_MAX_BYTES) {
      showToast("Import refused — file is larger than 256 KB");
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showToast("Import refused — not valid JSON");
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== USER_DATA_VERSION) {
      showToast("Import refused — unrecognized schema");
      return;
    }
    const bookmarks = sanitizeIdList(data.bookmarks, 2000);
    const readStoryIds = sanitizeIdList(data.readStoryIds, 1500);
    let userTags = null;
    if (data.userTags && typeof data.userTags === "object" && !Array.isArray(data.userTags)) {
      userTags = {};
      for (const [author, tag] of Object.entries(data.userTags)) {
        if (typeof author !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(author)) return void showToast("Import refused — bad author name in tags");
        if (typeof tag !== "string" || tag.length > 40) return void showToast("Import refused — bad tag value");
        userTags[author] = tag;
        if (Object.keys(userTags).length >= 500) break;
      }
    }
    let blockedUsers = null;
    if (Array.isArray(data.blockedUsers)) {
      blockedUsers = [];
      for (const author of data.blockedUsers) {
        if (typeof author !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(author)) return void showToast("Import refused — bad blocked user name");
        blockedUsers.push(author);
        if (blockedUsers.length >= 500) break;
      }
    }
    if (!bookmarks || !readStoryIds || (data.userTags !== undefined && !userTags) || (data.blockedUsers !== undefined && !blockedUsers)) {
      showToast("Import refused — schema validation failed");
      return;
    }
    // Merge, not replace: importing adds to what is already here.
    for (const id of bookmarks) state.bookmarks.add(id);
    for (const id of readStoryIds) state.readIds.add(id);
    if (userTags) for (const [author, tag] of Object.entries(userTags)) state.userTags.set(author, tag);
    if (blockedUsers) for (const author of blockedUsers) state.blockedUsers.add(author);
    await runtimeMessage({ type: "HARMONIC_BOOKMARKS_SET", ids: [...state.bookmarks].slice(0, 2000) });
    await runtimeMessage({ type: "HARMONIC_READ_IDS_SET", ids: [...state.readIds].slice(-1500) });
    persistUserTags();
    persistBlockedUsers();
    document.querySelectorAll(".story-card").forEach((card) => {
      if (state.readIds.has(Number(card.dataset.storyId))) card.classList.add("is-read");
    });
    document.querySelectorAll("[data-bookmark-id]").forEach((node) => {
      node.classList.toggle("active", state.bookmarks.has(Number(node.dataset.bookmarkId)));
    });
    showToast("Imported " + bookmarks.length + " bookmarks, " + readStoryIds.length + " read stories" + (userTags ? ", " + Object.keys(userTags).length + " tags" : "") + (blockedUsers ? ", " + blockedUsers.length + " blocked" : ""));
    filterStories();
    if (state.thread) renderThread(state.thread);
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
      if (state.search.active) {
        if (remaining < 500 && !state.search.controller && state.search.page + 1 < state.search.nbPages)
          runGlobalSearch(state.search.page + 1, true);
        return;
      }
      if (remaining < 900) loadMoreStories();
    }, { passive: true });
    feedInner.append(createToolbar(), storyList);
    feedPane.append(feedInner);

    threadPane = el("section", "thread-pane");
    threadPane.appendChild(createThreadPlaceholder());
    app.append(feedPane, threadPane);
    document.body.appendChild(app);
    // Phase 6: author links open the in-Harmonic user panel (Firebase-backed)
    // instead of leaving for Hacker News.
    app.addEventListener("click", (event) => {
      // HN's hn.js must not process clicks inside the extension UI.
      event.stopPropagation();
      const link = event.target?.closest?.('a[href*="user?id="]');
      if (!link || !event.isTrusted) return;
      const match = (link.getAttribute("href") || "").match(/user\?id=([A-Za-z0-9_-]{1,32})/);
      if (!match) return;
      event.preventDefault();
      openUserPanel(decodeURIComponent(match[1]));
    });
    document.documentElement.classList.add("harmonic-ready");
    // Search shortcut is inert while editing text or when an overlay is open.
    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".harmonic-confirm-overlay, .settings-overlay, .harmonic-submit-overlay")) return;
      event.preventDefault();
      if (!searchWrap.classList.contains("open")) toggleSearch();
      searchInput.focus();
    });
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
      seedFeedVotes();
      window.HarmonicHN?.onSessionChange?.((session) => {
        // Account switched mid-session: vote affordances reset (they belong to
        // the previous account); the chip and any open thread UI refresh.
        state.feedVotes.clear();
        state.itemState = null;
        state.pollOptions = null;
        updateAccountChip();
        updateThreadVoteUi();
        if (state.sessionToastReady && session?.username) showToast("Signed in as " + session.username);
      });
      mount();
      state.sessionToastReady = true;
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  })();
})();
