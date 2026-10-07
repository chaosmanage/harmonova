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

  const count = await page.locator(".story-card").count();
  assert.ok(count >= 30, "expected at least 30 story cards");

  const layout = await page.evaluate(() => {
    const title = document.querySelector(".feed-title-button").getBoundingClientRect();
    const first = document.querySelector(".story-card").getBoundingClientRect();
    const refresh = document.querySelector(".refresh-pill").getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll(".story-card")).slice(0, 12).map((card) => ({
      clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight,
      height: card.getBoundingClientRect().height
    }));
    return {
      titleTop: title.top,
      firstCardLeft: first.left,
      refreshWidth: refresh.width,
      refreshHeight: refresh.height,
      cards
    };
  });
  assert.ok(layout.titleTop <= 26, "Top Stories should sit near the top");
  assert.ok(layout.firstCardLeft <= 20, "story gutter should be compact");
  assert.ok(layout.refreshWidth <= 160 && layout.refreshHeight <= 46, "refresh control should stay compact");
  assert.ok(layout.cards.every((card) => card.scrollHeight <= card.clientHeight + 1 && card.height >= 64), "story cards should grow with content without clipping");

  const left = page.locator(".story-list");
  const leftBefore = await left.evaluate((e) => e.scrollTop);
  await left.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(250);
  const leftAfter = await left.evaluate((e) => e.scrollTop);
  assert.ok(leftAfter > leftBefore, "left feed should scroll");

  const right = page.locator(".thread-pane");
  const rightBefore = await right.evaluate((e) => e.scrollTop);
  await right.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(250);
  const rightAfter = await right.evaluate((e) => e.scrollTop);
  assert.ok(rightAfter > rightBefore, "thread pane should scroll");

  await left.evaluate((e) => { e.scrollTop = 0; });
  await right.evaluate((e) => { e.scrollTop = 0; });

  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.load('400 16px "Google Sans Flex Rounded"');
    return Array.from(document.fonts).some((face) => face.family.replace(/["']/g, "") === "Google Sans Flex Rounded" && face.status === "loaded");
  });
  assert.ok(fontLoaded, "Google Sans Flex Rounded should load for the Harmonic UI");

  const thirdCard = page.locator(".story-card").nth(2);
  const thirdHref = await thirdCard.locator(".story-card-title").getAttribute("href");
  assert.ok(thirdHref, "third story should expose its article URL");
  const cardTabPromise = context.waitForEvent("page", { timeout: 10000 });
  const cardBox = await thirdCard.boundingBox();
  assert.ok(cardBox, "third story card should have a bounding box");
  await thirdCard.click({ position: { x: Math.max(45, Math.min(70, cardBox.width * 0.15)), y: Math.max(10, cardBox.height - 12) } });
  const cardTab = await cardTabPromise;
  await cardTab.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  assert.equal(cardTab.url(), thirdHref, "story card body should open its article in a new tab like Harmonic");
  await cardTab.close();

  const secondCard = page.locator(".story-card").nth(1);
  const secondId = await secondCard.getAttribute("data-story-id");
  await secondCard.locator(".story-comment-button").click();
  await page.waitForURL(new RegExp("item\\?id=" + secondId), { timeout: 10000 });
  await page.locator(".thread-title").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(new URL(page.url()).searchParams.get("id"), secondId, "comment button should select discussion");

  await page.getByRole("button", { name: "More" }).last().click();
  await page.getByRole("button", { name: /Sort comments/ }).click();
  const sortLabels = await page.locator(".harmonic-popup .popup-item").allTextContents();
  for (const mode of ["Default", "Newest first", "Oldest first", "Reply count"]) {
    assert.ok(sortLabels.some((label) => label.includes(mode)), "sort menu should contain " + mode);
  }
  await page.getByRole("button", { name: /Newest first/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "More" }).last().click();
  assert.ok((await page.locator(".harmonic-popup").textContent()).includes("Sort comments · Newest first"), "selected sort mode should persist in the thread menu");
  await page.locator(".harmonic-popup").evaluate((e) => e.remove());

  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".settings-overlay").waitFor({ state: "visible" });
  const settingRows = await page.locator(".setting-row").count();
  assert.ok(settingRows >= 16, "expected expanded Harmonic-style settings controls");
  const settingsText = await page.locator(".settings-panel").textContent();
  for (const label of ["Content zoom", "Comment text size", "Card click opens comments", "Comment sorting", "Thread colors"]) {
    assert.ok(settingsText.includes(label), "settings should contain " + label);
  }

  const zoomRow = page.locator(".setting-row").filter({ hasText: "Content zoom" });
  const zoomSlider = zoomRow.locator('input[type="range"]');
  assert.equal(await zoomSlider.inputValue(), "100", "default desktop content zoom should match Harmonic at 100%");
  await zoomSlider.fill("80");
  await page.waitForTimeout(150);
  assert.ok((await zoomRow.textContent()).includes("80%"), "content zoom setting should update live");

  const commentSizeRow = page.locator(".setting-row").filter({ hasText: "Comment text size" });
  const commentSizeSlider = commentSizeRow.locator('input[type="range"]');
  await commentSizeSlider.fill("16");
  await page.waitForTimeout(150);
  assert.ok((await commentSizeRow.textContent()).includes("16 sp"), "comment text size should be adjustable");

  // Restore Harmonic defaults before the visual regression screenshot.
  await zoomSlider.fill("100");
  await commentSizeSlider.fill("15");
  await page.waitForTimeout(150);

  await page.locator(".settings-header .icon-button").click();
  await page.locator(".settings-overlay").waitFor({ state: "detached" });

  const firstComment = page.locator(".comment-row").first();
  const commentCard = firstComment.locator(":scope > .comment-card");
  const commentBox = await commentCard.boundingBox();
  assert.ok(commentBox, "first comment should have a visible card");
  await commentCard.click({ position: { x: Math.max(8, commentBox.width - 8), y: Math.min(12, commentBox.height / 2) } });
  await page.waitForTimeout(150);
  assert.ok(await firstComment.evaluate((e) => e.classList.contains("collapsed")), "comment click should collapse thread");

  const quoteCount = await page.locator(".harmonic-quote").count();
  if (quoteCount > 0) {
    const quoteStyle = await page.locator(".harmonic-quote").first().evaluate((e) => {
      const s = getComputedStyle(e);
      return { background: s.backgroundColor, borderLeft: s.borderLeftWidth, paddingLeft: s.paddingLeft };
    });
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

  await page.screenshot({ path: path.join(outDir, "harmonic-1919x872.png"), fullPage: false });

  console.log(JSON.stringify({
    storyCards: count,
    fontLoaded,
    titleTop: layout.titleTop,
    storyGutter: layout.firstCardLeft,
    refreshSize: [layout.refreshWidth, layout.refreshHeight],
    feedScroll: [leftBefore, leftAfter],
    threadScroll: [rightBefore, rightAfter],
    selectedStoryId: secondId,
    settingsRows: settingRows,
    contentZoom: 100,
    commentTextSize: 15,
    commentSort: "Newest first",
    commentCollapse: true,
    quoteBlocks: quoteCount,
    externalTab: articlePage.url(),
    screenshot: path.join(outDir, "harmonic-1919x872.png")
  }, null, 2));
} finally {
  await context.close();
}
