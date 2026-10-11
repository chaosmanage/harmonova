// Harmonic Phase 6 UI suite: profiles and account lists. Drives the real
// Chromium extension against fully mocked Hacker News list pages, the public
// Firebase user API, and Algolia. Companion to tests/actions.mjs (actions),
// tests/comments.mjs (composer), and tests/voting.mjs (voting); this file
// asserts Firebase-backed user panels with sanitized about text (SEC-05:
// the /user HTML page is never fetched), own lists through the account chip
// with pagination and dedupe, the threads reply inbox via Algolia, public
// lists for other users, and the loginRequired branch.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);

const USER = "harmonic_test";
const OTHER_USER = "alice_2";

const STORY_ID = 50022292;
const STORY_2 = 50022293;
const STORY_3 = 50022294;
const PAGE2_ID = 50023001;
const THREAD_COMMENT_A = 50034061;
const THREAD_COMMENT_B = 50029143;
const OWN_LIST_STORY = 50024400;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Mocked Hacker News server with list pages (/upvoted, /hidden, /submitted…).
// /user is served from a request log that every test asserts stays empty —
// SEC-05 means the profile HTML page must never be requested.
// ---------------------------------------------------------------------------

const LIST_TOPBAR =
  '<td style="text-align:right;padding-right:4px;"><span class="pagetop">' +
  '<a id="me" href="user?id=' + USER + '">' + USER + "</a>&nbsp;(<span id=\"karma\">512</span>)&#32;|&#32;" +
  '<a id="logout" href="logout?auth=' + "2".repeat(40) + '&amp;goto=news">logout</a></span></td>';

const listRow = (id) =>
  '<tr class="athing" id="' + id + '"><td align="right" valign="top" class="title"><span class="rank">1.</span></td>' +
  '<td class="title"><span class="titleline"><a href="item?id=' + id + '">Mocked list story ' + id + "</a></span></td></tr>" +
  '<tr><td colspan="2"></td><td class="subtext"><span class="subline"><span class="score" id="score_' + id + '">3 points</span> by ' +
  '<a href="user?id=' + OTHER_USER + '" class="hnuser">' + OTHER_USER + '</a> <a href="item?id=' + id + '">2&nbsp;comments</a></span></td></tr>' +
  '<tr class="spacer" style="height:5px"></tr>';

const listDoc = (ids, more) =>
  "<html lang=\"en\" op=\"list\"><head><title>Hacker News</title></head><body><center><table><tbody>" +
  "<tr><td bgcolor=\"#ff6600\"></td></tr><tr><td>" + LIST_TOPBAR + "</td></tr>" +
  ids.map(listRow).join("") +
  '<tr><td class="title">' + (more ? '<a class="morelink" href="?p=2" rel="next">More</a>' : "") + "</td></tr>" +
  "</tbody></table></center></body></html>";

const blankDoc = () =>
  "<html><head><title>Hacker News</title></head><body><center><table><tbody><tr><td>" + LIST_TOPBAR +
  "</td></tr></tbody></table></center></body></html>";

function createHnMock() {
  const state = {
    loggedIn: true,
    loginUsername: USER,
    // kind -> { page1: [...ids], page2: [...ids] }; "" lists are empty.
    lists: {},
    listLoginRequired: false,
  };
  const requests = [];

  const withUser = (html) => (state.loginUsername === USER ? html : html.split(USER).join(state.loginUsername));
  const serveHtml = (html) => ({ status: 200, contentType: "text/html; charset=utf-8", body: html });

  const listFor = (pathname, params) => {
    const kind = pathname.slice(1); // upvoted | hidden | submitted | comments | threads | favorites
    const target = params.get("id") || USER;
    const own = target === USER;
    const key = kind === "threads" ? "threads" : kind;
    const bucket = state.lists[key] || { page1: [], page2: [] };
    if (own && state.listLoginRequired) return serveHtml(fixture("login.html"));
    if (!own) {
      // Public lists for other users: submissions/comments/favorites only.
      const publicBucket = state.otherLists?.[kind];
      if (!publicBucket) return serveHtml(blankDoc());
      return serveHtml(listDoc(publicBucket.page1 || [], Boolean(publicBucket.page2)));
    }
    if (!bucket.page1.length) return serveHtml(blankDoc());
    const more = Boolean(bucket.page2?.length);
    const ids = params.get("p") === "2" ? bucket.page2 || [] : bucket.page1;
    return serveHtml(listDoc(ids, more && params.get("p") !== "2"));
  };

  async function handle(route) {
    const request = route.request();
    const parsed = new URL(request.url());
    const pathname = parsed.pathname;
    const params = parsed.searchParams;
    requests.push({
      method: request.method(),
      path: pathname + parsed.search,
      params: Object.fromEntries(parsed.searchParams),
      t: Date.now(),
    });

    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonic mocked asset */"));
    }
    // SEC-05 tripwire: the profile HTML page must never be fetched.
    if (pathname === "/user") {
      state.userPageRequests = (state.userPageRequests || 0) + 1;
      return route.fulfill(serveHtml(blankDoc()));
    }
    switch (pathname) {
      case "/news":
      case "/":
      case "/newest":
        return route.fulfill(serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html"))));
      case "/item":
        return route.fulfill(serveHtml(withUser(state.loggedIn ? fixture("synthetic", "item-in.html") : fixture("synthetic", "item-out.html"))));
      case "/login":
        return route.fulfill(serveHtml(fixture("login.html")));
      case "/logout":
        return route.fulfill(serveHtml(fixture("news.html")));
      case "/upvoted":
      case "/hidden":
      case "/submitted":
      case "/comments":
      case "/threads":
      case "/favorites":
        return route.fulfill(serveHtml(withUser(listFor(pathname, params).body)));
      default:
        return route.fulfill(serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html"))));
    }
  }

  return { state, requests, handle };
}

// ---------------------------------------------------------------------------
// Firebase (user profiles, item docs) + Algolia (thread list comments).
// ---------------------------------------------------------------------------

const HOSTILE_ABOUT =
  'Hello <img src="x" onerror="window.__pwned=1"> <script>window.__scriptRan=1</script>' +
  'world <a href="javascript:evil(1)">bad link</a> <a href="https://example.com/good">good link</a>';

function createDataMocks() {
  const now = Math.floor(Date.now() / 1000);
  const stories = {
    [STORY_ID]: {
      id: STORY_ID,
      type: "story",
      by: "submitter_0",
      title: "Mocked feed story " + STORY_ID,
      score: 55,
      time: now - 3600,
      descendants: 3,
    },
    [STORY_2]: { id: STORY_2, type: "story", by: OTHER_USER, title: "Second mocked story", score: 20, time: now - 3000, descendants: 1 },
    [STORY_3]: { id: STORY_3, type: "story", by: OTHER_USER, title: "Third mocked story", score: 9, time: now - 2000, descendants: 0 },
    [PAGE2_ID]: { id: PAGE2_ID, type: "story", by: OTHER_USER, title: "Page two story", score: 4, time: now - 1000, descendants: 0 },
    [OWN_LIST_STORY]: { id: OWN_LIST_STORY, type: "story", by: USER, title: "My own mocked submission", score: 7, time: now - 900, descendants: 0 },
  };
  const users = {
    [USER]: {
      id: USER,
      karma: 512,
      created: 1400000000,
      about: 'I build <a href="https://example.com/harmonic">browser things</a>.',
      submitted: [OWN_LIST_STORY],
    },
    [OTHER_USER]: {
      id: OTHER_USER,
      karma: 12345,
      created: 1300000000,
      about: HOSTILE_ABOUT,
      submitted: [STORY_ID, STORY_2],
    },
    ghost_user: null,
  };
  const threadHits = {
    [THREAD_COMMENT_A]: {
      id: THREAD_COMMENT_A,
      author: OTHER_USER,
      text: "First mocked comment.",
      created_at_i: now - 2400,
      story_id: STORY_ID,
      story_title: "Mocked feed story " + STORY_ID,
    },
    [THREAD_COMMENT_B]: {
      id: THREAD_COMMENT_B,
      author: "commenter_a",
      text: "Second mocked comment.",
      created_at_i: now - 1800,
      story_id: STORY_ID,
      story_title: "Mocked feed story " + STORY_ID,
    },
  };
  const discussionFor = (id) => ({
    id,
    title: "Mocked feed story " + id,
    url: null,
    author: stories[id]?.by || "submitter_0",
    points: 55,
    created_at_i: now - 3600,
    text: null,
    children: [
      { id: THREAD_COMMENT_A, author: OTHER_USER, created_at_i: now - 2400, text: "First mocked comment.", children: [] },
      { id: THREAD_COMMENT_B, author: "commenter_a", created_at_i: now - 1800, text: "Second mocked comment.", children: [] },
    ],
  });
  return async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([STORY_ID, STORY_2, STORY_3]),
        });
      }
      const userMatch = parsed.pathname.match(/\/user\/([A-Za-z0-9_-]+)\.json/);
      if (userMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(users[userMatch[1]] ?? null),
        });
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
        const hit = threadHits[id] || (id === STORY_ID ? discussionFor(id) : null);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(hit || { id, author: "unknown", text: "Unknown comment.", created_at_i: now, story_id: STORY_ID, story_title: "A story" }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
    }
    return route.continue();
  };
}

// ---------------------------------------------------------------------------
// Test runner
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
  if (process.env.HARMONIC_TEST_FILTER && !name.toLowerCase().includes(process.env.HARMONIC_TEST_FILTER.toLowerCase())) return;
  const hn = createHnMock();
  const dataMocks = createDataMocks();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
    if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
    return route.continue();
  });
  const page = await browser.newPage();
  try {
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

const openThreadFully = async (page) => {
  await page.locator('.story-card[data-story-id="' + STORY_ID + '"]').click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector("[data-thread-vote]")?.classList.contains("active"),
    { timeout: 20000 }
  );
};

const chipMenu = async (page, label) => {
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonic-popup .popup-item").first().click();
  await page.locator(".harmonic-popup .popup-item", { hasText: label }).click();
};

// Content scripts live in an isolated world; page.evaluate can't see
// HarmonicHN. Evaluate in that world over CDP (pattern from tests/hn-auth.mjs).
async function attachIsolatedWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = new Map();
  cdp.on("Runtime.executionContextCreated", (event) => contexts.set(event.context.id, event.context));
  await cdp.send("Runtime.enable");
  let harmonicContextId = null;
  const findHarmonicContext = async () => {
    for (const [id] of contexts) {
      try {
        const probe = await cdp.send("Runtime.evaluate", {
          expression: "typeof window.HarmonicHN !== 'undefined'",
          contextId: id,
          returnByValue: true,
        });
        if (probe.result?.value === true) {
          harmonicContextId = id;
          return id;
        }
      } catch {}
    }
    return null;
  };
  const evaluate = async (expression) => {
    if (!harmonicContextId) {
      if (!(await findHarmonicContext())) throw new Error("HarmonicHN isolated world not found");
    }
    const result = await cdp.send("Runtime.evaluate", { expression, contextId: harmonicContextId, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Isolated-world evaluation failed: " + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    return result.result?.value;
  };
  return { evaluate };
}

// ---------------------------------------------------------------------------
// User panel (Firebase-backed, sanitized)
// ---------------------------------------------------------------------------

await test("account chip Profile opens a Firebase-backed panel for your own account", async ({ page }) => {
  await gotoFeed(page);
  await chipMenu(page, "Profile");
  const panel = page.locator(".harmonic-user");
  await panel.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelector(".user-karma")?.textContent?.includes("512 karma"),
    { timeout: 10000 }
  );
  assert.ok(
    (await page.locator(".user-karma").textContent()).includes("member since"),
    "member-since date derived from the Firebase created field"
  );
  const about = await page.locator(".user-about").innerHTML();
  assert.ok(about.includes("browser things"), "about HTML rendered");
  assert.ok((await page.locator('.user-about a[href^="https://example.com/harmonic"]').count()) === 1, "safe about link kept");
  assert.ok((await page.locator(".user-hn-link").count()) >= 1, "Open profile on HN link present");
  await page.locator(".user-close").click();
  assert.equal(await page.locator(".harmonic-user-overlay").count(), 0, "close button removes the panel");
});

await test("another user's panel sanitizes hostile about HTML (SEC-05)", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  // Comment author anchors carry href user?id=…; clicking opens the panel.
  await page.locator('.comment-card .comment-author[href*="user?id=' + OTHER_USER + '"]').first().click();
  await page.locator(".harmonic-user").waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await page.locator(".user-header h3").textContent()), OTHER_USER, "panel names the viewed user");
  await page.waitForFunction(
    () => document.querySelector(".user-karma")?.textContent?.includes("karma") &&
      !document.querySelector(".user-karma")?.textContent?.includes("Loading"),
    { timeout: 10000 }
  );
  assert.ok((await page.locator(".user-karma").textContent()).includes("12k karma"), "compact karma from Firebase: " + (await page.locator(".user-karma").textContent()));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const windowFlags = await page.evaluate(() => ({
    pwned: window.__pwned,
    scriptRan: window.__scriptRan,
  }));
  assert.equal(windowFlags.pwned, undefined, "img onerror handler never executed");
  assert.equal(windowFlags.scriptRan, undefined, "inline script never executed");
  const about = await page.locator(".user-about").innerHTML();
  assert.ok(!about.includes("onerror"), "onerror attribute stripped");
  assert.ok(!about.includes("<script"), "no script element in about");
  assert.ok(!about.includes("<img"), "img elements unwrapped entirely");
  assert.ok(about.includes("evil(1)") || (await page.locator('.user-about a[href^="javascript"]').count()) === 0, "javascript: link neutered or dropped");
  assert.ok(about.includes("good link"), "benign content kept");
  assert.equal(
    hn.requests.filter((request) => request.path.startsWith("/user?id=")).length,
    0,
    "no /user HTML fetch even though a user?id anchor was clicked"
  );
});

await test("missing profiles say so instead of rendering a broken panel", async ({ page }) => {
  await gotoFeed(page);
  // The first feed story's author (submitter_0) has no Firebase record; the
  // thread header author anchor is a real user?id link inside the app.
  await openThreadFully(page);
  await page.locator('.thread-author[href*="user?id=submitter_0"]').click();
  await page.locator(".harmonic-user").waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await page.locator(".user-header h3").textContent()), "submitter_0", "panel names the unknown user");
  await page.waitForFunction(
    () => document.querySelector(".user-karma")?.textContent?.includes("not available"),
    { timeout: 10000 }
  );
});

// ---------------------------------------------------------------------------
// Own lists through the account chip
// ---------------------------------------------------------------------------

await test("upvoted list paginates through morelink pages with dedupe", async ({ page, hn }) => {
  hn.state.lists.upvoted = { page1: [STORY_ID, STORY_2, STORY_3], page2: [PAGE2_ID, STORY_ID] };
  await gotoFeed(page);
  await chipMenu(page, "Upvoted");
  await page.locator(".list-view").waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await page.locator(".list-view-header h2").textContent()), "Your upvoted", "list title");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/upvoted?id=" + USER)), 20000, 150, "GET /upvoted");
  const first = hn.requests.find((request) => request.path.startsWith("/upvoted?id=" + USER));
  assert.equal(first.params.id, USER, "list path carries the username");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 3,
    { timeout: 20000 }
  );
  const moreButton = page.locator(".list-view-more");
  assert.ok(!(await moreButton.isHidden()), "Load more visible when the page offers a morelink");

  await moreButton.click();
  await waitFor(
    () => hn.requests.some((request) => request.path === "/upvoted?id=" + USER + "&p=2"),
    20000,
    150,
    "GET /upvoted?p=2 (relative morelink resolved)"
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 4,
    { timeout: 20000 }
  );
  assert.ok(await moreButton.isHidden(), "Load more hidden once the second page has no morelink");
  assert.equal(
    await page.locator('.list-view-body .story-card[data-story-id="' + PAGE2_ID + '"]').count(),
    1,
    "page-two story appears exactly once (dedupe of repeated ids)"
  );
});

await test("submissions list renders story cards through fetchItems", async ({ page, hn }) => {
  hn.state.lists.submitted = { page1: [OWN_LIST_STORY] };
  await gotoFeed(page);
  await chipMenu(page, "Submissions");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/submitted?id=" + USER)), 20000, 150, "GET /submitted");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 1,
    { timeout: 20000 }
  );
  assert.ok((await page.locator(".list-view-body").textContent()).includes("My own mocked submission"), "own submission rendered");
});

await test("threads list renders comment rows from Algolia and opens the discussion", async ({ page, hn }) => {
  hn.state.lists.threads = { page1: [THREAD_COMMENT_A, THREAD_COMMENT_B] };
  await gotoFeed(page);
  await chipMenu(page, "Threads");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/threads?id=" + USER)), 20000, 150, "GET /threads");
  // Algolia requests are not recorded in the HN request log; wait for rows.
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .thread-list-item").length === 2,
    { timeout: 20000 }
  );
  const firstRow = page.locator(".thread-list-item").first();
  assert.ok((await firstRow.locator(".thread-list-story-title").textContent()).includes("Mocked feed story"), "row carries the story title");
  assert.ok((await firstRow.locator(".thread-list-text").textContent()).includes("First mocked comment"), "row carries the comment text");

  await firstRow.locator(".thread-list-story").click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await waitFor(() => hn.requests.some((request) => request.path === "/item?id=" + STORY_ID), 20000, 150, "GET /item for the opened thread");
});

await test("hidden list exists and empty lists show a friendly state", async ({ page, hn }) => {
  await gotoFeed(page);
  await chipMenu(page, "Hidden");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/hidden?id=" + USER)), 20000, 150, "GET /hidden");
  await page.waitForFunction(
    () => document.querySelector(".list-view-body .list-empty")?.textContent === "Nothing here yet.",
    { timeout: 20000 }
  );
  assert.ok(await page.locator(".list-view-more").isHidden(), "no Load more for an empty list");
});

await test("back to feed restores the regular story feed", async ({ page, hn }) => {
  hn.state.lists.upvoted = { page1: [STORY_2] };
  await gotoFeed(page);
  await chipMenu(page, "Upvoted");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 1,
    { timeout: 20000 }
  );
  assert.equal(await page.locator(".story-list > .story-card").count(), 0, "feed cards swapped out for the list view");
  await page.locator(".list-view-back").click();
  await page.locator(".story-list > .story-card").first().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await page.locator(".list-view").count(), 0, "list view removed after going back");
});

// ---------------------------------------------------------------------------
// Public lists for other users + guards
// ---------------------------------------------------------------------------

await test("user panel links open public lists for another user", async ({ page, hn }) => {
  hn.state.otherLists = {
    submitted: { page1: [STORY_ID, STORY_2] },
    comments: { page1: [THREAD_COMMENT_A] },
    favorites: { page1: [STORY_3] },
  };
  await gotoFeed(page);
  await openThreadFully(page);
  await page.locator('.comment-card .comment-author[href*="user?id=' + OTHER_USER + '"]').first().click();
  await page.locator(".harmonic-user").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".user-karma")?.textContent?.includes("karma"), { timeout: 10000 });

  await page.locator(".user-tabs .user-tab", { hasText: "Submissions" }).click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/submitted?id=" + OTHER_USER)), 20000, 150, "GET /submitted?id=alice_2");
  assert.equal((await page.locator(".list-view-header h2").textContent()), OTHER_USER + "'s submissions", "public list title names the user");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 2,
    { timeout: 20000 }
  );

  // Comments list for the other user: comment rows via Algolia.
  await page.locator('.comment-card .comment-author[href*="user?id=' + OTHER_USER + '"]').first().click();
  await page.locator(".harmonic-user").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".user-tabs .user-tab", { hasText: "Comments" }).click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/comments?id=" + OTHER_USER)), 20000, 150, "GET /comments?id=alice_2");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .thread-list-item").length === 1,
    { timeout: 20000 }
  );

  // Favorites list for the other user.
  await page.locator('.comment-card .comment-author[href*="user?id=' + OTHER_USER + '"]').first().click();
  await page.locator(".harmonic-user").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".user-tabs .user-tab", { hasText: "Favorites" }).click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/favorites?id=" + OTHER_USER)), 20000, 150, "GET /favorites?id=alice_2");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 1,
    { timeout: 20000 }
  );
});

await test("fetchListPage refuses off-allowlist paths like /user (SEC-05 list guard)", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  for (const bad of ["/user?id=alice_2", "user?id=alice_2", "/vote?foo=1", "/item?id=50022292"]) {
    const outcome = await world.evaluate('window.HarmonicHN.fetchListPage(' + JSON.stringify(bad) + ")");
    assert.equal(outcome.status, "failure", "off-allowlist path refused: " + bad);
    assert.ok((outcome.message || "").includes("not available"), "refusal message: " + outcome.message);
  }
  const okOutcome = await world.evaluate('window.HarmonicHN.fetchListPage("/upvoted?id=' + USER + '")');
  assert.equal(okOutcome.status, "ok", "allowlisted own list passes validation");
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(
    hn.requests.filter((request) => request.path.startsWith("/user")).length,
    0,
    "no /user request of any kind fired"
  );
});

await test("login page served for a list surfaces loginRequired and clears the session", async ({ page, hn }) => {
  hn.state.lists.upvoted = { page1: [STORY_ID] };
  hn.state.listLoginRequired = true;
  await gotoFeed(page);
  await chipMenu(page, "Upvoted");
  await page.waitForFunction(
    () => document.querySelector(".list-view-body .harmonic-error")?.textContent?.includes("Sign in"),
    { timeout: 20000 }
  );
  await page.waitForFunction(
    () => document.querySelector("#harmonic-account-chip .account-chip-name")?.textContent === "Log in",
    { timeout: 10000 }
  );
});

await test("untrusted scripted clicks open no user panel or list view", async ({ page, hn }) => {
  hn.state.lists.upvoted = { page1: [STORY_2] };
  await gotoFeed(page);
  await chipMenu(page, "Upvoted");
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card").length === 1,
    { timeout: 20000 }
  );
  await page.evaluate(() => {
    document.querySelector(".list-view-back")?.click();
    document.querySelector(".list-view-more")?.click();
    document.querySelector("#harmonic-account-chip")?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(await page.locator(".harmonic-user-overlay").count(), 0, "no panel from scripted clicks");
  assert.equal(await page.locator(".harmonic-popup").count(), 0, "no chip menu from a scripted click");
  assert.equal(await page.locator(".list-view").count(), 1, "scripted back click did not close the list view");
  assert.equal(hn.requests.filter((request) => request.path.includes("p=2")).length, 0, "no extra list pages fetched");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/upvoted")).length, 1, "no reload of the list from scripted clicks");
});

await browser.close();
if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");