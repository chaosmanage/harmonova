// Isolated-world HarmoNovaContentFeed module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  function createStoryCard(story, index) {
    const card = dependencies.el("article", "story-card");
    card.dataset.storyId = String(story.id);
    card.dataset.search = (story.title || "") + " " + dependencies.domainOf(story.url);
    card.dataset.domain = dependencies.domainOf(story.url);
    card.dataset.type = dependencies.isJobStory(story) ? "job" : (story.type || "story");
    card.style.setProperty("--fallback-tint", dependencies.hashTint(dependencies.domainOf(story.url)));
    if (model.readIds.has(story.id)) card.classList.add("is-read");
    if (model.selectedId === story.id) card.classList.add("selected");

    const main = dependencies.el("div", "story-card-main");
    const title = dependencies.el("a", "story-card-title", story.title || "(untitled)");
    dependencies.setStoryLink(title, story);
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.addEventListener("click", (event) => {
      event.stopPropagation();
      dependencies.markRead(story.id);
      if (model.settings.cardClickComments || !story.url) {
        event.preventDefault();
        dependencies.selectStory(story, true, true, event);
      } else if (model.settings.alwaysOpenComments) {
        setTimeout(() => dependencies.selectStory(story, false), 0);
      }
    });
    const rank = dependencies.el("span", "story-index", (index + 1) + ".");
    const titleLine = dependencies.el("div", "story-title-line");
    titleLine.append(rank, title);
    const meta = dependencies.storyMeta(story);
    // Actions are available on right-click / long-press, not another
    // permanent button under the story metadata.
    const showStoryActions = (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      dependencies.openPopup(card, [
        { label: "Open discussion", icon: "comment", action: (event) => dependencies.selectStory(story, true, true, event) },
        ...(story.url ? [{ label: "Open article", icon: "external", action: () => window.open(dependencies.nitterize(dependencies.articleHref(story)), "_blank", "noopener") }] : []),
        ...(dependencies.archiveHref(story) ? [{ label: "View on archive", icon: "clock", action: () => dependencies.openArchive(story) }] : []),
        { label: model.feedVotes.has(story.id) ? "Unvote" : "Upvote", icon: "up", action: (e) => voteFromFeed(e, story.id) },
        ...(window.HarmoNovaHN?.session?.() ? [{ label: "Hide story", icon: "eyeOff", action: (e) => dependencies.hideFromFeed(e, story.id) }] : []),
        ...(story.url ? [{ label: "Hide this domain", icon: "eyeOff", action: () => dependencies.hideDomain(story) }] : []),
        { label: model.bookmarks.has(story.id) ? "Remove bookmark" : "Bookmark", icon: "star", action: () => dependencies.toggleBookmark(story.id) },
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

    const preview = dependencies.el("a", "story-preview");
    preview.href = dependencies.articleHref(story);
    preview.target = story.url ? "_blank" : "_self";
    preview.rel = "noopener noreferrer";
    preview.title = story.url ? "Open article" : "Open comments";
    const previewImg = dependencies.el("img", "story-preview-image");
    previewImg.alt = "";
    previewImg.addEventListener("error", () => {
      previewImg.removeAttribute("src");
      previewImg.remove();
      card.classList.remove("has-preview");
      card.classList.add("no-preview");
      const previous = model.previewById.get(story.id) || {};
      model.previewById.set(story.id, { ...previous, image: null, failedUntil: Date.now() + 86400000 });
    });
    preview.appendChild(previewImg);
    preview.addEventListener("click", (event) => {
      event.stopPropagation();
      dependencies.markRead(story.id);
      if (model.settings.cardClickComments || !story.url) {
        event.preventDefault();
        dependencies.selectStory(story, true, true, event);
      } else if (model.settings.alwaysOpenComments) {
        setTimeout(() => dependencies.selectStory(story, false), 0);
      }
    });

    const commentButton = dependencies.el("button", "story-comment-button");
    commentButton.type = "button";
    commentButton.title = "Open " + (story.descendants || 0) + " comments";
    commentButton.append(dependencies.svg("comment"), dependencies.el("strong", "", dependencies.compact(story.descendants || 0)));
    commentButton.addEventListener("click", (event) => {
      event.stopPropagation();
      dependencies.selectStory(story, true, true, event);
    });

    card.addEventListener("click", (event) => {
      if (event.target.closest("a,button") || !model.settings.cardClickEnabled) return;
      dependencies.markRead(story.id);
      if (model.settings.cardClickComments || !story.url) {
        dependencies.selectStory(story, true, true, event);
      } else {
        window.open(dependencies.articleHref(story), "_blank", "noopener");
      }
    });

    if (story.url) {
      dependencies.previewsUI.requestCardPreview(card, story, (meta) => {
        const favicon = card.querySelector(".story-favicon");
        const faviconSrc = dependencies.safeImageSrc(meta.favicon || "");
        if (faviconSrc && favicon) favicon.src = faviconSrc;
        const imageSrc = dependencies.safeImageSrc(meta.image || "");
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
    const voted = model.feedVotes.has(id);
    card.classList.toggle("voted", voted);
    card.dataset.votedDirection = voted ? (model.feedVotes.get(id) === "down" ? "down" : "up") : "";
    if (!card.querySelector(".story-voted-badge")) {
      const badge = dependencies.el("span", "story-voted-badge", "▲");
      badge.title = "You upvoted this";
      card.appendChild(badge);
    }
  }

  // Upvote/unvote straight from a feed card, using the token harvested from
  // the feed document (or an on-demand item fetch when the story isn't on it).
  async function voteFromFeed(event, storyId) {
    if (!dependencies.requireTrustedEvent(event)) return;
    const session = window.HarmoNovaHN?.session?.();
    if (!session) {
      dependencies.showToast("Sign in to vote");
      return;
    }
    if (!Number.isInteger(storyId) || storyId <= 0) return;
    const direction = model.feedVotes.get(storyId) ? "un" : "up";
    const outcome = await window.HarmoNovaHN.vote(storyId, direction);
    if (outcome.status === "success") {
      if (direction === "up") model.feedVotes.set(storyId, outcome.state?.votedDirection === "down" ? "down" : "up");
      else model.feedVotes.delete(storyId);
      dependencies.updateFeedVoteBadges();
      dependencies.showToast(direction === "up" ? "Upvoted" : "Vote removed");
    } else {
      dependencies.showToast(outcome.message || "The vote did not go through");
      if (outcome.status === "loginRequired") dependencies.updateAccountChip();
    }
  }

  function createLoading(label) {
    const wrap = dependencies.el("div", "harmonova-loading");
    wrap.append(dependencies.el("div", "harmonova-spinner"), dependencies.el("span", "", label));
    return wrap;
  }

  async function loadMoreStories() {
    if (model.listView || model.search.active || model.loadingMore || !model.hasMoreStories || !model.feedIds.length) return;
    const generation = model.feedGeneration;
    const batchIds = model.feedIds.slice(model.feedCursor, model.feedCursor + dependencies.FEED_BATCH_SIZE);
    if (!batchIds.length) {
      model.hasMoreStories = false;
      return;
    }

    model.loadingMore = true;
    model.feedCursor += batchIds.length;
    const loading = createLoading("Loading more stories…");
    loading.classList.add("load-more-stories");
    dependencies.storyList.appendChild(loading);
    try {
      const stories = await dependencies.fetchItems(batchIds,dependencies.feedScope.signal);
      if (generation !== model.feedGeneration) return;
      loading.remove();
      const startIndex = model.stories.length;
      model.stories.push(...stories);
      stories.forEach((story, index) => dependencies.storyList.appendChild(createStoryCard(story, startIndex + index)));
      model.hasMoreStories = model.feedCursor < model.feedIds.length;
      dependencies.filterStories();
    } catch {
      if(generation!==model.feedGeneration)return;
      loading.remove();
      model.feedCursor -= batchIds.length;
      dependencies.showToast("Couldn’t load more stories");
    } finally {
      if (generation === model.feedGeneration) model.loadingMore = false;
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
    for (const [id, direction] of Object.entries(first.votes)) model.feedVotes.set(Number(id), direction);
  }
  if (first.morePath && first.ids.length < dependencies.FEED_BATCH_SIZE) {
    const second = await window.HarmoNovaHN.fetchListPage(first.morePath,{signal});
    if (second.status === "ok") for (const id of second.ids) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function visibleFeeds() {
  const order = (Array.isArray(model.settings.feedOrder) ? model.settings.feedOrder : [])
    .filter((key) => dependencies.FEEDS[key]);
  const hidden = new Set((Array.isArray(model.settings.feedHidden) ? model.settings.feedHidden : []).filter((key) => dependencies.FEEDS[key]));
  const ordered = [...order, ...dependencies.FEED_ORDER_DEFAULT.filter((key) => !order.includes(key))];
  return ordered.filter((key) => !hidden.has(key));
}

function syncFrontDateInput() {
  if (!dependencies.frontDateInput) return;
  const show = dependencies.FEEDS[model.feed]?.dayBased;
  dependencies.frontDateInput.hidden = !show;
  if (show) dependencies.frontDateInput.value = validFrontDate(model.settings.frontDate) || frontDayOffset(1);
}

function openManageFeeds() {
  document.querySelector(".feeds-overlay")?.remove();
  const overlay = dependencies.el("div", "feeds-overlay");
  const panel = dependencies.el("section", "feeds-panel");
  const header = dependencies.el("header", "feeds-header");
  header.append(dependencies.el("h2", "", "Manage frontpages"), dependencies.el("p", "feeds-note", "Reorder the feed menu and hide the lists you never read. Settings stay local to this profile."));
  const close = dependencies.button("close", "Close");
  close.type = "button";
  close.addEventListener("click", () => overlay.remove());
  header.appendChild(close);
  panel.appendChild(header);

  const save = async (order, hidden) => {
    model.settings.feedOrder = order;
    model.settings.feedHidden = hidden;
    await dependencies.saveSettings(["feedOrder","feedHidden"]);
  };

  const renderRows = () => {
    panel.querySelectorAll(".feeds-row").forEach((node) => node.remove());
    const hidden = new Set(model.settings.feedHidden || []);
    const order = (model.settings.feedOrder || []).filter((key) => dependencies.FEEDS[key]);
    const all = [...order, ...dependencies.FEED_ORDER_DEFAULT.filter((key) => !order.includes(key))];
    all.forEach((key, index) => {
      const row = dependencies.el("div", "feeds-row" + (hidden.has(key) ? " feeds-row-hidden" : ""));
      const check = dependencies.el("input", "feeds-check");
      check.type = "checkbox";
      check.checked = !hidden.has(key);
      check.addEventListener("change", () => {
        const nextHidden = new Set(model.settings.feedHidden || []);
        if (check.checked) nextHidden.delete(key); else nextHidden.add(key);
        save(model.settings.feedOrder || [], [...nextHidden]).then(renderRows).catch(() => { console.warn("HarmoNova: asynchronous UI operation failed"); });
      });
      const label = dependencies.el("span", "feeds-label", dependencies.FEEDS[key].label);
      const up = dependencies.el("button", "feeds-move", "↑");
      up.type = "button";
      up.setAttribute("aria-label", "Move " + dependencies.FEEDS[key].label + " up");
      up.disabled = index === 0;
      up.addEventListener("click", () => {
        const list = [...all];
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        save(list, model.settings.feedHidden || []).then(renderRows).catch(() => { console.warn("HarmoNova: asynchronous UI operation failed"); });
      });
      const down = dependencies.el("button", "feeds-move", "↓");
      down.type = "button";
      down.setAttribute("aria-label", "Move " + dependencies.FEEDS[key].label + " down");
      down.disabled = index === all.length - 1;
      down.addEventListener("click", () => {
        const list = [...all];
        [list[index + 1], list[index]] = [list[index], list[index + 1]];
        save(list, model.settings.feedHidden || []).then(renderRows).catch(() => { console.warn("HarmoNova: asynchronous UI operation failed"); });
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
    dependencies.abortSearch();
    model.search.active = false;
    // A manual refresh closes an open account list view and rebuilds the feed.
    model.listView = null;
    dependencies.feedScope.dispose();dependencies.feedScope=HarmoNovaLifecycle.create();
    const scope=dependencies.feedScope;
    const generation = ++model.feedGeneration;
    model.loadingMore = false;
    model.feedIds = [];
    model.feedCursor = 0;
    model.hasMoreStories = true;
    dependencies.storyList.replaceChildren(createLoading("Loading stories…"));
    const key = model.feed;
    const feed = dependencies.FEEDS[key];
    syncFrontDateInput();
    try {
      // Phase 7: parity lists have no Firebase endpoint — their ids come from
      // public HN list pages fetched through the rate-limited queue (SEC-05
      // allowlist applies). Past frontpages add the day parameter.
      const listPath = feed.dayBased
        ? "/front?day=" + dependencies.encodeURIComponent(validFrontDate(model.settings.frontDate) || frontDayOffset(1))
        : feed.listPath;
      const ids = feed.endpoint
        ? await dependencies.fetchJson(dependencies.HN_API + "/" + feed.endpoint + ".json",scope.signal)
        : await fetchListFeedIds(listPath,scope.signal);
      // /news is the canonical HN list for the Top feed.
      if (feed.endpoint === "topstories" && window.HarmoNovaHN?.session?.()) {
        const hnList = await window.HarmoNovaHN.fetchListPage("/news",{signal:scope.signal});
        if (hnList.status === "ok") {
          const shown = new Set(ids.slice(0, dependencies.INITIAL_FEED_BATCH_SIZE));
          for (const [id, direction] of Object.entries(hnList.votes || {})) {
            if (shown.has(Number(id))) model.feedVotes.set(Number(id), direction);
          }
        }
      }
      if (generation !== model.feedGeneration) return;
      model.feedIds = ids.filter((id) => Number.isInteger(id) && id > 0);
      const batchIds = model.feedIds.slice(0, dependencies.INITIAL_FEED_BATCH_SIZE);
      model.feedCursor = batchIds.length;
      const stories = await dependencies.fetchItems(batchIds,dependencies.feedScope.signal);
      if (generation !== model.feedGeneration) return;
      if (!stories.length && batchIds.length) throw new Error("Story details are temporarily unavailable");
      model.stories = stories;
      // Parity lists have no reliable "more" cursor; everything fetched is shown.
      model.hasMoreStories = feed.endpoint ? model.feedCursor < model.feedIds.length : false;
      model.updatedAt = new Date();
      dependencies.updatedLabel.textContent = "Last updated: " + dependencies.formatTime(model.updatedAt);
      dependencies.storyList.replaceChildren();
      if (feed.kind === "comments") {
        // Best-comments style feeds: comment rows with story context (Algolia).
        const rows = await Promise.all(batchIds.map((id) => dependencies.renderThreadListItem(id)));
        if (generation !== model.feedGeneration) return;
        rows.forEach((row, index) => row && dependencies.storyList.appendChild(row));
      } else {
        stories.forEach((story, index) => dependencies.storyList.appendChild(createStoryCard(story, index)));
        dependencies.filterStories();
      }
      if (model.selectedId) {
        const match = stories.find((story) => story.id === model.selectedId);
        if (match) model.selectedStory = match;
      } else if (stories[0] && window.innerWidth >= 900 && feed.kind !== "comments") {
        dependencies.selectStory(stories[0], false, false);
      }
    } catch (error) {
      if(!scope.alive || generation!==model.feedGeneration)return;
      const fail = dependencies.el("div", "harmonova-error");
      fail.append(dependencies.el("strong", "", "Couldn’t load Hacker News"), dependencies.el("span", "", error.message));
      dependencies.storyList.replaceChildren(fail);
    }
  }



    return Object.freeze({createStoryCard,
applyCardVotedState,
createLoading,
loadMoreStories,
frontDayOffset,
validFrontDate,
visibleFeeds,
openManageFeeds,
refreshFeed});
  }
  globalThis.HarmoNovaContentFeed=Object.freeze({create});
})();
