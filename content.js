(() => {
  const HN_API = "https://hacker-news.firebaseio.com/v0";
  const ALGOLIA_API = "https://hn.algolia.com/api/v1";
  const FEED_BATCH_SIZE = 40;
  const SETTINGS_BACKUP_KEY = "harmonova:settings:v1";
  const ENABLED_BACKUP_KEY = "harmonova:enabled:v1";
  const SETTINGS_HASH = "#harmonova-settings";
  const ORIGINAL_HASH = "#harmonova-original";
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

  const DEFAULT_SETTINGS = HarmoNovaSettingsSchema.defaults;

  const ICONS = {
    chevron: '<path d="M7 10l5 5 5-5z"/>',
    search: '<path d="M9.5 3a6.5 6.5 0 104.08 11.56L19 20l1-1-5.44-5.42A6.5 6.5 0 009.5 3zm0 1.8a4.7 4.7 0 110 9.4 4.7 4.7 0 010-9.4z"/>',
    more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    comment: '<path d="M4 4.5h16v12H9l-4.2 3.1.7-3.1H4v-12zm1.8 1.8v8.4h2.3l-.3 1.4 1.6-1.4h8.8V6.3H5.8z"/>',
    replyPlus: '<path d="M4 4.5h16v12H9l-4.2 3.1.7-3.1H4v-12zm1.8 1.8v8.4h2.3l-.3 1.4 1.6-1.4h8.8V6.3H5.8z"/><path d="M11 8h2v4h-2zM10 9h4v2h-4z"/>',
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
    s.setAttribute("class", "harmonova-icon " + className);
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

  function stateFacet(fields){return Object.freeze(Object.defineProperties(Object.create(null),Object.fromEntries(fields.map(key=>[key,{get:()=>state[key],set:value=>{state[key]=value;}}]))));}

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
    threadOpOnly: false, // Per-thread OP-comment filter
    userTags: new Map(), // author -> short tag (local, exportable)
    blockedUsers: new Set(), // locally blocked authors
    seenTimes: new Map(), // story id -> last-visit timestamp for new-comment markers
  };

  let feedScope=HarmoNovaLifecycle.create(), threadScope=HarmoNovaLifecycle.create();
  const fetchJson = async (url,signal) => {
    const origin=new URL(url).origin;
    if(!["https://hacker-news.firebaseio.com","https://hn.algolia.com"].includes(origin))throw new Error("Unsupported public data source");
    const response=await HarmoNovaResourcePolicy.request(fetch,url,{signal,headers:{Accept:"application/json"}},HarmoNovaResourcePolicy.Limits.publicJson,["application/json"]);
    if(!response.ok){await response.body?.cancel();throw new Error("Public data request failed");}
    return HarmoNovaLifecycle.validateTree(JSON.parse(await HarmoNovaResourcePolicy.readText(response,4*1024*1024,signal)));
  };

  const fetchItems = async (ids,signal) => {
    const safeIds = ids.filter((id) => Number.isInteger(id) && id > 0).slice(0, 60);
    const results = new Array(safeIds.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(10, safeIds.length) }, async () => {
      while (cursor < safeIds.length) {
        const index = cursor++;
        results[index] = await fetchJson(HN_API + "/item/" + safeIds[index] + ".json",signal);
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

  // Only worker-reencoded, bounded PNG bytes are rendered. There is no
  // original URL or credentialed network fallback in an error handler.
  const safeImageSrc = href => typeof href==="string" && href.length<=350000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(href) ? href : null;

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
  const privateReader = INCOGNITO ? HarmoNovaPrivateStore.create() : null;

  const normalizeQuotedParagraphs = (target) => {
    const stripQuoteMarkers = (quote) => {
      const walker = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        node.textContent = (node.textContent || "").replace(/(^|\n)(\s*)>\s?/g, "$1$2");
      }
    };

    target.querySelectorAll("blockquote").forEach((quote) => {
      quote.classList.add("harmonova-quote");
      stripQuoteMarkers(quote);
    });

    target.querySelectorAll("p").forEach((paragraph) => {
      const text = paragraph.textContent || "";
      if (!text.trimStart().startsWith(">")) return;
      const quote = document.createElement("blockquote");
      quote.className = "harmonova-quote";
      while (paragraph.firstChild) quote.appendChild(paragraph.firstChild);
      stripQuoteMarkers(quote);
      paragraph.replaceWith(quote);
    });

    for (const node of [...target.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || "";
      if (!text.trimStart().startsWith(">")) continue;
      const quote = document.createElement("blockquote");
      quote.className = "harmonova-quote";
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


  const stateUI=HarmoNovaContentState.create({
    get ENABLED_BACKUP_KEY(){return ENABLED_BACKUP_KEY;},
    get INCOGNITO(){return INCOGNITO;},
    get ORIGINAL_HASH(){return ORIGINAL_HASH;},
    get SETTINGS_BACKUP_KEY(){return SETTINGS_BACKUP_KEY;},
    get localStorage(){return localStorage;},
    get privateReader(){return privateReader;},
    get showToast(){return showToast;},
  },stateFacet(["blockedUsers","bookmarks","readIds","readerRevision","recoveryNotice","seenTimes","settings","userTags"]));
  function pageStorageSet(...args){return stateUI.pageStorageSet(...args);}
  function loadEnabledPreference(...args){return stateUI.loadEnabledPreference(...args);}
  function isOriginalTab(...args){return stateUI.isOriginalTab(...args);}
  function flushSettings(...args){return stateUI.flushSettings(...args);}
  function saveSettings(...args){return stateUI.saveSettings(...args);}
  function loadPersistentState(...args){return stateUI.loadPersistentState(...args);}
  function persistUserTags(...args){return stateUI.persistUserTags(...args);}
  function persistBlockedUsers(...args){return stateUI.persistBlockedUsers(...args);}
  function persistSeenTimes(...args){return stateUI.persistSeenTimes(...args);}
  function markRead(...args){return stateUI.markRead(...args);}
  function toggleBookmark(...args){return stateUI.toggleBookmark(...args);}

  const previewsUI=HarmoNovaContentPreviews.create({
    get INCOGNITO(){return INCOGNITO;},
    get stateUI(){return stateUI;},
    get storyList(){return storyList;}
  },stateFacet(["previewById","search","settings"]));

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
    filterStories();
    const contentScale = Math.max(0.75, Math.min(1.25, Number(state.settings.contentScale || 100) / 100));
    const storySetting = Number(state.settings.storyTextSize || 17.5);
    const storyScale = storySetting / 17.5;
    const commentSetting = Number(state.settings.commentTextSize || 15);
    const commentScale = Math.max(0.7, Math.min(1.3, Number(state.settings.commentZoom ?? 100) / 100));
    app.dataset.cardClickComments = String(state.settings.cardClickComments);
    // HarmoNova's semantic settings rendered at desktop density. The Android app's dp/sp
    // values are physically larger on a high-density display, so this preserves the same
    // visual scale on a standard-density laptop instead of shrinking the UI.
    app.style.setProperty("--story-text-size", ((23 + (storySetting - 17.5) * 1.25) * contentScale) + "px");
    app.style.setProperty("--story-index-size", ((22 + (storySetting - 17.5) * 1.2) * contentScale) + "px");
    app.style.setProperty("--story-meta-size", (16.5 * storyScale * contentScale) + "px");
    app.style.setProperty("--story-comment-count-size", (19 * storyScale * contentScale) + "px");
    app.style.setProperty("--comment-text-size", ((19 + (commentSetting - 15) * 1.2) * contentScale * commentScale) + "px");
    app.style.setProperty("--comment-meta-size", (17 * contentScale * commentScale) + "px");
    app.style.setProperty("--comment-row-gap", (10 * contentScale * commentScale) + "px");
    app.style.setProperty("--comment-indent", (12 * contentScale * commentScale) + "px");
    app.style.setProperty("--comment-paragraph-gap", (14 * contentScale * commentScale) + "px");
    app.style.setProperty("--story-pad-y", (15 * contentScale) + "px");
    app.style.setProperty("--story-pad-x", (13 * contentScale) + "px");
    app.style.setProperty("--story-gap", (9 * contentScale) + "px");
    app.style.setProperty("--comment-pad-y", (14 * contentScale * commentScale) + "px");
    app.style.setProperty("--comment-pad-x", (16 * contentScale * commentScale) + "px");
    app.style.setProperty("--thread-title-size", (32 * contentScale) + "px");
    app.style.setProperty("--thread-meta-size", (17 * contentScale) + "px");
    // Phase 7 part 3: appearance — surface theme and interface font live on
    // the document element so they reach the body background as well.
    const root = document.documentElement;
    const themes = ["amoled", "charcoal", "navy"];
    root.dataset.theme = themes.includes(state.settings.uiTheme) ? state.settings.uiTheme : "amoled";
    const fonts = ["rounded", "system", "serif"];
    root.dataset.font = fonts.includes(state.settings.uiFont) ? state.settings.uiFont : "rounded";
  }

  function showToast(message, options = {}) {
    let toast = document.querySelector(".harmonova-toast");
    if (!toast) {
      toast = el("div", "harmonova-toast");
      document.body.appendChild(toast);
    }
    // Phase 4: toasts can carry one action button (e.g. Undo for hide).
    toast.replaceChildren();
    toast.appendChild(el("span", "harmonova-toast-message", message));
    if (options.actionLabel && typeof options.onAction === "function") {
      const action = el("button", "harmonova-toast-action", options.actionLabel);
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
      await saveSettings("frontDate");
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
    accountChip.id = "harmonova-account-chip";
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
    searchInput.placeholder = "Search all Hacker News";
    searchInput.autocomplete = "off";
    searchInput.addEventListener("input", onSearchInput);
    searchInput.addEventListener("keydown", onSearchKeydown);
    searchInput.addEventListener("focus", renderRecentSearches);
    const closeSearchButton = button("close", "Close search", "feed-search-close");
    closeSearchButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      closeSearch();
    });
    searchWrap.append(svg("search"), searchInput, closeSearchButton);
    toolbar.append(row, updatedLabel, searchWrap, createSearchPanel());
    return toolbar;
  }

  // Search covers all of Hacker News. Recent searches stay in memory only.
  function createSearchPanel() {
    searchPanel = el("div", "hn-search-panel");

    searchFilters = el("div", "hn-search-filters");

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
    searchSubmit.addEventListener("click", () => runGlobalSearch(0));
    searchRecent = el("div", "hn-search-recent");
    searchRecent.hidden = true;

    searchPanel.append(searchSubmit, searchFilters, searchRecent);
    return searchPanel;
  }

  function openPopup(anchor, items, pointer = null) {
    document.querySelector(".harmonova-popup")?.remove();
    const popup = el("div", "harmonova-popup");
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
// HarmoNova's own known paths — user-supplied query strings are never reflected.
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
  const session = window.HarmoNovaHN?.session?.() || null;
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
  const session = window.HarmoNovaHN?.session?.() || null;
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

// SEC-04: logout is a signed-in fetch handled by HarmoNovaHN, not a navigation
// to /logout, so tokens are never pasted into URLs. Afterwards we reload the
// feed so the page reflects the signed-out state.
async function performLogout(event) {
  if (!event?.isTrusted || state.logoutPending) return;
  state.logoutPending = true;
  const username = window.HarmoNovaHN?.session?.()?.username;
  try {
  const outcome = await window.HarmoNovaHN?.logout?.();
  if (!outcome || outcome.status !== "success") {
    showToast(outcome?.message || "Could not confirm sign-out");
    openConfirmDialog({ title: "Could not confirm sign-out", message: "Your drafts are kept. Check your session on Hacker News.", confirmLabel: "Open Hacker News", onConfirm: () => openOriginalHackerNews("/news") });
    return;
  }
  if (state.composer) closeComposer({ keepDraft: false });
  const cleared = await composerUI.draftClearAll(outcome.username || username);
  if (!cleared) {
    showToast("Signed out. Could not clear saved drafts.");
    updateAccountChip();
    return;
  }
  state.feedVotes.clear();
  state.itemState = null;
  state.pollOptions = null;
  showToast("Signed out");
  location.reload();
  } finally { state.logoutPending = false; }
}

// ---------------------------------------------------------------------------
// Phase 2: voting (story upvote, comment up/down votes, poll options)
// ---------------------------------------------------------------------------

// Vote state seen on the feed document when HarmoNova first mounted. Used to
// light up "already voted" affordances before per-item state is fetched.
function seedFeedVotes() {
  const docVotes = window.HarmoNovaHN?.documentVoteState?.() || {};
  for (const [id, direction] of Object.entries(docVotes)) {
    const numeric = Number(id);
    if (Number.isInteger(numeric) && numeric > 0) state.feedVotes.set(numeric, direction === "down" ? "down" : "up");
  }
}

// SEC-30: HarmoNova never sends an action unless the click is a real user
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

// Once a story has been open for 600ms, ask Hacker News (via HarmoNovaHN) for
// the document state: the story's vote links and every comment's vote links.
// This is a single signed-in GET, queued through the module's rate limiter.
function scheduleItemState(id) {
  cancelItemState();
  const token = state.itemStateToken;
  state.itemStateTimer = setTimeout(async () => {
    if (!window.HarmoNovaHN || state.selectedId !== id || token !== state.itemStateToken) return;
    await loadThreadItemState(id, token);
  }, 600);
}

async function loadThreadItemState(id, token) {
  try {
    const itemState = await window.HarmoNovaHN.ensureItemState(id,{signal:threadScope.signal});
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
    // Keep the star visible in the toolbar, but do not offer an HN action
    // when the fetched item document provides no favorite link.
    if (!pending) favoriteButton.disabled = story !== null && story.favoriteAvailable === false;
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
  const session = window.HarmoNovaHN?.session?.();
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
    const outcome = await window.HarmoNovaHN.vote(storyId, direction);
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
  const session = window.HarmoNovaHN?.session?.();
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
    const outcome = await window.HarmoNovaHN.vote(commentId, direction);
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
  const session = window.HarmoNovaHN?.session?.();
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
    const outcome = await window.HarmoNovaHN.setFavorite(storyId, !favorited);
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
  const session = window.HarmoNovaHN?.session?.();
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
    const outcome = await window.HarmoNovaHN.setHidden(storyId, !hidden);
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
    const outcome = await window.HarmoNovaHN.setHidden(storyId, false);
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
        const outcome = await window.HarmoNovaHN.setFlagged(itemId, true);
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
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    showToast("Sign in to hide");
    return;
  }
  const card = document.querySelector('.story-card[data-story-id="' + storyId + '"]');
  try {
    const outcome = await window.HarmoNovaHN.setHidden(storyId, true);
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
          const undo = await window.HarmoNovaHN.setHidden(storyId, false);
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
  const session = window.HarmoNovaHN?.session?.();
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
      const outcome = await window.HarmoNovaHN.setFavorite(ids[index], true);
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
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    showToast("Sign in to submit");
    return;
  }
  openSubmitModal();
}

function openSubmitModal() {
  document.querySelector(".harmonova-submit-overlay")?.remove();
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    showToast("Sign in to submit");
    return;
  }
  const overlay = el("div", "harmonova-submit-overlay");
  const panel = el("div", "harmonova-submit");
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
      const session = window.HarmoNovaHN?.session?.();
      if (session?.username) {
        const check = el("button", "submit-hn-open", "Check my submissions");
        check.type = "button";
        check.addEventListener("click", () => openOriginalHackerNews("/submitted?id=" + encodeURIComponent(session.username)));
        status.appendChild(check);
      }
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
        const opened = await window.HarmoNovaHN.openSubmitForm();
        if (opened.status !== "ok") {
          if (opened.status === "loginRequired") updateAccountChip();
          fail(opened.message || "Could not open the Hacker News submit form. Open it on Hacker News instead.", true);
          return;
        }
        status.textContent = "Posting your story…";
        const outcome = await window.HarmoNovaHN.submitStory(opened.handle, { title, url, text });
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
      // HarmoNova never auto-fills a form on hacker news itself.
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
    fail(outcome.message || "Hacker News did not confirm the submission. Check your HN submissions before posting again.",
      outcome.status === "indeterminate" || outcome.status === "failure" || outcome.status === "rateLimited");
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
  const session = window.HarmoNovaHN?.session?.();
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
    const result = await window.HarmoNovaHN.fetchListPage(path);
    if (state.listView !== view) return;
    if (result.status !== "ok") {
      if (body) body.replaceChildren(el("div", "harmonova-error", result.message || "Hacker News did not return the list"));
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
    if (body) body.replaceChildren(el("div", "harmonova-error", "The list could not be loaded. Try again shortly."));
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
  document.querySelector(".harmonova-user-overlay")?.remove();
  const overlay = el("div", "harmonova-user-overlay");
  const panel = el("div", "harmonova-user");
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
  // Segmented public-list tabs open inside HarmoNova, for own and other users.
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
    const scope=threadScope;
    const item = await fetchJson(HN_API + "/item/" + storyId + ".json",scope.signal);
    if(!scope.alive || state.selectedId!==storyId)return;
    if (state.selectedId !== storyId || item?.type !== "poll" || !Array.isArray(item.parts)) return;
    const options = await fetchItems(item.parts,scope.signal);
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

  const composerUI=HarmoNovaContentComposer.create({
    get INCOGNITO(){return INCOGNITO;},
    get el(){return el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get openOriginalHackerNews(){return openOriginalHackerNews;},
    get privateReader(){return privateReader;},
    get renderComment(){return renderComment;},
    get showToast(){return showToast;},
    get stateUI(){return stateUI;},
    get svg(){return svg;},
    get threadPane(){return threadPane;},
    get updateAccountChip(){return updateAccountChip;}
  },stateFacet(["composer","confirmedComments","confirmedDeletes","confirmedEdits","thread"]));
  function openConfirmDialog(...args){return composerUI.openConfirmDialog(...args);}
  function openComposer(...args){return composerUI.openComposer(...args);}
  function mergeConfirmedComments(...args){return composerUI.mergeConfirmedComments(...args);}
  function closeComposer(...args){return composerUI.closeComposer(...args);}
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
    chrome.runtime.sendMessage({ type: "HARMONOVA_OPEN_ORIGINAL", url }, (response) => {
      if (response?.ok) return;
      showToast("Could not open this page on Hacker News.");
    });
  }

  async function disableHarmoNova() {
    pageStorageSet(ENABLED_BACKUP_KEY, false);
    if (INCOGNITO) {
      showToast("Use the extension popup in a regular window to change enabled state.");
      return;
    }
    const result=await stateUI.runtimeMessage({type:"HARMONOVA_PREFERENCES_PATCH",fields:{},enabled:false});
    if(!result?.ok)return void showToast("Could not save enabled preference");
    location.reload();
  }

  function openMoreMenu(anchor) {
    const session = window.HarmoNovaHN?.session?.();
    const karma = session?.karma == null ? "" : " · " + compact(session.karma) + " karma";
    openPopup(anchor, [
      { label: session ? session.username + karma : "Log in", icon: "user", action: () => openAccountMenu(anchor) },
      { label: "New post", icon: "plus", action: () => startNewPost() },
      { label: "Add bookmarks to HN favorites", icon: "heart", action: () => addBookmarksToFavorites() },
      { label: "Settings", icon: "settings", action: openSettings },
      { label: "Open original Hacker News", icon: "external", action: () => openOriginalHackerNews(FEEDS[state.feed].path) },
      { label: "Disable HarmoNova", icon: "power", action: disableHarmoNova },
    ]);
  }


  const searchUI=HarmoNovaContentSearch.create({
    get FEEDS(){return FEEDS;},
    get INCOGNITO(){return INCOGNITO;},
    get compact(){return compact;},
    get createLoading(){return createLoading;},
    get createStoryCard(){return createStoryCard;},
    get domainOf(){return domainOf;},
    get el(){return el;},
    get feedTitle(){return feedTitle;},
    get previewsUI(){return previewsUI;},
    get refreshFeed(){return refreshFeed;},
    get relativeTime(){return relativeTime;},
    get saveSettings(){return saveSettings;},
    get searchInput(){return searchInput;},
    get searchPanel(){return searchPanel;},
    get searchRecent(){return searchRecent;},
    get searchSubmit(){return searchSubmit;},
    get searchWrap(){return searchWrap;},
    get selectStory(){return selectStory;},
    get showToast(){return showToast;},
    get storyList(){return storyList;},
    get svg(){return svg;},
    get threadPane(){return threadPane;}
  },stateFacet(["feed","search","selectedId","settings","stories"]));
  function toggleSearch(...args){return searchUI.toggleSearch(...args);}
  function closeSearch(...args){return searchUI.closeSearch(...args);}
  function abortSearch(...args){return searchUI.abortSearch(...args);}
  function onSearchInput(...args){return searchUI.onSearchInput(...args);}
  function onSearchKeydown(...args){return searchUI.onSearchKeydown(...args);}
  function filterStories(...args){return searchUI.filterStories(...args);}
  function queueGlobalSearch(...args){return searchUI.queueGlobalSearch(...args);}
  function runGlobalSearch(...args){return searchUI.runGlobalSearch(...args);}
  function renderRecentSearches(...args){return searchUI.renderRecentSearches(...args);}
  function switchFeed(...args){return searchUI.switchFeed(...args);}
  function storyMeta(...args){return searchUI.storyMeta(...args);}
  function hideDomain(...args){return searchUI.hideDomain(...args);}
  function isJobStory(...args){return searchUI.isJobStory(...args);}
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
        selectStory(story, true, true, event);
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
        { label: "Open discussion", icon: "comment", action: (event) => selectStory(story, true, true, event) },
        ...(story.url ? [{ label: "Open article", icon: "external", action: () => window.open(nitterize(articleHref(story)), "_blank", "noopener") }] : []),
        ...(archiveHref(story) ? [{ label: "View on archive", icon: "clock", action: () => openArchive(story) }] : []),
        { label: state.feedVotes.has(story.id) ? "Unvote" : "Upvote", icon: "up", action: (e) => voteFromFeed(e, story.id) },
        ...(window.HarmoNovaHN?.session?.() ? [{ label: "Hide story", icon: "eyeOff", action: (e) => hideFromFeed(e, story.id) }] : []),
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
        selectStory(story, true, true, event);
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
      selectStory(story, true, true, event);
    });

    card.addEventListener("click", (event) => {
      if (event.target.closest("a,button") || !state.settings.cardClickEnabled) return;
      markRead(story.id);
      if (state.settings.cardClickComments || !story.url) {
        selectStory(story, true, true, event);
      } else {
        window.open(articleHref(story), "_blank", "noopener");
      }
    });

    if (story.url) {
      previewsUI.requestCardPreview(card, story, (meta) => {
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
    const session = window.HarmoNovaHN?.session?.();
    if (!session) {
      showToast("Sign in to vote");
      return;
    }
    if (!Number.isInteger(storyId) || storyId <= 0) return;
    const direction = state.feedVotes.get(storyId) ? "un" : "up";
    const outcome = await window.HarmoNovaHN.vote(storyId, direction);
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
    const wrap = el("div", "harmonova-loading");
    wrap.append(el("div", "harmonova-spinner"), el("span", "", label));
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
      const stories = await fetchItems(batchIds,feedScope.signal);
      if (generation !== state.feedGeneration) return;
      loading.remove();
      const startIndex = state.stories.length;
      state.stories.push(...stories);
      stories.forEach((story, index) => storyList.appendChild(createStoryCard(story, startIndex + index)));
      state.hasMoreStories = state.feedCursor < state.feedIds.length;
      filterStories();
    } catch {
      if(generation!==state.feedGeneration)return;
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
async function fetchListFeedIds(listPath,signal) {
  const first = await window.HarmoNovaHN.fetchListPage(listPath,{signal});
  if (first.status !== "ok") {
    const error = new Error(first.message || "Hacker News did not return the list");
    error.status = first.status;
    throw error;
  }
  const ids = [...first.ids];
  if (window.HarmoNovaHN.session() && first.votes) {
    for (const [id, direction] of Object.entries(first.votes)) state.feedVotes.set(Number(id), direction);
  }
  if (first.morePath && first.ids.length < FEED_BATCH_SIZE) {
    const second = await window.HarmoNovaHN.fetchListPage(first.morePath,{signal});
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
    await saveSettings(["feedOrder","feedHidden"]);
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
    feedScope.dispose();feedScope=HarmoNovaLifecycle.create();
    const scope=feedScope;
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
        ? await fetchJson(HN_API + "/" + feed.endpoint + ".json",scope.signal)
        : await fetchListFeedIds(listPath,scope.signal);
      // /news is the canonical HN list for the Top feed.
      if (feed.endpoint === "topstories" && window.HarmoNovaHN?.session?.()) {
        const hnList = await window.HarmoNovaHN.fetchListPage("/news",{signal:scope.signal});
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
      const stories = await fetchItems(batchIds,feedScope.signal);
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
      if(!scope.alive || generation!==state.feedGeneration)return;
      const fail = el("div", "harmonova-error");
      fail.append(el("strong", "", "Couldn’t load Hacker News"), el("span", "", error.message));
      storyList.replaceChildren(fail);
    }
  }


  const commentsUI=HarmoNovaContentComments.create({
    get appendSanitizedHtml(){return appendSanitizedHtml;},
    get confirmFlagItem(){return confirmFlagItem;},
    get el(){return el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get handleCommentVote(){return handleCommentVote;},
    get hashTint(){return hashTint;},
    get openComposer(){return openComposer;},
    get openConfirmDialog(){return openConfirmDialog;},
    get openOriginalHackerNews(){return openOriginalHackerNews;},
    get openPopup(){return openPopup;},
    get openUserPanel(){return openUserPanel;},
    get persistBlockedUsers(){return persistBlockedUsers;},
    get persistUserTags(){return persistUserTags;},
    get relativeTime(){return relativeTime;},
    get renderThread(){return renderThread;},
    get showToast(){return showToast;},
    get svg(){return svg;},
    get toggleBookmark(){return toggleBookmark;}
  },stateFacet(["blockedUsers","bookmarks","itemState","seenTimes","selectedId","settings","thread","threadAuthor","userTags"]));
  function renderComment(...args){return commentsUI.renderComment(...args);}
  const summaryUI=HarmoNovaContentSummary.create({
    get el(){return el;},
    get openSettings(){return openSettings;},
    get safeHref(){return safeHref;},
    get showToast(){return showToast;},
    get stateUI(){return stateUI;},
    get svg(){return svg;}
  },stateFacet(["activeSummary","aiSelectionIntent","selectedId","selectedStory","summaries","summaryGeneration","thread"]));
  function summaryStateFor(...args){return summaryUI.summaryStateFor(...args);}
  function updateSummarySurface(...args){return summaryUI.updateSummarySurface(...args);}
  function createSummarySurface(...args){return summaryUI.createSummarySurface(...args);}
  function stopActiveSummary(...args){return summaryUI.stopActiveSummary(...args);}
  function startStorySummary(...args){return summaryUI.startStorySummary(...args);}
  function threadAction(iconName, label, action, options = {}) {
    const b = button(iconName, label, "thread-action");
    if (options.id) b.dataset.bookmarkId = options.id;
    if (options.summaryId) b.dataset.summaryActionId = options.summaryId;
    if (options.summarySource) b.dataset.summarySource = options.summarySource;
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

  async function selectStory(storyOrId, push = true, scrollTop = true, gesture = null) {
    const id = typeof storyOrId === "number" ? storyOrId : storyOrId.id;
    state.aiSelectionIntent = gesture?.isTrusted ? id : null;
    state.selectedId = id;
    state.selectedStory = typeof storyOrId === "object" ? storyOrId : state.stories.find((s) => s.id === id) || null;
    if (app) app.classList.add("show-thread");
    markRead(id);
    document.querySelectorAll(".story-card.selected").forEach((node) => node.classList.remove("selected"));
    document.querySelector('[data-story-id="' + id + '"]')?.classList.add("selected");
    if (push) history.pushState({ harmonovaItem: id }, "", "/item?id=" + id);
    document.body.classList.add("thread-active");
    if (scrollTop) threadPane.scrollTop = 0;
    await loadThread(id);
  }

  async function loadThread(id) {
    threadScope.dispose();threadScope=HarmoNovaLifecycle.create();
    const scope=threadScope;
    stopActiveSummary();
    cancelItemState();
    closeComposer({ keepDraft: true });
    // Direct thread switches (e.g. "already submitted" → open the existing
    // story) must retarget the selection, or the fetched payloads are dropped
    // when the stale selectedId fails the guard below.
    state.selectedId = id;
    state.threadOpOnly = false;
    state.itemState = null;
    state.pollOptions = null;
    state.pollOptionsRenderedKey = "";
    threadPane.replaceChildren(createLoading("Loading discussion…"));
    scheduleItemState(id);
    loadPollOptions(id);
    try {
      const item = await fetchJson(ALGOLIA_API + "/items/" + id,scope.signal);
      if (!scope.alive || state.selectedId !== id) return;
      mergeConfirmedComments(item);
      state.thread = item;
      renderThread(item);
    } catch (error) {
      if(!scope.alive || state.selectedId!==id)return;
      const fail = el("div", "harmonova-error");
      fail.append(el("strong", "", "Couldn’t load discussion"), el("span", "", error.message));
      threadPane.replaceChildren(fail);
    }
  }

  async function renderThread(item) {
    const scope=threadScope;
    if(!scope.alive || state.selectedId!==item.id)return;
    threadPane.replaceChildren();
    document.title = (item.title || "Discussion") + " — HarmoNova";
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

    const totalComments = (item.children || []).reduce((sum, child) => sum + 1 + commentsUI.descendantCount(child), 0);
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

    const session = window.HarmoNovaHN?.session?.() || null;
    const replyAction = threadAction("replyPlus", "Add reply", () => session
      ? openComposer({ parentId: item.id, storyId: item.id })
      : showToast("Sign in to reply"));
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
    const favoriteButton = threadAction("star", storyState?.favorited ? "Unfavorite" : "Favorite", handleStoryFavorite);
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
    const profileAction = threadAction("user", session ? "My profile" : "Log in", () => session
      ? openUserPanel(session.username)
      : openAccountMenu(profileAction));
    profileAction.classList.add("thread-profile-action");
    const summaryActions = el("div", "summary-action-group");
    summaryActions.setAttribute("role", "group");
    summaryActions.setAttribute("aria-label", "AI summaries");
    const articleSummary = threadAction("sparkle", "Summarize article", () => startStorySummary(item, { source: "article", trusted: true }),
      { summaryId: item.id, summarySource: "article", disabled: !item.url });
    const discussionSummary = threadAction("comment", "Summarize discussion", () => startStorySummary(item, { source: "discussion", trusted: true }),
      { summaryId: item.id, summarySource: "discussion" });
    for (const [action, label] of [[articleSummary, "Article"], [discussionSummary, "Discussion"]]) {
      action.classList.add("summary-action");
      action.appendChild(el("span", "summary-action-label", label));
      summaryActions.appendChild(action);
    }
    const shareAction = threadAction("share", "Share story", async () => {
      const url = "https://news.ycombinator.com/item?id=" + item.id;
      if (navigator.share) {
        try {
          await navigator.share({ title: item.title || "Hacker News", url });
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        showToast("Story link copied");
      } catch {
        window.open(url, "_blank", "noopener");
      }
    });
    actions.append(profileAction, replyAction, upvoteButton, favoriteButton, summaryActions, shareAction);
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
        { label: state.threadOpOnly ? "Show all comments" : "Show only OP comments", icon: "user", action: () => {
          state.threadOpOnly = !state.threadOpOnly;
          const input = threadPane.querySelector(".comment-search");
          const count = threadPane.querySelector(".comment-search-count");
          filterThreadComments(input?.value, count, totalComments);
        } },
        { label: "Open on original Hacker News", icon: "external", action: () => openOriginalHackerNews("/item?id=" + item.id) },
        ...(archiveHref(item) ? [{ label: "View on archive", icon: "clock", action: () => openArchive(item) }] : []),
        // Phase 4: flag only when Hacker News offers the link, behind a
        // confirmation dialog (SEC-36).
        ...(session && storyState?.flagAvailable
          ? [{
              label: storyState.flagged ? "Unflag story" : "Flag story",
              icon: "flag",
              action: (popupEvent) => {
                if (storyState.flagged) {
                  window.HarmoNovaHN.setFlagged(item.id, false).then((outcome) =>
                    showToast(outcome.status === "success" ? "Flag removed" : outcome.message || "The flag could not be removed")
                  );
                } else {
                  confirmFlagItem(popupEvent, item.id, "story");
                }
              },
            }]
          : []),
        { label: "Settings", icon: "settings", action: openSettings },
        { label: "Disable HarmoNova", icon: "power", action: disableHarmoNova },
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
    hideButton.classList.add("thread-secondary-action");
    headerBody.append(createSummarySurface(item.id), actions, hideButton);
    updateSummarySurface(item.id);
    header.append(hero, headerBody);
    threadPane.appendChild(header);
    updateSummarySurface(item.id);
    const existingSummary = summaryStateFor(item.id);
    if (item.url && state.aiSelectionIntent === item.id && existingSummary.status === "idle") {
      startStorySummary(item, { automatic: true });
    }

    const total = (item.children || []).reduce((sum, child) => sum + 1 + commentsUI.descendantCount(child), 0);
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
    for (const comment of commentsUI.sortedComments(item.children || [])) comments.appendChild(renderComment(comment, 0));
    if (!comments.childElementCount) comments.appendChild(el("div", "empty-comments", "No comments yet."));
    threadPane.appendChild(comments);
    if (state.threadOpOnly) filterThreadComments(searchBox.value, matchLabel, total);
    // Once the discussion has been read, its comments are never "new" again.
    if (state.settings.markNewComments && Number.isInteger(item.id)) {
      setTimeout(() => {
        if (!scope.alive || state.selectedId !== item.id) return;
        state.seenTimes.set(item.id, Math.floor(Date.now() / 1000));
        persistSeenTimes(item.id);
      }, 4000);
    }
    // Re-apply any item state that arrived (or was cached) for this story.
    if (state.itemState && state.itemState.itemId === item.id) {
      updateThreadVoteUi();
      renderPollOptions();
    }

    if (item.url) {
      const fakeStory = { id: item.id, url: item.url };
      const preview = await previewsUI.getPreview(fakeStory,scope.signal);
      if (!scope.alive || state.selectedId !== item.id) return;
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

  // Phase 7 part 2: in-thread comment filter. A top-level branch stays visible
  // when any comment inside it matches; non-matching branches hide entirely.
  function filterThreadComments(query, matchLabel, total) {
    const q = String(query || "").trim().toLowerCase();
    const rows = [...threadPane.querySelectorAll(".comment-row")];
    if (!q && !state.threadOpOnly) {
      rows.forEach((row) => { row.hidden = false; });
      if (matchLabel) matchLabel.textContent = "";
      return;
    }
    const ownMatch = new Map();
    for (const row of rows) {
      const card = row.querySelector(":scope > .comment-card");
      const text = ((card?.textContent || "") + " " + (row.dataset.author || "")).toLowerCase();
      ownMatch.set(row, text.includes(q) && (!state.threadOpOnly || row.dataset.author === state.threadAuthor));
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
    if (matchLabel) matchLabel.textContent = kept + " of " + total + (state.threadOpOnly ? " in OP threads" : " match");
  }

  function openSortMenu(anchor) {
    const modes = ["Default", "Newest first", "Oldest first", "Reply count"];
    openPopup(anchor, modes.map((mode) => ({
      label: (state.settings.commentSort === mode ? "✓  " : "   ") + mode,
      action: async () => {
        const previousScroll = threadPane.scrollTop;
        state.settings.commentSort = mode;
        await saveSettings("commentSort");
        if (state.thread) {
          await renderThread(state.thread);
          threadPane.scrollTop = previousScroll;
        }
      },
    })));
  }


  const settingsUI=HarmoNovaContentSettings.create({
    get INCOGNITO(){return INCOGNITO;},
    get SETTINGS_HASH(){return SETTINGS_HASH;},
    get app(){return app;},
    get applySettings(){return applySettings;},
    get button(){return button;},
    get compact(){return compact;},
    get el(){return el;},
    get filterStories(){return filterStories;},
    get flushSettings(){return flushSettings;},
    get nitterInstanceHost(){return nitterInstanceHost;},
    get privateReader(){return privateReader;},
    get refreshStoryLinks(){return refreshStoryLinks;},
    get renderThread(){return renderThread;},
    get saveSettings(){return saveSettings;},
    get showToast(){return showToast;},
    get stateUI(){return stateUI;}
  },stateFacet(["blockedUsers","bookmarks","readIds","readerRevision","settings","thread","userTags"]));
  function openSettings(...args){return settingsUI.openSettings(...args);}
  function handleSettingsHash(...args){return settingsUI.handleSettingsHash(...args);}
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message?.type==="HARMONOVA_PREFERENCES_SNAPSHOT") {
      if(INCOGNITO || sender?.id!==chrome.runtime.id || message.value?.version!==1)return;
      const settings=HarmoNovaSettingsSchema.normalize(message.value.settings);
      for(const key of Object.keys(settings))if(!Object.hasOwn(stateUI.pendingSettings,key))state.settings[key]=settings[key];
      applySettings();return;
    }
    if (message?.type === "HARMONOVA_READER_SNAPSHOT") {
      if (INCOGNITO || sender?.id !== chrome.runtime.id ||
          !Number.isSafeInteger(message.revision) || message.revision <= state.readerRevision) return;
      state.readerRevision = message.revision;
      state.readIds = new Set(Array.isArray(message.readStoryIds) ? message.readStoryIds : []);
      state.bookmarks = new Set(Array.isArray(message.bookmarks) ? message.bookmarks : []);
      state.userTags = new Map(Object.entries(message.userTags || {}));
      state.blockedUsers = new Set(Array.isArray(message.blockedUsers) ? message.blockedUsers : []);
      state.seenTimes = new Map(Object.entries(message.seenTimes || {}).map(([id,ts]) => [Number(id),ts]));
      document.querySelectorAll(".story-card").forEach(card =>
        card.classList.toggle("is-read", state.readIds.has(Number(card.dataset.storyId))));
      document.querySelectorAll("[data-bookmark-id]").forEach(button =>
        button.classList.toggle("active", state.bookmarks.has(Number(button.dataset.bookmarkId))));
      return;
    }
    if (message?.type !== "HARMONOVA_OPEN_SETTINGS") return;
    if (!app) {
      sendResponse({ ok: false });
      return;
    }
    openSettings();
    sendResponse({ ok: true });
  });

  // Resolve bundled font URLs from Chrome's extension origin, not the HN page.
  // Best-effort unload flush. The browser may discard in-flight extension
  // messages during navigation; debounced autosave remains the primary path.
  window.addEventListener("pagehide", () => {
    flushSettings();
    feedScope.dispose();threadScope.dispose();abortSearch();stopActiveSummary();previewsUI.previewCleanupObserver.disconnect();previewsUI.previewObserver?.disconnect();
    for(const controller of previewsUI.previewCardScopes.values())controller.abort();previewsUI.previewCardScopes.clear();
    const composer = state.composer;
    composer?.scope?.dispose();
    if (!composer || composer.submitting || !composer.lastTrustedText?.trim()) return;
    clearTimeout(composer.draftTimer);
    composerUI.draftSet(composer, composer.lastTrustedText);
  });

  function installRoundedFont() {
    if (document.getElementById("harmonova-rounded-fonts")) return;
    const normal = chrome.runtime.getURL("fonts/GoogleSansFlexRounded-wght.ttf");
    const italic = chrome.runtime.getURL("fonts/GoogleSansFlexRounded-Italic-wght.ttf");
    const sheet = document.createElement("style");
    sheet.id = "harmonova-rounded-fonts";
    sheet.textContent = `
      @font-face {font-family:"Google Sans Flex Rounded";src:url("${normal}") format("truetype");font-style:normal;font-weight:100 900;font-display:swap;}
      @font-face {font-family:"Google Sans Flex Rounded";src:url("${italic}") format("truetype");font-style:italic;font-weight:100 900;font-display:swap;}
    `;
    (document.head || document.documentElement).appendChild(sheet);
  }

  function mount() {
    installRoundedFont();
    document.body.className = "harmonova-body";
    document.body.replaceChildren();
    app = el("div", "harmonova-app");
    feedPane = el("section", "feed-pane");
    const feedInner = el("div", "feed-inner");
    storyList = el("div", "story-list");
    if(state.recoveryNotice)setTimeout(()=>showToast("Some old reader data could not be recovered. Your source data is kept."),0);
    previewsUI.previewCleanupObserver.observe(storyList,{childList:true,subtree:true});
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
    // Phase 6: author links open the in-HarmoNova user panel (Firebase-backed)
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
    document.documentElement.classList.add("harmonova-ready");
    // Search shortcut is inert while editing text or when an overlay is open.
    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".harmonova-confirm-overlay, .settings-overlay, .harmonova-submit-overlay")) return;
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
    document.documentElement.classList.add("harmonova-hn");
    await loadPersistentState();
    const start = () => {
      // Phase 0.4: harvest the original HN DOM (session state) before mount
      // replaces the body, then mount at DOMContentLoaded.
      try { window.HarmoNovaHN?.harvest(document); } catch {}
      seedFeedVotes();
      window.HarmoNovaHN?.onSessionChange?.((session) => {
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
