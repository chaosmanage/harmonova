// Isolated-world HarmoNovaContentSettings module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  function settingToggle(label, key, description) {
    const row = dependencies.el("label", "setting-row");
    const text = dependencies.el("span", "setting-copy");
    text.append(dependencies.el("strong", "", label), dependencies.el("small", "", description));
    const input = dependencies.el("input", "setting-switch");
    input.type = "checkbox";
    input.checked = Boolean(model.settings[key]);
    input.addEventListener("change", async () => {
      model.settings[key] = input.checked;
      await dependencies.saveSettings(key);
      dependencies.applySettings();
      if (key === "tintedCards") document.querySelectorAll(".story-card").forEach((card) => card.classList.toggle("no-tint", !input.checked));
      if (model.thread && ["markNewComments", "hideDelayed", "showAvatars", "nitterRedirect", "richPreviews"].includes(key)) dependencies.renderThread(model.thread);
      if (key === "nitterRedirect" || key === "nitterInstance") dependencies.refreshStoryLinks();
    });
    row.append(text, input);
    return row;
  }

  function settingSlider(label, key, min, max, step, suffix = "") {
    const row = dependencies.el("label", "setting-row setting-slider-row");
    const text = dependencies.el("span", "setting-copy");
    const valueLabel = dependencies.el("small", "setting-value", String(model.settings[key]) + suffix);
    text.append(dependencies.el("strong", "", label), valueLabel);
    const input = dependencies.el("input", "setting-slider");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(model.settings[key]);
    input.addEventListener("input", async () => {
      model.settings[key] = Number(input.value);
      valueLabel.textContent = String(model.settings[key]) + suffix;
      dependencies.applySettings();
      await dependencies.saveSettings(key,true);
    });
    row.append(text, input);
    return row;
  }

  function settingSelect(label, key, options) {
    const row = dependencies.el("label", "setting-row");
    const text = dependencies.el("span", "setting-copy");
    text.append(dependencies.el("strong", "", label));
    const select = dependencies.el("select", "setting-select");
    for (const [value, name] of options) {
      const option = dependencies.el("option", "", name);
      option.value = value;
      option.selected = String(model.settings[key]) === String(value);
      select.appendChild(option);
    }
    select.addEventListener("change", async () => {
      const numeric = typeof model.settings[key] === "number";
      model.settings[key] = numeric ? Number(select.value) : select.value;
      await dependencies.saveSettings(key);
      dependencies.applySettings();
      if (model.thread && ["commentStyle", "depthMode", "commentSort"].includes(key)) dependencies.renderThread(model.thread);
    });
    row.append(text, select);
    return row;
  }

  function settingText(label, key, description, options = {}) {
    const multiline = Boolean(options.multiline);
    const row = dependencies.el("label", "setting-row setting-text-row");
    const text = dependencies.el("span", "setting-copy");
    text.append(dependencies.el("strong", "", label), dependencies.el("small", "", description));
    const input = dependencies.el(multiline ? "textarea" : "input", multiline ? "setting-textarea" : "setting-text");
    if (!multiline) input.type = "text";
    input.value = String(model.settings[key] ?? "");
    if (multiline) input.rows = 5;
    input.addEventListener("change", async () => {
      model.settings[key] = input.value.trim();
      await dependencies.saveSettings(key);
      if (key === "hiddenDomains" || key === "hiddenKeywords") dependencies.filterStories();
      if (typeof options.onChange === "function") options.onChange();
    });
    row.append(text, input);
    return row;
  }

  function openSettings(options = {}) {
    document.querySelector(".settings-overlay")?.remove();
    const overlay = dependencies.el("div", "settings-overlay");
    const panel = dependencies.el("section", "settings-panel");
    const header = dependencies.el("header", "settings-header");
    header.append(dependencies.el("h2", "", "Settings"));
    const close = dependencies.button("close", "Close");
    const closeSettings=async()=>{if(await dependencies.flushSettings())overlay.remove();};
    close.addEventListener("click",closeSettings);
    header.appendChild(close);

    const storySection = dependencies.el("div", "settings-section");
    storySection.append(
      dependencies.el("h3", "", "Stories"),
      settingSelect("Preview images", "previewImages", [["medium", "Medium"], ["small", "Small"], ["off", "Off"]]),
      settingToggle("Tint cards from images", "tintedCards", "Use each story preview to color its card"),
      settingToggle("Favicons", "showFavicons", "Show the source icon beside metadata"),
      settingToggle("Points", "showPoints", "Show story score"),
      settingToggle("Comment count", "showComments", "Show the large comments control"),
      settingToggle("Story number", "showIndex", "Show story position in the feed"),
      settingToggle("Dim read stories", "dimRead", "Fade stories after opening them"),
      settingToggle("Hotness colors", "hotnessColors", "Color scores by how fast a story is moving"),
      settingToggle("Compact points", "compactPoints", "Show abbreviated scores without the word points"),
      settingToggle("Show domain", "showDomain", "Show the story's source domain in the metadata"),
      settingToggle("Hide jobs", "hideJobs", "Filter job stories out of every feed"),
      settingToggle("Hide read stories", "hideRead", "Filter stories you have already opened out of the feed"),
      settingText("Hidden domains", "hiddenDomains", "Comma-separated domains to filter, e.g. example.com, sub.example.org"),
      settingText("Hidden keywords", "hiddenKeywords", "Comma-separated title keywords to filter, case-insensitive"),
      dependencies.el("p", "settings-note", "Preview images are enabled by default; turn them off under AI Summarization. Websites without usable images show a local placeholder."),
      settingSlider("Story text size", "storyTextSize", 14.5, 20.5, 0.5, " sp"),
      settingSlider("Content zoom", "contentScale", 75, 125, 5, "%")
    );

    const commentsSection = dependencies.el("div", "settings-section");
    commentsSection.append(
      dependencies.el("h3", "", "Comments"),
      settingSelect("Comment style", "commentStyle", [["outlined", "Outlined"], ["raised", "Raised"], ["standard", "Standard"], ["flat", "Flat"]]),
      settingSelect("Comment sorting", "commentSort", [["Default", "Default"], ["Newest first", "Newest first"], ["Oldest first", "Oldest first"], ["Reply count", "Reply count"]]),
      settingSelect("Thread colors", "depthMode", [["theme_default", "Theme default"], ["material_you", "Material You"], ["colors", "Colorful"], ["author", "Author"], ["monochrome", "Monochrome"], ["none", "None"]]),
      settingToggle("Rounded depth indicators", "roundedRails", "Round the thread indicator ends"),
      settingToggle("Continuous depth indicators", "continuousRails", "Continue ancestor rails through replies"),
      settingToggle("Mark new comments", "markNewComments", "Highlight comments posted since your last visit to a story"),
      settingToggle("Hide [delayed]", "hideDelayed", "Collapse HN's [delayed] placeholder comments"),
      settingToggle("Comment avatars", "showAvatars", "Show generated local avatars beside comment authors"),
      settingToggle("Swap comment actions", "swapCommentActions", "Tap opens actions; long-press collapses"),
      settingSlider("Comment text size", "commentTextSize", 12, 18, 0.5, " sp"),
      settingSlider("Comment zoom", "commentZoom", 70, 130, 5, "%")
    );

    const userDataSection = dependencies.el("div", "settings-section");
    const exportButton = dependencies.el("button", "setting-button", "Export user data (JSON)");
    exportButton.type = "button";
    exportButton.addEventListener("click", exportUserData);
    const importButton = dependencies.el("button", "setting-button", "Import user data");
    importButton.type = "button";
    importButton.addEventListener("click", () => importFileInput.click());
    const importFileInput = dependencies.el("input", "setting-import-input");
    importFileInput.type = "file";
    importFileInput.accept = "application/json,.json";
    importFileInput.hidden = true;
    importFileInput.addEventListener("change", () => importUserData(importFileInput));
    userDataSection.append(
      dependencies.el("h3", "", "Your local data"),
      exportButton,
      importButton,
      importFileInput,
      dependencies.el("p", "settings-note", "Bookmarks, read stories, user tags, and blocked users are stored on this profile. Export saves them as a JSON file; import merges a previously exported file after schema validation (integers for ids, small strings for tags, 256 KB cap). Nothing here is synced to Hacker News or any server.")
    );

    const headerDisplaySection = dependencies.el("div", "settings-section");
    headerDisplaySection.append(
      dependencies.el("h3", "", "Header display"),
      settingToggle("Background tint", "headerTint", "Tint the discussion header from the story preview"),
      settingToggle("Preview image", "headerImage", "Show the story preview above the discussion title")
    );

    // Phase 7 part 3: appearance (theme + font) and link behavior.
    const appearanceSection = dependencies.el("div", "settings-section");
    appearanceSection.append(
      dependencies.el("h3", "", "Appearance"),
      settingSelect("Theme", "uiTheme", [["amoled", "AMOLED black"], ["charcoal", "Charcoal"], ["navy", "Deep navy"]]),
      settingSelect("Font", "uiFont", [["rounded", "Google Sans Flex Rounded"], ["system", "System UI"], ["serif", "Serif"]]),
      dependencies.el("p", "settings-note", "Themes restyle HarmoNova's own surfaces only; pages opened through Open original HN keep Hacker News's own look.")
    );

    const linksSection = dependencies.el("div", "settings-section");
    linksSection.append(
      dependencies.el("h3", "", "Links"),
      settingToggle("Rich link previews", "richPreviews", "Show website metadata and provider facts in link previews"),
      settingToggle("Open X/Twitter links via Nitter", "nitterRedirect", "Rewrite twitter.com and x.com links (story titles and comment links) to a Nitter instance"),
      settingText("Nitter instance", "nitterInstance", "Bare hostname only, e.g. nitter.net", {
        onChange: () => {
          dependencies.refreshStoryLinks();
          if (model.settings.nitterInstance && !dependencies.nitterInstanceHost()) dependencies.showToast("That doesn't look like a hostname — Nitter links keep the default");
        },
      }),
      dependencies.el("p", "settings-note", "Website previews are enabled by default and can be controlled under AI Summarization. Sites that block metadata or images use placeholders. Nitter links open the instance you select.")
    );

    const aiSection = dependencies.el("div", "settings-section ai-settings-section");
    const aiFrame = dependencies.el("iframe", "ai-settings-frame");
    aiFrame.title = "Secure AI and preview preferences";
    aiFrame.src = chrome.runtime.getURL("ai-settings.html");
    aiFrame.setAttribute("referrerpolicy", "no-referrer");
    aiFrame.setAttribute("loading", "lazy");
    aiSection.append(
      dependencies.el("h3", "", "AI summarization"),
      dependencies.el("p", "settings-note ai-settings-intro", "Control article and discussion summaries, OpenRouter access, and website previews here. Credentials and consent stay inside HarmoNova’s secure extension panel."),
      ...(dependencies.INCOGNITO
        ? [dependencies.el("p", "settings-note", "AI and external previews are unavailable in private tabs. Configure these preferences from a normal HarmoNova tab.")]
        : [aiFrame])
    );

    const behaviorSection = dependencies.el("div", "settings-section");
    behaviorSection.append(
      dependencies.el("h3", "", "Behavior"),
      settingToggle("Enable story card click", "cardClickEnabled", "Click a card background to open its article. When off, use the title or comments button instead."),
      settingToggle("Card click opens comments", "cardClickComments", "Switch story-card clicks from the article to the discussion. The comments button always opens the discussion."),
      settingToggle("Article links also open comments", "alwaysOpenComments", "When a title or preview opens an article in a new tab, also load its discussion here."),
      dependencies.el("p", "settings-note", "By default, clicking a story card opens the article and its comments button opens the discussion. Turn off card clicks to use only the explicit title and comments controls.")
    );

    // Phase 1: Account explainer. HarmoNova has no password field (SEC-01);
    // sign-in happens on Hacker News's own page and the session lives in
    // Hacker News's cookie.
    const session = window.HarmoNovaHN?.session?.() || null;
    const accountSection = dependencies.el("div", "settings-section");
    accountSection.append(
      dependencies.el("h3", "", "Account"),
      dependencies.el("p", "settings-note", session?.username
        ? "Signed in to Hacker News as " + session.username + (session.karma !== null && session.karma !== undefined ? " (" + dependencies.compact(session.karma) + " karma)" : "") + ". Use the account chip in the toolbar to open your profile or log out."
        : "Not signed in to Hacker News. Use the Log in chip in the toolbar — sign-in happens on Hacker News's own page in this tab."),
      dependencies.el("p", "settings-note", "HarmoNova never sees or stores your Hacker News password. Your session lives in Hacker News's own cookie. When you vote, favorite, or reply, HarmoNova sends the action directly to Hacker News through the same signed-in browser session; one-time tokens read from Hacker News pages stay in memory for this tab only and never reach HarmoNova's storage or sync.")
    );

    // A category index keeps the settings compact without changing any
    // persisted keys or dropping advanced controls.
    const categories = [
      ["Appearance", [appearanceSection, headerDisplaySection]],
      ["Stories", [storySection, behaviorSection]],
      ["Comments", [commentsSection]],
      ["Web and links", [linksSection]],
      ["Account", [accountSection]],
      ["Data", [userDataSection]],
      ["AI Summarization", [aiSection]],
    ];
    const index = dependencies.el("nav", "settings-categories");
    const back = dependencies.button("chevron", "Back to settings categories", "settings-back");
    back.hidden = true;
    back.addEventListener("click", showIndex);
    header.insertBefore(back, header.firstChild);
    const sections = dependencies.el("div", "settings-pages");
    for (const [name, children] of categories) {
      const link = dependencies.el("button", "settings-category");
      link.type = "button";
      link.append(dependencies.el("strong", "", name), dependencies.el("span", "", "›"));
      link.addEventListener("click", () => showCategory(name));
      index.append(link);
      for (const section of children) {
        section.hidden = true;
        sections.append(section);
      }
    }
    function showIndex() {
      index.hidden = false;
      back.hidden = true;
      header.querySelector("h2").textContent = "Settings";
      for (const section of sections.children) section.hidden = true;
      panel.scrollTop = 0;
    }
    function showCategory(name) {
      index.hidden = true;
      back.hidden = false;
      header.querySelector("h2").textContent = name;
      const group = categories.find(([label]) => label === name)?.[1] || [];
      for (const section of sections.children) section.hidden = !group.includes(section);
      panel.scrollTop = 0;
    }
    panel.append(header, index, sections);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeSettings(); });
    document.body.appendChild(overlay);
    if (options.focusAi) {
      showCategory("AI Summarization");
      aiSection.classList.add("settings-section-highlight");
      setTimeout(() => aiSection.classList.remove("settings-section-highlight"), 1200);
    }
  }

  // Phase 7 part 2: export/import of local user data (bookmarks, read ids,
  // user tags, blocked users). Strict schema validation on import; integers
  // only for ids; hard size caps everywhere.
  const USER_DATA_VERSION = 1;
  const USER_DATA_MAX_BYTES = 262144;

  function exportUserData() {
    const payload = {
      version: USER_DATA_VERSION,
      exportedAt: new Date().toISOString(),
      bookmarks: [...model.bookmarks].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 2000),
      readStoryIds: [...model.readIds].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 1500),
      userTags: Object.fromEntries([...model.userTags].slice(0, 500)),
      blockedUsers: [...model.blockedUsers].slice(0, 500),
      seenTimes: Object.fromEntries([...model.seenTimes].slice(-400)),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "harmonova-user-data.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    dependencies.showToast("User data exported");
  }

  const sanitizeIdList = (value, cap) => {
    if (!Array.isArray(value)) return null;
    const ids = value.filter((id) => Number.isSafeInteger(id) && id > 0);
    if (ids.length !== value.length) return null; // integers only, no coercion
    return ids.slice(0, cap);
  };

  async function importUserData(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > USER_DATA_MAX_BYTES) {
      dependencies.showToast("Import refused — file is larger than 256 KB");
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      dependencies.showToast("Import refused — not valid JSON");
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== USER_DATA_VERSION) {
      dependencies.showToast("Import refused — unrecognized schema");
      return;
    }
    const bookmarks = sanitizeIdList(data.bookmarks, 2000);
    const readStoryIds = sanitizeIdList(data.readStoryIds, 1500);
    let truncated = data.bookmarks?.length > 2000 || data.readStoryIds?.length > 1500;
    let userTags = null;
    if (data.userTags && typeof data.userTags === "object" && !Array.isArray(data.userTags)) {
      userTags = {};
      for (const [author, tag] of Object.entries(data.userTags)) {
        if (!HarmoNovaSettingsSchema.username(author)) return void dependencies.showToast("Import refused — bad author name in tags");
        if (typeof tag !== "string" || new TextEncoder().encode(tag).byteLength > 40) return void dependencies.showToast("Import refused — bad tag value");
        userTags[author] = tag;

      }
    }
    let blockedUsers = null;
    if (Array.isArray(data.blockedUsers)) {
      blockedUsers = [];
      for (const author of data.blockedUsers) {
        if (!HarmoNovaSettingsSchema.username(author)) return void dependencies.showToast("Import refused — bad blocked user name");
        blockedUsers.push(author);

      }
    }
    if (userTags && Object.keys(userTags).length > 500) {truncated=true;userTags=Object.fromEntries(Object.entries(userTags).slice(0,500));}
    if (blockedUsers && blockedUsers.length > 500) {truncated=true;blockedUsers=blockedUsers.slice(0,500);}
    let seenTimes;
    if(data.seenTimes!==undefined) {
      if(!data.seenTimes || typeof data.seenTimes!=="object" || Array.isArray(data.seenTimes) || Object.entries(data.seenTimes).some(([id,time])=>! /^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || !Number.isSafeInteger(time) || time<0))return void dependencies.showToast("Import refused — bad seen times");
      truncated ||= Object.keys(data.seenTimes).length>400;seenTimes=Object.fromEntries(Object.entries(data.seenTimes).slice(-400));
    }
    if (!bookmarks || !readStoryIds || (data.userTags !== undefined && !userTags) || (data.blockedUsers !== undefined && !blockedUsers)) {
      dependencies.showToast("Import refused — schema validation failed");
      return;
    }
    // Private tabs only alter their in-document state; normal imports are
    // committed atomically by the worker before updating this view.
    if (dependencies.INCOGNITO) {
      const outcome = dependencies.privateReader.importData({ bookmarks, readStoryIds,
        ...(userTags ? { userTags } : {}), ...(blockedUsers ? { blockedUsers } : {}), ...(seenTimes ? {seenTimes} : {}) });
      if (!outcome.ok) return void dependencies.showToast("Private import unavailable");
      model.bookmarks = new Set(outcome.value.harmonovaBookmarks);
      model.readIds = new Set(outcome.value.readStoryIds);
      model.userTags = new Map(Object.entries(outcome.value.userTags));
      model.blockedUsers = new Set(outcome.value.blockedUsers);
      model.seenTimes = new Map(Object.entries(outcome.value.seenTimes).map(([id,time])=>[Number(id),time]));
      truncated ||= outcome.truncated === true;
    } else {
      const outcome = await dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_IMPORT_READER_DATA", data: {
        bookmarks, readStoryIds, ...(userTags ? { userTags } : {}),
        ...(blockedUsers ? { blockedUsers } : {}), ...(seenTimes ? {seenTimes} : {}) } });
      if (!outcome?.ok) return void dependencies.showToast("Import could not be saved. No changes were committed.");
      model.readerRevision = outcome.value.revision;
      model.bookmarks = new Set(outcome.value.bookmarks);
      model.readIds = new Set(outcome.value.readIds);
      model.userTags = new Map(Object.entries(outcome.value.tags));
      model.blockedUsers = new Set(outcome.value.blockedUsers);
      model.seenTimes = new Map(Object.entries(outcome.value.seenTimes).map(([id,time])=>[Number(id),time]));
      truncated ||= outcome.truncated === true;
    }
    document.querySelectorAll(".story-card").forEach((card) => {
      if (model.readIds.has(Number(card.dataset.storyId))) card.classList.add("is-read");
    });
    document.querySelectorAll("[data-bookmark-id]").forEach((node) => {
      node.classList.toggle("active", model.bookmarks.has(Number(node.dataset.bookmarkId)));
    });
    dependencies.showToast("Imported " + bookmarks.length + " bookmarks, " + readStoryIds.length + " read stories" + (userTags ? ", " + Object.keys(userTags).length + " tags" : "") + (blockedUsers ? ", " + blockedUsers.length + " blocked" : "") + (truncated ? ". Some data was truncated to storage limits." : ""));
    dependencies.filterStories();
    if (model.thread) dependencies.renderThread(model.thread);
  }

  function handleSettingsHash() {
    if (location.hash !== dependencies.SETTINGS_HASH || !dependencies.app) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    openSettings();
  }


    return Object.freeze({openSettings,
handleSettingsHash});
  }
  globalThis.HarmoNovaContentSettings=Object.freeze({create});
})();
