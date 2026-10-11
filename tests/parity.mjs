// HarmoNova Phase 7 (0.12.0) UI suite: feed parity — parity lists (pool,
// active, bestcomments, launches, whoishiring, noobstories, classic, past
// frontpages), frontpage management, and feed filters (domains, keywords,
// hide jobs, hide read) plus points display (compact, hotness, domain toggle)
// and the favicon provider choice. Drives the real Chromium extension against
// fully mocked HN list pages + Firebase + Algolia. Companion to
// tests/profile.mjs; same harness shape.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);

const USER = "harmonova_test";
const STORY_ID = 50022292;
const STORY_2 = 50022293;
const JOB_ID = 50022999;
const LIST_A = 50023111;
const LIST_B = 50023112;
const LIST_C = 50023113;
const COMMENT_A = 50034061;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Mocked HN server: parity list pages for any allowlisted segment
// ---------------------------------------------------------------------------

const LIST_TOPBAR =
  '<td style="text-align:right;padding-right:4px;"><span class="pagetop">' +
  '<a id="me" href="user?id=' + USER + '">' + USER + "</a>&nbsp;(<span id=\"karma\">512</span>)&#32;|&#32;" +
  '<a id="logout" href="logout?auth=' + "2".repeat(40) + '&amp;goto=news">logout</a></span></td>';

const listRow = (id) =>
  '<tr class="athing" id="' + id + '"><td align="right" valign="top" class="title"><span class="rank">1.</span></td>' +
  '<td class="title"><span class="titleline"><a href="item?id=' + id + '">Mocked list story ' + id + "</a></span></td></tr>" +
  '<tr><td colspan="2"></td><td class="subtext"><span class="subline"><span class="score" id="score_' + id + '">3 points</span> by ' +
  '<a href="user?id=' + USER + '" class="hnuser">' + USER + '</a> <a href="item?id=' + id + '">2&nbsp;comments</a></span></td></tr>' +
  '<tr class="spacer" style="height:5px"></tr>';

const listDoc = (ids) =>
  "<html lang=\"en\" op=\"list\"><head><title>Hacker News</title></head><body><center><table><tbody>" +
  "<tr><td bgcolor=\"#ff6600\"></td></tr><tr><td>" + LIST_TOPBAR + "</td></tr>" +
  ids.map(listRow).join("") +
  "</tbody></table></center></body></html>";

const PARITY_LIST_IDS = {
  pool: [LIST_A, LIST_B],
  active: [LIST_A, LIST_C],
  bestcomments: [COMMENT_A],
  launches: [LIST_B],
  whoishiring: [LIST_C],
  noobstories: [LIST_A],
  classic: [LIST_B, LIST_C],
};

function createHnMock() {
  const requests = [];
  const state = { frontDays: [] };
  const serveHtml = (html) => ({ status: 200, contentType: "text/html; charset=utf-8", body: html });

  async function handle(route) {
    const parsed = new URL(route.request().url());
    const pathname = parsed.pathname;
    requests.push({ method: route.request().method(), path: pathname + parsed.search, params: Object.fromEntries(parsed.searchParams) });
    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonova mocked asset */"));
    }
    if (pathname === "/user") {
      state.userPageRequests = (state.userPageRequests || 0) + 1;
      return route.fulfill(serveHtml(listDoc([])));
    }
    if (PARITY_LIST_IDS[pathname.slice(1)]) {
      return route.fulfill(serveHtml(listDoc(PARITY_LIST_IDS[pathname.slice(1)])));
    }
    if (pathname === "/front") {
      state.frontDays.push(parsed.searchParams.get("day") || "");
      return route.fulfill(serveHtml(listDoc([LIST_A, LIST_B, LIST_C])));
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
  return { state, requests, handle };
}

function createDataMocks() {
  const now = Math.floor(Date.now() / 1000);
  const stories = {
    [STORY_ID]: {
      id: STORY_ID,
      type: "story",
      by: "submitter_0",
      title: "Hot story about testing",
      url: "https://mocked-source.com/a",
      score: 900,
      time: now - 600, // 15 min old, 900 points → very hot
      descendants: 30,
    },
    [STORY_2]: {
      id: STORY_2,
      type: "story",
      by: "other_1",
      title: "A boring story about widgets",
      url: "https://other-source.org/b",
      score: 4,
      time: now - 6 * 86400, // days old, low score → cool
      descendants: 1,
    },
    [JOB_ID]: {
      id: JOB_ID,
      type: "job",
      by: "whoishiring",
      title: "Acme is hiring engineers",
      url: "https://acme.example/jobs",
      score: 2,
      time: now - 7200,
      descendants: 0,
    },
    [LIST_A]: { id: LIST_A, type: "story", by: "lister_1", title: "Active list story A", url: "https://one-source.net/a", score: 20, time: now - 1800, descendants: 2 },
    [LIST_B]: { id: LIST_B, type: "story", by: "lister_2", title: "Active list story B", url: "https://two-source.net/b", score: 10, time: now - 3600, descendants: 0 },
    [LIST_C]: { id: LIST_C, type: "story", by: "lister_3", title: "Active list story C", url: "https://three-source.net/c", score: 5, time: now - 9000, descendants: 1 },
  };
  return async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([STORY_ID, STORY_2, JOB_ID]) });
      }
      if (parsed.pathname.endsWith("/jobstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([JOB_ID]) });
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
          body: JSON.stringify({
            id,
            author: USER,
            text: "A mocked best comment.",
            created_at_i: now - 1800,
            story_id: STORY_ID,
            story_title: "Hot story about testing",
            children: [],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
    }
    return route.continue();
  };
}

// ---------------------------------------------------------------------------
// Test runner (chrome.storage.sync is shared across pages — reset per test)
// ---------------------------------------------------------------------------

const browser = await chromium.launchPersistentContext("", {
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  viewport: { width: 1919, height: 872 },
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions-except=" + extensionPath,
    "--load-extension=" + extensionPath,
  ],
});

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
  const hn = createHnMock();
  const dataMocks = createDataMocks();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
    if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
    return route.continue();
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("  pageerror:", String(error).slice(0, 160)));
  try {
    // Reset synced settings + page storage so tests never leak into each other.
    const sw = browser.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
    if (sw) await sw.evaluate(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set({ harmonovaSettings: { feedHidden: [], feedOrder: [] } });
    }).catch(() => {});
    await page.addInitScript(() => {
      if (sessionStorage.getItem("harmonovaParityInit")) return;
      sessionStorage.setItem("harmonovaParityInit", "1");
      try {
        localStorage.clear();
        // Parity list suites intentionally enable the optional lists that
        // are hidden by default in the 0.7.2-style feed picker.
        localStorage.setItem("harmonova:settings:v1", JSON.stringify({ feedHidden: [] }));
      } catch {}
    });
    await fn({ page, hn });
    assert.equal(hn.state.userPageRequests || 0, 0, "SEC-05: the /user HTML page was never requested");
    passed++;
    console.log("ok -", name);
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  } finally {
    await page.close();
  }
}

const gotoFeed = async (page) => {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
};

const feedMenu = async (page, label) => {
  await page.locator(".feed-title-button").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: label }).click();
};

const openFeedMenuOnly = async (page) => {
  await page.locator(".feed-title-button").click();
  await page.locator(".harmonova-popup .popup-item").first().waitFor({ state: "visible", timeout: 5000 });
};

const settingsPath = async (page, sectionLabel) => {
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Settings" }).click();
  const panel = page.locator(".settings-panel");
  await panel.waitFor({ state: "visible", timeout: 5000 });
  await panel.locator(".settings-category", { hasText: "Stories" }).click();
  return panel;
};

const settingRow = (root, label, selector) =>
  root.locator('.setting-row', { hasText: label }).locator(selector).first();

// ---------------------------------------------------------------------------
// Parity lists
// ---------------------------------------------------------------------------

await test("parity lists render story cards from public list pages", async ({ page, hn }) => {
  await gotoFeed(page);
  await feedMenu(page, "Active Discussions");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/active")), 20000, 150, "GET /active");
  await page.waitForFunction(
    () => document.querySelectorAll(".story-list > .story-card").length === 2,
    { timeout: 20000 }
  );
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll(".story-list > .story-card")].map((card) => card.dataset.storyId)
  );
  assert.deepEqual(ids.sort(), [String(LIST_A), String(LIST_C)].sort(), "active list ids match the parsed rows");
});

await test("bestcomments feed renders comment rows that open discussions", async ({ page, hn }) => {
  await gotoFeed(page);
  await feedMenu(page, "Best Comments");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/bestcomments")), 20000, 150, "GET /bestcomments");
  await page.waitForFunction(
    () => document.querySelectorAll(".story-list > .thread-list-item").length === 1,
    { timeout: 20000 }
  );
  assert.ok((await page.locator(".thread-list-story-title").textContent()).includes("Hot story about testing"), "row carries story context");
  await page.locator(".thread-list-story").click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await waitFor(() => hn.requests.some((request) => request.path === "/item?id=" + STORY_ID), 20000, 150, "thread opened");
});

await test("past frontpages feed shows a date picker and refetches on change", async ({ page, hn }) => {
  await gotoFeed(page);
  await feedMenu(page, "Past Frontpages");
  const dateInput = page.locator(".feed-date-input");
  await dateInput.waitFor({ state: "visible", timeout: 10000 });
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/front?day=")), 20000, 150, "GET /front?day=…");
  const firstDay = hn.requests.find((request) => request.path.startsWith("/front?day=")).params.day;
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(firstDay), "front feed requests a dated page: " + firstDay);
  await page.locator(".story-list > .story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await dateInput.fill("2026-10-05");
  await waitFor(() => hn.requests.some((request) => request.path === "/front?day=2026-10-05"), 20000, 150, "GET /front?day=2026-10-05");
  const days = hn.state.frontDays;
  assert.deepEqual([...new Set(days)].sort(), ["2026-10-05", firstDay].sort(), "front page served per picked day");
});

await test("manage feeds hides entries from the menu and persists", async ({ page, hn }) => {
  await gotoFeed(page);
  await feedMenu(page, "Manage feeds");
  const overlay = page.locator(".feeds-overlay");
  await overlay.waitFor({ state: "visible", timeout: 5000 });
  const jobsRow = overlay.locator(".feeds-row", { hasText: "Jobs" });
  await jobsRow.locator(".feeds-check").click(); // hide Jobs
  await page.waitForFunction(() => true);
  await overlay.locator(".feeds-row", { hasText: "Classic" }).locator(".feeds-check").click();
  await overlay.locator(".feeds-header .icon-button").first().click(); // close button
  await page.waitForFunction(() => !document.querySelector(".feeds-overlay"), { timeout: 5000 });
  await openFeedMenuOnly(page);
  const labels = await page.locator(".harmonova-popup .popup-item").allTextContents();
  assert.ok(!labels.some((label) => label.includes("Jobs")), "hidden feed no longer offered; labels: " + JSON.stringify(labels));
  assert.ok(!labels.some((label) => label.includes("Classic")), "second hidden feed no longer offered; labels: " + JSON.stringify(labels));
  assert.ok(labels.some((label) => label.includes("Active Discussions")), "visible feeds remain; labels: " + JSON.stringify(labels));
});

await test("manage feeds reorders the menu with the arrow buttons", async ({ page }) => {
  await gotoFeed(page);
  await feedMenu(page, "Manage feeds");
  const overlay = page.locator(".feeds-overlay");
  await overlay.waitFor({ state: "visible", timeout: 5000 });
  const classicRow = overlay.locator(".feeds-row", { hasText: "Classic" });
  await classicRow.locator(".feeds-move").first().click(); // move up three times
  await page.waitForFunction(() => true);
  await overlay.locator(".feeds-row", { hasText: "Classic" }).locator(".feeds-move").first().click();
  await page.waitForFunction(() => true);
  await overlay.locator(".feeds-row", { hasText: "Classic" }).locator(".feeds-move").first().click();
  await page.waitForFunction(() => true);
  await overlay.locator(".feeds-header .icon-button").first().click();
  await openFeedMenuOnly(page);
  const labels = await page.locator(".harmonova-popup .popup-item").allTextContents();
  const classicIndex = labels.findIndex((label) => label.includes("Classic"));
  const launchesIndex = labels.findIndex((label) => label.includes("Launch HN"));
  assert.ok(classicIndex !== -1 && launchesIndex !== -1, "both feeds present; labels: " + JSON.stringify(labels));
  assert.ok(classicIndex < launchesIndex, "Classic moved above Launch HN in the menu");
});

// ---------------------------------------------------------------------------
// Filters and points display
// ---------------------------------------------------------------------------

await test("hidden-domain filter removes matching cards and the card menu adds domains", async ({ page, hn }) => {
  await gotoFeed(page);
  assert.equal(await page.locator('.story-card[data-story-id="' + STORY_2 + '"]').count(), 1, "other-source card visible");
  const panel = await settingsPath(page);
  await settingRow(panel, "Hidden domains", "input").fill("other-source.org");
  await settingRow(panel, "Hidden domains", "input").dispatchEvent("change");
  await panel.locator(".settings-header .icon-button").first().click();
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.hidden === true,
    STORY_2,
    { timeout: 10000 }
  );
  assert.ok(!(await page.locator('.story-card[data-story-id="' + STORY_ID + '"]').evaluate((node) => node.hidden)), "unrelated card stays visible");

  // Card menu entry hides a domain for good.
  const card = page.locator('.story-card[data-story-id="' + STORY_ID + '"]');
  await card.click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Hide this domain" }).click();
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.hidden === true,
    STORY_ID,
    { timeout: 10000 }
  );
});

await test("keyword filter hides matching titles case-insensitively", async ({ page }) => {
  await gotoFeed(page);
  const panel = await settingsPath(page);
  await settingRow(panel, "Hidden keywords", "input").fill("BORING");
  await settingRow(panel, "Hidden keywords", "input").dispatchEvent("change");
  await panel.locator(".settings-header .icon-button").first().click();
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.hidden === true,
    STORY_2,
    { timeout: 10000 }
  );
  assert.ok(!(await page.locator('.story-card[data-story-id="' + STORY_ID + '"]').evaluate((node) => node.hidden)), "non-matching card visible");
});

await test("hide jobs filters job stories in every feed, including Jobs", async ({ page }) => {
  await gotoFeed(page);
  assert.equal(await page.locator('.story-card[data-story-id="' + JOB_ID + '"]').count(), 1, "job card initially visible");
  const panel = await settingsPath(page);
  await settingRow(panel, "Hide jobs", "input").click();
  await panel.locator(".settings-header .icon-button").first().click();
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.hidden === true,
    JOB_ID,
    { timeout: 10000 }
  );
  // The setting applies to every feed, even the dedicated Jobs feed.
  assert.equal(await page.locator('.story-card[data-story-id="' + JOB_ID + '"]').evaluate((card) => getComputedStyle(card).display), "none");
  await feedMenu(page, "Jobs");
  await page.waitForFunction(
    (id) => {
      const card = document.querySelector('.story-card[data-story-id="' + id + '"]');
      return card && card.hidden && getComputedStyle(card).display === "none";
    },
    JOB_ID,
    { timeout: 20000 }
  );
});

await test("story card opens article by default and can disable background clicks", async ({ page }) => {
  await gotoFeed(page);
  await browser.route('https://mocked-source.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Mock article</title>' }));
  const card = page.locator('.story-card[data-story-id="' + STORY_ID + '"]');
  const opened = browser.waitForEvent('page', { timeout: 10000 });
  await card.locator('.story-meta').click();
  const article = await opened;
  await article.waitForURL(/mocked-source\.com/, { timeout: 10000 });
  assert.ok(article.url().includes('mocked-source.com'), 'card background opens the article');
  await article.close();

  const panel = await settingsPath(page);
  const enabled = panel.locator('.setting-row', { hasText: 'Enable story card click' }).locator('input');
  assert.ok(await enabled.isChecked(), 'card clicks enabled by default');
  await enabled.uncheck();
  await panel.locator('.settings-header .icon-button').first().click();
  const previousPages = browser.pages().length;
  await card.locator('.story-meta').click();
  await page.waitForTimeout(300);
  assert.equal(browser.pages().length, previousPages, 'disabled background does not open a page');
  assert.equal(new URL(page.url()).pathname, '/news', 'disabled background does not open comments');
  await card.locator('.story-comment-button').click();
  await page.locator('[data-thread-vote]').waitFor({ state: 'visible' });
});

await test("dim read visibly fades opened stories and respects the toggle", async ({ page }) => {
  await gotoFeed(page);
  const readCard = page.locator('.story-card[data-story-id="' + STORY_ID + '"]');
  const unreadCard = page.locator('.story-card[data-story-id="' + STORY_2 + '"]');
  assert.equal(await unreadCard.evaluate((card) => getComputedStyle(card).opacity), "1", "unread stories remain fully opaque");

  await readCard.locator(".story-comment-button").click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await waitFor(() => readCard.evaluate((card) => Number(getComputedStyle(card).opacity) <= 0.45), 5000, 50, "read story dimming");
  assert.equal(await unreadCard.evaluate((card) => getComputedStyle(card).opacity), "1", "unread stories remain prominent");

  const panel = await settingsPath(page);
  await settingRow(panel, "Dim read stories", "input").uncheck();
  await waitFor(() => readCard.evaluate((card) => getComputedStyle(card).opacity === "1"), 5000, 50, "dimming disabled");
  await settingRow(panel, "Dim read stories", "input").check();
  await waitFor(() => readCard.evaluate((card) => Number(getComputedStyle(card).opacity) <= 0.45), 5000, 50, "dimming re-enabled");
});

await test("hide read filters stories after opening them", async ({ page }) => {
  await gotoFeed(page);
  await page.locator('.story-card[data-story-id="' + STORY_ID + '"] .story-comment-button').click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  const panel = await settingsPath(page);
  await settingRow(panel, "Hide read stories", "input").click();
  await panel.locator(".settings-header .icon-button").first().click();
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.hidden === true,
    STORY_ID,
    { timeout: 10000 }
  );
  assert.ok(!(await page.locator('.story-card[data-story-id="' + STORY_2 + '"]').evaluate((node) => node.hidden)), "unread card stays visible");
});

await test("compact points drops the unit and hotness colors the score", async ({ page }) => {
  await gotoFeed(page);
  const hotPoints = page.locator('.story-card[data-story-id="' + STORY_ID + '"] .meta-points');
  const coolPoints = page.locator('.story-card[data-story-id="' + STORY_2 + '"] .meta-points');
  assert.ok(!(await hotPoints.evaluate((node) => node.classList.contains("hotness-hot"))),
    "hotness is off by default, preserving HarmoNova's visual parity");
  const hotnessPanel = await settingsPath(page);
  await settingRow(hotnessPanel, "Hotness colors", "input").click();
  await hotnessPanel.locator(".settings-header .icon-button").first().click();
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='Refresh']").click();
  await hotPoints.waitFor({ state: "visible", timeout: 20000 });
  assert.ok(await hotPoints.evaluate((node) => node.classList.contains("hotness-hot")), "fast high-score story is hot");
  assert.ok(await coolPoints.evaluate((node) => node.classList.contains("hotness-cool")), "slow low-score story is cool");
  assert.ok((await hotPoints.textContent()).includes("points"), "points carry the unit by default");

  const panel = await settingsPath(page);
  await settingRow(panel, "Compact points", "input").click();
  await panel.locator(".settings-header .icon-button").first().click();
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='Refresh']").click();
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  const text = (await page.locator('.story-card[data-story-id="' + STORY_ID + '"] .meta-points').textContent()).trim();
  assert.ok(!text.includes("points"), "compact score has no unit: " + text);
});

await test("show domain toggle removes the domain from card metadata", async ({ page }) => {
  await gotoFeed(page);
  const panel = await settingsPath(page);
  await settingRow(panel, "Show domain", "input").click();
  await panel.locator(".settings-header .icon-button").first().click();
  await page.waitForFunction(
    (id) => {
      const domain = document.querySelector('.story-card[data-story-id="' + id + '"] .meta-domain');
      return domain ? getComputedStyle(domain).display === "none" : false;
    },
    STORY_ID,
    { timeout: 15000 }
  );
});

await test("favicon provider setting switches the icon source", async ({ page, hn }) => {
  await gotoFeed(page);
  const panel = await settingsPath(page);
  await settingRow(panel, "Favicon provider", "select").selectOption("duckduckgo");
  await panel.locator(".settings-header .icon-button").first().click();
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='Refresh']").click();
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  const src = await page.locator('.story-card[data-story-id="' + STORY_ID + '"] .story-favicon').getAttribute("src");
  assert.ok(src.includes("icons.duckduckgo.com"), "DuckDuckGo icon endpoint used: " + src);
});

await browser.close();
if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");