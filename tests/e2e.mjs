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

  const secondCard = page.locator(".story-card").nth(1);
  const secondId = await secondCard.getAttribute("data-story-id");
  await secondCard.locator(".story-comment-button").click();
  await page.waitForURL(new RegExp("item\\?id=" + secondId), { timeout: 10000 });
  await page.locator(".thread-title").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(new URL(page.url()).searchParams.get("id"), secondId, "comment button should select discussion");

  await page.locator(".feed-toolbar-actions .icon-button").last().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator(".settings-overlay").waitFor({ state: "visible" });
  const settingRows = await page.locator(".setting-row").count();
  assert.ok(settingRows >= 12, "expected Harmonic-style settings controls");
  await page.locator(".settings-header .icon-button").click();
  await page.locator(".settings-overlay").waitFor({ state: "detached" });

  const firstComment = page.locator(".comment-row").first();
  await firstComment.locator(":scope > .comment-card > .comment-body").click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(150);
  assert.ok(await firstComment.evaluate((e) => e.classList.contains("collapsed")), "comment click should collapse thread");

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
    feedScroll: [leftBefore, leftAfter],
    threadScroll: [rightBefore, rightAfter],
    selectedStoryId: secondId,
    settingsRows: settingRows,
    commentCollapse: true,
    externalTab: articlePage.url(),
    screenshot: path.join(outDir, "harmonic-1919x872.png")
  }, null, 2));
} finally {
  await context.close();
}
