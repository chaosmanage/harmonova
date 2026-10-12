// Isolated-world HarmoNovaContentComposer module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
const draftBegin = (parentId, username) => dependencies.INCOGNITO
  ? Promise.resolve(dependencies.privateReader.beginDraft(username, parentId))
  : dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_DRAFT_BEGIN", parentId, username });
const draftSet = (composer, text) => {
  // Serial writes from one composer and compare-and-set against other tabs.
  composer.draftWrite = (composer.draftWrite || Promise.resolve()).then(async () => {
    await composer.draftReady;
    if (!composer.draftToken) return false;
    const response = dependencies.INCOGNITO
      ? dependencies.privateReader.saveDraft(composer.username, composer.parentId,
        composer.draftToken, composer.draftRevision, text)
      : await dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_DRAFT_SET",
        parentId: composer.parentId, username: composer.username,
        token: composer.draftToken, revision: composer.draftRevision, text });
    if (response?.ok) { composer.draftRevision = response.revision; return true; }
    composer.status.hidden = false;
    composer.status.classList.add("error");
    composer.status.textContent = response?.code === "DRAFT_CONFLICT"
      ? "Another tab updated this draft. Your unsaved text is kept here."
      : "Draft could not be saved. Keep this tab open to avoid losing your text.";
    if (response?.code === "DRAFT_CONFLICT") composer.draftToken = null;
    return false;
  }).catch(() => false);
  return composer.draftWrite;
};
const draftClear = async (composer) => {
  await composer.draftReady;
  await composer.draftWrite;
  if (!composer.draftToken) return false;
  const result = dependencies.INCOGNITO
    ? dependencies.privateReader.clearDraft(composer.username, composer.parentId, composer.draftToken)
    : await dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_DRAFT_CLEAR",
      username: composer.username, parentId: composer.parentId, token: composer.draftToken });
  if (result?.ok) composer.draftToken = null;
  return result?.ok === true;
};
const draftClearAll = (username) => new Promise((resolve) => {
  if (!username) return resolve(true);
  if (dependencies.INCOGNITO) return resolve(dependencies.privateReader.clearAccountDrafts(username).ok);
  chrome.runtime.sendMessage({ type: "HARMONOVA_DRAFT_CLEAR_ALL", username }, (response) => resolve(!chrome.runtime.lastError && response?.ok === true));
});

// SEC-36: destructive actions (delete comment) run only behind a real
// confirmation dialog with a Cancel button.
function openConfirmDialog({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  document.querySelector(".harmonova-confirm-overlay")?.remove();
  const overlay = dependencies.el("div", "harmonova-confirm-overlay");
  const panel = dependencies.el("div", "harmonova-confirm");
  panel.append(dependencies.el("h3", "", title), dependencies.el("p", "harmonova-confirm-message", message));
  const row = dependencies.el("div", "harmonova-confirm-actions");
  const cancel = dependencies.el("button", "harmonova-confirm-cancel", "Cancel");
  cancel.type = "button";
  const confirm = dependencies.el("button", "harmonova-confirm-confirm" + (danger ? " danger" : ""), confirmLabel);
  confirm.type = "button";
  cancel.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  confirm.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
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
        const link = dependencies.el("a", "", match[1]);
        link.href = match[1];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        node.append(link);
      } else node.append(dependencies.el("em", "", match[2]));
      start = match.index + match[0].length;
    }
    node.append(document.createTextNode(value.slice(start)));
  };
  const flush = () => {
    if (!paragraph.length) return;
    const p = dependencies.el("p");
    inline(p, paragraph.join(" "));
    target.append(p);
    paragraph = [];
  };
  let code = [];
  const flushCode = () => {
    if (code.length) target.append(dependencies.el("pre", "", code.join("\n")));
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
  const session = window.HarmoNovaHN?.session?.();
  if (!session) {
    dependencies.showToast("Sign in to reply");
    return;
  }
  const verb = mode === "edit" ? "Editing comment" : parentId === storyId ? "Commenting on" : "Replying to";
  const node = dependencies.el("section", "composer");
  if (parentId !== storyId) {
    const parent = findCommentNode(model.thread, parentId);
    if (parent) {
      const context = dependencies.el("div", "composer-parent-context");
      const excerpt = dependencies.el("div", "composer-parent-excerpt");
      excerpt.textContent = String(parent.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
      const expand = dependencies.el("button", "composer-secondary", "Show parent");
      expand.type = "button";
      expand.addEventListener("click", () => {
        const open = excerpt.classList.toggle("expanded");
        expand.textContent = open ? "Hide parent" : "Show parent";
      });
      context.append(dependencies.el("strong", "", "Replying to " + (parent.author || "[deleted]")), expand, excerpt);
      node.appendChild(context);
    }
  }
  const header = dependencies.el("div", "composer-header");
  header.append(
    dependencies.el("span", "composer-identity", verb + " as " + session.username),
    dependencies.el("span", "composer-chars", "0 characters"),
    (() => {
      const close = dependencies.el("button", "composer-close");
      close.type = "button";
      close.title = "Close composer (draft stays saved)";
      close.setAttribute("aria-label", "Close composer");
      close.append(dependencies.svg("close"));
      close.addEventListener("click", () => closeComposer({ keepDraft: true }));
      return close;
    })()
  );
  const textarea = dependencies.el("textarea", "composer-input");
  textarea.rows = 4;
  textarea.maxLength = 8000; // HN's own maxcommentchar limit
  textarea.placeholder = mode === "edit" ? "Edit your comment" : "Say something useful";
  textarea.value = initialText;
  const previewWrap = dependencies.el("div", "composer-preview");
  previewWrap.hidden = true;
  const status = dependencies.el("div", "composer-status");
  status.hidden = true;
  const actions = dependencies.el("div", "composer-actions");
  const previewToggle = dependencies.el("button", "composer-secondary", "Preview");
  previewToggle.type = "button";
  const discard = dependencies.el("button", "composer-secondary composer-discard", "Discard draft");
  discard.type = "button";
  const cancel = dependencies.el("button", "composer-secondary composer-cancel", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => closeComposer({ keepDraft: true }));
  const help = dependencies.el("a", "composer-format-help", "Formatting help");
  help.href = "https://news.ycombinator.com/formatdoc";
  help.target = "_blank";
  help.rel = "noopener noreferrer";
  const submit = dependencies.el("button", "composer-submit", mode === "edit" ? "Save edit" : "Post reply");
  submit.type = "button";
  submit.disabled = mode !== "edit";
  actions.append(help, previewToggle, discard, (() => {
    const spacer = dependencies.el("span", "composer-spacer");
    return spacer;
  })(), cancel, submit);
  const footnote = dependencies.el("div", "composer-footnote", "Posting as " + session.username + " · Ctrl+Enter posts · Esc keeps your draft" +
    (dependencies.INCOGNITO ? " · Private draft disappears on reload or when this tab closes" : ""));
  node.append(header, textarea, previewWrap, status, actions, footnote);

  // Draft restore note + autosave (debounced).
  let draftTimer = 0;

  const chars = header.querySelector(".composer-chars");
  const syncChars = () => {
    chars.textContent = textarea.value.length + (textarea.value.length === 1 ? " character" : " characters");
  };
  const renderPreview = () => {
    previewWrap.replaceChildren();
    if (!textarea.value.trim()) {
      previewWrap.append(dependencies.el("span", "composer-preview-empty", "Nothing to preview yet."));
      return;
    }
    formatHnPreview(previewWrap, textarea.value);
  };
  const autosave = (snapshot) => {
    clearTimeout(draftTimer);
    composer.draftTimer = draftTimer = setTimeout(() => {
      if (model.composer === composer && snapshot.trim()) draftSet(composer, snapshot);
    }, 500);
  };
  const grow = () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(420, textarea.scrollHeight + 2) + "px";
  };
  textarea.addEventListener("input", (event) => {
    if (!event.isTrusted) return;
    composer.lastTrustedText = textarea.value;
    syncChars();
    grow();
    if (!previewWrap.hidden) renderPreview();
    autosave(composer.lastTrustedText);
  });
  previewToggle.addEventListener("click", () => {
    const showing = !previewWrap.hidden;
    previewWrap.hidden = showing;
    previewToggle.textContent = showing ? "Preview" : "Write";
    if (!showing) renderPreview();
    textarea.hidden = !showing;
  });
  discard.addEventListener("click", (event) => {
    if (!event.isTrusted || composer.submitting || model.composer !== composer) return;
    clearTimeout(composer.draftTimer);
    discard.disabled = true;
    draftClear(composer).then(async success => {
      discard.disabled = false;
      if (!success || model.composer !== composer) {
        dependencies.showToast("Could not discard this draft. Try again.");
        return;
      }
      textarea.value = "";
      composer.lastTrustedText = "";
      syncChars(); grow();
      if (!previewWrap.hidden) renderPreview();
      composer.draftReady = draftBegin(parentId, composer.username).then(r => {
        if (r?.ok) { composer.draftToken = r.token; composer.draftRevision = r.revision; }
      });
      dependencies.showToast("Draft discarded");
    }).catch(() => { console.warn("HarmoNova: asynchronous UI operation failed"); });
  });
  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!event.isTrusted) return;
      submitComposer(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer({ keepDraft: true }).then(saved =>
        dependencies.showToast(saved ? "Draft saved" : "Draft not saved. Keep this tab open.")).catch(() => { console.warn("HarmoNova: asynchronous UI operation failed"); });
    }
  });
  submit.addEventListener("click", submitComposer);

  const composer = {scope:HarmoNovaLifecycle.create(), username: session.username, parentId, storyId, mode, handle, node, textarea, status, submit, previewToggle, previewWrap, discard, draftTimer, submitting: false, onDone, draftToken: null, draftRevision: 0, draftWrite: Promise.resolve(), draftReady: Promise.resolve(), lastTrustedText: "" };
  model.composer = composer;
  composer.scope.own(()=>clearTimeout(composer.draftTimer));
  if (mode === "reply") {
    status.hidden = false;
    status.textContent = "Checking availability on Hacker News…";
    window.HarmoNovaHN.openReplyForm(parentId, { storyId,signal:composer.scope.signal }).then((opened) => {
      if (model.composer !== composer) return;
      if (opened.status === "ok") {
        composer.handle = opened.handle;
        submit.disabled = false;
        status.hidden = true;
      } else {
        status.textContent = opened.message || "Reply unavailable. Open Hacker News to continue.";
        status.classList.add("error");
        const escape = dependencies.el("button", "composer-hn-open", "Open reply on Hacker News");
        escape.type = "button";
        escape.addEventListener("click", () => dependencies.openOriginalHackerNews(
          "/reply?id=" + parentId + "&goto=" + dependencies.encodeURIComponent("item?id=" + storyId)));
        status.append(document.createTextNode(" "), escape);
      }
    }).catch(() => {
      if (model.composer !== composer) return;
      status.textContent = "Could not load the reply form. Your draft is kept.";
      status.classList.add("error");
    });
  }
  // Insert: inline under the anchored comment row, else above the comments.
  if (anchor) {
    anchor.insertBefore(node, anchor.querySelector(".comment-children"));
  } else {
    const heading = dependencies.threadPane.querySelector(".comments-heading");
    if (heading) dependencies.threadPane.insertBefore(node, heading.nextSibling);
    else dependencies.threadPane.appendChild(node);
  }
  syncChars();
  grow();
  textarea.focus();
  // Surface a previously saved draft for this parent.
  composer.draftReady = draftBegin(parentId, composer.username).then(result => {
    if (!result?.ok) return;
    composer.draftToken = result.token;
    composer.draftRevision = result.revision;
    if (result.text && model.composer === composer && !textarea.value) {
      textarea.value = result.text;
      composer.lastTrustedText = result.text;
      status.hidden = false;
      status.textContent = "Draft restored.";
      status.classList.remove("error");
      syncChars(); grow();
    }
  }).catch(() => { status.hidden = false; status.textContent = "Draft persistence is unavailable."; });

  function submitComposer(event) {
    if (!event?.isTrusted) return;
    if (model.composer !== composer || composer.submitting || !composer.handle) return;
    if (window.HarmoNovaHN.session()?.username !== composer.username) {
      handleComposerOutcome(composer, { status: "accountChanged", message: "Account changed. Your draft is kept." }, textarea.value);
      return;
    }
    const submissionHandle = composer.handle;
    const text = textarea.value;
    if (text !== composer.lastTrustedText) {
      status.hidden = false;
      status.textContent = "Text changed without a trusted edit. Review and retype before submitting.";
      status.classList.add("error");
      return;
    }
    if (!text.trim()) {
      status.hidden = false;
      status.textContent = "Write something first.";
      status.classList.add("error");
      return;
    }
    clearTimeout(composer.draftTimer);
    composer.submitting = true;
    textarea.disabled = true;
    discard.disabled = true;
    submit.disabled = true;
    previewToggle.disabled = true;
    status.hidden = false;
    status.classList.remove("error");
    status.textContent = mode === "edit" ? "Saving your edit on Hacker News…" : "Posting your reply…";
    (async () => {
      try {
        // Preserve the captured draft before an ambiguous mutation can outlive
        // this worker/document. The trusted event and handle were captured above.
        if (!(await draftSet(composer,text))) {
          composer.submitting=false;textarea.disabled=false;discard.disabled=false;submit.disabled=false;previewToggle.disabled=false;
          if(!status.classList.contains("error")){status.hidden=false;status.classList.add("error");status.textContent="Draft could not be saved. No reply was sent. Keep this tab open.";}
          return;
        }
        if(model.composer!==composer || !composer.scope.alive)return;
        let outcome;
        if (mode === "edit") {
          outcome = await window.HarmoNovaHN.saveEdit(submissionHandle, text);
        } else {
          outcome = await window.HarmoNovaHN.postComment(submissionHandle, text);
        }
        await handleComposerOutcome(composer, outcome, text);
      } catch {
        await handleComposerOutcome(composer, { status: "indeterminate", message: "The request to Hacker News failed. Your draft is kept." }, text);
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
  if (!model.thread || model.thread.id !== composer.storyId) return;
  if (composer.mode === "edit") {
    const comment = findCommentNode(model.thread, composer.parentId);
    if (comment) comment.text = text;
    const edits = model.confirmedEdits.get(composer.storyId) || new Map();
    edits.set(composer.parentId, text);
    model.confirmedEdits.set(composer.storyId, edits);
    const row = dependencies.threadPane.querySelector('[data-comment-id="' + composer.parentId + '"]');
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
    author: window.HarmoNovaHN.session()?.username || null,
    created_at_i: Math.floor(Date.now() / 1000),
    text: posted.html,
    children: [],
  };
  const parent = composer.parentId === composer.storyId
    ? model.thread
    : findCommentNode(model.thread, composer.parentId);
  if (!parent) return;
  if (!findCommentNode(model.thread, posted.id)) parent.children = [entry, ...(parent.children || [])];
  const local = model.confirmedComments.get(composer.storyId) || new Map();
  local.set(posted.id, { parentId: composer.parentId, entry });
  model.confirmedComments.set(composer.storyId, local);
  const parentRow = composer.parentId === composer.storyId ? null
    : dependencies.threadPane.querySelector('[data-comment-id="' + composer.parentId + '"]');
  let container = composer.parentId === composer.storyId
    ? dependencies.threadPane.querySelector(".comments")
    : parentRow?.querySelector(":scope > .comment-children");
  if (!container && parentRow) {
    container = dependencies.el("div", "comment-children");
    parentRow.appendChild(container);
  }
  if (!container || container.querySelector('[data-comment-id="' + posted.id + '"]')) return;
  container.querySelector(":scope > .empty-comments")?.remove();
  const depth = composer.parentId === composer.storyId ? 0
    : Number(container.closest(".comment-row")?.dataset.depth || 0) + 1;
  const row = dependencies.renderComment(entry, depth);
  row.classList.add("just-posted");
  row.querySelector(".comment-meta")?.append(dependencies.el("span", "posted-marker", "Posted"));
  container.prepend(row);
  row.scrollIntoView({ block: "center", behavior: "smooth" });
}

function mergeConfirmedComments(item) {
  const local = model.confirmedComments.get(item.id);
  if (local) for (const { parentId, entry } of local.values()) {
    if (findCommentNode(item, entry.id)) continue;
    const parent = parentId === item.id ? item : findCommentNode(item, parentId);
    if (parent) parent.children = [entry, ...(parent.children || [])];
  }
  for (const [id, text] of model.confirmedEdits.get(item.id) || []) {
    const comment = findCommentNode(item, id);
    if (comment) comment.text = text;
  }
  for (const id of model.confirmedDeletes.get(item.id) || []) {
    const comment = findCommentNode(item, id);
    if (comment) { comment.text = null; comment.author = null; comment.deleted = true; }
  }
}

async function handleComposerOutcome(composer, outcome, text) {
  const { status, submit, previewToggle } = composer;
  if (outcome?.status === "success") {
    clearTimeout(composer.draftTimer);
    const cleared = await draftClear(composer);
    applyLocalComment(composer, outcome, text);
    if (model.composer === composer) await closeComposer({ keepDraft: false });
    dependencies.showToast((composer.mode === "edit" ? "Edit saved" : "Reply posted") +
      (cleared ? "" : " · saved draft could not be cleared"));
    return;
  }
  composer.submitting = false;
  composer.textarea.disabled = false;
  composer.discard.disabled = false;
  submit.disabled = false;
  previewToggle.disabled = false;
  status.hidden = false;
  const message = outcome?.message || "Hacker News did not confirm the post. Your draft is kept.";
  status.textContent = message;
  status.classList.add("error");
  // Draft is kept in all non-success outcomes (module outcomes say "draft kept").
  draftSet(composer, text);
  if (outcome?.status !== "loginRequired" && outcome?.status !== "accountChanged") {
    const open = dependencies.el("button", "composer-hn-open", "Check on Hacker News");
    open.type = "button";
    open.addEventListener("click", () => dependencies.openOriginalHackerNews("/item?id=" + composer.storyId));
    status.appendChild(document.createElement("br"));
    status.appendChild(open);
  }
  if (outcome?.status === "loginRequired" || outcome?.status === "accountChanged") dependencies.updateAccountChip();
}

async function closeComposer({ keepDraft = true } = {}) {
  const composer = model.composer;
  if (!composer) return false;
  clearTimeout(composer.draftTimer);
  await composer.draftReady;
  let saved = true;
  if (keepDraft && composer.mode === "reply" && composer.lastTrustedText.trim())
    saved = await draftSet(composer, composer.lastTrustedText);
  else await composer.draftWrite;
  if (!saved) {
    dependencies.showToast("Your draft was not saved. Keep this tab open.");
    return false;
  }
  if (composer.draftToken) {
    if (dependencies.INCOGNITO) dependencies.privateReader.retire(composer.draftToken);
    else await dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_DRAFT_RETIRE", token: composer.draftToken });
  }
  composer.draftToken = null;
  composer.scope?.dispose();
  composer.node?.remove();
  if (model.composer === composer) model.composer = null;
  return true;
}


    return Object.freeze({get draftSet(){return draftSet;},
get draftClearAll(){return draftClearAll;},
openConfirmDialog,
openComposer,
mergeConfirmedComments,
closeComposer});
  }
  globalThis.HarmoNovaContentComposer=Object.freeze({create});
})();
