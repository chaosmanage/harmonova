// Isolated-world HarmoNovaContentComments module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
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
    switch (model.settings.commentSort) {
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
    const mode = model.settings.depthMode;
    if (mode === "none") return "transparent";
    if (mode === "mono" || mode === "monochrome") return "#808080";
    if (mode === "author") return authorRailColor(author);
    const palette = mode === "material" || mode === "material_you" ? MATERIAL_RAILS : COLOR_RAILS;
    return palette[Math.abs(depth) % palette.length];
  }

  function renderComment(comment, depth = 0) {
    const row = dependencies.el("div", "comment-row");
    row.dataset.depth = String(depth);
    row.dataset.commentId = String(comment.id || 0); // used by search comment hits to scroll into view
    row.dataset.createdAt = String(comment.created_at_i || 0);
    row.dataset.replies = String(descendantCount(comment));
    if (comment.author) row.dataset.author = comment.author;
    row.style.setProperty("--depth", String(depth));
    row.style.setProperty("--rail", railColor(depth, comment.author || ""));

    // Phase 7 part 2: OP highlight, new-comment marker, [delayed] hiding.
    if (comment.author && comment.author === model.threadAuthor) row.classList.add("by-op");
    if (model.settings.hideDelayed && comment.text && /\[delayed\]/i.test(comment.text)) row.classList.add("is-delayed");
    const storyId = Number.isInteger(model.selectedId) ? model.selectedId : null;
    if (model.settings.markNewComments && storyId && model.seenTimes.has(storyId) && Number(comment.created_at_i || 0) > model.seenTimes.get(storyId)) {
      row.classList.add("is-new");
    }
    const isBlockedAuthor = comment.author && model.blockedUsers.has(comment.author);
    if (isBlockedAuthor) row.classList.add("is-blocked");

    const card = dependencies.el("article", "comment-card");
    card.tabIndex = 0;
    const meta = dependencies.el("div", "comment-meta");
    // Generated avatars: deterministic, purely local color + initial.
    if (model.settings.showAvatars && comment.author) {
      const avatar = dependencies.el("span", "comment-avatar", comment.author.charAt(0).toUpperCase());
      avatar.style.background = dependencies.hashTint(comment.author);
      meta.appendChild(avatar);
    }
    const author = dependencies.el("a", "comment-author", comment.author || "[deleted]");
    if (comment.author) {
      author.href = "https://news.ycombinator.com/user?id=" + dependencies.encodeURIComponent(comment.author);
      author.target = "_blank";
      author.rel = "noopener";
    }
    if (comment.author && comment.author === model.threadAuthor) {
      author.appendChild(dependencies.el("span", "op-badge", "(OP)"));
    }
    meta.appendChild(author);
    const tag = comment.author ? model.userTags.get(comment.author) : null;
    if (tag) {
      const tagChip = dependencies.el("button", "comment-tag", tag);
      tagChip.type = "button";
      tagChip.title = "Edit tag for " + comment.author;
      tagChip.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        openTagDialog(comment.author);
      });
      meta.appendChild(tagChip);
    }
    // Newness is a thin rail, not a badge on every comment.
    const age = dependencies.el("a", "comment-age", dependencies.relativeTime(comment.created_at_i || 0));
    age.href = "https://news.ycombinator.com/item?id=" + comment.id;
    age.target = "_blank";
    age.rel = "noopener";
    const voteMark = dependencies.el("span", "comment-vote-mark", "↑");
    voteMark.dataset.commentVoteMark = "1";
    voteMark.hidden = !model.itemState?.comments?.[comment.id]?.voted;
    if (model.itemState?.comments?.[comment.id]?.votedDirection === "down") voteMark.textContent = "↓";
    meta.append(voteMark, age);

    const body = dependencies.el("div", "comment-body");
    if (comment.text) dependencies.appendSanitizedHtml(body, comment.text);
    else body.textContent = "[deleted]";

    const collapsed = dependencies.el("div", "collapsed-comment");
    collapsed.append(
      dependencies.el("span", "collapsed-author", comment.author || "[deleted]"),
      dependencies.el("span", "collapsed-preview", body.textContent.trim().slice(0, 90)),
      dependencies.el("span", "collapsed-count", descendantCount(comment) ? descendantCount(comment) + " replies" : "")
    );

    // Phase 2: per-comment action row — vote, downvote (when HN offers it),
    // reply hand-off, and a "More" menu (share/copy/parent/top-level/user).
    const session = window.HarmoNovaHN?.session?.() || null;

    const voteButton = dependencies.el("button", "comment-action");
    voteButton.type = "button";
    voteButton.title = "Upvote";
    voteButton.setAttribute("aria-label", "Upvote");
    voteButton.setAttribute("data-comment-vote", "1");
    voteButton.append(dependencies.svg("up"));
    voteButton.addEventListener("click", (event) => dependencies.handleCommentVote(event, comment.id));
    const downButton = dependencies.el("button", "comment-action");
    downButton.type = "button";
    downButton.setAttribute("data-comment-vote-down", "1");
    downButton.hidden = true; // shown once item state says HN allows it
    downButton.append(dependencies.svg("down"));
    downButton.addEventListener("click", (event) => dependencies.handleCommentVote(event, comment.id));
    // Apply any already-known item state (e.g. after a re-render) so buttons
    // don't briefly flash as unvoted.
    const known = model.itemState?.comments?.[comment.id] || null;
    if (known) {
      voteButton.classList.toggle("active", Boolean(known.voted && known.votedDirection !== "down"));
      voteButton.title = known.voted ? "Unvote" : "Upvote";
      voteButton.setAttribute("aria-label", voteButton.title);
      downButton.hidden = !known.canDown;
      downButton.classList.toggle("active", Boolean(known.voted && known.votedDirection === "down"));
    }
    const replyButton = dependencies.el("button", "comment-action");
    replyButton.type = "button";
    replyButton.title = session ? "Reply" : "Sign in to reply";
    replyButton.setAttribute("aria-label", replyButton.title);
    replyButton.append(dependencies.svg("comment"));
    const beginReply = (event) => {
      if (!event.isTrusted) return;
      if (!session) {
        dependencies.showToast("Sign in to reply");
        return;
      }
      dependencies.openComposer({ parentId: comment.id, storyId: model.selectedId || comment.id, anchor: row });
    };
    replyButton.addEventListener("click", beginReply);
    const isOwn = session && comment.author && comment.author === session.username;
    const canEditOwn = Boolean(isOwn && comment.created_at_i && Date.now() / 1000 - comment.created_at_i < 2 * 3600);
    const editButton = dependencies.el("button", "comment-action");
    editButton.type = "button";
    editButton.title = "Edit";
    editButton.setAttribute("aria-label", "Edit comment");
    editButton.append(dependencies.svg("edit"));
    editButton.hidden = !canEditOwn;
    // Editing and deleting are intentionally handled by stock HN until their
    // authenticated action protocol is verified on real accounts. A user must
    // confirm the handoff; HarmoNova never fetches or POSTs either mutation.
    const handoffCommentAction = (action, event) => {
      if (!event.isTrusted || !canEditOwn) return;
      const deleting = action === "delete";
      const storyId = Number.isSafeInteger(model.selectedId) && model.selectedId > 0
        ? model.selectedId : comment.id;
      const path = deleting
        ? "/delete-confirm?id=" + comment.id + "&goto=" + dependencies.encodeURIComponent("item?id=" + storyId)
        : "/edit?id=" + comment.id;
      dependencies.openConfirmDialog({
        title: deleting ? "Deleting comments isn't supported in HarmoNova yet"
          : "Editing comments isn't supported in HarmoNova yet",
        message: deleting
          ? "Continue on the original Hacker News page to review and confirm deletion. Nothing will be deleted in HarmoNova."
          : "Continue on the original Hacker News page to edit this comment. Nothing will be changed in HarmoNova.",
        confirmLabel: "Continue on Hacker News",
        onConfirm: () => dependencies.openOriginalHackerNews(path),
      });
    };
    const beginEdit = (event) => handoffCommentAction("edit", event);
    editButton.addEventListener("click", beginEdit);
    const deleteButton = dependencies.el("button", "comment-action");
    deleteButton.type = "button";
    deleteButton.title = "Delete";
    deleteButton.setAttribute("aria-label", "Delete comment");
    deleteButton.append(dependencies.svg("trash"));
    deleteButton.hidden = !canEditOwn;
    const beginDelete = (event) => handoffCommentAction("delete", event);
    deleteButton.addEventListener("click", beginDelete);
    const moreButton = dependencies.el("button", "comment-action");
    moreButton.type = "button";
    moreButton.title = "More";
    moreButton.setAttribute("aria-label", "More comment actions");
    moreButton.append(dependencies.svg("more"));
    const showCommentActions = (event) => {
      if (!event.isTrusted) return;
      const parentRow = row.parentElement?.closest?.(".comment-row");
      const parentId = parentRow?.dataset?.commentId;
      const hnLink = "https://news.ycombinator.com/item?id=" + comment.id;
      const offeredByHn = model.itemState?.status === "ok"
        && model.itemState?.comments?.[comment.id]?.replyAvailable === true;
      const canReply = Boolean(session && offeredByHn && comment.author && comment.text
        && !comment.dead && !comment.deleted
        && Date.now() / 1000 - (comment.created_at_i || 0) < 14 * 86400);
      const voteState = model.itemState?.comments?.[comment.id] || null;
      dependencies.openPopup(moreButton, [
        { heading: (comment.author || "[deleted]") +
          (comment.author === model.threadAuthor ? " (OP)" : "") },
        { heading: (body.textContent || "").trim().slice(0, 250) },
        ...(session ? [
          { label: voteState?.voted ? "Unvote" : "Vote up", icon: "up",
            action: (clicked) => dependencies.handleCommentVote(clicked, comment.id, false) },
          ...(voteState?.canDown || voteState?.votedDirection === "down"
            ? [{ label: voteState?.votedDirection === "down" ? "Undown" : "Vote down",
              icon: "down", action: (clicked) => dependencies.handleCommentVote(clicked, comment.id, true) }] : []),
        ] : []),
        { label: model.bookmarks.has(comment.id) ? "Remove bookmark" : "Bookmark",
          icon: "star", action: () => dependencies.toggleBookmark(comment.id) },
        ...(session ? [{ label: "Favorite", icon: "heart",
          action: async () => {
            const result = await window.HarmoNovaHN.setFavorite(comment.id, true);
            dependencies.showToast(result.status === "success" ? "Favorited" : result.message || "Favorite unavailable");
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
              dependencies.showToast("Link copied");
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
              dependencies.showToast("Comment text copied");
            } catch {}
          },
        },
        ...(parentId && Number(parentId) > 0
          ? [{ label: "Open parent", icon: "link", action: () => window.open("https://news.ycombinator.com/item?id=" + parentId, "_blank", "noopener") }]
          : []),
        {
          label: "Open top level",
          icon: "link",
          action: () => window.open("https://news.ycombinator.com/item?id=" + (model.selectedId || comment.id), "_blank", "noopener"),
        },
        ...(comment.author
          ? [{ label: "View user", icon: "user", action: () => dependencies.openUserPanel(comment.author) }]
          : []),
        ...(comment.author
          ? [
              { label: model.userTags.has(comment.author) ? "Edit user tag" : "Set user tag", icon: "star", action: () => openTagDialog(comment.author) },
              {
                label: model.blockedUsers.has(comment.author) ? "Unblock user" : "Block user",
                icon: "eyeOff",
                action: async () => {
                  if (model.blockedUsers.has(comment.author)) {
                    model.blockedUsers.delete(comment.author);
                    dependencies.showToast("Unblocked " + comment.author);
                  } else {
                    model.blockedUsers.add(comment.author);
                    dependencies.showToast("Blocked " + comment.author + " — their comments stay hidden here");
                  }
                  dependencies.persistBlockedUsers(comment.author);
                  if (model.thread) await dependencies.renderThread(model.thread);
                },
              },
            ]
          : []),
        // Phase 4: flag a comment only when HN offers the link (SEC-36 dialog).
        ...(model.itemState?.comments?.[comment.id]?.flagAvailable
          ? [{ label: "Flag comment", icon: "flag", action: (popupEvent) => dependencies.confirmFlagItem(popupEvent, comment.id, "comment") }]
          : []),
      ], event.type === "contextmenu" || event.type === "pointerdown" ? { x: event.clientX, y: event.clientY } : null);
    };
    moreButton.addEventListener("click", showCommentActions);
    meta.appendChild(moreButton);
    card.append(meta, body, collapsed);
    row.appendChild(card);

    const children = dependencies.el("div", "comment-children");
    for (const child of sortedComments(comment.children || [])) children.appendChild(renderComment(child, depth + 1));
    if (children.childElementCount) row.appendChild(children);

    // Blocked authors keep their place in the thread but collapse into a note.
    if (isBlockedAuthor) {
      const note = dependencies.el("div", "blocked-note");
      note.append(dependencies.el("span", "", "Hidden comment from a blocked user (" + comment.author + ")"));
      const unblock = dependencies.el("button", "blocked-unblock", "Unblock");
      unblock.type = "button";
      unblock.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        model.blockedUsers.delete(comment.author);
        dependencies.persistBlockedUsers(comment.author);
        row.classList.remove("is-blocked");
        note.remove();
      });
      note.appendChild(unblock);
      row.insertBefore(note, card);
    }

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button") || window.getSelection()?.toString()) return;
      if (model.settings.swapCommentActions) showCommentActions(event);
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
        if (model.settings.swapCommentActions) row.classList.toggle("collapsed");
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
    const overlay = dependencies.el("div", "tag-overlay");
    const panel = dependencies.el("section", "tag-panel");
    panel.append(dependencies.el("h3", "", "Tag for " + author));
    const input = dependencies.el("input", "tag-input");
    input.type = "text";
    input.maxLength = 40;
    input.value = model.userTags.get(author) || "";
    input.placeholder = "e.g. HN legend, careful reviewer";
    const row = dependencies.el("div", "tag-actions");
    const save = dependencies.el("button", "tag-save", "Save");
    save.type = "button";
    save.addEventListener("click", () => {
      const value = input.value.trim().slice(0, 40);
      if (value) model.userTags.set(author, value);
      else model.userTags.delete(author);
      dependencies.persistUserTags(author);
      overlay.remove();
      if (model.thread) dependencies.renderThread(model.thread);
    });
    const remove = dependencies.el("button", "tag-remove", "Remove tag");
    remove.type = "button";
    remove.hidden = !model.userTags.has(author);
    remove.addEventListener("click", () => {
      model.userTags.delete(author);
      dependencies.persistUserTags(author);
      overlay.remove();
      if (model.thread) dependencies.renderThread(model.thread);
    });
    const cancel = dependencies.el("button", "tag-cancel", "Cancel");
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



    return Object.freeze({get descendantCount(){return descendantCount;},
get sortedComments(){return sortedComments;},
renderComment});
  }
  globalThis.HarmoNovaContentComments=Object.freeze({create});
})();
