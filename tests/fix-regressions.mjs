// Chromium regression for the real HN js=t vote protocol and delayed Algolia comments.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixture = (name) => fs.readFileSync(path.join(root, "tests/fixtures/hn/synthetic", name), "utf8");
const storyId = 50022292;
const newId = 91919991;
const postedText = "HarmoNova browser regression reply";
const requests = [];
let posted = false;
let voted = true;
const now = Math.floor(Date.now() / 1000);
const story = { id: storyId, type: "story", by: "submitter_0", title: "Chromium regression story", score: 55, time: now - 1200, descendants: 3, kids: [] };
const comment = { id: 50029143, author: "commenter_a", text: "<p>Original test comment.</p>", created_at_i: now - 180, children: [] };
function hnItem() {
  let html = fixture("item-in.html");
  if (!voted) {
    const unv = '<span id="unv_' + storyId + '"> | <a id="un_' + storyId + '" class="clicky" href="vote?id=' + storyId + '&amp;how=un&amp;auth=' + "0".repeat(40) + '&amp;goto=item%3Fid%3D' + storyId + '">unvote</a></span>';
    html = html.replace(unv, '<span id="unv_' + storyId + '"></span>').replace('id="up_' + storyId + '" class="nosee"', 'id="up_' + storyId + '"');
  }
  if (posted) {
    const row = '<tr class="athing comtr" id="' + newId + '"><td><table><tbody><tr><td><span class="comhead"><a class="hnuser" href="user?id=harmonova_test">harmonova_test</a></span></td></tr><tr><td><span class="commtext"><p>' + postedText + '</p></span></td></tr></tbody></table></td></tr>';
    html = html.replace('<table border="0" class="comment-tree"><tbody>', '<table border="0" class="comment-tree"><tbody>' + row);
  }
  return html;
}

const ctx = await chromium.launchPersistentContext("", {
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true, viewport: { width: 1440, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-extensions-except=" + root, "--load-extension=" + root],
});
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
await ctx.route("**/*", async route => {
  const req = route.request();
  const u = new URL(req.url());
  const base = { status: 200, contentType: "text/html; charset=utf-8" };
  const html = (body) => route.fulfill({ ...base, body });
  if (u.hostname === "news.ycombinator.com") {
    requests.push({ pathname: u.pathname, query: Object.fromEntries(u.searchParams), method: req.method() });
    if (/\.(?:js|css|svg|png|gif|ico)$/.test(u.pathname)) return html("");
    if (u.pathname === "/vote") {
      if (u.searchParams.get("js") !== "t") throw new Error("Expected js=t");
      voted = u.searchParams.get("how") !== "un";
      return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
    }
    if (u.pathname === "/comment" && req.method() === "POST") {
      const fields = new URLSearchParams(req.postData() || "");
      assert.match(req.headers()["content-type"] || "", /^application\/x-www-form-urlencoded(?:\s*;|$)/i);
      assert.equal(fields.get("parent"), String(storyId));
      assert.equal(fields.get("text"), postedText);
      posted = true;
      return route.fulfill({ status: 302, headers: { Location: "https://news.ycombinator.com/item?id=" + storyId }, body: "" });
    }
    if (u.pathname === "/item") return html(hnItem());
    if (u.pathname === "/news" || u.pathname === "/") return html(fixture("news-in.html"));
    return html(fixture("news-in.html"));
  }
  if (u.hostname === "hacker-news.firebaseio.com") {
    if (u.pathname.endsWith("/topstories.json")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([storyId]) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(story) });
  }
  if (u.hostname === "hn.algolia.com") {
    if (u.pathname.includes("/items/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        id: storyId, title: story.title, author: story.by, points: story.score,
        created_at_i: story.time, children: [comment], text: null,
      }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [], nbPages: 1, page: 0 }) });
  }
  return route.abort();
});

try {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible" });
  assert.equal(await page.locator(".feed-toolbar-actions .icon-button").count(), 3);
  await page.locator(".story-comment-button").first().click();
  await page.locator("[data-thread-vote].active").waitFor({ timeout: 20000 });
  await page.locator("[data-thread-vote]").click();
  await page.waitForFunction(() => document.querySelector("[data-thread-vote]")?.title === "Upvote", null, { timeout: 20000 });
  assert.equal(requests.filter(r => r.pathname === "/vote").length, 1);
  assert.equal(requests.find(r => r.pathname === "/vote").query.how, "un");
  console.log("ok - Chromium handles a blank js=t reply and unvotes an existing vote");

  const more = page.locator(".thread-actions .thread-action[aria-label='More']");
  await more.click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Reply to story" }).click();
  await page.locator(".composer-submit:enabled").waitFor({ timeout: 20000 });
  assert.ok(await page.locator(".composer-format-help").isVisible());
  await page.locator(".composer-input").fill(postedText);
  await page.locator(".composer-input").press("Control+Enter");
  // The POST is sent once. Read-only GET /item confirmation now detects the
  // just-posted comment even when the POST redirected HTML was stale.
  await page.locator('.comment-row[data-comment-id="' + newId + '"]').waitFor({ state: "visible", timeout: 20000 });
  console.log("ok - Chromium sends a single comment POST");
  assert.equal(requests.filter(r => r.pathname === "/comment").length, 1);
  assert.equal(await page.locator(".composer").count(), 0);
  assert.ok((await page.locator('.comment-row[data-comment-id="' + newId + '"]').innerText()).includes(postedText));
  console.log("ok - Chromium confirms via item fetch and inserts reply without waiting for Algolia");

  await page.locator(".thread-actions .thread-action[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Sort comments" }).click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Newest first" }).click();
  await page.locator('.comment-row[data-comment-id="' + newId + '"]').waitFor({ state: "visible", timeout: 20000 });
  console.log("ok - newly posted comment survives thread rerender");

  assert.deepEqual(pageErrors, [], "No page errors");
  console.log("ok - no Chromium page errors");
  await fs.promises.mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({ path: path.join(root, "test-results", "fix-regression-thread.png") });
} finally {
  await ctx.close();
}
