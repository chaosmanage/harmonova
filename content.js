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


  const domUI=HarmoNovaContentDom.create({

  },undefined);

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


  const linksUI=HarmoNovaContentLinks.create({

  },stateFacet(["settings"]));

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
          const href = linksUI.safeHref(child.getAttribute("href") || "");
          if (!href) { copy(child, parent); continue; }
          out.href = linksUI.nitterize(href);
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
      toast = domUI.el("div", "harmonova-toast");
      document.body.appendChild(toast);
    }
    // Phase 4: toasts can carry one action button (e.g. Undo for hide).
    toast.replaceChildren();
    toast.appendChild(domUI.el("span", "harmonova-toast-message", message));
    if (options.actionLabel && typeof options.onAction === "function") {
      const action = domUI.el("button", "harmonova-toast-action", options.actionLabel);
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
    const toolbar = domUI.el("header", "feed-toolbar");
    const row = domUI.el("div", "feed-toolbar-row");
    const titleButton = domUI.el("button", "feed-title-button");
    feedTitle = domUI.el("span", "feed-title", FEEDS[state.feed].label);
    titleButton.append(feedTitle, domUI.svg("chevron", "feed-chevron"));
    titleButton.addEventListener("click", (event) => openFeedMenu(event.currentTarget));
    // Phase 7: date picker for the Past Frontpages feed.
    frontDateInput = domUI.el("input", "feed-date-input");
    frontDateInput.type = "date";
    frontDateInput.value = validFrontDate(state.settings.frontDate) || frontDayOffset(1);
    frontDateInput.max = frontDayOffset(0);
    frontDateInput.addEventListener("change", async () => {
      state.settings.frontDate = validFrontDate(frontDateInput.value) ? frontDateInput.value : "";
      await saveSettings("frontDate");
      refreshFeed();
    });

    const actions = domUI.el("div", "feed-toolbar-actions");
    const searchButton = domUI.button("search", "Search");
    searchButton.addEventListener("click", toggleSearch);
    const refreshButton = domUI.button("refresh", "Refresh");
    refreshButton.addEventListener("click", refreshFeed);
    const newPostButton = domUI.button("plus", "New post");
    newPostButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // SEC-30
      startNewPost();
    });
    const moreButton = domUI.button("more", "More");
    moreButton.addEventListener("click", (event) => openMoreMenu(event.currentTarget));
    accountChip = domUI.el("button", "account-chip");
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

    updatedLabel = domUI.el("div", "last-updated", "Last updated: " + linksUI.formatTime(state.updatedAt));
    searchWrap = domUI.el("div", "feed-search");
    searchInput = domUI.el("input", "feed-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search all Hacker News";
    searchInput.autocomplete = "off";
    searchInput.addEventListener("input", onSearchInput);
    searchInput.addEventListener("keydown", onSearchKeydown);
    searchInput.addEventListener("focus", renderRecentSearches);
    const closeSearchButton = domUI.button("close", "Close search", "feed-search-close");
    closeSearchButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      closeSearch();
    });
    searchWrap.append(domUI.svg("search"), searchInput, closeSearchButton);
    toolbar.append(row, updatedLabel, searchWrap, createSearchPanel());
    return toolbar;
  }

  // Search covers all of Hacker News. Recent searches stay in memory only.
  function createSearchPanel() {
    searchPanel = domUI.el("div", "hn-search-panel");

    searchFilters = domUI.el("div", "hn-search-filters");

    searchChips = domUI.el("div", "hn-search-chips");
    const chips = [
      ["story", "Stories"],
      ["comment", "Comments"],
      ["ask_hn", "Ask"],
      ["show_hn", "Show"],
      ["poll", "Polls"],
      ["front_page", "Front page"],
    ];
    for (const [tag, label] of chips) {
      const chip = domUI.el("button", "hn-search-chip" + (state.search.tag === tag ? " active" : ""), label);
      chip.type = "button";
      chip.dataset.tag = tag;
      chip.addEventListener("click", () => {
        state.search.tag = tag;
        searchChips.querySelectorAll(".hn-search-chip").forEach((node) => node.classList.toggle("active", node === chip));
        queueGlobalSearch(0);
      });
      searchChips.appendChild(chip);
    }

    const controls = domUI.el("div", "hn-search-controls");
    const rangeSelect = domUI.el("select", "hn-search-select");
    rangeSelect.setAttribute("aria-label", "Date range");
    for (const [value, label] of [["any", "Any time"], ["day", "Past 24 hours"], ["week", "Past week"], ["month", "Past month"], ["year", "Past year"]]) {
      const option = domUI.el("option", "", label);
      option.value = value;
      if (value === state.search.range) option.selected = true;
      rangeSelect.appendChild(option);
    }
    rangeSelect.addEventListener("change", () => {
      state.search.range = rangeSelect.value;
      queueGlobalSearch(0);
    });

    const sortSelect = domUI.el("select", "hn-search-select");
    sortSelect.setAttribute("aria-label", "Sort");
    for (const [value, label] of [["relevance", "Relevance"], ["newest", "Newest"]]) {
      const option = domUI.el("option", "", label);
      option.value = value;
      if (value === state.search.sort) option.selected = true;
      sortSelect.appendChild(option);
    }
    sortSelect.addEventListener("change", () => {
      state.search.sort = sortSelect.value;
      queueGlobalSearch(0);
    });

    const pointsInput = domUI.el("input", "hn-search-number");
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

    const authorInput = domUI.el("input", "hn-search-text");
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

    searchSubmit = domUI.el("button", "hn-search-submit");
    searchSubmit.type = "button";
    searchSubmit.hidden = true;
    searchSubmit.addEventListener("click", () => runGlobalSearch(0));
    searchRecent = domUI.el("div", "hn-search-recent");
    searchRecent.hidden = true;

    searchPanel.append(searchSubmit, searchFilters, searchRecent);
    return searchPanel;
  }

  function openPopup(anchor, items, pointer = null) {
    document.querySelector(".harmonova-popup")?.remove();
    const popup = domUI.el("div", "harmonova-popup");
    for (const item of items) {
      if (item.heading) {
        popup.appendChild(domUI.el("div", "popup-heading", item.heading));
        continue;
      }
      const row = domUI.el("button", "popup-item");
      row.type = "button";
      if (item.icon) {
        row.dataset.icon = item.icon;
        row.appendChild(domUI.svg(item.icon));
      }
      row.appendChild(domUI.el("span", "", item.label));
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

  const actionsUI=HarmoNovaContentActions.create({
    get ALGOLIA_API(){return ALGOLIA_API;},
    get FEEDS(){return FEEDS;},
    get HN_API(){return HN_API;},
    get abortSearch(){return abortSearch;},
    get accountChip(){return accountChip;},
    get appendSanitizedHtml(){return appendSanitizedHtml;},
    get applyCardVotedState(){return applyCardVotedState;},
    get closeComposer(){return closeComposer;},
    get compact(){return linksUI.compact;},
    get composerUI(){return composerUI;},
    get createLoading(){return createLoading;},
    get createStoryCard(){return createStoryCard;},
    get el(){return domUI.el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get fetchItems(){return fetchItems;},
    get fetchJson(){return fetchJson;},
    get loadThread(){return loadThread;},
    get openConfirmDialog(){return openConfirmDialog;},
    get openOriginalHackerNews(){return openOriginalHackerNews;},
    get openPopup(){return openPopup;},
    get refreshFeed(){return refreshFeed;},
    get relativeTime(){return linksUI.relativeTime;},
    get safeHref(){return linksUI.safeHref;},
    get showToast(){return showToast;},
    get storyList(){return storyList;},
    get svg(){return domUI.svg;},
    get threadPane(){return threadPane;},
    get threadScope(){return threadScope;}
  },stateFacet(["bookmarks","composer","feed","feedVotes","itemState","itemStateTimer","itemStateToken","listView","logoutPending","pollOptions","pollOptionsRenderedKey","search","selectedId"]));
  function updateAccountChip(...args){return actionsUI.updateAccountChip(...args);}
  function openAccountMenu(...args){return actionsUI.openAccountMenu(...args);}
  function seedFeedVotes(...args){return actionsUI.seedFeedVotes(...args);}
  function requireTrustedEvent(...args){return actionsUI.requireTrustedEvent(...args);}
  function cancelItemState(...args){return actionsUI.cancelItemState(...args);}
  function scheduleItemState(...args){return actionsUI.scheduleItemState(...args);}
  function updateThreadVoteUi(...args){return actionsUI.updateThreadVoteUi(...args);}
  function handleStoryVote(...args){return actionsUI.handleStoryVote(...args);}
  function handleCommentVote(...args){return actionsUI.handleCommentVote(...args);}
  function handleStoryFavorite(...args){return actionsUI.handleStoryFavorite(...args);}
  function handleStoryHide(...args){return actionsUI.handleStoryHide(...args);}
  function confirmFlagItem(...args){return actionsUI.confirmFlagItem(...args);}
  function hideFromFeed(...args){return actionsUI.hideFromFeed(...args);}
  function addBookmarksToFavorites(...args){return actionsUI.addBookmarksToFavorites(...args);}
  function startNewPost(...args){return actionsUI.startNewPost(...args);}
  function renderThreadListItem(...args){return actionsUI.renderThreadListItem(...args);}
  function openUserPanel(...args){return actionsUI.openUserPanel(...args);}
  function loadPollOptions(...args){return actionsUI.loadPollOptions(...args);}
  function renderPollOptions(...args){return actionsUI.renderPollOptions(...args);}
  function updateFeedVoteBadges(...args){return actionsUI.updateFeedVoteBadges(...args);}
  const composerUI=HarmoNovaContentComposer.create({
    get INCOGNITO(){return INCOGNITO;},
    get el(){return domUI.el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get openOriginalHackerNews(){return openOriginalHackerNews;},
    get privateReader(){return privateReader;},
    get renderComment(){return renderComment;},
    get showToast(){return showToast;},
    get stateUI(){return stateUI;},
    get svg(){return domUI.svg;},
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
    const karma = session?.karma == null ? "" : " · " + linksUI.compact(session.karma) + " karma";
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
    get compact(){return linksUI.compact;},
    get createLoading(){return createLoading;},
    get createStoryCard(){return createStoryCard;},
    get domainOf(){return linksUI.domainOf;},
    get el(){return domUI.el;},
    get feedTitle(){return feedTitle;},
    get previewsUI(){return previewsUI;},
    get refreshFeed(){return refreshFeed;},
    get relativeTime(){return linksUI.relativeTime;},
    get saveSettings(){return saveSettings;},
    get searchInput(){return searchInput;},
    get searchPanel(){return searchPanel;},
    get searchRecent(){return searchRecent;},
    get searchSubmit(){return searchSubmit;},
    get searchWrap(){return searchWrap;},
    get selectStory(){return selectStory;},
    get showToast(){return showToast;},
    get storyList(){return storyList;},
    get svg(){return domUI.svg;},
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

  const feedUI=HarmoNovaContentFeed.create({
    get FEEDS(){return FEEDS;},
    get FEED_BATCH_SIZE(){return FEED_BATCH_SIZE;},
    get FEED_ORDER_DEFAULT(){return FEED_ORDER_DEFAULT;},
    get HN_API(){return HN_API;},
    get abortSearch(){return abortSearch;},
    get archiveHref(){return linksUI.archiveHref;},
    get articleHref(){return linksUI.articleHref;},
    get button(){return domUI.button;},
    get compact(){return linksUI.compact;},
    get domainOf(){return linksUI.domainOf;},
    get el(){return domUI.el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get feedScope(){return feedScope;},set feedScope(value){feedScope=value;},
    get fetchItems(){return fetchItems;},
    get fetchJson(){return fetchJson;},
    get filterStories(){return filterStories;},
    get formatTime(){return linksUI.formatTime;},
    get frontDateInput(){return frontDateInput;},
    get hashTint(){return linksUI.hashTint;},
    get hideDomain(){return hideDomain;},
    get hideFromFeed(){return hideFromFeed;},
    get isJobStory(){return isJobStory;},
    get markRead(){return markRead;},
    get nitterize(){return linksUI.nitterize;},
    get openArchive(){return linksUI.openArchive;},
    get openPopup(){return openPopup;},
    get previewsUI(){return previewsUI;},
    get renderThreadListItem(){return renderThreadListItem;},
    get requireTrustedEvent(){return requireTrustedEvent;},
    get safeImageSrc(){return linksUI.safeImageSrc;},
    get saveSettings(){return saveSettings;},
    get selectStory(){return selectStory;},
    get setStoryLink(){return linksUI.setStoryLink;},
    get showToast(){return showToast;},
    get storyList(){return storyList;},
    get storyMeta(){return storyMeta;},
    get svg(){return domUI.svg;},
    get toggleBookmark(){return toggleBookmark;},
    get updateAccountChip(){return updateAccountChip;},
    get updateFeedVoteBadges(){return updateFeedVoteBadges;},
    get updatedLabel(){return updatedLabel;}
  },stateFacet(["bookmarks","feed","feedCursor","feedGeneration","feedIds","feedVotes","hasMoreStories","listView","loadingMore","previewById","readIds","search","selectedId","selectedStory","settings","stories","updatedAt"]));
  function createStoryCard(...args){return feedUI.createStoryCard(...args);}
  function applyCardVotedState(...args){return feedUI.applyCardVotedState(...args);}
  function createLoading(...args){return feedUI.createLoading(...args);}
  function loadMoreStories(...args){return feedUI.loadMoreStories(...args);}
  function frontDayOffset(...args){return feedUI.frontDayOffset(...args);}
  function validFrontDate(...args){return feedUI.validFrontDate(...args);}
  function visibleFeeds(...args){return feedUI.visibleFeeds(...args);}
  function openManageFeeds(...args){return feedUI.openManageFeeds(...args);}
  function refreshFeed(...args){return feedUI.refreshFeed(...args);}
  const commentsUI=HarmoNovaContentComments.create({
    get appendSanitizedHtml(){return appendSanitizedHtml;},
    get confirmFlagItem(){return confirmFlagItem;},
    get el(){return domUI.el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get handleCommentVote(){return handleCommentVote;},
    get hashTint(){return linksUI.hashTint;},
    get openComposer(){return openComposer;},
    get openConfirmDialog(){return openConfirmDialog;},
    get openOriginalHackerNews(){return openOriginalHackerNews;},
    get openPopup(){return openPopup;},
    get openUserPanel(){return openUserPanel;},
    get persistBlockedUsers(){return persistBlockedUsers;},
    get persistUserTags(){return persistUserTags;},
    get relativeTime(){return linksUI.relativeTime;},
    get renderThread(){return renderThread;},
    get showToast(){return showToast;},
    get svg(){return domUI.svg;},
    get toggleBookmark(){return toggleBookmark;}
  },stateFacet(["blockedUsers","bookmarks","itemState","seenTimes","selectedId","settings","thread","threadAuthor","userTags"]));
  function renderComment(...args){return commentsUI.renderComment(...args);}
  const summaryUI=HarmoNovaContentSummary.create({
    get el(){return domUI.el;},
    get openSettings(){return openSettings;},
    get safeHref(){return linksUI.safeHref;},
    get showToast(){return showToast;},
    get stateUI(){return stateUI;},
    get svg(){return domUI.svg;}
  },stateFacet(["activeSummary","aiSelectionIntent","selectedId","selectedStory","summaries","summaryGeneration","thread"]));
  function summaryStateFor(...args){return summaryUI.summaryStateFor(...args);}
  function updateSummarySurface(...args){return summaryUI.updateSummarySurface(...args);}
  function createSummarySurface(...args){return summaryUI.createSummarySurface(...args);}
  function stopActiveSummary(...args){return summaryUI.stopActiveSummary(...args);}
  function startStorySummary(...args){return summaryUI.startStorySummary(...args);}

  const readerUI=HarmoNovaContentReader.create({
    get ALGOLIA_API(){return ALGOLIA_API;},
    get app(){return app;},
    get appendSanitizedHtml(){return appendSanitizedHtml;},
    get archiveHref(){return linksUI.archiveHref;},
    get articleHref(){return linksUI.articleHref;},
    get button(){return domUI.button;},
    get cancelItemState(){return cancelItemState;},
    get closeComposer(){return closeComposer;},
    get commentsUI(){return commentsUI;},
    get compact(){return linksUI.compact;},
    get confirmFlagItem(){return confirmFlagItem;},
    get createLoading(){return createLoading;},
    get createSummarySurface(){return createSummarySurface;},
    get disableHarmoNova(){return disableHarmoNova;},
    get domainOf(){return linksUI.domainOf;},
    get el(){return domUI.el;},
    get encodeURIComponent(){return encodeURIComponent;},
    get fetchJson(){return fetchJson;},
    get handleStoryFavorite(){return handleStoryFavorite;},
    get handleStoryHide(){return handleStoryHide;},
    get handleStoryVote(){return handleStoryVote;},
    get loadPollOptions(){return loadPollOptions;},
    get markRead(){return markRead;},
    get mergeConfirmedComments(){return mergeConfirmedComments;},
    get openAccountMenu(){return openAccountMenu;},
    get openArchive(){return linksUI.openArchive;},
    get openComposer(){return openComposer;},
    get openOriginalHackerNews(){return openOriginalHackerNews;},
    get openPopup(){return openPopup;},
    get openSettings(){return openSettings;},
    get openUserPanel(){return openUserPanel;},
    get persistSeenTimes(){return persistSeenTimes;},
    get previewsUI(){return previewsUI;},
    get relativeTime(){return linksUI.relativeTime;},
    get renderComment(){return renderComment;},
    get renderPollOptions(){return renderPollOptions;},
    get safeImageSrc(){return linksUI.safeImageSrc;},
    get saveSettings(){return saveSettings;},
    get scheduleItemState(){return scheduleItemState;},
    get setStoryLink(){return linksUI.setStoryLink;},
    get showToast(){return showToast;},
    get startStorySummary(){return startStorySummary;},
    get stopActiveSummary(){return stopActiveSummary;},
    get summaryStateFor(){return summaryStateFor;},
    get svg(){return domUI.svg;},
    get threadPane(){return threadPane;},
    get threadScope(){return threadScope;},set threadScope(value){threadScope=value;},
    get updateSummarySurface(){return updateSummarySurface;},
    get updateThreadVoteUi(){return updateThreadVoteUi;}
  },stateFacet(["aiSelectionIntent","feedVotes","itemState","pollOptions","pollOptionsRenderedKey","seenTimes","selectedId","selectedStory","settings","stories","thread","threadAuthor","threadOpOnly"]));
  function createThreadPlaceholder(...args){return readerUI.createThreadPlaceholder(...args);}
  function selectStory(...args){return readerUI.selectStory(...args);}
  function loadThread(...args){return readerUI.loadThread(...args);}
  function renderThread(...args){return readerUI.renderThread(...args);}
  const settingsUI=HarmoNovaContentSettings.create({
    get INCOGNITO(){return INCOGNITO;},
    get SETTINGS_HASH(){return SETTINGS_HASH;},
    get app(){return app;},
    get applySettings(){return applySettings;},
    get button(){return domUI.button;},
    get compact(){return linksUI.compact;},
    get el(){return domUI.el;},
    get filterStories(){return filterStories;},
    get flushSettings(){return flushSettings;},
    get nitterInstanceHost(){return linksUI.nitterInstanceHost;},
    get privateReader(){return privateReader;},
    get refreshStoryLinks(){return linksUI.refreshStoryLinks;},
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
    app = domUI.el("div", "harmonova-app");
    feedPane = domUI.el("section", "feed-pane");
    const feedInner = domUI.el("div", "feed-inner");
    storyList = domUI.el("div", "story-list");
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

    threadPane = domUI.el("section", "thread-pane");
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
