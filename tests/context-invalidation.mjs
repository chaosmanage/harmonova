// Regression: a tab left open when Chrome reloads the extension must not throw.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || root);
const newsHtml = fs.readFileSync(path.join(root, "tests/fixtures/hn/synthetic/news-in.html"), "utf8");
const storyId = 50022292;
const story = { id: storyId, type: "story", by: "tester", title: "Context reload test", score: 22, time: Math.floor(Date.now() / 1000), descendants: 1, url: "https://example.com/story" };
const ctx = await chromium.launchPersistentContext("", {
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-extensions-except=" + extensionPath, "--load-extension=" + extensionPath],
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await ctx.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === "news.ycombinator.com") {
    if (/\.(?:js|css|svg|png|gif|ico)$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: newsHtml });
  }
  if (url.hostname === "hacker-news.firebaseio.com") {
    const value = url.pathname.endsWith("/topstories.json") ? [storyId] : story;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
  }
  if (url.hostname === "hn.algolia.com") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [], nbPages: 1, page: 0 }) });
  }
  return route.abort();
});

try {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ timeout: 20000 });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  // Schedule reload after the extension worker has returned to Playwright.
  await worker.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); });
  await page.waitForTimeout(600);

  // A setting change sends a worker message from the stale modular content
  // script. The shared runtime guard must catch Chrome's sync exception.
  await page.locator('.feed-toolbar-actions button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Settings" }).click();
  await page.locator('.settings-category', { hasText: 'Stories' }).click();
  await page.locator('.settings-overlay .setting-row', { hasText: 'Tint cards from images' }).click();
  const notice = page.locator("#harmonova-context-reload");
  await notice.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await notice.innerText(), /Refresh this tab to reconnect/);
  assert.equal(await notice.count(), 1, "show only one reload prompt");
  assert.deepEqual(errors, [], "invalidated runtime calls must not cause page errors");

  // In headless Chromium, runtime.reload() can unload an unpacked extension
  // altogether. Verify tab reload works and the stale script is gone; fresh
  // extension startup is covered by the existing browser suite.
  await Promise.all([
    page.waitForEvent("load"),
    notice.getByRole("button", { name: "Reload tab" }).click(),
  ]);
  assert.equal(await page.locator("#harmonova-context-reload").count(), 0);
  assert.deepEqual(errors, [], "the tab reload must not cause page errors");
  console.log("ok - invalidated messaging handled and reload control works");
} finally {
  await ctx.close();
}
