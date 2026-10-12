// Isolated-world HarmoNovaContentActions module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
function currentGotoPath() {
  if (location.pathname === "/item") {
    const id = Number(new URLSearchParams(location.search).get("id"));
    if (Number.isInteger(id) && id > 0) return "item?id=" + id;
  }
  const feedPath = dependencies.FEEDS[model.feed]?.path;
  if (feedPath && ["top", "new", "best", "ask", "show", "jobs"].includes(model.feed)) {
    const path = feedPath.replace(/^\//, "");
    if (["news", "newest", "front", "best", "ask", "show", "jobs"].includes(path)) return path;
  }
  return "news";
}

function goToLogin() {
  const goto = currentGotoPath();
  location.href = "https://news.ycombinator.com/login?goto=" + dependencies.encodeURIComponent(goto);
}



function updateAccountChip() {
  if (!dependencies.accountChip) return;
  const session = window.HarmoNovaHN?.session?.() || null;
  dependencies.accountChip.replaceChildren();
  dependencies.accountChip.classList.toggle("logged-in", Boolean(session));
  if (session?.username) {
    const karma = session.karma === null || session.karma === undefined ? "" : " · " + dependencies.compact(session.karma) + " karma";
    dependencies.accountChip.append(dependencies.svg("user", "account-chip-icon"), dependencies.el("span", "account-chip-name", session.username));
    dependencies.accountChip.title = "Account: " + session.username + karma;
    dependencies.accountChip.setAttribute("aria-label", "Account menu for " + session.username);
  } else {
    dependencies.accountChip.append(dependencies.svg("user", "account-chip-icon"), dependencies.el("span", "account-chip-name", "Log in"));
    dependencies.accountChip.title = "Log in to Hacker News";
    dependencies.accountChip.setAttribute("aria-label", "Log in to Hacker News");
  }
}

function openAccountMenu(anchor) {
  const session = window.HarmoNovaHN?.session?.() || null;
  if (!session) {
    dependencies.openPopup(anchor, [
      { label: "Log in", icon: "user", action: goToLogin },
      { label: "Create account", icon: "external", action: goToLogin },
    ]);
    return;
  }
  const karma = session.karma === null || session.karma === undefined ? "" : " · " + dependencies.compact(session.karma) + " karma";
  dependencies.openPopup(anchor, [
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
  if (!event?.isTrusted || model.logoutPending) return;
  model.logoutPending = true;
  const username = window.HarmoNovaHN?.session?.()?.username;
  try {
  const outcome = await window.HarmoNovaHN?.logout?.();
  if (!outcome || outcome.status !== "success") {
    dependencies.showToast(outcome?.message || "Could not confirm sign-out");
    dependencies.openConfirmDialog({ title: "Could not confirm sign-out", message: "Your drafts are kept. Check your session on Hacker News.", confirmLabel: "Open Hacker News", onConfirm: () => dependencies.openOriginalHackerNews("/news") });
    return;
  }
  if (model.composer) dependencies.closeComposer({ keepDraft: false });
  const cleared = await dependencies.composerUI.draftClearAll(outcome.username || username);
  if (!cleared) {
    dependencies.showToast("Signed out. Could not clear saved drafts.");
    updateAccountChip();
    return;
  }
  model.feedVotes.clear();
  model.itemState = null;
  model.pollOptions = null;
  dependencies.showToast("Signed out");
  location.reload();
  } finally { model.logoutPending = false; }
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
    if (Number.isInteger(numeric) && numeric > 0) model.feedVotes.set(numeric, direction === "down" ? "down" : "up");
  }
}

// SEC-30: HarmoNova never sends an action unless the click is a real user
// gesture. Scripted element.click() from page code has isTrusted === false.
function requireTrustedEvent(event) {
  if (event?.isTrusted) return true;
  dependencies.showToast("That action needs a real click");
  return false;
}

function cancelItemState() {
  clearTimeout(model.itemStateTimer);
  model.itemStateTimer = 0;
  model.itemStateToken++;
}

// Once a story has been open for 600ms, ask Hacker News (via HarmoNovaHN) for
// the document state: the story's vote links and every comment's vote links.
// This is a single signed-in GET, queued through the module's rate limiter.
function scheduleItemState(id) {
  cancelItemState();
  const token = model.itemStateToken;
  model.itemStateTimer = setTimeout(async () => {
    if (!window.HarmoNovaHN || model.selectedId !== id || token !== model.itemStateToken) return;
    await loadThreadItemState(id, token);
  }, 600);
}

async function loadThreadItemState(id, token) {
  try {
    const itemState = await window.HarmoNovaHN.ensureItemState(id,{signal:dependencies.threadScope.signal});
    if (token !== model.itemStateToken || model.selectedId !== id) return;
    model.itemState = itemState || null;
    if (itemState?.story?.voted) model.feedVotes.set(id, itemState.story.votedDirection === "down" ? "down" : "up");
    else if (itemState?.status === "ok") model.feedVotes.delete(id);
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
  const story = model.itemState?.story || null;
  const voteButton = dependencies.threadPane.querySelector("[data-thread-vote]");
  if (voteButton) {
    const pending = voteButton.dataset.pending === "1";
    voteButton.classList.toggle("active", !pending && Boolean(story?.voted));
    voteButton.title = story ? (story.voted ? "Unvote" : "Upvote") : "Loading vote state…";
    voteButton.classList.toggle("loading", !story);
    voteButton.setAttribute("aria-label", voteButton.title);
    if (!pending) voteButton.disabled = false;
  }
  const favoriteButton = dependencies.threadPane.querySelector("[data-thread-favorite]");
  if (favoriteButton) {
    const pending = favoriteButton.dataset.pending === "1";
    favoriteButton.classList.toggle("active", !pending && Boolean(story?.favorited));
    favoriteButton.title = story?.favorited ? "Unfavorite" : "Favorite";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    // Keep the star visible in the toolbar, but do not offer an HN action
    // when the fetched item document provides no favorite link.
    if (!pending) favoriteButton.disabled = story !== null && story.favoriteAvailable === false;
  }
  const hideButton = dependencies.threadPane.querySelector("[data-thread-hide]");
  if (hideButton) {
    const pending = hideButton.dataset.pending === "1";
    hideButton.classList.toggle("active", !pending && Boolean(story?.hidden));
    hideButton.title = story?.hidden ? "Unhide" : "Hide";
    hideButton.setAttribute("aria-label", hideButton.title);
    hideButton.hidden = !pending && story !== null && story.hideAvailable === false;
    if (!pending) hideButton.disabled = false;
  }
  for (const row of dependencies.threadPane.querySelectorAll(".comment-row[data-comment-id]")) {
    const id = Number(row.dataset.commentId);
    if (id > 0) syncCommentVoteUi(id);
  }
}

function syncCommentVoteUi(commentId) {
  const row = dependencies.threadPane.querySelector('.comment-row[data-comment-id="' + commentId + '"]');
  if (!row) return;
  const cs = model.itemState?.comments?.[commentId] || null;
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
  const statNode = dependencies.threadPane.querySelector("[data-thread-points]");
  const valueNode = statNode?.querySelector("span:last-child");
  if (!valueNode) return;
  const current = Number(valueNode.dataset.threadPointsValue || valueNode.textContent.replace(/\D/g, "") || 0);
  const next = Math.max(0, current + delta);
  valueNode.dataset.threadPointsValue = String(next);
  valueNode.textContent = dependencies.compact(next);
}

async function handleStoryVote(event) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    dependencies.showToast("Sign in to vote");
    goToLogin();
    return;
  }
  const storyId = model.selectedId;
  if (!Number.isInteger(storyId) || storyId <= 0) return;
  const voteButton = dependencies.threadPane.querySelector("[data-thread-vote]");
  if (!voteButton || voteButton.dataset.pending === "1") return; // one vote in flight (SEC-32)
  voteButton.dataset.pending = "1";
  voteButton.disabled = true;
  // Defer a fast click until we have the actual voted state from HN.
  if (model.itemState?.status !== "ok" || model.itemState.itemId !== storyId) {
    clearTimeout(model.itemStateTimer);
    await loadThreadItemState(storyId, model.itemStateToken);
    if (model.selectedId !== storyId || model.itemState?.status !== "ok") {
      delete voteButton.dataset.pending;
      voteButton.disabled = false;
      dependencies.showToast("Couldn't load your vote state");
      return;
    }
  }
  const voted = Boolean(model.itemState.story.voted);
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
      dependencies.showToast(outcome.message || "The vote did not go through");
      if (outcome.status === "rateLimited") dependencies.showToast("Hacker News rate limit — try again soon, or open the story there");
      if (outcome.status === "loginRequired") updateAccountChip();
      return;
    }
    const nextState = outcome.state || null;
    if (model.itemState) {
      model.itemState = { ...model.itemState, story: { ...model.itemState.story, ...(nextState || {}) } };
    }
    voteButton.disabled = false;
    delete voteButton.dataset.pending;
    voteButton.classList.toggle("active", Boolean(nextState?.voted));
    voteButton.title = nextState?.voted ? "Unvote" : "Upvote";
    if (direction === "up") model.feedVotes.set(storyId, "up");
    else model.feedVotes.delete(storyId);
    updateFeedVoteBadges();
  } catch {
    rollback();
    dependencies.showToast("The vote did not go through");
  }
}

async function handleCommentVote(event, commentId, requestedDown = null) {
  if (!requireTrustedEvent(event)) return;
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    dependencies.showToast("Sign in to vote");
    return;
  }
  if (!Number.isInteger(commentId) || commentId <= 0) return;
  const buttonNode = event.currentTarget;
  if (!buttonNode || buttonNode.dataset.pending === "1") return;
  const isDown = requestedDown === null ? buttonNode.hasAttribute("data-comment-vote-down") : requestedDown;
  buttonNode.dataset.pending = "1";
  if (model.itemState?.status !== "ok" || model.itemState.itemId !== model.selectedId) {
    await loadThreadItemState(model.selectedId, model.itemStateToken);
    if (model.itemState?.status !== "ok") {
      delete buttonNode.dataset.pending;
      dependencies.showToast("Couldn't load your vote state");
      return;
    }
  }
  const cs = model.itemState?.comments?.[commentId] || {};
  const voted = Boolean(cs.voted);
  const direction = voted ? "un" : isDown ? "down" : "up";
  buttonNode.dataset.pending = "1";
  buttonNode.classList.add("pending");
  buttonNode.classList.toggle("active", !voted);
  try {
    const outcome = await window.HarmoNovaHN.vote(commentId, direction);
    if (outcome.status !== "success") {
      dependencies.showToast(outcome.message || "The vote did not go through");
      if (outcome.status === "loginRequired") updateAccountChip();
    } else if (model.itemState) {
      model.itemState.comments[commentId] = { ...(model.itemState.comments[commentId] || {}), ...(outcome.state || {}) };
    }
  } catch {
    dependencies.showToast("The vote did not go through");
  } finally {
    delete buttonNode.dataset.pending;
    buttonNode.classList.remove("pending");
    const cs = model.itemState?.comments?.[commentId] || null;
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
    dependencies.showToast("Sign in to favorite");
    goToLogin();
    return;
  }
  const storyId = model.selectedId;
  if (!Number.isInteger(storyId) || storyId <= 0) return;
  const favoriteButton = dependencies.threadPane.querySelector("[data-thread-favorite]");
  if (!favoriteButton || favoriteButton.dataset.pending === "1") return; // one action in flight (SEC-32)
  const favorited = Boolean(model.itemState?.story?.favorited);
  favoriteButton.dataset.pending = "1";
  favoriteButton.classList.add("pending");
  favoriteButton.classList.toggle("active", !favorited); // optimistic
  try {
    const outcome = await window.HarmoNovaHN.setFavorite(storyId, !favorited);
    if (outcome.status === "success") {
      if (model.itemState && model.itemState.itemId === storyId && outcome.state) {
        model.itemState.story = { ...model.itemState.story, ...outcome.state };
      }
      dependencies.showToast(favorited ? "Removed from favorites" : "Favorited");
    } else {
      if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
      dependencies.showToast(outcome.message || "Favoriting did not go through");
    }
  } catch {
    dependencies.showToast("Favoriting did not go through");
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
    dependencies.showToast("Sign in to hide");
    goToLogin();
    return;
  }
  const storyId = model.selectedId;
  if (!Number.isInteger(storyId) || storyId <= 0) return;
  const hideButton = dependencies.threadPane.querySelector("[data-thread-hide]");
  if (!hideButton || hideButton.dataset.pending === "1") return;
  const hidden = Boolean(model.itemState?.story?.hidden);
  hideButton.dataset.pending = "1";
  hideButton.classList.add("pending");
  try {
    const outcome = await window.HarmoNovaHN.setHidden(storyId, !hidden);
    if (outcome.status === "success") {
      if (model.itemState && model.itemState.itemId === storyId) {
        model.itemState.story = { ...model.itemState.story, hidden: !hidden };
      }
      if (!hidden) {
        dependencies.showToast("Story hidden", {
          actionLabel: "Undo",
          duration: 6000,
          onAction: () => unhideStory(storyId),
        });
      } else {
        dependencies.showToast("Story unhidden");
      }
    } else {
      if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
      dependencies.showToast(outcome.message || "The story could not be hidden");
    }
  } catch {
    dependencies.showToast("The story could not be hidden");
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
      if (model.itemState && model.itemState.itemId === storyId) model.itemState.story.hidden = false;
      dependencies.showToast("Story unhidden");
    } else {
      dependencies.showToast(outcome.message || "The story is still hidden");
    }
  } catch {
    dependencies.showToast("The story is still hidden");
  }
}

// SEC-36: flagging runs only behind an explicit confirmation dialog, and only
// when Hacker News actually offers a flag link for the item.
function confirmFlagItem(event, itemId, kind) {
  if (!requireTrustedEvent(event)) return;
  dependencies.openConfirmDialog({
    title: "Flag this " + kind + "?",
    message:
      "Flagging tells Hacker News's moderators that this " + kind +
      " may break the site rules. Flags are weighed by the moderators and can lead to penalties — flag only when you're sure.",
    confirmLabel: "Flag",
    danger: true,
    onConfirm: async () => {
      try {
        const outcome = await window.HarmoNovaHN.setFlagged(itemId, true);
        dependencies.showToast(outcome.status === "success" ? capitalize(kind) + " flagged" : outcome.message || "Flagging did not go through");
      } catch {
        dependencies.showToast("Flagging did not go through");
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
    dependencies.showToast("Sign in to hide");
    return;
  }
  const card = document.querySelector('.story-card[data-story-id="' + storyId + '"]');
  try {
    const outcome = await window.HarmoNovaHN.setHidden(storyId, true);
    if (outcome.status !== "success") {
      if (outcome.status === "loginRequired" || outcome.status === "accountChanged") updateAccountChip();
      dependencies.showToast(outcome.message || "The story could not be hidden");
      return;
    }
    if (card) card.classList.add("is-hidden");
    dependencies.showToast("Story hidden", {
      actionLabel: "Undo",
      duration: 6000,
      onAction: async () => {
        try {
          const undo = await window.HarmoNovaHN.setHidden(storyId, false);
          if (undo.status === "success") {
            card?.classList.remove("is-hidden");
            dependencies.showToast("Story unhidden");
          } else {
            dependencies.showToast(undo.message || "The story is still hidden");
          }
        } catch {
          dependencies.showToast("The story is still hidden");
        }
      },
    });
  } catch {
    dependencies.showToast("The story could not be hidden");
  }
}

// SEC-37: bulk favorites run serially through the module's rate-limited queue
// and stay cancellable between items.
let bulkFavoritesCancelled = false;
function addBookmarksToFavorites() {
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    dependencies.showToast("Sign in to use your Hacker News favorites");
    return;
  }
  const ids = [...model.bookmarks];
  if (!ids.length) {
    dependencies.showToast("No bookmarks yet");
    return;
  }
  const seconds = Math.max(1, Math.ceil((ids.length * 1500) / 1000));
  dependencies.openConfirmDialog({
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
      dependencies.showToast("Bulk favorite cancelled");
      return;
    }
    dependencies.showToast("Adding to favorites… " + (index + 1) + " of " + ids.length, {
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
        dependencies.showToast("Your Hacker News session ended partway through — " + added + " of " + ids.length + " favorited");
        return;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  dependencies.showToast(added + " of " + ids.length + " added to favorites" + (failed ? " · " + failed + " failed" : ""));
}

// ---------------------------------------------------------------------------
// Phase 5: story submission
// ---------------------------------------------------------------------------

function startNewPost() {
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    dependencies.showToast("Sign in to submit");
    return;
  }
  openSubmitModal();
}

function openSubmitModal() {
  document.querySelector(".harmonova-submit-overlay")?.remove();
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    dependencies.showToast("Sign in to submit");
    return;
  }
  const overlay = dependencies.el("div", "harmonova-submit-overlay");
  const panel = dependencies.el("div", "harmonova-submit");
  const header = dependencies.el("div", "submit-header");
  header.append(
    dependencies.el("h3", "", "New post"),
    (() => {
      const close = dependencies.el("button", "submit-close");
      close.type = "button";
      close.setAttribute("aria-label", "Close submit form");
      close.append(dependencies.svg("close"));
      close.addEventListener("click", () => overlay.remove());
      return close;
    })()
  );
  const asUser = dependencies.el("div", "submit-as", "Posting as " + session.username);
  const titleLabel = dependencies.el("label", "submit-label", "Title");
  const titleInput = dependencies.el("input", "submit-title");
  titleInput.type = "text";
  titleInput.maxLength = 80;
  titleInput.placeholder = "A factual, neutral title";
  const titleCount = dependencies.el("div", "submit-count", "0/80");
  const urlLabel = dependencies.el("label", "submit-label", "URL");
  const urlInput = dependencies.el("input", "submit-url");
  urlInput.type = "url";
  urlInput.placeholder = "https://… (leave empty for a text post)";
  const textLabel = dependencies.el("label", "submit-label", "Text");
  const textInput = dependencies.el("textarea", "submit-text");
  textInput.rows = 5;
  textInput.placeholder = "The text of your post (use either URL or text)";
  const guidelines = dependencies.el("a", "submit-guidelines", "Read the Hacker News guidelines before posting");
  guidelines.href = "https://news.ycombinator.com/newsguidelines.html";
  guidelines.target = "_blank";
  guidelines.rel = "noopener noreferrer";
  const status = dependencies.el("div", "submit-status");
  status.hidden = true;
  const actionsRow = dependencies.el("div", "submit-actions");
  const cancel = dependencies.el("button", "submit-cancel", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => overlay.remove());
  const submit = dependencies.el("button", "submit-go", "Submit story");
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
      const open = dependencies.el("button", "submit-hn-open", "Continue on Hacker News");
      open.type = "button";
      open.addEventListener("click", () => dependencies.openOriginalHackerNews("/submit"));
      status.appendChild(open);
      const session = window.HarmoNovaHN?.session?.();
      if (session?.username) {
        const check = dependencies.el("button", "submit-hn-open", "Check my submissions");
        check.type = "button";
        check.addEventListener("click", () => dependencies.openOriginalHackerNews("/submitted?id=" + dependencies.encodeURIComponent(session.username)));
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
      const safe = dependencies.safeHref(url);
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
      dependencies.showToast("Story submitted");
      dependencies.refreshFeed();
      return;
    }
    if (outcome.status === "alreadySubmitted") {
      overlay.remove();
      dependencies.showToast("Hacker News already has this story");
      if (Number.isInteger(outcome.existingId) && outcome.existingId > 0) dependencies.loadThread(outcome.existingId);
      return;
    }
    if (outcome.status === "validationRequired") {
      // Keep the entered values and hand off to HN's own stock form —
      // HarmoNova never auto-fills a form on hacker news itself.
      const open = dependencies.el("button", "submit-hn-open", "Open the Hacker News submit form");
      open.type = "button";
      open.addEventListener("click", () => dependencies.openOriginalHackerNews("/submit"));
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
    dependencies.showToast("That list is private on Hacker News");
    return;
  }
  if (own && !session) {
    dependencies.showToast("Sign in to see your lists");
    return;
  }
  const target = own ? dependencies.encodeURIComponent(session.username) : dependencies.encodeURIComponent(username);
  model.listView = {
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
  dependencies.abortSearch();
  model.search.active = false;
  const pane = dependencies.el("div", "list-view");
  const header = dependencies.el("div", "list-view-header");
  const back = dependencies.el("button", "list-view-back");
  back.type = "button";
  back.append(dependencies.svg("chevron"), dependencies.el("span", "", "Back to feed"));
  back.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    model.listView = null;
    dependencies.refreshFeed();
  });
  header.append(back, dependencies.el("h2", "", title));
  const body = dependencies.el("div", "list-view-body");
  const more = dependencies.el("button", "list-view-more", "Load more");
  more.type = "button";
  more.hidden = true;
  more.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    loadListViewBatch();
  });
  pane.append(header, body, more);
  dependencies.storyList.replaceChildren(pane);
}

async function loadListViewBatch() {
  const view = model.listView;
  if (!view || view.loading) return;
  view.loading = true;
  const pane = dependencies.storyList.querySelector(".list-view");
  const body = pane?.querySelector(".list-view-body");
  const moreButton = pane?.querySelector(".list-view-more");
  const firstBatch = !view.pendingMore;
  const path = view.pendingMore || view.path;
  if (body && firstBatch) body.replaceChildren(dependencies.createLoading("Loading your " + view.kind + "…"));
  try {
    const result = await window.HarmoNovaHN.fetchListPage(path);
    if (model.listView !== view) return;
    if (result.status !== "ok") {
      if (body) body.replaceChildren(dependencies.el("div", "harmonova-error", result.message || "Hacker News did not return the list"));
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
      if (model.listView !== view) return;
      rows.forEach((row) => row && body.appendChild(row));
    } else {
      const stories = await dependencies.fetchItems(freshIds);
      if (model.listView !== view) return;
      const startIndex = body.querySelectorAll(".story-card").length;
      stories.forEach((story, index) => story && body.appendChild(dependencies.createStoryCard(story, startIndex + index)));
    }
    view.loading = false;
    if (moreButton) moreButton.hidden = view.done;
    if (body && !body.childElementCount) body.appendChild(dependencies.el("div", "list-empty", "Nothing here yet."));
  } catch {
    view.loading = false;
    if (body) body.replaceChildren(dependencies.el("div", "harmonova-error", "The list could not be loaded. Try again shortly."));
    if (moreButton) moreButton.hidden = true;
  }
}

// Threads (reply inbox): one Algolia item fetch per comment carries the text,
// the story it belongs to, and the story title — everything the row needs.
async function renderThreadListItem(commentId) {
  try {
    const hit = await dependencies.fetchJson(dependencies.ALGOLIA_API + "/items/" + commentId);
    if (!hit || !Number.isInteger(hit.story_id)) return dependencies.el("div", "list-empty", "A comment is no longer visible.");
    const row = dependencies.el("article", "thread-list-item");
    const storyButton = dependencies.el("button", "thread-list-story");
    storyButton.type = "button";
    storyButton.append(
      dependencies.el("span", "thread-list-story-title", hit.story_title || "A discussion"),
      dependencies.el("span", "thread-list-story-meta", "open discussion")
    );
    storyButton.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      dependencies.loadThread(hit.story_id);
    });
    const meta = dependencies.el("div", "thread-list-meta", (hit.author || "unknown") + " · " + dependencies.relativeTime(hit.created_at_i || 0));
    const text = dependencies.el("div", "thread-list-text");
    dependencies.appendSanitizedHtml(text, hit.text || "");
    row.append(storyButton, meta, text);
    return row;
  } catch {
    return dependencies.el("div", "list-empty", "A comment could not be loaded.");
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
  const overlay = dependencies.el("div", "harmonova-user-overlay");
  const panel = dependencies.el("div", "harmonova-user");
  const header = dependencies.el("div", "user-header");
  header.append(
    dependencies.el("h3", "", username),
    (() => {
      const close = dependencies.el("button", "user-close");
      close.type = "button";
      close.setAttribute("aria-label", "Close profile panel");
      close.append(dependencies.svg("close"));
      close.addEventListener("click", () => overlay.remove());
      return close;
    })()
  );
  const karmaRow = dependencies.el("div", "user-karma", "Loading…");
  const about = dependencies.el("div", "user-about");
  const submissionsTitle = dependencies.el("h4", "", "Recent items");
  const submissions = dependencies.el("div", "user-submissions");
  const links = dependencies.el("div", "user-links");
  // Segmented public-list tabs open inside HarmoNova, for own and other users.
  const tabs = dependencies.el("nav", "user-tabs");
  for (const kind of ["submissions", "comments", "favorites"]) {
    const tab = dependencies.el("button", "user-tab", kind[0].toUpperCase() + kind.slice(1));
    tab.type = "button";
    tab.addEventListener("click", () => {
      overlay.remove();
      openListView(kind, username);
    });
    tabs.append(tab);
  }
  const profileHref = dependencies.safeHref("https://news.ycombinator.com/user?id=" + dependencies.encodeURIComponent(username));
  if (profileHref) {
    const profileLink = dependencies.el("a", "user-hn-link", "Open profile on Hacker News");
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
    const user = await dependencies.fetchJson(dependencies.HN_API + "/user/" + dependencies.encodeURIComponent(username) + ".json");
    if (!overlay.isConnected) return;
    if (!user || typeof user !== "object" || !user.id) {
      karmaRow.textContent = "This profile is not available.";
      submissionsTitle.hidden = true;
      submissions.hidden = true;
      return;
    }
    karmaRow.replaceChildren(
      dependencies.el("strong", "", dependencies.compact(Number(user.karma) || 0) + " karma"),
      dependencies.el("span", "", memberSince(user.created) ? " · member since " + memberSince(user.created) : "")
    );
    if (user.about) dependencies.appendSanitizedHtml(about, String(user.about));
    else about.hidden = true;
    const ids = Array.isArray(user.submitted)
      ? user.submitted.filter((id) => Number.isInteger(id) && id > 0).slice(0, 8)
      : [];
    if (!ids.length) {
      submissions.appendChild(dependencies.el("div", "list-empty", "No submissions yet."));
      return;
    }
    const items = await dependencies.fetchItems(ids);
    if (!overlay.isConnected) return;
    if (!items.length) {
      submissions.appendChild(dependencies.el("div", "list-empty", "No submissions yet."));
      return;
    }
    for (const item of items) {
      if (!item || !Number.isInteger(item.id)) continue;
      const row = dependencies.el("button", "user-submission");
      row.type = "button";
      const label = item.title || (item.text ? String(item.text).replace(/\s+/g, " ").slice(0, 140) : "(untitled)");
      row.append(
        dependencies.el("span", "user-submission-title", label),
        dependencies.el("span", "user-submission-meta", (item.type === "comment" ? "comment · " : "") + dependencies.compact(item.score || item.descendants || 0))
      );
      row.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        overlay.remove();
        dependencies.loadThread(item.id);
      });
      submissions.appendChild(row);
    }
  } catch {
    karmaRow.textContent = "The profile could not be loaded. Open it on Hacker News instead.";
  }
}

// ---------------------------------------------------------------------------
async function loadPollOptions(storyId) {
  model.pollOptions = null;
  try {
    const scope=dependencies.threadScope;
    const item = await dependencies.fetchJson(dependencies.HN_API + "/item/" + storyId + ".json",scope.signal);
    if(!scope.alive || model.selectedId!==storyId)return;
    if (model.selectedId !== storyId || item?.type !== "poll" || !Array.isArray(item.parts)) return;
    const options = await dependencies.fetchItems(item.parts,scope.signal);
    if (model.selectedId !== storyId) return;
    model.pollOptions = options
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
    const key = (model.pollOptions || []).map((option) => option.id + ":" + option.points).join(",");
    if (dependencies.threadPane.querySelector(".thread-poll") && key === model.pollOptionsRenderedKey) return;
    model.pollOptionsRenderedKey = key;
    dependencies.threadPane.querySelector(".thread-poll")?.remove();
    if (!model.pollOptions?.length || model.pollOptions.some((option) => !option.text)) return;
    const poll = dependencies.el("section", "thread-poll");
    poll.append(dependencies.el("h2", "", "Poll"));
    for (const option of model.pollOptions) {
      const row = dependencies.el("div", "poll-option");
      const voteButton = dependencies.el("button", "poll-option-vote");
      voteButton.type = "button";
      voteButton.title = "Vote";
      voteButton.setAttribute("aria-label", "Vote: " + (option.text || "option"));
      voteButton.append(dependencies.svg("up"));
      const known = model.itemState?.comments?.[option.id];
      if (known) voteButton.classList.toggle("active", Boolean(known.voted && known.votedDirection !== "down"));
      voteButton.addEventListener("click", (event) => handleCommentVote(event, option.id));
      const text = dependencies.el("div", "poll-option-text");
      dependencies.appendSanitizedHtml(text, option.text);
      const score = dependencies.el("span", "poll-option-points", dependencies.compact(option.points) + " points");
      row.append(voteButton, text, score);
      poll.appendChild(row);
    }
    const commentsSection = dependencies.threadPane.querySelector(".comments");
    if (commentsSection) dependencies.threadPane.insertBefore(poll, commentsSection);
    else dependencies.threadPane.appendChild(poll);
  }

function updateFeedVoteBadges() {
  for (const card of dependencies.storyList.querySelectorAll(".story-card[data-story-id]")) {
    const id = Number(card.dataset.storyId);
    if (!Number.isInteger(id) || id <= 0) continue;
    dependencies.applyCardVotedState(card, id);
  }
}

// ---------------------------------------------------------------------------
// Phase 3: composer (replies + edits) and drafts
// ---------------------------------------------------------------------------

// Drafts live in chrome.storage.session via the background worker (SEC-50):
// keyed by acting username + parent item, ≤20 KB each, ≤50 entries, cleared on
// logout and after a successful post. They never touch disk or sync.


    return Object.freeze({updateAccountChip,
openAccountMenu,
seedFeedVotes,
requireTrustedEvent,
cancelItemState,
scheduleItemState,
updateThreadVoteUi,
handleStoryVote,
handleCommentVote,
handleStoryFavorite,
handleStoryHide,
confirmFlagItem,
hideFromFeed,
addBookmarksToFavorites,
startNewPost,
renderThreadListItem,
openUserPanel,
loadPollOptions,
renderPollOptions,
updateFeedVoteBadges});
  }
  globalThis.HarmoNovaContentActions=Object.freeze({create});
})();
