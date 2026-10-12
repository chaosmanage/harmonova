if(process.env.HARMONOVA_ALLOW_LIVE !== "1") throw new Error("Live suite requires explicit HARMONOVA_ALLOW_LIVE=1");
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";

const extensionPath = path.resolve(process.env.EXTENSION_PATH || ".");
const outDir = path.resolve(process.env.TEST_OUTPUT_DIR || "test-results");
fs.mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext("", {
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  viewport: { width: 1919, height: 872 },
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions-except=" + extensionPath,
    "--load-extension=" + extensionPath
  ]
});

try {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".thread-title").waitFor({ state: "visible", timeout: 20000 });

  const extensionWorker = context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"))
    || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extensionId = new URL(extensionWorker.url()).host;

  const count = await page.locator(".story-card").count();
  assert.ok(count >= 30, "expected at least 30 story cards");

  const layout = await page.evaluate(() => {
    const title = document.querySelector(".feed-title-button").getBoundingClientRect();
    const first = document.querySelector(".story-card").getBoundingClientRect();
    const refresh = document.querySelector('.feed-toolbar-actions .icon-button[aria-label="Refresh"]').getBoundingClientRect();
    const cardNodes = Array.from(document.querySelectorAll(".story-card")).slice(0, 12);
    const cards = cardNodes.map((card) => ({
      clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight,
      height: card.getBoundingClientRect().height
    }));
    const cardRects = cardNodes.map((card) => card.getBoundingClientRect());
    const cardGaps = cardRects.slice(1).map((rect, index) => rect.top - cardRects[index].bottom);
    return {
      titleTop: title.top,
      firstCardLeft: first.left,
      refreshWidth: refresh.width,
      refreshHeight: refresh.height,
      cardGaps,
      cards
    };
  });
  assert.ok(layout.titleTop <= 26, "Top Stories should sit near the top");
  assert.ok(layout.firstCardLeft <= 20, "story gutter should be compact");
  assert.ok(layout.refreshWidth >= 40 && layout.refreshWidth <= 46 && layout.refreshHeight >= 40 && layout.refreshHeight <= 46, "refresh button should match the top action buttons");
  const refreshPath = await page.locator('.feed-toolbar-actions .icon-button[aria-label="Refresh"] path').getAttribute("d");
  assert.equal(refreshPath, "M12 20a8 8 0 1 1 5.65-13.65L20 4v7h-7l2.65-2.65A5.15 5.15 0 1 0 17.05 14h2.2A7.35 7.35 0 0 1 12 20z", "refresh icon should use the repaired closed-loop path");
  assert.ok(layout.cardGaps.every((gap) => Math.abs(gap - 7) <= 0.5), "story cards should keep a consistent zoom-scaled gap");
  assert.ok(layout.cards.every((card) => card.scrollHeight <= card.clientHeight + 1 && card.height >= 56), "story cards should grow with content without clipping");

  const left = page.locator(".story-list");
  const leftBefore = await left.evaluate((e) => e.scrollTop);
  await left.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(250);
  const leftAfter = await left.evaluate((e) => e.scrollTop);
  assert.ok(leftAfter > leftBefore, "left feed should scroll");

  await left.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll(".story-card").length > 40, null, { timeout: 20000 });
  const loadedCount = await page.locator(".story-card").count();
  assert.ok(loadedCount > 40, "scrolling near the end should load more than 40 stories");

  const right = page.locator(".thread-pane");
  const rightBefore = await right.evaluate((e) => e.scrollTop);
  await right.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(250);
  const rightAfter = await right.evaluate((e) => e.scrollTop);
  assert.ok(rightAfter > rightBefore, "thread pane should scroll");

  await left.evaluate((e) => { e.scrollTop = 0; });
  await right.evaluate((e) => { e.scrollTop = 0; });

  assert.equal(await page.locator("html").getAttribute("data-font"), "rounded", "Google Sans Flex Rounded is the default");

  const thirdCard = page.locator(".story-card").nth(2);
  const thirdHref = await thirdCard.locator(".story-card-title").getAttribute("href");
  assert.ok(thirdHref, "third story should expose its article URL");
  const cardTabPromise = context.waitForEvent("page", { timeout: 10000 });
  const cardBox = await thirdCard.boundingBox();
  assert.ok(cardBox, "third story card should have a bounding box");
  await thirdCard.click({ position: { x: Math.max(45, Math.min(70, cardBox.width * 0.15)), y: Math.max(10, cardBox.height - 12) } });
  const cardTab = await cardTabPromise;
  await cardTab.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  assert.equal(cardTab.url(), thirdHref, "story card body should open its article in a new tab like HarmoNova");
  await cardTab.close();

  const secondCard = page.locator(".story-card").nth(1);
  const secondId = await secondCard.getAttribute("data-story-id");
  await secondCard.locator(".story-comment-button").click();
  await page.waitForURL(new RegExp("item\\?id=" + secondId), { timeout: 10000 });
  await page.locator(".thread-title").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(new URL(page.url()).searchParams.get("id"), secondId, "comment button should select discussion");

  // Thread toolbar keeps its primary actions and exposes the two AI sources.
  const threadLabels = await page.locator(".thread-actions button").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label")));
  assert.equal(threadLabels.length, 8, "toolbar includes profile, reply, vote, favorite, summaries, share and More");
  for (const label of ["Add reply", "Summarize article", "Summarize discussion", "Share story", "More"]) {
    assert.ok(threadLabels.includes(label), "thread toolbar has " + label);
  }
  assert.ok(threadLabels.some((label) => ["My profile", "Log in"].includes(label)), "profile/login action exists");
  assert.equal(await page.locator('.thread-actions [data-thread-vote]').count(), 1, "vote control exists");
  assert.equal(await page.locator('.thread-actions [data-thread-favorite]').count(), 1, "HN favorite star exists");
  assert.ok(!threadLabels.some((label) => /bookmark/i.test(label)), "no bookmark action in toolbar");
  assert.equal(await page.locator('.thread-actions [role="group"][aria-label="AI summaries"]').count(), 1, "source actions stay grouped in the toolbar");
  // The thread More menu (comment rows also have per-comment "More" buttons).
  const threadMore = page.locator(".thread-actions button.thread-action[aria-label='More']");
  await threadMore.click();
  const menuText = await page.locator(".harmonova-popup").textContent();
  assert.ok(!/bookmark story|remove bookmark|collapse all comments|expand all comments/i.test(menuText), "removed actions stay out");
  assert.ok(menuText.includes("Show only OP comments") && menuText.includes("Open on original Hacker News"), "OP filter and original-site action");
  await page.getByRole("button", { name: /Sort comments/ }).click();
  const sortLabels = await page.locator(".harmonova-popup .popup-item").allTextContents();
  for (const mode of ["Default", "Newest first", "Oldest first", "Reply count"]) {
    assert.ok(sortLabels.some((label) => label.includes(mode)), "sort menu should contain " + mode);
  }
  await page.getByRole("button", { name: /Newest first/ }).click();
  await page.waitForTimeout(300);
  await threadMore.click();
  assert.ok((await page.locator(".harmonova-popup").textContent()).includes("Sort comments · Newest first"), "selected sort mode should persist in the thread menu");
  await page.locator(".harmonova-popup").evaluate((e) => e.remove());

  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".settings-overlay").waitFor({ state: "visible" });
  const settingRows = await page.locator(".setting-row").count();
  assert.ok(settingRows >= 16, "expected expanded HarmoNova-style settings controls");
  const settingsText = await page.locator(".settings-panel").textContent();
  for (const label of ["Content zoom", "Comment text size", "Comment zoom", "Enable story card click", "Card click opens comments", "Comment sorting", "Thread colors", "AI summarization", "OpenRouter model", "Use AI summarization"]) {
    assert.ok(settingsText.includes(label), "settings should contain " + label);
  }

  const openSettingsCategory = async (name) => {
    const back = page.locator(".settings-back");
    if (await back.isVisible()) await back.click();
    await page.locator(".settings-category", { hasText: name }).click();
  };
  await openSettingsCategory("Stories");
  const zoomRow = page.locator(".setting-row").filter({ hasText: "Content zoom" });
  const zoomSlider = zoomRow.locator('input[type="range"]');
  assert.equal(await zoomSlider.inputValue(), "70", "default content zoom should fit more stories in the feed");
  await zoomSlider.fill("80");
  await page.waitForTimeout(150);
  assert.ok((await zoomRow.textContent()).includes("80%"), "content zoom setting should update live");
  const syncedZoom = await extensionWorker.evaluate(async () => {
    const stored = await chrome.storage.sync.get(["harmonovaSettings"]);
    return stored.harmonovaSettings?.contentScale;
  });
  assert.equal(syncedZoom, 80, "settings should persist to chrome.storage.sync");
  const backedUpZoom = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("harmonova:settings:v1") || "{}");
    return stored.contentScale;
  });
  assert.equal(backedUpZoom, 80, "settings should keep the unpacked-update backup on the Hacker News origin");

  await openSettingsCategory("Comments");
  const commentSizeRow = page.locator(".setting-row").filter({ hasText: "Comment text size" });
  const commentSizeSlider = commentSizeRow.locator('input[type="range"]');
  await commentSizeSlider.fill("16");
  await page.waitForTimeout(150);
  assert.ok((await commentSizeRow.textContent()).includes("16 sp"), "comment text size should be adjustable");

  const commentsZoomRow = page.locator(".setting-row").filter({ hasText: "Comment zoom" });
  const commentsZoomSlider = commentsZoomRow.locator('input[type="range"]');
  assert.equal(await commentsZoomSlider.inputValue(), "85");
  await commentsZoomSlider.fill("75");
  assert.ok((await commentsZoomRow.textContent()).includes("75%"));
  await openSettingsCategory("AI Summarization");
  const defaultAiModel = await page.locator(".setting-row").filter({ hasText: "OpenRouter model" }).locator("input").inputValue();
  assert.equal(defaultAiModel, "openrouter/free", "AI summarization should default to OpenRouter's free-model router");

  const testApiKey = "sk-or-v1-harmonova-e2e-secret";
  const optionsPagePromise = context.waitForEvent("page", { timeout: 10000 });
  await page.locator(".ai-key-row .setting-button").click();
  const aiOptionsPage = await optionsPagePromise;
  await aiOptionsPage.waitForLoadState("domcontentloaded", { timeout: 10000 });
  await aiOptionsPage.locator("#api-key").fill(testApiKey);
  await aiOptionsPage.locator('input[name="storage"][value="persistent"]').check();
  await aiOptionsPage.locator("#save").click();
  await aiOptionsPage.waitForFunction(() => document.querySelector("#message")?.textContent?.includes("saved"));
  const privateKey = await extensionWorker.evaluate(async () => (await chrome.storage.local.get(["harmonovaAiApiKey"])).harmonovaAiApiKey);
  assert.equal(privateKey, testApiKey, "OpenRouter key should be stored in private extension-local storage");
  const syncContainsSecret = await extensionWorker.evaluate(async (secret) => JSON.stringify(await chrome.storage.sync.get(null)).includes(secret), testApiKey);
  assert.equal(syncContainsSecret, false, "OpenRouter key must never enter chrome.storage.sync");
  const pageStorageContainsSecret = await page.evaluate((secret) => {
    return Object.keys(localStorage).some((key) => String(localStorage.getItem(key) || "").includes(secret));
  }, testApiKey);
  assert.equal(pageStorageContainsSecret, false, "OpenRouter key must never enter Hacker News localStorage");
  await aiOptionsPage.close();

  const promptEditor = page.locator(".ai-settings-section textarea");
  await promptEditor.fill("Custom prompt");
  await promptEditor.blur();
  await page.getByRole("button", { name: "Reset to HarmoNova default" }).click();
  assert.ok((await promptEditor.inputValue()).includes("summarizing articles"), "system prompt reset should restore HarmoNova's default");

  // Restore HarmoNova defaults before the visual regression screenshot.
  await openSettingsCategory("Stories");
  await zoomSlider.fill("70");
  await openSettingsCategory("Comments");
  await commentSizeSlider.fill("15");
  await commentsZoomSlider.fill("90");
  await openSettingsCategory("Stories");
  const cardClickRow = page.locator(".setting-row").filter({ hasText: "Card click opens comments" });
  const cardClickInput = cardClickRow.locator('input[type="checkbox"]');
  await cardClickInput.check();
  await page.waitForTimeout(150);

  await page.locator(".settings-header .icon-button").click();
  await page.locator(".settings-overlay").waitFor({ state: "detached" });

  const summaryStoryIndex = await page.locator(".story-card").evaluateAll((cards) => {
    return cards.findIndex((card) => {
      const href = card.querySelector(".story-card-title")?.href;
      if (!href) return false;
      try { return new URL(href).hostname !== "news.ycombinator.com"; }
      catch { return false; }
    });
  });
  assert.ok(summaryStoryIndex >= 0, "expected an external story for AI summary coverage");
  const summaryStoryCard = page.locator(".story-card").nth(summaryStoryIndex);
  const summaryStoryId = await summaryStoryCard.getAttribute("data-story-id");
  await summaryStoryCard.locator(".story-comment-button").click();
  await page.waitForURL((url) => url.searchParams.get("id") === summaryStoryId, { timeout: 10000 });
  await page.locator(".thread-title").waitFor({ state: "visible", timeout: 15000 });
  const summaryArticleUrl = await page.locator(".thread-title").getAttribute("href");
  assert.ok(summaryArticleUrl, "summary story should expose an article URL");

  let openRouterPayload = null;
  let openRouterAuth = null;
  let aiResponseMode = "stream";
  let aiRequests = 0;
  await context.route(summaryArticleUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body><main><h1>Test article</h1><p>Alpha finding about browser extensions.</p><p>Beta finding about streaming summaries.</p></main></body></html>",
    });
  });
  await context.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    if (aiResponseMode === "live") {
      await route.continue();
      return;
    }
    aiRequests++;
    openRouterPayload = route.request().postDataJSON();
    openRouterAuth = route.request().headers()["authorization"];
    if (aiResponseMode === "error") {
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { message: "Free model rate limit" } }) });
      return;
    }
    if (aiResponseMode === "delayed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [
        'data: {"choices":[{"delta":{"content":"- Alpha finding"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"; Beta finding"}}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
    });
  });

  await page.getByRole("button", { name: "Summarize article" }).click();
  await page.locator(".story-summary").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".story-summary")?.dataset.status === "success", null, { timeout: 10000 });
  const summaryText = (await page.locator(".story-summary-body").textContent()) || "";
  assert.ok(summaryText.includes("Alpha finding") && summaryText.includes("Beta finding"), "streamed OpenRouter chunks should render in the summary card");
  assert.equal(openRouterAuth, "Bearer " + testApiKey, "background request should attach the private OpenRouter key");
  assert.equal(openRouterPayload?.model, "openrouter/free", "summary request should use the configured OpenRouter model");
  assert.equal(openRouterPayload?.stream, true, "summary request should stream by default");
  assert.ok(openRouterPayload?.messages?.[0]?.content?.includes("summarizing articles"), "summary request should use HarmoNova's system prompt");
  assert.ok(openRouterPayload?.messages?.[1]?.content?.includes("Alpha finding about browser extensions"), "summary request should send extracted article text");
  assert.ok((openRouterPayload?.messages?.[1]?.content || "").length <= 15000, "article input should respect HarmoNova's 15k character budget");
  const regeneratedLabel = await page.locator('[data-summary-action-id="' + summaryStoryId + '"][data-summary-source="article"]').getAttribute("aria-label");
  assert.equal(regeneratedLabel, "Regenerate article summary", "Article action should allow regeneration after success");
  assert.equal(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), testApiKey), false, "key must not appear in the HN DOM");
  if (await page.locator('.comment-row').count()) {
    await page.getByRole("button", { name: "Summarize discussion" }).click();
    await page.waitForFunction(() => document.querySelector('.story-summary')?.dataset.status === 'success');
    assert.equal(await page.locator('.story-summary-heading strong').textContent(), 'Discussion summary');
    assert.match(openRouterPayload.messages[0].content, /NOT read the linked article/);
    assert.match(openRouterPayload.messages[1].content, /Hacker News discussion/);
    assert.equal(await page.getByRole("button", { name: "Regenerate discussion summary" }).count(), 1);
    await page.getByRole("button", { name: "Summarize article" }).click();
    await page.waitForFunction(() => document.querySelector('.story-summary')?.dataset.status === 'success' && document.querySelector('.story-summary-heading strong')?.textContent === 'Summary');
  }

  aiResponseMode = "error";
  await page.getByRole("button", { name: "Regenerate article summary" }).click();
  await page.waitForFunction(() => document.querySelector(".story-summary")?.dataset.status === "error");
  assert.ok((await page.locator(".story-summary-body").textContent()).includes("Free model rate limit"), "provider errors should be actionable");

  aiResponseMode = "delayed";
  await page.getByRole("button", { name: "Summarize article" }).click();
  await page.getByRole("button", { name: "Cancel article summary" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Cancel article summary" }).click();
  await page.waitForFunction(() => document.querySelector(".story-summary")?.dataset.status === "idle");
  await page.waitForTimeout(1100);
  assert.equal(await page.locator(".story-summary").getAttribute("data-status"), "idle", "cancelled chunks must not replace idle state");

  const requestsBeforeNavigation = aiRequests;
  await page.getByRole("button", { name: "Summarize article" }).click();
  await page.getByRole("button", { name: "Cancel article summary" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".story-summary")?.dataset.status === "generating");
  await page.locator(".story-card").nth((summaryStoryIndex + 1) % count).locator(".story-comment-button").click();
  await page.locator(".thread-title").waitFor({ state: "visible" });
  await summaryStoryCard.locator(".story-comment-button").click();
  await page.locator('[data-summary-action-id="' + summaryStoryId + '"][data-summary-source="article"]').waitFor({ state: "visible" });
  assert.equal(await page.locator(".story-summary").getAttribute("data-status"), "idle", "revisiting a cancelled story must allow a new summary");
  assert.ok(aiRequests > requestsBeforeNavigation, "navigation should cancel a real pending request");
  aiResponseMode = "stream";
  await page.getByRole("button", { name: "Summarize article" }).click();
  await page.waitForFunction(() => document.querySelector(".story-summary")?.dataset.status === "success");

  if (process.env.OPENROUTER_TEST_KEY) {
    await extensionWorker.evaluate((key) => saveAiKey(key, "session"), process.env.OPENROUTER_TEST_KEY);
    aiResponseMode = "live";
    await page.getByRole("button", { name: "Regenerate article summary" }).click();
    await page.waitForFunction(() => ["success", "error"].includes(document.querySelector(".story-summary")?.dataset.status), null, { timeout: 125000 });
    const liveStatus = await page.locator(".story-summary").getAttribute("data-status");
    const liveText = await page.locator(".story-summary-body").textContent();
    await extensionWorker.evaluate((key) => saveAiKey(key, "persistent"), testApiKey);
    assert.equal(liveStatus, "success", "live OpenRouter request failed: " + liveText);
    assert.ok(liveText.trim().length > 0, "live summary should contain text");
    console.log(JSON.stringify({ liveOpenRouter: "passed", model: "openrouter/free", summaryCharacters: liveText.length }));
  }
  const requestsBeforeReload = aiRequests;
  aiResponseMode = "stream";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".thread-title").waitFor({ state: "visible" });
  assert.equal(aiRequests, requestsBeforeReload, "auto-summary should stay off by default after reload");
  const openAiSettings = async () => {
    await page.locator(".feed-toolbar-actions .icon-button").last().click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".settings-overlay").waitFor({ state: "visible" });
    await page.locator(".settings-category", { hasText: "AI" }).click();
  };
  await openAiSettings();
  assert.equal(await page.locator(".ai-settings-section textarea").inputValue(), openRouterPayload.messages[0].content, "AI settings should survive reload");
  await page.locator(".setting-row").filter({ hasText: "Automatically summarize articles" }).locator('input[type="checkbox"]').check();
  await extensionWorker.evaluate(async () => {
    while (!(await chrome.storage.sync.get("harmonovaSettings")).harmonovaSettings.aiAutoSummarize) await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".story-summary")?.dataset.status === "success");
  assert.ok(aiRequests > requestsBeforeReload, "enabled auto-summary should start after reload");
  await openAiSettings();
  await page.locator(".setting-row").filter({ hasText: "Automatically summarize articles" }).locator('input[type="checkbox"]').uncheck();
  await page.locator(".settings-header .icon-button").click();
  const credentialPage = await context.newPage();
  await credentialPage.goto(`chrome-extension://${extensionId}/ai-settings.html`);
  await credentialPage.locator("#clear").click();
  await credentialPage.waitForFunction(() => document.querySelector("#message")?.textContent?.includes("cleared"));
  await credentialPage.close();
  await page.getByRole("button", { name: "Regenerate article summary" }).click();
  await page.locator(".settings-overlay").waitFor({ state: "visible" });
  assert.ok((await page.locator(".ai-key-status").textContent()).includes("Not set"), "missing key should direct users to setup");
  await page.locator(".settings-header .icon-button").click();
  await extensionWorker.evaluate((key) => saveAiKey(key, "session"), testApiKey);
  assert.equal(await extensionWorker.evaluate(async () => (await chrome.storage.local.get("harmonovaAiApiKey")).harmonovaAiApiKey), undefined, "session keys must not remain on disk");

  await context.unroute(summaryArticleUrl);
  await context.unroute("https://openrouter.ai/api/v1/chat/completions");

  const titleCard = page.locator(".story-card").nth(3);
  const titleCardId = await titleCard.getAttribute("data-story-id");
  const pageCountBeforeTitleClick = context.pages().length;
  await titleCard.locator(".story-card-title").click();
  await page.waitForURL(new RegExp("item\\?id=" + titleCardId), { timeout: 10000 });
  await page.waitForTimeout(250);
  assert.equal(context.pages().length, pageCountBeforeTitleClick, "title click should stay in HarmoNova when card-click comments is enabled");

  await page.waitForFunction(() => document.querySelectorAll(".story-card.has-preview").length > 0, null, { timeout: 10000 }).catch(() => {});
  const previewCard = page.locator(".story-card.has-preview").first();
  if (await previewCard.count()) {
    const previewCardId = await previewCard.getAttribute("data-story-id");
    const pageCountBeforePreviewClick = context.pages().length;
    await previewCard.locator(".story-preview").click();
    await page.waitForURL(new RegExp("item\\?id=" + previewCardId), { timeout: 10000 });
    await page.waitForTimeout(250);
    assert.equal(context.pages().length, pageCountBeforePreviewClick, "preview image click should stay in HarmoNova when card-click comments is enabled");
  }

  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".settings-overlay").waitFor({ state: "visible" });
  await page.locator(".settings-category", { hasText: "Stories" }).click();
  await page.locator(".setting-row").filter({ hasText: "Card click opens comments" }).locator('input[type="checkbox"]').uncheck();
  await page.locator(".settings-header .icon-button").click();
  await page.locator(".settings-overlay").waitFor({ state: "detached" });

  const firstComment = page.locator(".comment-row").first();
  await firstComment.waitFor({ state: "visible", timeout: 15000 });
  const commentCard = firstComment.locator(":scope > .comment-card");
  const commentBox = await commentCard.boundingBox();
  assert.ok(commentBox, "first comment should have a visible card");
  await commentCard.click({ position: { x: Math.max(8, commentBox.width - 8), y: Math.min(12, commentBox.height / 2) } });
  await page.waitForTimeout(150);
  assert.ok(await firstComment.evaluate((e) => e.classList.contains("collapsed")), "comment click should collapse thread");

  const quoteCount = await page.locator(".harmonova-quote").count();
  const unnormalizedQuoteParagraphs = await page.locator(".comment-body p").evaluateAll((nodes) =>
    nodes.filter((node) => (node.textContent || "").trimStart().startsWith(">")).length
  );
  assert.equal(unnormalizedQuoteParagraphs, 0, "literal > quote paragraphs should be normalized");
  if (quoteCount > 0) {
    const quoteStyle = await page.locator(".harmonova-quote").first().evaluate((e) => {
      const s = getComputedStyle(e);
      return { background: s.backgroundColor, borderLeft: s.borderLeftWidth, paddingLeft: s.paddingLeft };
    });
    const firstQuoteText = (await page.locator(".harmonova-quote").first().textContent()) || "";
    assert.ok(!firstQuoteText.trimStart().startsWith(">"), "normalized quote should not keep a leading > marker");
    assert.notEqual(quoteStyle.background, "rgba(0, 0, 0, 0)", "quotes should have a visible background");
    assert.ok(parseFloat(quoteStyle.borderLeft) >= 2, "quotes should have a visible left rule");
    assert.ok(parseFloat(quoteStyle.paddingLeft) >= 8, "quotes should have readable inset spacing");
  }

  const articleHref = await page.locator(".story-card-title").first().getAttribute("href");
  const newPagePromise = context.waitForEvent("page", { timeout: 10000 });
  await page.locator(".story-card-title").first().click();
  const articlePage = await newPagePromise;
  await articlePage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  assert.ok(articleHref, "story should have an article href");
  assert.notEqual(new URL(articlePage.url()).hostname, "news.ycombinator.com", "article should open in another tab");
  assert.equal(new URL(page.url()).hostname, "news.ycombinator.com", "reader tab should remain on Hacker News");

  await page.screenshot({ path: path.join(outDir, "harmonova-1919x872.png"), fullPage: false });

  const originalPagePromise = context.waitForEvent("page", { timeout: 10000 });
  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Open original Hacker News" }).click();
  const originalPage = await originalPagePromise;
  await originalPage.waitForLoadState("domcontentloaded", { timeout: 15000 });
  await originalPage.locator("#hnmain").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await originalPage.locator(".harmonova-app").count(), 0, "Open original Hacker News should bypass the HarmoNova renderer");
  await originalPage.goto("https://news.ycombinator.com/newest", { waitUntil: "domcontentloaded" });
  await originalPage.locator("#hnmain").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await originalPage.locator(".harmonova-app").count(), 0, "original-HN mode should persist while navigating in the same tab");
  await originalPage.close();

  const disableNavigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Disable HarmoNova" }).click();
  await disableNavigation;
  await page.locator("#hnmain").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator(".harmonova-app").count(), 0, "Disable HarmoNova should reload stock Hacker News without disabling the Chrome extension");

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
  const popupToggle = popupPage.locator("#enabled");
  await popupToggle.waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await popupToggle.isChecked(), false, "extension popup should reflect the disabled state");
  await popupToggle.check();
  await popupPage.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("Enabled"));
  const enabledAfterPopup = await extensionWorker.evaluate(async () => (await chrome.storage.sync.get(["harmonovaEnabled"])).harmonovaEnabled);
  assert.equal(enabledAfterPopup, true, "extension popup should re-enable HarmoNova in storage");
  await popupPage.close();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await page.locator(".harmonova-app").count(), 1, "reloading after popup re-enable should restore HarmoNova");

  // Regression: long comment headings must not expand the popup to screen size.
  await page.locator(".comment-card").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".comment-card").first().click({ button: "right" });
  const popupMetrics = await page.locator(".harmonova-popup").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, left: box.left, top: box.top,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      accent: getComputedStyle(node.querySelector('[data-icon="star"] .harmonova-icon')).color };
  });
  assert.ok(popupMetrics.width <= 310 && popupMetrics.height <= 540, "context menu should be compact and scrollable");
  assert.ok(popupMetrics.left >= 0 && popupMetrics.top >= 0 && popupMetrics.left + popupMetrics.width <= popupMetrics.viewportWidth, "menu stays on screen");
  assert.notEqual(popupMetrics.accent, "rgb(200, 198, 207)", "action icons use subtle theme accents");
  await page.mouse.click(4, 4);

  // Regression: setting hidden=true must beat .story-card display:grid.
  await page.evaluate(() => {
    const job = document.querySelector('.story-list .story-card').cloneNode(true);
    job.dataset.storyId = '999999999';
    job.dataset.type = 'job';
    document.querySelector('.story-list').prepend(job);
  });
  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".settings-category", { hasText: "Stories" }).click();
  const hideJobsInput = page.locator(".setting-row").filter({ hasText: "Hide jobs" }).locator('input[type="checkbox"]');
  await hideJobsInput.check();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-story-id="999999999"]')).display === "none");
  await hideJobsInput.uncheck();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-story-id="999999999"]')).display !== "none");
  await page.locator(".settings-header .icon-button").click();
  await page.locator('[data-story-id="999999999"]').evaluate((node) => node.remove());

  console.log(JSON.stringify({
    storyCards: count,
    interfaceFont: "system",
    titleTop: layout.titleTop,
    storyGutter: layout.firstCardLeft,
    refreshSize: [layout.refreshWidth, layout.refreshHeight],
    feedScroll: [leftBefore, leftAfter],
    threadScroll: [rightBefore, rightAfter],
    selectedStoryId: secondId,
    settingsRows: settingRows,
    contentZoom: 70,
    commentTextSize: 15.5,
    commentSort: "Newest first",
    commentCollapse: true,
    quoteBlocks: quoteCount,
    aiSummary: true,
    aiModel: "openrouter/free",
    apiKeyPrivate: true,
    externalTab: articlePage.url(),
    originalTabBypass: true,
    popupReenable: true,
    extensionId,
    screenshot: path.join(outDir, "harmonova-1919x872.png")
  }, null, 2));
} finally {
  await context.close();
}
