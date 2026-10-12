// HarmoNova Phase 7 part 2 (0.12.1) UI suite: comment parity — OP highlight,
// generated avatars, new-comment markers since last visit, [delayed] hiding,
// in-thread comment filtering with match counts, top-level prev/next + up
// navigation, user tags, blocked users, and bookmark/user-data export+import
// with schema validation. Drives the real Chromium extension against mocked
// HN + Firebase + Algolia documents.
import {launchExtension} from "./helpers/extension.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);

const USER = "harmonova_test";
const OP_USER = "submitter_0";
const OTHER = "seabass";
const FRESH = "commenter_a";
const BLOCKED = "commenter_b";
const STORY_ID = 50022292;
const OWN_COMMENT = 50032063;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");
const SEED_SEEN = () => JSON.stringify({ [STORY_ID]: Math.floor(Date.now() / 1000) - 1800 });

function createHnMock() {
  const requests = [];
  const serveHtml = (html) => ({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  async function handle(route) {
    const parsed = new URL(route.request().url());
    const pathname = parsed.pathname;
    requests.push({ method: route.request().method(), path: pathname + parsed.search });
    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonova mocked asset */"));
    }
    switch (pathname) {
      case "/news":
      case "/":
      case "/newest":
        return route.fulfill(serveHtml(fixture("synthetic", "news-in.html")));
      case "/item":
        return route.fulfill(serveHtml(fixture("synthetic", "item-in.html")));
      case "/login":
        return route.fulfill(serveHtml(fixture("login.html")));
      default:
        return route.fulfill(serveHtml(fixture("synthetic", "news-in.html")));
    }
  }
  return { requests, handle };
}

function createDataMocks() {
  const now = Math.floor(Date.now() / 1000);
  const stories = {
    [STORY_ID]: {
      id: STORY_ID,
      type: "story",
      by: OP_USER,
      title: "Mocked feed story " + STORY_ID,
      url: "https://mocked-source.com/a",
      score: 55,
      time: now - 3600,
      descendants: 5,
    },
  };
  const discussion = {
    id: STORY_ID,
    title: "Mocked feed story " + STORY_ID,
    url: "https://mocked-source.com/a",
    author: OP_USER,
    points: 55,
    created_at_i: now - 3600,
    text: null,
    children: [
      { id: 50034100, author: OP_USER, created_at_i: now - 3600, text: "The original poster explains the story.", children: [] },
      { id: OTHER === "seabass" ? 50034061 : 0, author: OTHER, created_at_i: now - 3600, text: "Seabass says something clever here.", children: [] },
      { id: 50034101, author: FRESH, created_at_i: now - 30, text: "A fresh comment posted just now.", children: [] },
      { id: 50034102, author: BLOCKED, created_at_i: now - 120, text: "[delayed] this comment is being held.", children: [] },
      { id: OWN_COMMENT, author: USER, created_at_i: now - 900, text: "My own seeded comment.", children: [] },
    ],
  };
  return async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([STORY_ID]) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        const id = Number(itemMatch[1]);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(stories[id] || { id, type: "story", title: "Mocked story", score: 1, time: now, descendants: 0 }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (parsed.hostname === "hn.algolia.com") {
      const itemMatch = parsed.pathname.match(/\/items\/(\d+)/);
      if (itemMatch) {
        const id = Number(itemMatch[1]);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(id === STORY_ID ? discussion : { id, author: "unknown", text: "x", created_at_i: now, story_id: STORY_ID, story_title: "T", children: [] }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
    }
    return route.continue();
  };
}

let browser;

let passed = 0;
let failed = 0;
const failures = [];

const waitFor = async (fn, timeout = 30000, step = 150, label = "condition") => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  throw new Error("Timed out waiting for " + label);
};

async function test(name, fn) {
  if (process.env.HARMONOVA_TEST_FILTER && !name.toLowerCase().includes(process.env.HARMONOVA_TEST_FILTER.toLowerCase())) return;
  const harness=await launchExtension();browser=harness.context;
  const hn = createHnMock();
  const dataMocks = createDataMocks();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
    if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
    if(parsed.protocol==="chrome-extension:")return route.continue();
    return route.fallback();
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("  pageerror:", String(error).slice(0, 160)));
  try {
    // This suite tests comment display/interaction only. General previews
    // default on in production, but synthetic article hosts are not routed
    // here; isolate the independent preview preference explicitly.
    await harness.worker.evaluate(()=>chrome.storage.local.set({
      harmonovaNetworkPolicyV1:{version:1,externalPreviewsEnabled:false}
    }));
    await fn({ page, hn });
    harness.assertOffline();
    passed++;
    console.log("ok -", name);
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  } finally {
    await harness.close();
  }
}

const gotoFeed = async (page, seedSeen) => {
  // The persistent context shares localStorage across tests: wipe the
  // harmonova keys once at document start so every test starts clean, while
  // in-test reloads keep whatever the extension persisted.
  await page.addInitScript(() => {
    if (location.hostname !== "news.ycombinator.com") return;
    if (sessionStorage.getItem("harmonovaWipeDone")) return;
    sessionStorage.setItem("harmonovaWipeDone", "1");
    for (const key of Object.keys(localStorage)) if (key.startsWith("harmonova")) localStorage.removeItem(key);
  });
  if (seedSeen !== undefined)
    // One-shot: sessionStorage survives reloads in the same tab, so the seed
    // applies on the first load only and the app's own seen-times win after.
    await page.addInitScript(
      (seed) => {
        if (location.hostname !== "news.ycombinator.com") return;
        if (sessionStorage.getItem("harmonovaSeedDone")) return;
        sessionStorage.setItem("harmonovaSeedDone", "1");
        localStorage.setItem("harmonovaSeenComments", seed);
      },
      seedSeen
    );
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
};

const openThreadFully = async (page) => {
  // The comment button deterministically opens the discussion in this tab
  // (a card/title click would also pop the article into a new tab).
  await page.locator('.story-card[data-story-id="' + STORY_ID + '"] .story-comment-button').click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".comments > .comment-row").length >= 4, null, { timeout: 20000 });
};

const rowFor = (page, author) =>
  page.locator('.comments > .comment-row[data-author="' + author + '"]').first();

const openSettings = async (page, category = "Comments") => {
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Settings" }).click();
  const panel = page.locator(".settings-panel");
  await panel.waitFor({ state: "visible", timeout: 5000 });
  await panel.locator(".settings-category", { hasText: category }).click();
  return panel;
};

// The comment menu can lose a race with late thread re-renders, so retry.
const openCommentMenu = async (page, author, itemText) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rowFor(page, author).locator(":scope > .comment-card").click({ button: "right" });
    try {
      const item = page.locator(".harmonova-popup .popup-item", { hasText: itemText });
      await item.waitFor({ state: "visible", timeout: 4000 });
      await item.click();
      return;
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  throw new Error("comment menu item never appeared: " + itemText);
};

// ---------------------------------------------------------------------------

await test("OP comments are highlighted with a badge and a row class", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const opRow = rowFor(page, OP_USER);
  assert.ok(await opRow.evaluate((node) => node.classList.contains("by-op")), "OP row carries by-op");
  assert.ok((await opRow.locator(".op-badge").textContent()) === "(OP)", "OP attribution rendered");
  const otherRow = rowFor(page, OTHER);
  assert.equal(await otherRow.locator(".op-badge").count(), 0, "non-OP rows carry no badge");
});

await test("OP-only filter shows OP comments and can restore every comment", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const more = page.locator('.thread-actions button[aria-label="More"]');
  await more.click();
  await page.locator('.harmonova-popup .popup-item', { hasText: "Show only OP comments" }).click();
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".comments > .comment-row")];
    return rows.some((row) => row.dataset.author === "submitter_0" && !row.hidden) &&
      rows.some((row) => row.dataset.author !== "submitter_0" && row.hidden);
  });
  await more.click();
  await page.locator('.harmonova-popup .popup-item', { hasText: "Show all comments" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".comments > .comment-row")].every((row) => !row.hidden)
  );
});

await test("generated avatars are deterministic and local", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  assert.equal(await page.locator(".comment-avatar").count(), 0, "avatars are off by default");
  const panel = await openSettings(page);
  await panel.locator(".setting-row", { hasText: "Comment avatars" }).locator("input").first().click();
  await panel.locator(".settings-header .icon-button").first().click();
  const avatars = page.locator(".comment-avatar");
  assert.ok((await avatars.count()) >= 4, "enabling avatars renders local initials");
  const first = await avatars.first().textContent();
  assert.ok(/^[A-Z]$/.test(first), "avatar shows the author initial: " + first);
  const author1 = await rowFor(page, OTHER).locator(".comment-avatar").getAttribute("style");
  const ownAvatar = await rowFor(page, USER).locator(".comment-avatar").getAttribute("style");
  assert.ok(author1 && ownAvatar, "avatars carry inline tint styles");
  assert.notEqual(author1, ownAvatar, "different authors get different tints");
});

await test("new comments get a marker that clears on the next visit", async ({ page }) => {
  await gotoFeed(page, SEED_SEEN());
  await openThreadFully(page);
  const freshRow = rowFor(page, FRESH);
  assert.ok(await freshRow.evaluate((node) => node.classList.contains("is-new")), "fresh comment marked as new");
  assert.equal(await freshRow.locator(".new-badge").count(), 0, "newness uses a thin rail instead of a badge");
  const oldRow = rowFor(page, OTHER);
  assert.ok(!(await oldRow.evaluate((node) => node.classList.contains("is-new"))), "older comments not marked");

  // After the read-through, the story's seen timestamp advances past the
  // fresh comment's age; a reload shows no markers.
  await page.waitForTimeout(4500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openThreadFully(page);
  assert.ok(!(await rowFor(page, FRESH).evaluate((node) => node.classList.contains("is-new"))), "marker cleared after revisit");
});

await test("hide [delayed] toggle controls placeholder visibility", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const delayedRow = page.locator('.comment-row[data-author="' + BLOCKED + '"]').first();
  assert.ok(await delayedRow.evaluate((node) => node.classList.contains("is-delayed")), "delayed row flagged");
  assert.equal(
    await delayedRow.evaluate((node) => getComputedStyle(node).display),
    "none",
    "delayed placeholder hidden by default"
  );
  const panel = await openSettings(page);
  await panel.locator(".setting-row", { hasText: "Hide [delayed]" }).locator("input").first().click();
  await panel.locator(".settings-header .icon-button").first().click();
  await page.waitForTimeout(800); // re-render
  const row2 = page.locator('.comment-row[data-author="' + BLOCKED + '"]').first();
  assert.notEqual(await row2.evaluate((node) => getComputedStyle(node).display), "none", "delayed row visible when the toggle is off");
});

await test("in-thread filter keeps matching branches with a match count", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await page.locator(".thread-actions .thread-action[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Search in comments" }).click();
  const searchBox = page.locator(".comment-search");
  await searchBox.fill("seabass");
  await page.waitForFunction(
    () => !document.querySelector('.comments > .comment-row[data-author="seabass"]')?.hidden &&
      document.querySelector('.comments > .comment-row[data-author="submitter_0"]')?.hidden === true,
    null,
    { timeout: 10000 }
  );
  const count = await page.locator(".comment-search-count").textContent();
  assert.ok(count.includes("of 5 match"), "match count rendered: " + count);
  await searchBox.fill("");
  await page.waitForFunction(
    () => [...document.querySelectorAll(".comments > .comment-row")].every((row) => !row.hidden),
    null,
    { timeout: 10000 }
  );
  assert.equal(await page.locator(".comment-search-count").textContent(), "", "count cleared with the query");
});

await test("prev/next top-level navigation flashes the target comment", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await page.locator(".comments-nav-button", { hasText: "Next ›" }).click();
  await page.waitForFunction(
    () => document.querySelector(".comment-row.nav-flash") !== null,
    null,
    { timeout: 5000 }
  );
  const flashed = await page.locator(".comment-row.nav-flash").first().getAttribute("data-author");
  assert.equal(flashed, OP_USER, "first Next jumps to the first top-level comment");
  await page.locator(".comments-nav-button", { hasText: "↑ Top" }).click();
});

await test("user tags set, display, and persist across reloads", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openCommentMenu(page, OTHER, "Set user tag");
  const dialog = page.locator(".tag-overlay");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".tag-input").fill("legend");
  await page.locator(".tag-save").click();
  await page.waitForFunction(
    () => document.querySelector('.comment-row[data-author="seabass"] .comment-tag')?.textContent === "legend",
    null,
    { timeout: 10000 }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await openThreadFully(page);
  assert.equal(await rowFor(page, OTHER).locator(".comment-tag").textContent(), "legend", "tag persisted across reload");
});

await test("blocking a user hides their comments behind an unblock note", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openCommentMenu(page, OTHER, "Block user");
  await page.waitForFunction(
    () => document.querySelector('.comment-row[data-author="seabass"]')?.classList.contains("is-blocked"),
    null,
    { timeout: 10000 }
  );
  const blockedRow = rowFor(page, OTHER);
  assert.equal(await blockedRow.locator(".blocked-note").count(), 1, "unblock note shown");
  assert.equal(await blockedRow.locator(".blocked-note .blocked-unblock").count(), 1, "unblock button present");
  await blockedRow.locator(".blocked-unblock").click();
  await page.waitForFunction(
    () => !document.querySelector('.comment-row[data-author="seabass"]')?.classList.contains("is-blocked"),
    null,
    { timeout: 10000 }
  );
  assert.equal(await blockedRow.locator(".comment-card").count(), 1, "comment visible again after unblock");
});

await test("user data export produces a valid JSON file", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  // Leave a tag + block behind so the export has content.
  await openCommentMenu(page, OTHER, "Set user tag");
  await page.locator(".tag-input").fill("tagged");
  await page.locator(".tag-save").click();
  await page.waitForFunction(() => document.querySelector('.comment-row[data-author="seabass"] .comment-tag'), null, { timeout: 10000 });

  const panel = await openSettings(page, "Data");
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await panel.locator(".setting-button", { hasText: "Export user data" }).click();
  const download = await downloadPromise;
  const tempPath = path.join(os.tmpdir(), "harmonova-export-" + Date.now() + ".json");
  await download.saveAs(tempPath);
  const data = JSON.parse(fs.readFileSync(tempPath, "utf8"));
  fs.rmSync(tempPath, { force: true });
  assert.equal(data.version, 1, "export carries the schema version");
  assert.ok(Array.isArray(data.bookmarks), "bookmarks array present");
  assert.ok(Array.isArray(data.readStoryIds), "read ids array present");
  assert.deepEqual(data.userTags, { seabass: "tagged" }, "tag exported");
  await panel.locator(".settings-header .icon-button").first().click();
});

await test("user data import merges valid files and refuses bad schemas", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const panel = await openSettings(page, "Data");
  const goodFile = path.join(os.tmpdir(), "harmonova-good-" + Date.now() + ".json");
  fs.writeFileSync(goodFile, JSON.stringify({
    version: 1,
    bookmarks: [777001, 777002],
    readStoryIds: [STORY_ID],
    userTags: { [FRESH]: "imported tag" },
    blockedUsers: [BLOCKED],
  }));
  await panel.locator(".setting-import-input").setInputFiles(goodFile);
  fs.rmSync(goodFile, { force: true });
  await page.waitForFunction(
    (author) => document.querySelector('.comment-row[data-author="' + author + '"]')?.classList.contains("is-blocked"),
    BLOCKED,
    { timeout: 10000 }
  );
  assert.ok(await rowFor(page, FRESH).locator(".comment-tag").isVisible(), "imported tag rendered");
  const readCard = page.locator('.story-card[data-story-id="' + STORY_ID + '"]');
  assert.ok(await readCard.evaluate((node) => node.classList.contains("is-read")), "imported read id applied to the feed card");
  const stored = await browser.serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"))
    .evaluate(() => chrome.storage.local.get("harmonovaReaderStateV1"));
  assert.deepEqual(stored.harmonovaReaderStateV1.bookmarks, [777001, 777002], "imported bookmarks persisted through the worker");

  // Bad schema: non-integer bookmark id must be refused wholesale.
  const badFile = path.join(os.tmpdir(), "harmonova-bad-" + Date.now() + ".json");
  fs.writeFileSync(badFile, JSON.stringify({ version: 1, bookmarks: ["not-an-id"], readStoryIds: [], userTags: {}, blockedUsers: [] }));
  await panel.locator(".setting-import-input").setInputFiles(badFile);
  fs.rmSync(badFile, { force: true });
  const toast = await page.waitForFunction(
    () => {
      const text = document.querySelector(".harmonova-toast.show")?.textContent || "";
      return text.startsWith("Import refused") ? text : null;
    },
    null,
    { timeout: 10000 }
  ).then((handle) => handle.jsonValue());
  assert.ok(toast.includes("refused"), "bad schema refused with a message: " + toast);
  const stored2 = await browser.serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"))
    .evaluate(() => chrome.storage.local.get("harmonovaReaderStateV1"));
  assert.deepEqual(stored2.harmonovaReaderStateV1.bookmarks, [777001, 777002], "refused import changed nothing");
});


if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");
