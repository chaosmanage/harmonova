// Isolated-world HarmoNovaContentSearch module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  function toggleSearch() {
    const opening = !dependencies.searchWrap.classList.contains("open");
    dependencies.searchWrap.classList.toggle("open");
    if (opening) {
      dependencies.searchInput.focus();
      renderRecentSearches();
    } else {
      closeSearch();
    }
    syncSearchPanelSpace();
  }

  // The search panel overlays the list (the toolbar is an overlay by design);
  // reserve scroll space so results never hide behind it or lose clicks.
  function syncSearchPanelSpace() {
    if (!dependencies.storyList) return;

    // Header, search and results are in layout flow; no calculated gap.
  }

  function closeSearch() {
    abortSearch();
    dependencies.searchInput.value = "";
    if (model.search.active) {
      model.search.active = false;
      restoreFeedList();
    }
    filterStories();
    dependencies.searchWrap.classList.remove("open");
    dependencies.searchSubmit.hidden = true;
    dependencies.searchRecent.hidden = true;
    syncSearchPanelSpace();
  }

  function abortSearch() {
    clearTimeout(model.search.debounceTimer);
    model.search.debounceTimer = 0;
    model.search.controller?.abort();
    model.search.controller = null;
  }

  function onSearchInput() {
    if (model.search.active) {
      abortSearch();
      model.search.active = false;
      restoreFeedList();
    }
    renderRecentSearches();
  }

  function onSearchKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && model.search.active) {
      const cards = [...dependencies.storyList.querySelectorAll(".hn-search-results > .story-card, .hn-search-results > .comment-hit")];
      if (cards.length) {
        event.preventDefault();
        model.search.keyboardIndex = event.key === "ArrowDown"
          ? (model.search.keyboardIndex + 1) % cards.length
          : (model.search.keyboardIndex + cards.length) % cards.length;
        cards.forEach((node, index) => node.classList.toggle("search-keyboard-selected", index === model.search.keyboardIndex));
        cards[model.search.keyboardIndex].scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const current = model.search.active && model.search.keyboardIndex >= 0
        ? model.search.hits[model.search.keyboardIndex] : null;
      if (current) {
        if (current.kind === "comment") openThreadAtComment(current.storyId ?? current.story_id, current.id);
        else dependencies.selectStory(current.id);
        closeSearch();
      } else {
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

  function isEligibleStory(story) {
    if (!story || !Number.isSafeInteger(story.id) || story.id <= 0) return false;
    if (model.settings.hideRead && model.readIds.has(story.id)) return false;
    if (["future", "immediate"].includes(model.settings.scrolledStoryBehavior) && model.skippedIds.has(story.id)) return false;
    const domain = dependencies.domainOf(story.url).toLowerCase();
    if (parseListSetting(model.settings.hiddenDomains).some(value => domain.endsWith(value))) return false;
    const haystack = ((story.title || "") + " " + domain).toLowerCase();
    if (parseListSetting(model.settings.hiddenKeywords).some(value => haystack.includes(value))) return false;
    if (model.settings.hideJobs && isJobStory(story)) return false;
    return true;
  }

  function filterStories() {
    if (model.search.active) return;
    const domains = parseListSetting(model.settings.hiddenDomains);
    const keywords = parseListSetting(model.settings.hiddenKeywords);
    const hideJobs = model.settings.hideJobs;
    const hideRead = model.settings.hideRead;
    document.querySelectorAll(".story-card").forEach((card) => {
      const hay = (card.dataset.search || "").toLowerCase();
      let hidden = false;
      if (!hidden && domains.length) hidden = domains.some((entry) => (card.dataset.domain || "").endsWith(entry));
      if (!hidden && keywords.length) hidden = keywords.some((entry) => hay.includes(entry));
      if (!hidden && hideJobs && card.dataset.type === "job") hidden = true;
      if (!hidden && hideRead && card.classList.contains("is-read")) hidden = true;
      // Never remove a currently displayed story merely because its skip status
      // changed. 'future' hides it on the next feed construction instead.
      card.hidden = hidden;
    });
  }

  // ---------------------------------------------------------------------------
  // Site-wide search (Algolia via hn-search.js)
  // ---------------------------------------------------------------------------

  const RANGE_SECONDS = { day: 86400, week: 604800, month: 2592000, year: 31536000 };
  const AUTHOR_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

  function buildSearchOptions(page) {
    const author = model.search.author.trim();
    const authorValid = !author || AUTHOR_PATTERN.test(author);
    const tags = [model.search.tag];
    if (authorValid && author) tags.push("author_" + author);
    const options = {
      query: model.search.query || dependencies.searchInput.value,
      tags,
      sort: model.search.sort,
      page,
      hitsPerPage: 30,
    };
    const range = RANGE_SECONDS[model.search.range];
    if (range) options.since = Math.floor(Date.now() / 1000) - range;
    const minPoints = model.search.minPoints.trim();
    if (/^\d+$/.test(minPoints)) options.minPoints = Number(minPoints);
    return { options, authorValid };
  }

  function queueGlobalSearch(page) {
    clearTimeout(model.search.debounceTimer);
    if (model.search.query) model.search.debounceTimer = setTimeout(() => runGlobalSearch(page, true), 300);
  }

  async function runGlobalSearch(page, reuseQuery = false) {
    clearTimeout(model.search.debounceTimer);
    model.search.debounceTimer = 0;
    const query = reuseQuery ? model.search.query : dependencies.searchInput.value.trim();
    if (query.length < 2) {
      if (model.search.active) {
        model.search.active = false;
        restoreFeedList();
      }
      return;
    }
    abortSearch();
    const controller = new AbortController();
    model.search.controller = controller;
    const seq = ++model.search.seq;
    if (!model.search.active) model.search.feedScrollTop = dependencies.storyList.scrollTop;
    model.search.query = query;
    const { options, authorValid } = buildSearchOptions(page);
    model.search.active = true;
    dependencies.searchSubmit.hidden = true;
    pushRecentSearch(query);

    if (page === 0) {
      model.search.keyboardIndex = -1;
      dependencies.storyList.classList.add("search-results");
      const existing = dependencies.storyList.querySelector(".hn-search-results");
      if (existing) existing.classList.add("search-refining");
      else dependencies.storyList.replaceChildren(dependencies.createLoading("Searching Hacker News…"));
    }

    const result = window.HarmoNovaSearch
      ? await window.HarmoNovaSearch.runSearch(options, { signal: controller.signal })
      : { hits: [], page: 0, nbPages: 1, error: "The search client is unavailable" };
    if (result.aborted || controller.signal.aborted || seq !== model.search.seq) return;
    model.search.controller = null;

    if (result.error) {
      renderSearchError(result.error);
      return;
    }
    if (page === 0) {
      model.search.hits = result.hits;
      model.search.page = result.page;
      model.search.nbPages = result.nbPages;
      renderSearchResults({ authorValid });
    } else {
      model.search.hits.push(...result.hits);
      model.search.page = result.page;
      model.search.nbPages = result.nbPages;
      renderSearchResults({ authorValid });
    }
  }

  function renderHighlight(target, value) {
    // SEC-40: highlights arrive pre-tokenized as plain-text segments; hostile
    // markup can only ever render as text.
    for (const segment of window.HarmoNovaSearch.buildHighlightSegments(value)) {
      target.appendChild(dependencies.el("span", segment.highlighted ? "search-hit-em" : "", segment.text));
    }
  }

  function renderSearchError(message) {
    dependencies.storyList.classList.add("search-results");
    const fail = dependencies.el("div", "harmonova-error");
    fail.append(dependencies.el("strong", "", "Search failed"), dependencies.el("span", "", message));
    const retry = dependencies.el("button", "hn-search-retry", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => runGlobalSearch(0));
    fail.appendChild(retry);
    dependencies.storyList.replaceChildren(fail);
  }

  function renderSearchResults({ authorValid }) {
    dependencies.storyList.classList.add("search-results");
    const container = dependencies.el("div", "hn-search-results");
    const header = dependencies.el("div", "hn-search-header");
    const title = dependencies.el("strong", "", "Results for “" + model.search.query + "”");
    const storyCount = model.search.hits.filter((hit) => hit.kind === "story").length;
    const commentCount = model.search.hits.length - storyCount;
    const meta = dependencies.el("span", "hn-search-meta",
      storyCount + " stories · " + commentCount + " comments · page " + (model.search.page + 1) + " of " + model.search.nbPages);
    header.append(title, meta);
    if (!authorValid) {
      header.appendChild(dependencies.el("span", "hn-search-hint", "Author names may only contain letters, numbers, dashes, and underscores — the author filter was skipped."));
    }
    container.appendChild(header);
    let storyIndex = 0;
    for (const hit of model.search.hits) {
      if (hit.kind === "story") {
        container.appendChild(dependencies.createStoryCard({
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
    if (!model.search.hits.length) {
      container.appendChild(dependencies.el("div", "hn-search-empty", "No results for “" + model.search.query + "”. Try fewer words or remove a filter."));
    }
    if (model.search.page + 1 < model.search.nbPages) {
      const more = dependencies.el("button", "hn-search-more", "Load more results");
      more.type = "button";
      more.addEventListener("click", () => runGlobalSearch(model.search.page + 1));
      container.appendChild(more);
    }
    dependencies.storyList.replaceChildren(container);
    // Keep pagination explicit; opening global search must not automatically
    // consume later pages before the user chooses to load more results.
  }

  function createCommentHitCard(hit) {
    const card = dependencies.el("article", "comment-hit");
    const storyTitle = dependencies.el("button", "comment-hit-story");
    storyTitle.type = "button";
    const storyLine = dependencies.el("span", "comment-hit-story-text");
    renderHighlight(storyLine, hit.titleHighlight || hit.story_title || hit.title || "(untitled story)");
    storyTitle.append(dependencies.svg("comment", "comment-hit-icon"), storyLine);
    const meta = dependencies.el("div", "comment-hit-meta");
    meta.append(
      dependencies.el("span", "comment-hit-author", hit.author || "[deleted]"),
      dependencies.el("span", "meta-dot", "•"),
      dependencies.el("span", "meta-age", dependencies.relativeTime(hit.created_at_i || 0))
    );
    const excerpt = dependencies.el("div", "comment-hit-excerpt");
    renderHighlight(excerpt, hit.highlight || hit.commentText || "");
    const open = dependencies.el("button", "comment-hit-open", "Open comment");
    open.type = "button";
    card.append(storyTitle, meta, excerpt, open);
    const openComment = () => openThreadAtComment(hit.storyId ?? hit.story_id, hit.id);
    storyTitle.addEventListener("click", openComment);
    open.addEventListener("click", openComment);
    return card;
  }

  function openThreadAtComment(storyId, commentId) {
    if (!Number.isInteger(storyId) || storyId <= 0) return;
    dependencies.selectStory(storyId);
    const target = String(commentId);
    const deadline = Date.now() + 8000;
    const step = () => {
      const row = dependencies.threadPane.querySelector('[data-comment-id="' + target + '"]');
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
      if (Date.now() < deadline && model.selectedId === storyId) requestAnimationFrame(step);
      else if (model.selectedId === storyId) dependencies.showToast("That comment is no longer in the thread");
    };
    requestAnimationFrame(step);
  }

  function restoreFeedList() {
    dependencies.storyList.classList.remove("search-results");
    dependencies.storyList.replaceChildren();
    model.stories.forEach((story, index) => dependencies.storyList.appendChild(dependencies.createStoryCard(story, index)));
    filterStories();
    if (Number.isFinite(model.search.feedScrollTop)) dependencies.storyList.scrollTop = model.search.feedScrollTop;
  }

  function pushRecentSearch(query) {
    const recent = model.search.recent.filter((term) => term !== query);
    recent.unshift(query);
    model.search.recent = recent.slice(0, 8);
  }

  function renderRecentSearches() {
    if (!dependencies.searchRecent) return;
    const query = dependencies.searchInput.value.trim();
    dependencies.searchSubmit.hidden = !dependencies.searchWrap.classList.contains("open") || query.length < 2 || model.search.active;
    dependencies.searchSubmit.textContent = 'Search Hacker News for “' + query.slice(0, 200) + '” ↵';
    const searchOpen = dependencies.searchWrap.classList.contains("open");
    const showRecents = searchOpen && !dependencies.searchInput.value.trim() && model.search.recent.length > 0;
    dependencies.searchRecent.hidden = !showRecents;
    dependencies.searchRecent.replaceChildren();
    if (showRecents) {
      dependencies.searchRecent.appendChild(dependencies.el("div", "hn-search-recent-label", "Recent searches"));
      for (const term of model.search.recent) {
        const row = dependencies.el("button", "hn-search-recent-item", term);
        row.type = "button";
        row.addEventListener("click", () => {
          dependencies.searchInput.value = term;
          runGlobalSearch(0);
        });
        dependencies.searchRecent.appendChild(row);
      }
      const clear = dependencies.el("button", "hn-search-recent-clear", "Clear recent searches");
      clear.type = "button";
      clear.addEventListener("click", () => {
        model.search.recent = [];
        renderRecentSearches();
      });
      dependencies.searchRecent.appendChild(clear);
    }
    syncSearchPanelSpace();
  }

  async function switchFeed(key) {
    if (!dependencies.FEEDS[key]) return;
    model.feed = key;
    dependencies.feedTitle.textContent = dependencies.FEEDS[key].label;
    history.pushState({ harmonovaFeed: key }, "", dependencies.FEEDS[key].path);
    await dependencies.refreshFeed();
  }

  function storyMeta(story) {
    const meta = dependencies.el("div", "story-meta");
    const fav = dependencies.el("span", "story-favicon", (dependencies.domainOf(story.url) || "HN").slice(0,1).toUpperCase());
    fav.setAttribute("aria-hidden", "true");
    const points = dependencies.el("span", "meta-points", dependencies.compact(story.score) + (model.settings.compactPoints ? "" : " points"));
    if (model.settings.hotnessColors) points.classList.add("hotness-" + hotnessClass(story));
    const domain = dependencies.el("span", "meta-domain", dependencies.domainOf(story.url));
    const age = dependencies.el("span", "meta-age", dependencies.relativeTime(story.time));
    meta.append(fav, points, dependencies.el("span", "meta-dot", "•"));
    if (model.settings.showDomain !== false) meta.append(domain, dependencies.el("span", "meta-dot", "•"));
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
    const domain = dependencies.domainOf(story.url);
    if (!domain) return;
    const current = parseListSetting(model.settings.hiddenDomains);
    if (!current.includes(domain.toLowerCase())) {
      model.settings.hiddenDomains = [...current, domain.toLowerCase()].join(", ");
      await dependencies.saveSettings("hiddenDomains");
    }
    filterStories();
    dependencies.showToast("Hiding " + domain);
  }

  function isJobStory(story) {
    if (story.type === "job") return true;
    // Some HN lists expose hiring submissions as regular stories.
    // Match explicit hiring announcements, not general articles about employment.
    return /\b(?:is hiring|we(?:'|’)?re hiring|we are hiring|hiring for)\b/i.test(story.title || "")
      && (/\bYC\s*[A-Z]\d{2}\b/i.test(story.title || "")
        || /\b(?:jobs?\.|jobs?\/|careers?\.|careers?\/|ashbyhq\.|greenhouse\.|lever\.)/i.test(story.url || ""));
  }


    return Object.freeze({toggleSearch,
closeSearch,
abortSearch,
onSearchInput,
onSearchKeydown,
isEligibleStory,
filterStories,
queueGlobalSearch,
runGlobalSearch,
renderRecentSearches,
switchFeed,
storyMeta,
hideDomain,
isJobStory});
  }
  globalThis.HarmoNovaContentSearch=Object.freeze({create});
})();
