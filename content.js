(() => {
  const HN_API = "https://hacker-news.firebaseio.com/v0";
  const ALGOLIA_API = "https://hn.algolia.com/api/v1";
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
    previewImages: "medium",
    tintedCards: true,
    showFavicons: true,
    showPoints: true,
    showComments: true,
    showIndex: false,
    dimRead: true,
    commentStyle: "outlined",
    depthMode: "colors",
    roundedRails: true,
    continuousRails: false,
    storyTextSize: 22,
    commentTextSize: 19,
    alwaysOpenComments: false,
    headerTint: true,
    headerImage: true,
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
    refresh: '<path d="M18.7 6.3A8 8 0 104 17l1.5-1.2A6 6 0 1118 9h-4V7h7v7h-2V9.3l-.3-3z"/>',
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
  };

  document.documentElement.classList.add("harmonic-hn");

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
  };

  const chromeGet = (defaults) => new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  const chromeSet = (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve));

  async function loadPersistentState() {
    const stored = await chromeGet({
      readStoryIds: [],
      harmonicBookmarks: [],
      harmonicSettings: DEFAULT_SETTINGS,
    });
    state.readIds = new Set(stored.readStoryIds || []);
    state.bookmarks = new Set(stored.harmonicBookmarks || []);
    state.settings = { ...DEFAULT_SETTINGS, ...(stored.harmonicSettings || {}) };
  }

  async function markRead(id) {
    if (!id) return;
    state.readIds.add(id);
    await chromeSet({ readStoryIds: [...state.readIds].slice(-1500) });
    document.querySelector('[data-story-id="' + id + '"]')?.classList.add("is-read");
  }

  async function toggleBookmark(id) {
    if (state.bookmarks.has(id)) state.bookmarks.delete(id);
    else state.bookmarks.add(id);
    await chromeSet({ harmonicBookmarks: [...state.bookmarks] });
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
      return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=128";
    } catch { return null; }
  };

  let app, feedPane, threadPane, storyList, feedTitle, updatedLabel, refreshPill, searchWrap, searchInput;

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
    app.style.setProperty("--story-text-size", state.settings.storyTextSize + "px");
    app.style.setProperty("--comment-text-size", state.settings.commentTextSize + "px");
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
    const moreButton = button("more", "More");
    moreButton.addEventListener("click", (event) => openMoreMenu(event.currentTarget));
    actions.append(searchButton, moreButton);
    row.append(titleButton, actions);

    updatedLabel = el("div", "last-updated", "Last updated: " + formatTime(state.updatedAt));
    searchWrap = el("div", "feed-search");
    searchInput = el("input", "feed-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search stories";
    searchInput.autocomplete = "off";
    searchInput.addEventListener("input", filterStories);
    searchWrap.append(svg("search"), searchInput);
    toolbar.append(row, updatedLabel, searchWrap);
    return toolbar;
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

  function openMoreMenu(anchor) {
    openPopup(anchor, [
      { label: "Refresh", icon: "refresh", action: refreshFeed },
      { label: "Settings", icon: "settings", action: openSettings },
      { label: "Open original Hacker News", icon: "external", action: () => window.open("https://news.ycombinator.com" + FEEDS[state.feed].path, "_blank", "noopener") },
    ]);
  }

  function toggleSearch() {
    searchWrap.classList.toggle("open");
    if (searchWrap.classList.contains("open")) searchInput.focus();
    else {
      searchInput.value = "";
      filterStories();
    }
  }

  function filterStories() {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".story-card").forEach((card) => {
      const hay = (card.dataset.search || "").toLowerCase();
      card.hidden = q && !hay.includes(q);
    });
  }

  async function switchFeed(key) {
    if (!FEEDS[key]) return;
    state.feed = key;
    feedTitle.textContent = FEEDS[key].label;
    history.pushState({ harmonicFeed: key }, "", FEEDS[key].path);
    await refreshFeed();
  }

  function createRefreshPill() {
    refreshPill = el("button", "refresh-pill");
    refreshPill.type = "button";
    refreshPill.append(svg("refresh"), el("span", "", "Tap to update"));
    refreshPill.addEventListener("click", refreshFeed);
    return refreshPill;
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
    title.href = story.url || ("https://news.ycombinator.com/item?id=" + story.id);
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.addEventListener("click", (event) => {
      event.stopPropagation();
      markRead(story.id);
      if (state.settings.alwaysOpenComments) setTimeout(() => selectStory(story, false), 0);
    });
    const rank = el("span", "story-index", (index + 1) + ".");
    main.append(rank, title, storyMeta(story));

    const preview = el("a", "story-preview");
    preview.href = story.url || ("https://news.ycombinator.com/item?id=" + story.id);
    preview.target = story.url ? "_blank" : "_self";
    preview.rel = "noopener noreferrer";
    preview.title = story.url ? "Open article" : "Open comments";
    const previewImg = el("img", "story-preview-image");
    previewImg.alt = "";
    preview.appendChild(previewImg);
    preview.addEventListener("click", (event) => {
      event.stopPropagation();
      markRead(story.id);
      if (!story.url) {
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
      if (story.url) {
        window.open(story.url, "_blank", "noopener");
        if (state.settings.alwaysOpenComments) selectStory(story, false);
      } else {
        selectStory(story);
      }
    });

    if (story.url) {
      getPreview(story).then((meta) => {
        const favicon = card.querySelector(".story-favicon");
        if (meta.favicon && favicon) favicon.src = meta.favicon;
        if (meta.image) {
          previewImg.src = meta.image;
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

  async function refreshFeed() {
    const generation = ++state.feedGeneration;
    storyList.replaceChildren(createLoading("Loading stories…"));
    const key = state.feed;
    try {
      const ids = await fetchJson(HN_API + "/" + FEEDS[key].endpoint + ".json");
      const stories = await fetchItems(ids.slice(0, 40));
      if (generation !== state.feedGeneration) return;
      state.stories = stories;
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

  const descendantCount = (comment) => (comment.children || []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
  const COLOR_RAILS = ["#5E97F6", "#9CCC65", "#FFB74D", "#BA68C8", "#4DD0E1", "#EF5350", "#FFD54F"];
  const MATERIAL_RAILS = ["#526A78", "#7B94A2", "#6D7F89", "#8DA5B2", "#9AAEBB", "#41545F", "#72828B"];

  function railColor(depth, author) {
    if (state.settings.depthMode === "none") return "transparent";
    if (state.settings.depthMode === "mono") return "#808080";
    const palette = state.settings.depthMode === "material" ? MATERIAL_RAILS : COLOR_RAILS;
    return palette[Math.abs(depth) % palette.length];
  }

  function renderComment(comment, depth = 0) {
    const row = el("div", "comment-row");
    row.dataset.depth = String(depth);
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
    for (const child of comment.children || []) children.appendChild(renderComment(child, depth + 1));
    if (children.childElementCount) row.appendChild(children);

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button") || window.getSelection()?.toString()) return;
      row.classList.toggle("collapsed");
    });
    return row;
  }

  function threadAction(iconName, label, action, options = {}) {
    const b = button(iconName, label, "thread-action");
    if (options.id) b.dataset.bookmarkId = options.id;
    if (options.active) b.classList.add("active");
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
    hero.href = item.url || ("https://news.ycombinator.com/item?id=" + item.id);
    hero.target = "_blank";
    hero.rel = "noopener";
    const heroImg = el("img", "thread-hero-image");
    heroImg.alt = "";
    hero.appendChild(heroImg);

    const headerBody = el("div", "thread-header-body");
    const title = el("a", "thread-title", item.title || "(untitled)");
    title.href = item.url || ("https://news.ycombinator.com/item?id=" + item.id);
    title.target = "_blank";
    title.rel = "noopener";
    const domain = el("a", "thread-domain");
    domain.href = item.url || ("https://news.ycombinator.com/item?id=" + item.id);
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
      threadAction("sparkle", "Story tools", () => showToast("Story tools are coming next")),
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
        { label: "Open on Hacker News", icon: "external", action: () => window.open("https://news.ycombinator.com/item?id=" + item.id, "_blank", "noopener") },
        { label: "Collapse all comments", action: () => setAllCommentsCollapsed(true) },
        { label: "Expand all comments", action: () => setAllCommentsCollapsed(false) },
        { label: "Settings", icon: "settings", action: openSettings },
      ]);
    });
    actions.appendChild(more);
    const article = threadAction("link", "Open article", () => window.open(title.href, "_blank", "noopener"), { active: false });
    article.classList.add("article-link-action");

    headerBody.append(title, domain, meta, article, actions);
    if (item.text) {
      const storyText = el("div", "thread-story-text");
      appendSanitizedHtml(storyText, item.text);
      headerBody.appendChild(storyText);
    }
    header.append(hero, headerBody);
    threadPane.appendChild(header);

    const total = (item.children || []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
    const heading = el("div", "comments-heading");
    heading.append(el("h2", "", total + " comments"));
    threadPane.appendChild(heading);

    const comments = el("section", "comments");
    for (const comment of item.children || []) comments.appendChild(renderComment(comment, 0));
    if (!comments.childElementCount) comments.appendChild(el("div", "empty-comments", "No comments yet."));
    threadPane.appendChild(comments);

    if (item.url) {
      const fakeStory = { id: item.id, url: item.url };
      const preview = await getPreview(fakeStory);
      if (state.selectedId !== item.id) return;
      if (preview.image) {
        heroImg.src = preview.image;
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

  function settingToggle(label, key, description) {
    const row = el("label", "setting-row");
    const text = el("span", "setting-copy");
    text.append(el("strong", "", label), el("small", "", description));
    const input = el("input", "setting-switch");
    input.type = "checkbox";
    input.checked = Boolean(state.settings[key]);
    input.addEventListener("change", async () => {
      state.settings[key] = input.checked;
      await chromeSet({ harmonicSettings: state.settings });
      applySettings();
      if (key === "tintedCards") document.querySelectorAll(".story-card").forEach((card) => card.classList.toggle("no-tint", !input.checked));
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
      await chromeSet({ harmonicSettings: state.settings });
      applySettings();
      if (state.thread && ["commentStyle", "depthMode"].includes(key)) renderThread(state.thread);
    });
    row.append(text, select);
    return row;
  }

  function openSettings() {
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
      settingSelect("Story text size", "storyTextSize", [[19, "Small"], [22, "Default"], [24, "Large"], [26, "Extra large"]])
    );

    const commentsSection = el("div", "settings-section");
    commentsSection.append(
      el("h3", "", "Comments"),
      settingSelect("Comment style", "commentStyle", [["outlined", "Outlined"], ["raised", "Raised"], ["standard", "Standard"], ["flat", "Flat"]]),
      settingSelect("Thread colors", "depthMode", [["colors", "Colors"], ["material", "Material"], ["mono", "Monochrome"], ["none", "None"]]),
      settingToggle("Rounded depth indicators", "roundedRails", "Round the thread indicator ends"),
      settingToggle("Continuous depth indicators", "continuousRails", "Continue ancestor rails through replies"),
      settingSelect("Comment text size", "commentTextSize", [[17, "Small"], [19, "Default"], [21, "Large"], [23, "Extra large"]])
    );

    const headerDisplaySection = el("div", "settings-section");
    headerDisplaySection.append(
      el("h3", "", "Header display"),
      settingToggle("Background tint", "headerTint", "Tint the discussion header from the story preview"),
      settingToggle("Preview image", "headerImage", "Show the story preview above the discussion title")
    );

    const behaviorSection = el("div", "settings-section");
    behaviorSection.append(
      el("h3", "", "Behavior"),
      settingToggle("Always open comments", "alwaysOpenComments", "Also load the discussion when an article link is opened"),
      el("p", "settings-note", "Article and comment links open in new tabs. Bookmarks and read state stay local to this Chrome profile.")
    );

    panel.append(header, storySection, commentsSection, headerDisplaySection, behaviorSection);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function mount() {
    document.body.className = "harmonic-body";
    document.body.replaceChildren();
    app = el("div", "harmonic-app");
    feedPane = el("section", "feed-pane");
    const feedInner = el("div", "feed-inner");
    storyList = el("div", "story-list");
    feedInner.append(createToolbar(), storyList);
    feedPane.append(feedInner, createRefreshPill());

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

    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(location.search);
      const id = location.pathname === "/item" ? Number(params.get("id")) : null;
      const feed = PATH_TO_FEED[location.pathname];
      if (id) {
        state.selectedId = id;
        document.body.classList.add("thread-active");
        loadThread(id);
      } else if (feed) {
        document.body.classList.remove("thread-active");
        state.feed = feed;
        feedTitle.textContent = FEEDS[feed].label;
        refreshFeed();
      }
    });
  }

  const supported = Boolean(PATH_TO_FEED[location.pathname]) || (location.pathname === "/item" && Number(new URLSearchParams(location.search).get("id")));
  if (!supported) return;

  loadPersistentState().then(() => {
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  });
})();
