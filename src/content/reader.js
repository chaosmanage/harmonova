// Isolated-world HarmoNovaContentReader module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  // Bounded, tab-local reading state; no page-origin storage or private data export.
  const readingPositions = new Map();
  let renderedId = null;
  let newOnly = false;
  let searchMatchIndex = -1;
  function rememberReadingPosition() {
    if (!renderedId) return;
    const pane = dependencies.threadPane;
    const top = pane.getBoundingClientRect().top;
    const cards = [...pane.querySelectorAll(".comment-card")];
    const anchor = cards.find(card => card.getClientRects().length && card.getBoundingClientRect().bottom > top);
    readingPositions.delete(renderedId);
    readingPositions.set(renderedId,{
      scroll: pane.scrollTop,
      anchor: anchor?.parentElement.dataset.commentId,
      offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
      collapsed: [...pane.querySelectorAll(".comment-row.collapsed")].map(row=>row.dataset.commentId)
    });
    if (readingPositions.size > 30) readingPositions.delete(readingPositions.keys().next().value);
    renderedId = null;
  }
  function restoreReadingPosition(id) {
    renderedId = id;
    const saved = readingPositions.get(id);
    if (!saved) return;
    const pane = dependencies.threadPane;
    const collapsed = new Set(saved.collapsed);
    for (const row of pane.querySelectorAll(".comment-row")) row.classList.toggle("collapsed",collapsed.has(row.dataset.commentId));
    pane.scrollTop = saved.scroll;
    const card = [...pane.querySelectorAll(".comment-card")].find(card=>card.parentElement.dataset.commentId===saved.anchor);
    if (card?.getClientRects().length) pane.scrollTop += card.getBoundingClientRect().top - pane.getBoundingClientRect().top - saved.offset;
  }
  function threadAction(iconName, label, action, options = {}) {
    const b = dependencies.button(iconName, label, "thread-action");
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
    const placeholder = dependencies.el("div", "thread-placeholder");
    placeholder.append(
      dependencies.el("div", "placeholder-logo", "Y"),
      dependencies.el("h2", "", "Choose a story"),
      dependencies.el("p", "", "Comments and story details appear here. Article links open in a new tab.")
    );
    return placeholder;
  }

  async function selectStory(storyOrId, push = true, scrollTop = true, gesture = null) {
    const id = typeof storyOrId === "number" ? storyOrId : storyOrId.id;
    model.aiSelectionIntent = gesture?.isTrusted ? id : null;
    model.selectedId = id;
    model.selectedStory = typeof storyOrId === "object" ? storyOrId : model.stories.find((s) => s.id === id) || null;
    if (dependencies.app) dependencies.app.classList.add("show-thread");
    dependencies.markRead(id);
    document.querySelectorAll(".story-card.selected").forEach((node) => node.classList.remove("selected"));
    document.querySelector('[data-story-id="' + id + '"]')?.classList.add("selected");
    if (push) history.pushState({ harmonovaItem: id }, "", "/item?id=" + id);
    document.body.classList.add("thread-active");
    rememberReadingPosition();
    if (scrollTop) dependencies.threadPane.scrollTop = 0;
    await loadThread(id);
  }

  async function loadThread(id) {
    dependencies.threadScope.dispose();dependencies.threadScope=HarmoNovaLifecycle.create();
    const scope=dependencies.threadScope;
    dependencies.stopActiveSummary();
    dependencies.cancelItemState();
    dependencies.closeComposer({ keepDraft: true });
    // Direct thread switches (e.g. "already submitted" → open the existing
    // story) must retarget the selection, or the fetched payloads are dropped
    // when the stale selectedId fails the guard below.
    model.selectedId = id;
    model.threadOpOnly = false;
    newOnly = false;
    model.itemState = null;
    model.pollOptions = null;
    model.pollOptionsRenderedKey = "";
    rememberReadingPosition();
    dependencies.threadPane.replaceChildren(dependencies.createLoading("Loading discussion…"));
    dependencies.scheduleItemState(id);
    dependencies.loadPollOptions(id);
    try {
      const item = await dependencies.fetchJson(dependencies.ALGOLIA_API + "/items/" + id,scope.signal);
      if (!scope.alive || model.selectedId !== id) return;
      dependencies.mergeConfirmedComments(item);
      model.thread = item;
      renderThread(item);
    } catch (error) {
      if(!scope.alive || model.selectedId!==id)return;
      const fail = dependencies.el("div", "harmonova-error");
      fail.append(dependencies.el("strong", "", "Couldn’t load discussion"), dependencies.el("span", "", error.message));
      dependencies.threadPane.replaceChildren(fail);
    }
  }

  async function renderThread(item) {
    const scope=dependencies.threadScope;
    if(!scope.alive || model.selectedId!==item.id)return;
    rememberReadingPosition();
    dependencies.threadPane.replaceChildren();
    document.title = (item.title || "Discussion") + " — HarmoNova";
    const header = dependencies.el("header", "thread-header");
    const hero = dependencies.el("a", "thread-hero");
    hero.href = dependencies.articleHref(item);
    hero.target = "_blank";
    hero.rel = "noopener";
    const heroImg = dependencies.el("img", "thread-hero-image");
    heroImg.alt = "";
    heroImg.addEventListener("error", () => {
      header.classList.remove("has-hero");
      hero.remove();
    });
    hero.appendChild(heroImg);

    const headerBody = dependencies.el("div", "thread-header-body");
    const title = dependencies.el("a", "thread-title", item.title || "(untitled)");
    dependencies.setStoryLink(title, item);
    title.target = "_blank";
    title.rel = "noopener";
    const domain = dependencies.el("a", "thread-domain");
    dependencies.setStoryLink(domain, item);
    domain.target = "_blank";
    domain.rel = "noopener";
    domain.append(dependencies.svg("link"), dependencies.el("span", "", "(" + dependencies.domainOf(item.url) + ")"));

    const totalComments = (item.children || []).reduce((sum, child) => sum + 1 + dependencies.commentsUI.descendantCount(child), 0);
    const stat = (iconName, value) => {
      const node = dependencies.el("span", "thread-stat");
      node.append(dependencies.svg(iconName), dependencies.el("span", "", value));
      return node;
    };
    const meta = dependencies.el("div", "thread-meta");
    const authorLink = dependencies.el("a", "thread-author");
    authorLink.href = "https://news.ycombinator.com/user?id=" + dependencies.encodeURIComponent(item.author || "");
    authorLink.target = "_blank";
    authorLink.rel = "noopener";
    authorLink.append(dependencies.svg("user"), dependencies.el("span", "", item.author || "unknown"));
    const pointsStat = stat("thumb", dependencies.compact(item.points || 0));
    pointsStat.dataset.threadPoints = "1";
    const pointsValue = pointsStat.querySelector("span:last-child");
    pointsValue.dataset.threadPointsValue = String(item.points || 0); // optimistic vote updates target this
    meta.append(
      pointsStat,
      stat("comment", dependencies.compact(totalComments)),
      stat("clock", dependencies.relativeTime(item.created_at_i || 0)),
      authorLink
    );

    const session = window.HarmoNovaHN?.session?.() || null;
    const replyAction = threadAction("replyPlus", "Add reply", () => session
      ? dependencies.openComposer({ parentId: item.id, storyId: item.id })
      : dependencies.showToast("Sign in to reply"));
    const storyState = model.itemState && model.itemState.itemId === item.id ? model.itemState.story : null;
    const preVoted = Boolean(storyState?.voted) || Boolean(model.feedVotes.get(item.id));
    const upvoteButton = threadAction("thumb", preVoted ? "Unvote" : "Upvote", dependencies.handleStoryVote);
    upvoteButton.setAttribute("data-thread-vote", "1");
    upvoteButton.classList.toggle("active", preVoted);
    if (!session) {
      upvoteButton.title = "Sign in to vote";
      upvoteButton.setAttribute("aria-label", "Sign in to vote");
    }
    // Phase 4: favorite + hide controls. Availability gating happens in
    // updateThreadVoteUi once the fetched item document lands.
    const favoriteButton = threadAction("star", storyState?.favorited ? "Unfavorite" : "Favorite", dependencies.handleStoryFavorite);
    favoriteButton.setAttribute("data-thread-favorite", "1");
    favoriteButton.classList.toggle("active", Boolean(storyState?.favorited));
    if (!session) {
      favoriteButton.title = "Sign in to favorite";
      favoriteButton.setAttribute("aria-label", "Sign in to favorite");
    }
    const hideButton = threadAction("eyeOff", storyState?.hidden ? "Unhide" : "Hide", dependencies.handleStoryHide);
    hideButton.setAttribute("data-thread-hide", "1");
    hideButton.classList.toggle("active", Boolean(storyState?.hidden));
    if (!session) {
      hideButton.title = "Sign in to hide";
      hideButton.setAttribute("aria-label", "Sign in to hide");
    }

    const actions = dependencies.el("div", "thread-actions");
    const profileAction = threadAction("user", session ? "My profile" : "Log in", () => session
      ? dependencies.openUserPanel(session.username)
      : dependencies.openAccountMenu(profileAction));
    profileAction.classList.add("thread-profile-action");
    const summaryActions = dependencies.el("div", "summary-action-group");
    summaryActions.setAttribute("role", "group");
    summaryActions.setAttribute("aria-label", "AI summaries");
    const articleSummary = threadAction("sparkle", "Summarize article", () => dependencies.startStorySummary(item, { source: "article", trusted: true }),
      { summaryId: item.id, summarySource: "article", disabled: !item.url });
    const discussionSummary = threadAction("comment", "Summarize discussion", () => dependencies.startStorySummary(item, { source: "discussion", trusted: true }),
      { summaryId: item.id, summarySource: "discussion" });
    for (const [action, label] of [[articleSummary, "Article"], [discussionSummary, "Discussion"]]) {
      action.classList.add("summary-action");
      action.appendChild(dependencies.el("span", "summary-action-label", label));
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
        dependencies.showToast("Story link copied");
      } catch {
        window.open(url, "_blank", "noopener");
      }
    });
    actions.append(profileAction, replyAction, upvoteButton, favoriteButton, summaryActions, shareAction);
    const more = threadAction("more", "More", (event) => {
      const storyState = model.itemState && model.itemState.itemId === item.id ? model.itemState.story : null;
      dependencies.openPopup(event.currentTarget, [
        { label: "Reply to story", icon: "comment", action: () => session
          ? dependencies.openComposer({ parentId: item.id, storyId: item.id })
          : dependencies.showToast("Sign in to reply") },
        ...(session && storyState?.hideAvailable
          ? [{ label: storyState.hidden ? "Unhide" : "Hide", icon: "eyeOff", action: dependencies.handleStoryHide }]
          : []),
        { label: "Ask AI", icon: "sparkle", action: () => {
          const existing=headerBody.querySelector(".ask-ai-panel");
          if(existing){existing.querySelector("input")?.focus();return;}
          const panel=dependencies.el("form","ask-ai-panel");
          const title=dependencies.el("strong","","Ask AI");
          const notice=dependencies.el("small","","Your question, selected public source and previous answer are sent to OpenRouter. Requests may use API credits. Do not enter private information.");
          const source=dependencies.el("select","ask-ai-source");
          source.setAttribute("aria-label","AI source");
          for(const [value,label] of [["discussion","Discussion"],["article","Article"]]){
            if(value==="article"&&!item.url)continue;
            const option=dependencies.el("option","",label);option.value=value;source.append(option);
          }
          const input=dependencies.el("input","ask-ai-question");input.placeholder="Ask a question or follow up…";input.maxLength=375;input.required=true;input.setAttribute("aria-label","Question for AI");
          const send=dependencies.el("button","comments-nav-button","Ask");send.type="submit";
          const close=dependencies.el("button","comments-nav-button","Close");close.type="button";close.addEventListener("click",e=>{if(e.isTrusted)panel.remove();});
          const controls=dependencies.el("div","ask-ai-controls");controls.append(source,input,send,close);
          panel.append(title,notice,controls);
          panel.addEventListener("submit",e=>{
            e.preventDefault();if(!e.isTrusted||!input.value.trim())return;
            dependencies.startStorySummary(item,{source:source.value,trusted:true,question:input.value});input.value="";
          });
          headerBody.append(panel);input.focus();
        }},
        { label: "Search in comments", icon: "search", action: () => {
          const heading = dependencies.threadPane.querySelector(".comments-heading");
          const input = heading?.querySelector(".comment-search");
          heading?.classList.add("searching");
          input?.focus();
        } },
        { label: newOnly ? "Show all comments" : "Show new comments only", action: () => {
          newOnly = !newOnly;
          filterThreadComments(dependencies.threadPane.querySelector(".comment-search")?.value, dependencies.threadPane.querySelector(".comment-search-count"), totalComments);
        }},
        { label: "Sort comments · " + model.settings.commentSort, action: () => openSortMenu(more) },
        { label: model.threadOpOnly ? "Show all comments" : "Show only OP comments", icon: "user", action: () => {
          model.threadOpOnly = !model.threadOpOnly;
          const input = dependencies.threadPane.querySelector(".comment-search");
          const count = dependencies.threadPane.querySelector(".comment-search-count");
          filterThreadComments(input?.value, count, totalComments);
        } },
        { label: "Open on original Hacker News", icon: "external", action: () => dependencies.openOriginalHackerNews("/item?id=" + item.id) },
        ...(dependencies.archiveHref(item) ? [{ label: "View on archive", icon: "clock", action: () => dependencies.openArchive(item) }] : []),
        // Phase 4: flag only when Hacker News offers the link, behind a
        // confirmation dialog (SEC-36).
        ...(session && storyState?.flagAvailable
          ? [{
              label: storyState.flagged ? "Unflag story" : "Flag story",
              icon: "flag",
              action: (popupEvent) => {
                if (storyState.flagged) {
                  window.HarmoNovaHN.setFlagged(item.id, false).then((outcome) =>
                    dependencies.showToast(outcome.status === "success" ? "Flag removed" : outcome.message || "The flag could not be removed")
                  ).catch(() => { console.warn("HarmoNova: asynchronous UI operation failed"); });
                } else {
                  dependencies.confirmFlagItem(popupEvent, item.id, "story");
                }
              },
            }]
          : []),
        { label: "Settings", icon: "settings", action: dependencies.openSettings },
        { label: "Disable HarmoNova", icon: "power", action: dependencies.disableHarmoNova },
      ]);
    });
    actions.appendChild(more);
    const article = threadAction("link", "Open article", () => window.open(title.href, "_blank", "noopener"), { active: false });
    article.classList.add("article-link-action");

    headerBody.append(title, domain, meta, article);
    if (item.text) {
      const storyText = dependencies.el("div", "thread-story-text");
      dependencies.appendSanitizedHtml(storyText, item.text);
      headerBody.appendChild(storyText);
    }
    hideButton.classList.add("thread-secondary-action");
    headerBody.append(dependencies.createSummarySurface(item.id), actions, hideButton);
    dependencies.updateSummarySurface(item.id);
    header.append(hero, headerBody);
    dependencies.threadPane.appendChild(header);
    dependencies.updateSummarySurface(item.id);
    const existingSummary = dependencies.summaryStateFor(item.id);
    if (item.url && model.aiSelectionIntent === item.id && existingSummary.status === "idle") {
      dependencies.startStorySummary(item, { automatic: true });
    }

    const total = (item.children || []).reduce((sum, child) => sum + 1 + dependencies.commentsUI.descendantCount(child), 0);
    const heading = dependencies.el("div", "comments-heading");
    heading.append(dependencies.el("h2", "", total + " comments"));

    // Phase 7 part 2: in-thread comment filter with a live match count.
    model.threadAuthor = item.author || "";
    const searchBox = dependencies.el("input", "comment-search");
    searchBox.type = "search";
    searchBox.placeholder = "Filter comments";
    searchBox.autocomplete = "off";
    const matchLabel = dependencies.el("span", "comment-search-count", "");
    const searchTools=dependencies.el("div","comment-search-tools");
    const stepMatch=(delta)=>{
      const matches=[...dependencies.threadPane.querySelectorAll(".comment-row.search-match")].filter(row=>!row.hidden&&!row.classList.contains("is-delayed")&&!row.classList.contains("is-blocked"));
      if(!matches.length)return;
      searchMatchIndex=searchMatchIndex<0 ? (delta>0?0:matches.length-1) : (searchMatchIndex+delta+matches.length)%matches.length;
      const target=matches[searchMatchIndex];
      for(let row=target;row;row=row.parentElement.closest(".comment-row"))row.classList.remove("collapsed");
      dependencies.threadPane.querySelectorAll(".search-current").forEach(row=>row.classList.remove("search-current"));
      target.classList.add("search-current");target.querySelector(":scope > .comment-card")?.scrollIntoView({block:"center"});
      matchLabel.textContent=(searchMatchIndex+1)+" / "+matches.length+" matches";
    };
    const prevMatch=dependencies.el("button","comments-nav-button","‹ Match");
    const nextMatch=dependencies.el("button","comments-nav-button","Match ›");
    const clearSearch=dependencies.el("button","comments-nav-button","Close");
    for(const button of [prevMatch,nextMatch,clearSearch])button.type="button";
    prevMatch.addEventListener("click",e=>{if(e.isTrusted)stepMatch(-1);});
    nextMatch.addEventListener("click",e=>{if(e.isTrusted)stepMatch(1);});
    const closeSearch=()=>{searchBox.value="";filterThreadComments("",matchLabel,total);heading.classList.remove("searching");};
    clearSearch.addEventListener("click",e=>{if(e.isTrusted)closeSearch();});
    searchBox.addEventListener("keydown",e=>{
      if(e.key==="Enter"){e.preventDefault();stepMatch(e.shiftKey?-1:1);}
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();closeSearch();}
    });
    searchBox.addEventListener("input", () => {searchMatchIndex=-1;filterThreadComments(searchBox.value, matchLabel, total);});
    searchTools.append(searchBox,prevMatch,nextMatch,matchLabel,clearSearch);
    const nav = dependencies.el("div", "comments-nav");
    const upButton = dependencies.el("button", "comments-nav-button", "↑ Top");
    upButton.type = "button";
    upButton.title = "Back to the story";
    upButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      dependencies.threadPane.querySelector(".thread-header")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    let topLevelIndex = -1;
    const topLevelRows = () => [...dependencies.threadPane.querySelectorAll(".comments > .comment-row")].filter((row) => !row.hidden);
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
    const prevButton = dependencies.el("button", "comments-nav-button", "‹ Prev");
    prevButton.type = "button";
    prevButton.title = "Previous top-level comment";
    prevButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      jumpTopLevel(-1);
    });
    const nextButton = dependencies.el("button", "comments-nav-button", "Next ›");
    nextButton.type = "button";
    nextButton.title = "Next top-level comment";
    nextButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      jumpTopLevel(1);
    });
    nav.append(upButton, prevButton, nextButton);
    heading.append(nav, searchTools);
    dependencies.threadPane.appendChild(heading);

    const comments = dependencies.el("section", "comments");
    for (const comment of dependencies.commentsUI.sortedComments(item.children || [])) comments.appendChild(dependencies.renderComment(comment, 0));
    if (!comments.childElementCount) comments.appendChild(dependencies.el("div", "empty-comments", "No comments yet."));
    dependencies.threadPane.appendChild(comments);
    restoreReadingPosition(item.id);
    if (model.threadOpOnly || newOnly) filterThreadComments(searchBox.value, matchLabel, total);
    // Once the discussion has been read, its comments are never "new" again.
    if (model.settings.markNewComments && Number.isInteger(item.id)) {
      setTimeout(() => {
        if (!scope.alive || model.selectedId !== item.id) return;
        model.seenTimes.set(item.id, Math.floor(Date.now() / 1000));
        dependencies.persistSeenTimes(item.id);
      }, 4000);
    }
    // Re-apply any item state that arrived (or was cached) for this story.
    if (model.itemState && model.itemState.itemId === item.id) {
      dependencies.updateThreadVoteUi();
      dependencies.renderPollOptions();
    }

    if (item.url) {
      const fakeStory = { id: item.id, url: item.url };
      const preview = await dependencies.previewsUI.getPreview(fakeStory,scope.signal);
      if (!scope.alive || model.selectedId !== item.id) return;
      const imageSrc = dependencies.safeImageSrc(preview.image || "");
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
      const rich = model.settings.richPreviews === false ? null : preview.rich;
      if (rich && typeof rich === "object" && !Array.isArray(rich) && typeof rich.provider === "string") {
        const providerLabels = { github: "GitHub", wikipedia: "Wikipedia", arxiv: "arXiv" };
        const box = dependencies.el("div", "rich-preview rich-preview-" + rich.provider.replace(/[^a-z0-9-]/g, ""));
        const head = dependencies.el("div", "rich-preview-head");
        head.append(dependencies.el("span", "rich-preview-provider", providerLabels[rich.provider] || "Facts"));
        const richTitle = typeof rich.title === "string" ? rich.title.slice(0, 200) : "";
        if (richTitle) head.append(dependencies.el("strong", "rich-preview-title", richTitle));
        box.append(head);
        let shown = 0;
        for (const line of Array.isArray(rich.lines) ? rich.lines : []) {
          if (typeof line !== "string" || !line.trim()) continue;
          if (shown >= 4) break;
          box.append(dependencies.el("p", "rich-preview-line", line.slice(0, 700)));
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
    const rows = [...dependencies.threadPane.querySelectorAll(".comment-row")];
    searchMatchIndex=-1;
    rows.forEach(row=>row.classList.remove("search-match","search-current"));
    if (!q && !model.threadOpOnly && !newOnly) {
      rows.forEach((row) => { row.hidden = false; });
      if (matchLabel) matchLabel.textContent = "";
      return;
    }
    const ownMatch = new Map();
    for (const row of rows) {
      const card = row.querySelector(":scope > .comment-card");
      const text = ((card?.textContent || "") + " " + (row.dataset.author || "")).toLowerCase();
      const match=text.includes(q) && (!model.threadOpOnly || row.dataset.author === model.threadAuthor) && (!newOnly || row.classList.contains("is-new")) && !row.classList.contains("is-delayed") && !row.classList.contains("is-blocked");
      ownMatch.set(row, match);
      row.classList.toggle("search-match",Boolean(q)&&match);
    }
    // Children appear after their parent in DOM order, so reverse iteration
    // settles every subtree before its ancestor is decided.
    let kept = 0;
    for (const row of [...rows].reverse()) {
      const childKept = [...(row.querySelector(":scope > .comment-children")?.children || [])].some(child=>!child.hidden);
      const keep = ownMatch.get(row) || childKept;
      row.hidden = !keep;
      if (keep) { kept++; if (childKept && (q || newOnly)) row.classList.remove("collapsed"); }
    }
    if (matchLabel) matchLabel.textContent = kept + " of " + total + (model.threadOpOnly ? " in OP threads" : " match");
  }

  function openSortMenu(anchor) {
    const modes = ["Default", "Newest first", "Oldest first", "Reply count"];
    dependencies.openPopup(anchor, modes.map((mode) => ({
      label: (model.settings.commentSort === mode ? "✓  " : "   ") + mode,
      action: async () => {
        const previousScroll = dependencies.threadPane.scrollTop;
        model.settings.commentSort = mode;
        await dependencies.saveSettings("commentSort");
        if (model.thread) {
          await renderThread(model.thread);
          dependencies.threadPane.scrollTop = previousScroll;
        }
      },
    })));
  }



    return Object.freeze({createThreadPlaceholder,
selectStory,
loadThread,
renderThread});
  }
  globalThis.HarmoNovaContentReader=Object.freeze({create});
})();
