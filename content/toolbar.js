// Isolated-world HarmoNovaContentToolbar module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  function applySettings() {
    if (!dependencies.app) return;
    dependencies.app.dataset.preview = model.settings.previewImages;
    dependencies.app.dataset.tint = String(model.settings.tintedCards);
    dependencies.app.dataset.favicons = String(model.settings.showFavicons);
    dependencies.app.dataset.points = String(model.settings.showPoints);
    dependencies.app.dataset.comments = String(model.settings.showComments);
    dependencies.app.dataset.index = String(model.settings.showIndex);
    dependencies.app.dataset.dimread = String(model.settings.dimRead);
    dependencies.app.dataset.commentStyle = model.settings.commentStyle;
    dependencies.app.dataset.depth = model.settings.depthMode;
    dependencies.app.dataset.roundedRails = String(model.settings.roundedRails);
    dependencies.app.dataset.continuousRails = String(model.settings.continuousRails);
    dependencies.app.dataset.headerTint = String(model.settings.headerTint);
    dependencies.app.dataset.headerImage = String(model.settings.headerImage);
    dependencies.app.dataset.compactPoints = String(model.settings.compactPoints);
    dependencies.app.dataset.showDomain = String(model.settings.showDomain !== false);
    dependencies.filterStories();
    const contentScale = Math.max(0.75, Math.min(1.25, Number(model.settings.contentScale || 100) / 100));
    const storySetting = Number(model.settings.storyTextSize || 17.5);
    const storyScale = storySetting / 17.5;
    const commentSetting = Number(model.settings.commentTextSize || 15);
    const commentScale = Math.max(0.7, Math.min(1.3, Number(model.settings.commentZoom ?? 100) / 100));
    dependencies.app.dataset.cardClickComments = String(model.settings.cardClickComments);
    // HarmoNova's semantic settings rendered at desktop density. The Android app's dp/sp
    // values are physically larger on a high-density display, so this preserves the same
    // visual scale on a standard-density laptop instead of shrinking the UI.
    dependencies.app.style.setProperty("--story-text-size", ((23 + (storySetting - 17.5) * 1.25) * contentScale) + "px");
    dependencies.app.style.setProperty("--story-index-size", ((22 + (storySetting - 17.5) * 1.2) * contentScale) + "px");
    dependencies.app.style.setProperty("--story-meta-size", (16.5 * storyScale * contentScale) + "px");
    dependencies.app.style.setProperty("--story-comment-count-size", (19 * storyScale * contentScale) + "px");
    dependencies.app.style.setProperty("--comment-text-size", ((19 + (commentSetting - 15) * 1.2) * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--comment-meta-size", (17 * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--comment-row-gap", (10 * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--comment-indent", (12 * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--comment-paragraph-gap", (14 * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--story-pad-y", (15 * contentScale) + "px");
    dependencies.app.style.setProperty("--story-pad-x", (13 * contentScale) + "px");
    dependencies.app.style.setProperty("--story-gap", (9 * contentScale) + "px");
    dependencies.app.style.setProperty("--comment-pad-y", (14 * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--comment-pad-x", (16 * contentScale * commentScale) + "px");
    dependencies.app.style.setProperty("--thread-title-size", (32 * contentScale) + "px");
    dependencies.app.style.setProperty("--thread-meta-size", (17 * contentScale) + "px");
    // Phase 7 part 3: appearance — surface theme and interface font live on
    // the document element so they reach the body background as well.
    const root = document.documentElement;
    const themes = ["amoled", "charcoal", "navy"];
    root.dataset.theme = themes.includes(model.settings.uiTheme) ? model.settings.uiTheme : "amoled";
    const fonts = ["rounded", "system", "serif"];
    root.dataset.font = fonts.includes(model.settings.uiFont) ? model.settings.uiFont : "rounded";
  }

  function showToast(message, options = {}) {
    let toast = document.querySelector(".harmonova-toast");
    if (!toast) {
      toast = dependencies.domUI.el("div", "harmonova-toast");
      document.body.appendChild(toast);
    }
    // Phase 4: toasts can carry one action button (e.g. Undo for hide).
    toast.replaceChildren();
    toast.appendChild(dependencies.domUI.el("span", "harmonova-toast-message", message));
    if (options.actionLabel && typeof options.onAction === "function") {
      const action = dependencies.domUI.el("button", "harmonova-toast-action", options.actionLabel);
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
    const toolbar = dependencies.domUI.el("header", "feed-toolbar");
    const row = dependencies.domUI.el("div", "feed-toolbar-row");
    const titleButton = dependencies.domUI.el("button", "feed-title-button");
    dependencies.feedTitle = dependencies.domUI.el("span", "feed-title", dependencies.FEEDS[model.feed].label);
    titleButton.append(dependencies.feedTitle, dependencies.domUI.svg("chevron", "feed-chevron"));
    titleButton.addEventListener("click", (event) => dependencies.openFeedMenu(event.currentTarget));
    // Phase 7: date picker for the Past Frontpages feed.
    dependencies.frontDateInput = dependencies.domUI.el("input", "feed-date-input");
    dependencies.frontDateInput.type = "date";
    dependencies.frontDateInput.value = dependencies.validFrontDate(model.settings.frontDate) || dependencies.frontDayOffset(1);
    dependencies.frontDateInput.max = dependencies.frontDayOffset(0);
    dependencies.frontDateInput.addEventListener("change", async () => {
      model.settings.frontDate = dependencies.validFrontDate(dependencies.frontDateInput.value) ? dependencies.frontDateInput.value : "";
      await dependencies.saveSettings("frontDate");
      dependencies.refreshFeed();
    });

    const actions = dependencies.domUI.el("div", "feed-toolbar-actions");
    const searchButton = dependencies.domUI.button("search", "Search");
    searchButton.addEventListener("click", dependencies.toggleSearch);
    const refreshButton = dependencies.domUI.button("refresh", "Refresh");
    refreshButton.addEventListener("click", dependencies.refreshFeed);
    const newPostButton = dependencies.domUI.button("plus", "New post");
    newPostButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // SEC-30
      dependencies.startNewPost();
    });
    const moreButton = dependencies.domUI.button("more", "More");
    moreButton.addEventListener("click", (event) => dependencies.openMoreMenu(event.currentTarget));
    dependencies.accountChip = dependencies.domUI.el("button", "account-chip");
    dependencies.accountChip.type = "button";
    dependencies.accountChip.id = "harmonova-account-chip";
    dependencies.accountChip.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // SEC-30: scripted clicks never open menus
      dependencies.openAccountMenu(event.currentTarget);
    });
    actions.append(searchButton, refreshButton, moreButton);
    dependencies.accountChip.classList.add("thread-secondary-action");
    row.append(titleButton, dependencies.frontDateInput, actions, dependencies.accountChip);
    dependencies.updateAccountChip();

    dependencies.updatedLabel = dependencies.domUI.el("div", "last-updated", "Last updated: " + dependencies.linksUI.formatTime(model.updatedAt));
    dependencies.searchWrap = dependencies.domUI.el("div", "feed-search");
    dependencies.searchInput = dependencies.domUI.el("input", "feed-search-input");
    dependencies.searchInput.type = "search";
    dependencies.searchInput.placeholder = "Search all Hacker News";
    dependencies.searchInput.autocomplete = "off";
    dependencies.searchInput.addEventListener("input", dependencies.onSearchInput);
    dependencies.searchInput.addEventListener("keydown", dependencies.onSearchKeydown);
    dependencies.searchInput.addEventListener("focus", dependencies.renderRecentSearches);
    const closeSearchButton = dependencies.domUI.button("close", "Close search", "feed-search-close");
    closeSearchButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      dependencies.closeSearch();
    });
    dependencies.searchWrap.append(dependencies.domUI.svg("search"), dependencies.searchInput, closeSearchButton);
    toolbar.append(row, dependencies.updatedLabel, dependencies.searchWrap, createSearchPanel());
    return toolbar;
  }

  // Search covers all of Hacker News. Recent searches stay in memory only.
  function createSearchPanel() {
    dependencies.searchPanel = dependencies.domUI.el("div", "hn-search-panel");

    dependencies.searchFilters = dependencies.domUI.el("div", "hn-search-filters");

    dependencies.searchChips = dependencies.domUI.el("div", "hn-search-chips");
    const chips = [
      ["story", "Stories"],
      ["comment", "Comments"],
      ["ask_hn", "Ask"],
      ["show_hn", "Show"],
      ["poll", "Polls"],
      ["front_page", "Front page"],
    ];
    for (const [tag, label] of chips) {
      const chip = dependencies.domUI.el("button", "hn-search-chip" + (model.search.tag === tag ? " active" : ""), label);
      chip.type = "button";
      chip.dataset.tag = tag;
      chip.addEventListener("click", () => {
        model.search.tag = tag;
        dependencies.searchChips.querySelectorAll(".hn-search-chip").forEach((node) => node.classList.toggle("active", node === chip));
        dependencies.queueGlobalSearch(0);
      });
      dependencies.searchChips.appendChild(chip);
    }

    const controls = dependencies.domUI.el("div", "hn-search-controls");
    const rangeSelect = dependencies.domUI.el("select", "hn-search-select");
    rangeSelect.setAttribute("aria-label", "Date range");
    for (const [value, label] of [["any", "Any time"], ["day", "Past 24 hours"], ["week", "Past week"], ["month", "Past month"], ["year", "Past year"]]) {
      const option = dependencies.domUI.el("option", "", label);
      option.value = value;
      if (value === model.search.range) option.selected = true;
      rangeSelect.appendChild(option);
    }
    rangeSelect.addEventListener("change", () => {
      model.search.range = rangeSelect.value;
      dependencies.queueGlobalSearch(0);
    });

    const sortSelect = dependencies.domUI.el("select", "hn-search-select");
    sortSelect.setAttribute("aria-label", "Sort");
    for (const [value, label] of [["relevance", "Relevance"], ["newest", "Newest"]]) {
      const option = dependencies.domUI.el("option", "", label);
      option.value = value;
      if (value === model.search.sort) option.selected = true;
      sortSelect.appendChild(option);
    }
    sortSelect.addEventListener("change", () => {
      model.search.sort = sortSelect.value;
      dependencies.queueGlobalSearch(0);
    });

    const pointsInput = dependencies.domUI.el("input", "hn-search-number");
    pointsInput.type = "number";
    pointsInput.min = "0";
    pointsInput.step = "1";
    pointsInput.placeholder = "Min points";
    pointsInput.setAttribute("aria-label", "Minimum points");
    pointsInput.value = model.search.minPoints;
    pointsInput.addEventListener("input", () => {
      model.search.minPoints = pointsInput.value;
      dependencies.queueGlobalSearch(0);
    });

    const authorInput = dependencies.domUI.el("input", "hn-search-text");
    authorInput.type = "text";
    authorInput.placeholder = "Author";
    authorInput.setAttribute("aria-label", "Author");
    authorInput.spellcheck = false;
    authorInput.autocomplete = "off";
    authorInput.value = model.search.author;
    authorInput.addEventListener("input", () => {
      model.search.author = authorInput.value;
      dependencies.queueGlobalSearch(0);
    });

    controls.append(rangeSelect, sortSelect, pointsInput, authorInput);
    dependencies.searchFilters.append(dependencies.searchChips, controls);

    dependencies.searchSubmit = dependencies.domUI.el("button", "hn-search-submit");
    dependencies.searchSubmit.type = "button";
    dependencies.searchSubmit.hidden = true;
    dependencies.searchSubmit.addEventListener("click", () => dependencies.runGlobalSearch(0));
    dependencies.searchRecent = dependencies.domUI.el("div", "hn-search-recent");
    dependencies.searchRecent.hidden = true;

    dependencies.searchPanel.append(dependencies.searchSubmit, dependencies.searchFilters, dependencies.searchRecent);
    return dependencies.searchPanel;
  }

  let activePopupDispose = () => {};
  window.addEventListener("pagehide",()=>activePopupDispose(),{once:true});
  function openPopup(anchor, items, pointer = null) {
    activePopupDispose();
    document.querySelector(".harmonova-popup")?.remove();
    const popup = dependencies.domUI.el("div", "harmonova-popup");
    const close = event => { if (!popup.contains(event.target)) dispose(); };
    const onKey = event => { if (event.key === "Escape") dispose(); };
    const dispose = () => {
      popup.remove();document.removeEventListener("pointerdown",close,true);document.removeEventListener("keydown",onKey,true);
      if(activePopupDispose===dispose)activePopupDispose=()=>{};
    };
    activePopupDispose=dispose;
    for (const item of items) {
      if (item.heading) {
        popup.appendChild(dependencies.domUI.el("div", "popup-heading", item.heading));
        continue;
      }
      const row = dependencies.domUI.el("button", "popup-item");
      row.type = "button";
      if (item.icon) {
        row.dataset.icon = item.icon;
        row.appendChild(dependencies.domUI.svg(item.icon));
      }
      row.appendChild(dependencies.domUI.el("span", "", item.label));
      row.addEventListener("click", (event) => {
        if (!event.isTrusted) return; // SEC-30: scripted menu clicks never act
        dispose();
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
    // Menus open on click/contextmenu or a completed long-press; the opening
    // pointerdown has already finished. Register immediately to avoid a lost
    // first outside click, and retire listeners on every close path.
    document.addEventListener("pointerdown",close,true);
    document.addEventListener("keydown",onKey,true);
  }

  // ---------------------------------------------------------------------------
// Phase 1: account chip (session chip, login hand-off, logout)
// ---------------------------------------------------------------------------

// SEC-02: the only login hand-off. The goto value is built from an allowlist of
// HarmoNova's own known paths — user-supplied query strings are never reflected.


    return Object.freeze({applySettings,
showToast,
createToolbar,
openPopup});
  }
  globalThis.HarmoNovaContentToolbar=Object.freeze({create});
})();
