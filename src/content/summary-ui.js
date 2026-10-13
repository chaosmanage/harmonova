// Isolated-world HarmoNovaContentSummary module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  function appendSummaryInline(target, text) {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
    let cursor = 0;
    for (const match of String(text || "").matchAll(pattern)) {
      if (match.index > cursor) target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      // SEC-44: AI output never renders Markdown images. An image token is
      // demoted to plain text so no remote URL is ever fetched or embedded.
      if (text.slice(Math.max(0, match.index - 1), match.index) === "!") {
        target.appendChild(document.createTextNode(token));
        cursor = match.index + token.length;
        continue;
      }
      if (token.startsWith("`")) {
        target.appendChild(dependencies.el("code", "", token.slice(1, -1)));
      } else if (token.startsWith("**")) {
        target.appendChild(dependencies.el("strong", "", token.slice(2, -2)));
      } else if (token.startsWith("[")) {
        const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const href = parts ? dependencies.safeHref(parts[2]) : null;
        if (parts && href) {
          const link = dependencies.el("a", "", parts[1]);
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          target.appendChild(link);
        } else {
          target.appendChild(document.createTextNode(token));
        }
      } else {
        target.appendChild(dependencies.el("em", "", token.slice(1, -1)));
      }
      cursor = match.index + token.length;
    }
    if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function renderSummaryMarkdown(target, markdown) {
    target.replaceChildren();
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    let list = null;
    const flushList = () => {
      if (!list) return;
      target.appendChild(list);
      list = null;
    };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      if (bullet) {
        if (!list) list = dependencies.el("ul", "summary-list");
        const item = dependencies.el("li");
        appendSummaryInline(item, bullet[1]);
        list.appendChild(item);
        continue;
      }
      flushList();
      if (!line.trim()) continue;
      const paragraph = dependencies.el("p");
      appendSummaryInline(paragraph, line.trim());
      target.appendChild(paragraph);
    }
    flushList();
  }

  function summaryStateFor(storyId) {
    return model.summaries.get(storyId) || { status: "idle", text: "", error: "" };
  }

  function updateSummarySurface(storyId) {
    const surface = document.querySelector('[data-summary-story-id="' + storyId + '"]');
    if (!surface) return;
    const current = summaryStateFor(storyId);
    surface.dataset.status = current.status;
    const status = surface.querySelector(".story-summary-status");
    const body = surface.querySelector(".story-summary-body");
    const heading = surface.querySelector(".story-summary-heading strong");
    if (heading) heading.textContent = current.source === "discussion" ? "Discussion summary" : "Summary";
    if (current.status === "extracting") status.textContent = current.source === "discussion" ? "Preparing discussion…" : "Reading provider excerpt…";
    else if (current.status === "generating") status.textContent = current.detail || "Summarizing…";
    else if (current.status === "error") status.textContent = "Summary failed";
    else status.textContent = "";
    if (current.status === "error") {
      body.replaceChildren(dependencies.el("p", "story-summary-error", current.error || "Summary failed"));
      if (current.errorCode === "ARTICLE_ACCESS_DENIED") {
        const article = model.selectedStory?.url || (model.thread?.id === storyId ? model.thread.url : null);
        if (dependencies.safeHref(article)) {
          const link = dependencies.el("a", "composer-hn-open", "Open article in browser");
          link.href = dependencies.safeHref(article);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          body.appendChild(link);
        }
        if (discussionTextForSummary(model.thread, model.selectedStory || model.thread)) {
          const fallback = dependencies.el("button", "composer-hn-open", "Summarize HN discussion instead");
          fallback.type = "button";
          fallback.addEventListener("click", (event) => {
            if (event.isTrusted && model.selectedId === storyId) startStorySummary(model.selectedStory || model.thread, { source: "discussion", trusted: true });
          });
          body.appendChild(fallback);
        }
      }
    } else {
      renderSummaryMarkdown(body, current.text);
    }
    surface.hidden = current.status === "idle" && !current.text;
    const running = current.status === "extracting" || current.status === "generating";
    for (const action of document.querySelectorAll('[data-summary-action-id="' + storyId + '"]')) {
      const source = action.dataset.summarySource;
      const ownSource = source === (current.source || "article");
      const label = source === "discussion" ? "discussion" : "article";
      const active = ownSource && current.status === "success";
      action.disabled = source === "article" && !model.thread?.url;
      action.classList.toggle("loading", running && ownSource);
      action.classList.toggle("active", active);
      action.title = running && ownSource ? "Cancel " + label + " summary"
        : active ? "Regenerate " + label + " summary" : "Summarize " + label;
      action.setAttribute("aria-label", action.title);
      action.setAttribute("aria-pressed", String(active));
    }
  }

  function createSummarySurface(storyId) {
    const card = dependencies.el("section", "story-summary");
    card.dataset.summaryStoryId = String(storyId);
    const heading = dependencies.el("div", "story-summary-heading");
    heading.append(dependencies.svg("sparkle"), dependencies.el("strong", "", "Summary"));
    const status = dependencies.el("span", "story-summary-status");
    heading.appendChild(status);
    const body = dependencies.el("div", "story-summary-body");
    card.append(heading, body);
    updateSummarySurface(storyId);
    return card;
  }

  function stopActiveSummary() {
    model.summaryGeneration++;
    const active = model.activeSummary;
    if (!active) return;
    model.activeSummary = null;
    model.summaries.set(active.storyId, { status: "idle", text: "", error: "" });
    try { active.port.postMessage({ type: "cancel" }); } catch {}
    try { active.port.disconnect(); } catch {}
    updateSummarySurface(active.storyId);
  }

  function discussionTextForSummary(thread, story) {
    if (!thread || thread.id !== story?.id) return "";
    const result = ["Hacker News discussion: " + String(story.title || thread.title || "").slice(0, 300)];
    const comments = [];
    const collect = (children) => {
      for (const comment of children || []) {
        if (comments.length >= 50) return;
        if (comment.text && comment.author) {
          const html = new DOMParser().parseFromString(String(comment.text), "text/html");
          const text = (html.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
          if (text) comments.push(String(comment.author).slice(0, 80) + ": " + text);
        }
        collect(comment.children);
      }
    };
    collect(thread.children);
    if (!comments.length) return "";
    return result.concat(comments).join("\n").slice(0, 15000);
  }

  async function startStorySummary(item, options = {}) {
    const automatic = Boolean(options.automatic);
    if (dependencies.INCOGNITO) { if (!automatic && options.trusted) dependencies.showToast("AI summaries are unavailable in private tabs"); return; }
    if (automatic) {
      if (model.aiSelectionIntent !== Number(item?.id)) return;
      model.aiSelectionIntent = null; // One-use intent; rendering never reissues billing.
    } else if (!options.trusted) return;
    const source = options.source === "discussion" ? "discussion" : "article";
    if (model.activeSummary?.storyId === Number(item?.id)) {
      if (automatic) return;
      if (model.activeSummary.source === source) { stopActiveSummary(); return; }
      // Choosing the other source switches summaries instead of only cancelling.
    }
    const generation = ++model.summaryGeneration;
    if (source === "article" && !item?.url) {
      if (!automatic) dependencies.showToast("This story has no linked article to summarize");
      return;
    }
    const keyStatus = await dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_AI_STATUS" });
    if (generation !== model.summaryGeneration || Number(item.id) !== model.selectedId) return;
    if (!keyStatus?.hasKey || !keyStatus.enabled || (automatic && !keyStatus.autoSummarize)) {
      if (!automatic) {
        dependencies.showToast("Add your OpenRouter API key in Settings");
        dependencies.openSettings({ focusAi: true });
      }
      return;
    }

    const discussionText = source === "discussion" ? discussionTextForSummary(model.thread, item) : "";
    if (source === "discussion" && !discussionText) {
      if (!automatic) dependencies.showToast("No public comments are available for a discussion summary");
      return;
    }
    stopActiveSummary();
    const storyId = Number(item.id);
    model.summaries.set(storyId, { status: "extracting", source, text: "", error: "" });
    updateSummarySurface(storyId);
    let port;
    try { port = chrome.runtime.connect({ name: "harmonova-ai" }); }
    catch (error) {
      HarmoNovaContentRuntime.handleError(error);
      model.summaries.set(storyId, { status: "error", source, text: "", error: "Summary connection unavailable. Reload this tab." });
      updateSummarySurface(storyId);
      return;
    }
    const requestId = "summary-" + storyId + "-" + generation;
    model.activeSummary = { storyId, port, source, requestId };

    port.onMessage.addListener((message) => {
      if (model.activeSummary?.port !== port || Number(message?.storyId) !== storyId || message?.requestId !== requestId) return;
      if (message.type === "status") {
        const current = summaryStateFor(storyId);
        model.summaries.set(storyId, { ...current, status: message.status, detail: String(message.detail || ""), error: "" });
      } else if (message.type === "progress") {
        model.summaries.set(storyId, { status: "generating", source, text: String(message.text || ""), error: "" });
      } else if (message.type === "success") {
        model.summaries.set(storyId, { status: "success", source, text: String(message.text || ""), error: "" });
        if (model.activeSummary?.port === port) model.activeSummary = null;
        try { port.disconnect(); } catch {}
      } else if (message.type === "error") {
        model.summaries.set(storyId, { status: "error", source, text: "", errorCode: String(message.code || ""), error: String(message.message || "Summary failed") });
        if (model.activeSummary?.port === port) model.activeSummary = null;
        try { port.disconnect(); } catch {}
      }
      updateSummarySurface(storyId);
    });
    port.onDisconnect.addListener(() => {
      if (model.activeSummary?.port !== port) return;
      model.activeSummary = null;
      model.summaries.set(storyId, { status: "error", text: "", error: "Summary connection closed. Try again." });
      updateSummarySurface(storyId);
    });
    try { port.postMessage({
      type: "summarize",
      requestId,
      storyId,
      source,
      ...(source === "discussion" ? { discussionText } : {}),
    }); } catch (error) {
      HarmoNovaContentRuntime.handleError(error);
      model.activeSummary = null;
      model.summaries.set(storyId, { status: "error", source, text: "", error: "Summary connection unavailable. Reload this tab." });
      updateSummarySurface(storyId);
      try { port.disconnect(); } catch {}
    }
  }


    return Object.freeze({summaryStateFor,
updateSummarySurface,
createSummarySurface,
stopActiveSummary,
startStorySummary});
  }
  globalThis.HarmoNovaContentSummary=Object.freeze({create});
})();
