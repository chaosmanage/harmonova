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
      if (["hideRead", "hideJobs"].includes(key)) dependencies.refreshFeed();
      if (key === "tintedCards") document.querySelectorAll(".story-card").forEach((card) => card.classList.toggle("no-tint", !input.checked));
      if (model.thread && ["markNewComments", "hideDelayed", "showAvatars", "richPreviews"].includes(key)) dependencies.renderThread(model.thread);
    });
    row.append(text, input);
    return row;
  }

  function scrolledStorySetting() {
    // A standard section, not a fieldset legend, keeps this setting clearly
    // separate from the preceding Hide read stories toggle.
    const wrap = dependencies.el("section", "setting-scrolled-group");
    const heading = dependencies.el("h4", "setting-scrolled-title", "Scrolled-past stories");
    heading.id = "harmonova-scrolled-story-heading";
    const description = dependencies.el("p", "setting-scrolled-description",
      "Separate from stories you open. Choose what happens after a story scrolls above the feed.");
    const choices = dependencies.el("div", "setting-scrolled-choices");
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-labelledby", heading.id);
    wrap.append(heading, description, choices);
    const options = [
      ["off", "Off (default)", "Do not track scrolled-past stories."],
      ["future", "Hide on next load (recommended)", "Grey out immediately. Keep stories available for scrolling back up; hide them after refreshing, reopening, or switching feeds."],
      ["immediate", "Hide immediately", "Remove stories once they scroll completely above the viewport. Scrolling back to them is not possible."],
    ];
    for (const [value, title, description] of options) {
      const label = dependencies.el("label", "setting-scrolled-option");
      const radio = dependencies.el("input");
      radio.type = "radio";
      radio.name = "harmonova-scrolled-story-behavior";
      radio.value = value;
      radio.checked = model.settings.scrolledStoryBehavior === value;
      radio.addEventListener("change", async () => {
        if (!radio.checked) return;
        model.settings.scrolledStoryBehavior = value;
        await dependencies.saveSettings("scrolledStoryBehavior");
        dependencies.applySettings();
        // Switching to either hide mode constructs a new eligible batch.
        if (["future", "immediate"].includes(value)) dependencies.refreshFeed();
      });
      const detail = dependencies.el("span", "setting-scrolled-copy");
      detail.append(dependencies.el("strong", "", title), dependencies.el("small", "", description));
      label.append(radio, detail);
      choices.appendChild(label);
    }
    return wrap;
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
      if (key === "hiddenDomains" || key === "hiddenKeywords") dependencies.refreshFeed();
      if (typeof options.onChange === "function") options.onChange();
    });
    row.append(text, input);
    return row;
  }

  // Native details/summary controls provide accessible keyboard navigation and
  // keep advanced settings discoverable without opening another navigation level.
  function settingGroup(title, description, controls, expanded = false) {
    const group = dependencies.el("details", "settings-group");
    group.open = expanded;
    const summary = dependencies.el("summary", "settings-group-summary");
    const copy = dependencies.el("span", "settings-group-heading");
    copy.append(dependencies.el("strong", "", title), dependencies.el("small", "", description));
    summary.append(copy, dependencies.el("span", "settings-group-chevron", "›"));
    const body = dependencies.el("div", "settings-group-content");
    body.append(...controls);
    group.append(summary, body);
    return group;
  }

  function sectionIntro(title, description) {
    const wrap = dependencies.el("div", "settings-page-heading");
    wrap.append(dependencies.el("h3", "", title), dependencies.el("p", "", description));
    return wrap;
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

    const storySection = dependencies.el("div", "settings-section settings-organized");
    storySection.append(
      sectionIntro("Stories", "Decide what appears in your feed, how cards look, and what happens when you open a story."),
      settingGroup("Seen & skipped stories", "Previously opened and scrolled-past stories", [
        settingToggle("Dim read stories", "dimRead", "Fade stories after opening them"),
        settingToggle("Hide read stories", "hideRead", "Filter stories you have already opened out of the feed"),
        scrolledStorySetting()
      ], true),
      settingGroup("Feed filters", "Jobs, blocked domains, and title keywords", [
        settingToggle("Hide jobs", "hideJobs", "Filter job stories out of every feed"),
        settingText("Hidden domains", "hiddenDomains", "Comma-separated domains, e.g. example.com, sub.example.org"),
        settingText("Hidden keywords", "hiddenKeywords", "Comma-separated title keywords, case-insensitive")
      ]),
      settingGroup("Previews & card design", "Images, card colors, and source icons", [
        settingSelect("Preview images", "previewImages", [["medium", "Medium"], ["small", "Small"], ["off", "Off"]]),
        settingToggle("Tint cards from images", "tintedCards", "Use each story preview to color its card"),
        settingToggle("Favicons", "showFavicons", "Show the source icon beside metadata"),
        dependencies.el("p", "settings-note", "External website fetching is controlled separately in Web and links. Missing images use a local placeholder.")
      ]),
      settingGroup("Story details", "Points, comments, numbering, and domains", [
        settingToggle("Points", "showPoints", "Show story score"),
        settingToggle("Compact points", "compactPoints", "Show abbreviated scores without the word points"),
        settingToggle("Hotness colors", "hotnessColors", "Color scores by how fast a story is moving"),
        settingToggle("Comment count", "showComments", "Show the large comments control"),
        settingToggle("Story number", "showIndex", "Show story position in the feed"),
        settingToggle("Show domain", "showDomain", "Show the story's source domain in the metadata")
      ]),
      settingGroup("Text & density", "Adjust story text and the number of cards on screen", [
        settingSlider("Story text size", "storyTextSize", 14.5, 20.5, 0.5, " sp"),
        settingSlider("Content zoom", "contentScale", 65, 150, 5, "%")
      ]),
      settingGroup("Opening stories", "How story cards, articles, and discussions open", [
        settingToggle("Enable story card click", "cardClickEnabled", "Click a card background to open its article. When off, use the title or comments button instead."),
        settingToggle("Card click opens comments", "cardClickComments", "Switch story-card clicks from the article to the discussion. The comments button always opens the discussion."),
        settingToggle("Article links also open comments", "alwaysOpenComments", "When a title or preview opens an article in a new tab, also load its discussion here."),
        dependencies.el("p", "settings-note", "By default, card clicks open the article and the comments button opens the discussion.")
      ])
    );

    const commentsSection = dependencies.el("div", "settings-section settings-organized");
    commentsSection.append(
      sectionIntro("Comments", "Tune the discussion layout, navigation, and reading experience."),
      settingGroup("Reading & visibility", "New comments and collapsed placeholders", [
        settingToggle("Mark new comments", "markNewComments", "Highlight comments posted since your last visit to a story"),
        settingToggle("Hide [delayed]", "hideDelayed", "Collapse HN's [delayed] placeholder comments")
      ], true),
      settingGroup("Layout & sorting", "Thread appearance, sorting, and depth indicators", [
        settingSelect("Comment style", "commentStyle", [["outlined", "Outlined"], ["raised", "Raised"], ["standard", "Standard"], ["flat", "Flat"]]),
        settingSelect("Comment sorting", "commentSort", [["Default", "Default"], ["Newest first", "Newest first"], ["Oldest first", "Oldest first"], ["Reply count", "Reply count"]]),
        settingSelect("Thread colors", "depthMode", [["theme_default", "Theme default"], ["material_you", "Material You"], ["colors", "Colorful"], ["author", "Author"], ["monochrome", "Monochrome"], ["none", "None"]]),
        settingToggle("Rounded depth indicators", "roundedRails", "Round the thread indicator ends"),
        settingToggle("Continuous depth indicators", "continuousRails", "Continue ancestor rails through replies")
      ]),
      settingGroup("Interaction & authors", "Avatars and comment tap controls", [
        settingToggle("Comment avatars", "showAvatars", "Show generated local avatars beside comment authors"),
        settingToggle("Swap comment actions", "swapCommentActions", "Tap opens actions; long-press collapses")
      ]),
      settingGroup("Text & size", "Comment font size and zoom", [
        settingSlider("Comment text size", "commentTextSize", 12, 18, 0.5, " sp"),
        settingSlider("Comment zoom", "commentZoom", 65, 150, 5, "%")
      ])
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
    const deletionStatus = dependencies.el("p", "settings-note settings-deletion-status");
    deletionStatus.setAttribute("role", "status");
    const deletionActions = dependencies.el("div", "settings-delete-actions");
    const resets = [
      ["history", "Delete history", "Delete read-story history and comment visit markers? Saved tags, drafts, and settings will be kept."],
      ["saved", "Delete saved data", "Delete saved bookmarks, user tags, blocked users, and unsent drafts? Read history and settings will be kept."],
      ["settings", "Reset settings", "Restore all preferences, appearance, filters, AI permissions, and preview controls to defaults? Your reading history, saved data, and API key will be kept."],
      ["all", "Delete all HarmoNova data", "Permanently delete all HarmoNova reading history, saved data, drafts, settings, API keys, and stored update records? This cannot be undone. Hacker News account data is not affected."],
    ];
    for (const [scope,label,warning] of resets) {
      const button = dependencies.el("button", "setting-button settings-delete-"+scope, label);
      button.type = "button";
      button.disabled=dependencies.INCOGNITO;
      if(scope==="all")button.classList.add("settings-delete-all");
      button.addEventListener("click",async event=>{
        if(!event.isTrusted||button.disabled||dependencies.INCOGNITO)return;
        if(!window.confirm(warning))return;
        button.disabled=true;
        deletionStatus.textContent="Deleting…";
        try {
          const result=await dependencies.stateUI.runtimeMessage({type:"HARMONOVA_DATA_RESET",scope});
          if(!result?.ok) {
            deletionStatus.textContent="Could not delete all requested data. Please retry.";
            return;
          }
          // Refresh this tab to discard cached preferences, reading markers,
          // and unsent in-memory form state after the trusted worker reset.
          for(const key of ["harmonova:settings:v1","harmonic:settings:v1",
              "harmonovaUserTags","harmonicUserTags","harmonovaBlockedUsers","harmonicBlockedUsers",
              "harmonovaSeenComments","harmonicSeenComments"]) {
            if(scope==="all"||scope==="settings"&&key.includes("settings:"))
              try{localStorage.removeItem(key);}catch{}
          }
          window.location.reload();
        } catch {
          deletionStatus.textContent="Could not delete all requested data. Please retry.";
        } finally {button.disabled=false;}
      });
      deletionActions.appendChild(button);
    }
    if(dependencies.INCOGNITO)deletionStatus.textContent="Private-tab data is memory-only and is cleared when you close this tab.";
    userDataSection.classList.add("settings-organized");
    userDataSection.append(
      sectionIntro("Data", "Manage local backups and control what HarmoNova remembers."),
      settingGroup("Backup & restore", "Export your data or import a previous backup", [
        exportButton,
        importButton,
        importFileInput,
        dependencies.el("p", "settings-note", "Includes read and skipped story history, user tags, and blocked users. Older bookmarks remain compatible with imports. Nothing is sent to HarmoNova or an external server.")
      ], true),
      settingGroup("Delete & reset", "Clear reading history, saved data, or preferences", [
        dependencies.el("p", "settings-note", "Deletion is permanent and always requires confirmation. It does not delete anything from your Hacker News account."),
        deletionActions,
        deletionStatus
      ])
    );

    const headerDisplaySection = dependencies.el("div", "settings-section settings-organized");
    headerDisplaySection.append(
      settingGroup("Discussion header", "Story images and header tint", [
        settingToggle("Background tint", "headerTint", "Tint the discussion header from the story preview"),
        settingToggle("Preview image", "headerImage", "Show the story preview above the discussion title")
      ])
    );

    // Manually querying the existing release checker is independent from
    // notifications, and never supplies a URL to the privileged worker.
    const checkUpdates = dependencies.el("button", "setting-button settings-check-updates", "Check for updates");
    checkUpdates.type = "button";
    const updateStatus = dependencies.el("p", "settings-note settings-update-status");
    updateStatus.setAttribute("role", "status");
    if (dependencies.INCOGNITO) {
      checkUpdates.disabled = true;
      updateStatus.textContent = "Check for updates from a regular tab.";
    }
    checkUpdates.addEventListener("click", async event => {
      if (!event.isTrusted || checkUpdates.disabled) return;
      checkUpdates.disabled = true;
      updateStatus.textContent = "Checking for updates…";
      try {
        const result = await dependencies.stateUI.runtimeMessage({type:"HARMONOVA_RELEASE_CHECK_NOW"});
        if (!result?.ok) updateStatus.textContent = "Could not check for updates. Try again.";
        else if (result.available && /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(result.tag)) {
          updateStatus.textContent = "Update available: " + result.tag + ". ";
          const link = dependencies.el("a", "", "View release");
          link.href = "https://github.com/chaosmanage/harmonova/releases/latest";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          updateStatus.appendChild(link);
        } else updateStatus.textContent = "You're up to date.";
      } catch {
        updateStatus.textContent = "Could not check for updates. Try again.";
      } finally { checkUpdates.disabled = dependencies.INCOGNITO; }
    });

    // Phase 7 part 3: appearance (theme + font) and link behavior.
    const appearanceSection = dependencies.el("div", "settings-section settings-organized");
    appearanceSection.append(
      sectionIntro("Appearance", "Choose the overall look of HarmoNova."),
      settingGroup("Theme & typography", "Colors and fonts throughout the reader", [
        settingSelect("Theme", "uiTheme", [["amoled", "AMOLED black"], ["charcoal", "Charcoal"], ["navy", "Deep navy"]]),
        settingSelect("Font", "uiFont", [["rounded", "Google Sans Flex Rounded"], ["system", "System UI"], ["serif", "Serif"]]),
        dependencies.el("p", "settings-note", "Themes apply to HarmoNova only, not to pages opened in original Hacker News.")
      ], true)
    );

    const updatesSection = dependencies.el("div", "settings-section settings-organized");
    updatesSection.append(
      sectionIntro("Updates", "Control release notices and check for a newer HarmoNova version."),
      settingGroup("Release notices", "Notify me when a new version is available", [
        settingToggle("Notify about new releases", "notifyUpdates", "Show a quiet, dismissible notice when a newer GitHub release is available. No Chrome notifications.")
      ], true),
      settingGroup("Check for updates", "Look up the latest published release manually", [
        checkUpdates,
        updateStatus,
        dependencies.el("p", "settings-note", "Manual checks work even when automatic notices are off.")
      ])
    );

    const linksSection = dependencies.el("div", "settings-section settings-organized");
    const previewFrame = dependencies.el("iframe", "ai-settings-frame preview-settings-frame");
    previewFrame.title = "Secure website preview preferences";
    const previewFrameUrl = HarmoNovaContentRuntime.getURL("preview-settings.html");
    if(previewFrameUrl)previewFrame.src=previewFrameUrl;
    previewFrame.setAttribute("referrerpolicy", "no-referrer");
    previewFrame.setAttribute("loading", "lazy");
    linksSection.append(
      sectionIntro("Web and links", "Decide what previews can load from external websites."),
      settingGroup("Link preview details", "Titles and facts from public websites", [
        settingToggle("Rich link previews", "richPreviews", "Show website metadata and provider facts in link previews"),
        dependencies.el("p", "settings-note", "Websites with no usable images or metadata use local placeholders.")
      ], true),
      settingGroup("External preview access", "Control whether external websites can be fetched", [
        ...(dependencies.INCOGNITO
          ? [dependencies.el("p", "settings-note", "External previews are unavailable in private tabs. Configure them from a normal HarmoNova tab.")]
          : previewFrameUrl ? [previewFrame] : [])
      ])
    );

    const aiSection = dependencies.el("div", "settings-section settings-organized ai-settings-section");
    const aiFrame = dependencies.el("iframe", "ai-settings-frame");
    aiFrame.title = "Secure AI preferences";
    const aiFrameUrl = HarmoNovaContentRuntime.getURL("ai-settings.html");
    if (aiFrameUrl) aiFrame.src = aiFrameUrl;
    aiFrame.setAttribute("referrerpolicy", "no-referrer");
    aiFrame.setAttribute("loading", "lazy");
    aiSection.append(
      sectionIntro("AI Summarization", "Model, permissions, and summaries are configured in the secure panel."),
      settingGroup("Model & permissions", "Connect OpenRouter and choose what AI can summarize", [
        dependencies.el("p", "settings-note ai-settings-intro", "Article and discussion summaries require your permission. Your API key stays in the extension's secure settings."),
        ...(dependencies.INCOGNITO
          ? [dependencies.el("p", "settings-note", "AI settings are unavailable in private tabs. Configure them from a normal HarmoNova tab.")]
          : aiFrameUrl ? [aiFrame] : [])
      ], true)
    );

    // Reuse the account chip's actions; both entry points remain available.
    // Authentication still happens exclusively on Hacker News.
    const session = window.HarmoNovaHN?.session?.() || null;
    const accountSection = dependencies.el("div", "settings-section settings-organized");
    const accountActions = dependencies.el("div", "settings-account-actions");
    for (const item of dependencies.accountActions()) {
      const action = dependencies.el("button", "setting-button settings-account-action", item.label);
      action.type = "button";
      action.addEventListener("click", async (event) => {
        if (!event.isTrusted || !await dependencies.flushSettings()) return;
        overlay.remove();
        item.action(event);
      });
      accountActions.appendChild(action);
    }
    accountSection.append(
      sectionIntro("Account", "Your Hacker News account and related actions."),
      settingGroup("Hacker News session", "Current account and sign-in status", [
        dependencies.el("p", "settings-note", session?.username
          ? "Signed in to Hacker News as " + session.username + (session.karma != null ? " (" + dependencies.compact(session.karma) + " karma)" : "") + "."
          : "Not signed in to Hacker News. Sign-in happens on Hacker News's own page in this tab.")
      ], true),
      settingGroup("Account actions", "Account pages, profile, and login controls", [ accountActions ], true),
      settingGroup("Account privacy", "How HarmoNova uses your Hacker News session", [
        dependencies.el("p", "settings-note", "HarmoNova never sees or stores your Hacker News password. The session stays in Hacker News's cookie. Votes, favorites and replies go directly to Hacker News; one-time action tokens stay in memory and are not synchronized.")
      ])
    );

    // A category index keeps the settings compact without changing any
    // persisted keys or dropping advanced controls.
    const categories = [
      ["Stories", [storySection], "Seen stories, filters, cards and clicks"],
      ["Comments", [commentsSection], "Layout, sorting and reading"],
      ["Appearance", [appearanceSection, headerDisplaySection], "Theme, typography and headers"],
      ["Web and links", [linksSection], "External previews and website access"],
      ["AI Summarization", [aiSection], "OpenRouter, models and permissions"],
      ["Account", [accountSection], "Hacker News profile and actions"],
      ["Data", [userDataSection], "Backups, history and deletion"],
      ["Updates", [updatesSection], "Release notices and checks"],
    ];
    const index = dependencies.el("nav", "settings-categories");
    index.setAttribute("aria-label", "Settings categories");
    const searchWrap = dependencies.el("div", "settings-find");
    const searchInput = dependencies.el("input", "settings-find-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search settings…";
    searchInput.setAttribute("aria-label", "Search HarmoNova settings");
    const searchResults = dependencies.el("div", "settings-find-results");
    searchResults.hidden = true;
    searchWrap.append(searchInput, searchResults);
    const back = dependencies.button("chevron", "Back to settings categories", "settings-back");
    back.hidden = true;
    back.addEventListener("click", showIndex);
    header.insertBefore(back, header.firstChild);
    const sections = dependencies.el("div", "settings-pages");
    for (const [name, children, description] of categories) {
      const link = dependencies.el("button", "settings-category");
      link.type = "button";
      const copy = dependencies.el("span", "settings-category-copy");
      copy.append(dependencies.el("strong", "", name), dependencies.el("small", "", description));
      link.append(copy, dependencies.el("span", "settings-category-chevron", "›"));
      link.addEventListener("click", () => showCategory(name));
      index.append(link);
      for (const section of children) {
        section.hidden = true;
        sections.append(section);
      }
    }
    // Index actual controls once rather than copying settings or inventing
    // preference keys. Search only navigates to the original live control.
    const searchable = [];
    for (const [name, children] of categories) {
      for (const section of children) {
        for (const group of section.querySelectorAll(".settings-group")) {
          const heading = group.querySelector(".settings-group-heading strong")?.textContent || "";
          const description = group.querySelector(".settings-group-heading small")?.textContent || "";
          searchable.push({ name, heading, label: heading, description, section, group, target: group });
          for (const control of group.querySelectorAll(".setting-row, .setting-scrolled-option, .setting-button")) {
            const label = control.querySelector(".setting-copy strong, .setting-scrolled-copy strong")?.textContent ||
              (control.matches(".setting-button") ? control.textContent : "");
            if (!label) continue;
            searchable.push({ name, heading, label, description: control.textContent, section, group, target: control });
          }
        }
      }
    }
    function renderSearch() {
      const query = searchInput.value.trim().toLocaleLowerCase();
      searchResults.replaceChildren();
      const searching = query.length > 0;
      index.hidden = searching;
      searchResults.hidden = !searching;
      if (!searching) return;
      const found = searchable.filter(entry =>
        [entry.name, entry.heading, entry.label, entry.description].join(" ").toLocaleLowerCase().includes(query));
      if (!found.length) {
        searchResults.appendChild(dependencies.el("p", "settings-find-empty", "No matching settings. Try another word."));
        return;
      }
      for (const entry of found.slice(0, 16)) {
        const result = dependencies.el("button", "settings-find-item");
        result.type = "button";
        result.append(dependencies.el("strong", "", entry.label),
          dependencies.el("small", "", entry.name + " › " + entry.heading));
        result.addEventListener("click", () => {
          showCategory(entry.name);
          entry.group.open = true;
          entry.target.scrollIntoView({ block: "center", behavior: "instant" });
          const focusTarget = entry.target.matches(".setting-row, .setting-scrolled-option")
            ? entry.target.querySelector("input,select,textarea") : null;
          if (focusTarget) focusTarget.focus({ preventScroll: true });
        });
        searchResults.appendChild(result);
      }
      if (found.length > 16) searchResults.appendChild(
        dependencies.el("p", "settings-find-empty", "Showing the first 16 matches. Refine your search for more."));
    }
    searchInput.addEventListener("input", renderSearch);
    function showIndex() {
      searchWrap.hidden = false;
      searchInput.value = "";
      renderSearch();
      back.hidden = true;
      header.querySelector("h2").textContent = "Settings";
      for (const section of sections.children) section.hidden = true;
      panel.scrollTop = 0;
    }
    function showCategory(name) {
      searchWrap.hidden = true;
      index.hidden = true;
      searchResults.hidden = true;
      back.hidden = false;
      header.querySelector("h2").textContent = name;
      const group = categories.find(([label]) => label === name)?.[1] || [];
      for (const section of sections.children) section.hidden = !group.includes(section);
      panel.scrollTop = 0;
    }
    panel.append(header, searchWrap, index, sections);
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
      skippedStoryIds: [...model.skippedIds].filter((id) => Number.isSafeInteger(id) && id > 0).slice(-10000),
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
    const skippedStoryIds = data.skippedStoryIds === undefined ? [] : sanitizeIdList(data.skippedStoryIds, 10000);
    let truncated = data.bookmarks?.length > 2000 || data.readStoryIds?.length > 1500 || data.skippedStoryIds?.length > 10000;
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
    if (!bookmarks || !readStoryIds || !skippedStoryIds || (data.userTags !== undefined && !userTags) || (data.blockedUsers !== undefined && !blockedUsers)) {
      dependencies.showToast("Import refused — schema validation failed");
      return;
    }
    // Private tabs only alter their in-document state; normal imports are
    // committed atomically by the worker before updating this view.
    if (dependencies.INCOGNITO) {
      const outcome = dependencies.privateReader.importData({ bookmarks, readStoryIds, skippedStoryIds,
        ...(userTags ? { userTags } : {}), ...(blockedUsers ? { blockedUsers } : {}), ...(seenTimes ? {seenTimes} : {}) });
      if (!outcome.ok) return void dependencies.showToast("Private import unavailable");
      model.bookmarks = new Set(outcome.value.harmonovaBookmarks);
      model.readIds = new Set(outcome.value.readStoryIds);
      model.skippedIds = new Set(outcome.value.skippedStoryIds);
      model.userTags = new Map(Object.entries(outcome.value.userTags));
      model.blockedUsers = new Set(outcome.value.blockedUsers);
      model.seenTimes = new Map(Object.entries(outcome.value.seenTimes).map(([id,time])=>[Number(id),time]));
      truncated ||= outcome.truncated === true;
    } else {
      const outcome = await dependencies.stateUI.runtimeMessage({ type: "HARMONOVA_IMPORT_READER_DATA", data: {
        bookmarks, readStoryIds, skippedStoryIds, ...(userTags ? { userTags } : {}),
        ...(blockedUsers ? { blockedUsers } : {}), ...(seenTimes ? {seenTimes} : {}) } });
      if (!outcome?.ok) return void dependencies.showToast("Import could not be saved. No changes were committed.");
      model.readerRevision = outcome.value.revision;
      model.bookmarks = new Set(outcome.value.bookmarks);
      model.readIds = new Set(outcome.value.readIds);
      model.skippedIds = new Set(outcome.value.skippedIds);
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
    dependencies.showToast("Imported " + bookmarks.length + " bookmarks, " + readStoryIds.length + " read stories, " + skippedStoryIds.length + " skipped stories" + (userTags ? ", " + Object.keys(userTags).length + " tags" : "") + (blockedUsers ? ", " + blockedUsers.length + " blocked" : "") + (truncated ? ". Some data was truncated to storage limits." : ""));
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
