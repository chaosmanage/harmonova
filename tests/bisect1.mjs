// Harmonic Phase 6 UI suite: the in-Harmonic user panel (Firebase-backed,
// SEC-05 — profile HTML is never fetched) and the own-account list views
// (threads, upvoted, favorites, submissions) with pagination and empty
// states. Driven through the real Chromium extension against fully mocked
// Hacker News list documents, Firebase user records, and Algolia items.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);

const TOKEN_A = "0".repeat(40);
const TOKEN_B = "1".repeat(40);
const USER = "harmonic_test";

const STORY_ID = 50022292;
const STORY_2 = 50022293;
const STORY_3 = 50022294;
const PLAIN_COMMENT = 50029143;
const VOTED_COMMENT = 50034061;
const OWN_COMMENT = 50032063;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Mocked Hacker News server: regular pages + list pages
// ---------------------------------------------------------------------------

function createHnMock() {
  const state = {
    loggedIn: true,
    errorScript: [],
    loginUsername: USER,
    votes: new Map(),
    favorites: new Set(),
    hidden: new Set(),
    flagged: new Set(),
  };
  const requests = [];

  const consumeError = (pathname) => {
    const index = state.errorScript.findIndex((entry) => pathname.startsWith(entry.pathPattern));
    if (index === -1) return null;
    const [entry] = state.errorScript.splice(index, 1);
    return entry.classification;
  };

  const withUser = (html) => (state.loginUsername === USER ? html : html.split(USER).join(state.loginUsername));
  const serveHtml = (html) => ({ status: 200, contentType: "text/html; charset=utf-8", body: html });

  const anchorFor = (id, kind, title) =>
    '<a id="' + kind + "_" + id + '" href="vote?id=' + id + "&amp;how=" + kind +
    '&amp;auth=' + TOKEN_A + '&amp;goto=item%3Fid%3D' + STORY_ID +
    '"><div class="votearrow" title="' + title + '"></div></a>';

  function applyVotes(html) {
    for (const [id, vote] of state.votes) {
      const anchor = anchorFor(id, vote.kind, vote.title);
      const pattern = new RegExp('<a id="(?:up|down|un)_' + id + '"[\\s\\S]*?</a>');
      if (pattern.test(html)) html = html.replace(pattern, anchor);
      else html = html.replace('"votelinks"><center>', '"votelinks"><center>' + anchor);
    }
    return html;
  }

  function itemDoc(id) {
    return serveHtml(withUser(applyVotes(fixture("synthetic", "item-in.html"))));
  }

  // A minimal but top-bar-complete HN list page: `tr.athing[id]` rows and an
  // optional morelink, wrapped in the standard chrome the parser expects.
  const listPage = (ids, moreHref, title) =>
    '<!doctype html><html lang="en" op="faves"><head><meta name="referrer" content="origin">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="icon" href="y18.svg">' +
    "<title>" + (title || "List") + "</title></head><body><center><table id=\"hnmain\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"85%\" bgcolor=\"#f6f6ef\">" +
    '<tr><td bgcolor="#ff6600"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding:2px"><tr>' +
    '<td style="line-height:12pt; height:10px;"><span class="pagetop"><b class="hnname"><a href="news">Hacker News</a></b>' +
    '<a href="newest">new</a> | <a href="front">past</a> | <a href="comments">comments</a> | <a href="ask">ask</a> | <a href="show">show</a> | <a href="jobs">jobs</a> | <a href="submit" rel="nofollow">submit</a></span></td>' +
    '<td style="text-align:right;padding-right:4px;"><span class="pagetop"><a id="me" href="user?id=' + state.loginUsername + '">' + state.loginUsername + '</a>&nbsp;(<span id="karma">512</span>)&#32;|&#32;' +
    '<a id="logout" href="logout?auth=' + TOKEN_B + '&amp;goto=news">logout</a></span></td></tr></table></td></tr>' +
    '<tr><td style="padding:10px"><table border="0" cellpadding="0" cellspacing="0">' +
    ids.map((id) =>
      '<tr class="athing" id="' + id + '"><td align="right" valign="top" class="title"><span class="rank">1.</span></td>' +
      '<td class="title"><span class="titleline"><a href="item?id=' + id + '">Listed story ' + id + '</a></span></td></tr>'
    ).join("") +
    "</table>" +
    (moreHref ? '<tr><td colspan="2"><a class="morelink" href="' + moreHref + '">More</a></td></tr>' : "") +
    "</td></tr></table></center></body></html>";

  function listDocumentFor(pathname, search) {
    const params = new URLSearchParams(search);
    const page = Number(params.get("p") || 1);
    switch (pathname) {
      case "/favorites":
      case "/upvoted":
        return serveHtml(withUser(state.loggedIn
          ? (page >= 2 ? listPage([STORY_3], null, "page 2") : listPage([STORY_ID, STORY_2], "favorites?p=2", "favorites"))
          : fixture("login.html")));
      case "/submitted":
        return serveHtml(withUser(state.loggedIn ? listPage([], null, "submissions") : fixture("login.html")));
      case "/threads":
        return serveHtml(withUser(state.loggedIn ? listPage([PLAIN_COMMENT], null, "threads") : fixture("login.html")));
      default:
        return null;
    }
  }

  function documentFor(pathname, search) {
    const params = new URLSearchParams(search);
    switch (pathname) {
      case "/news":
      case "/":
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html")));
      case "/item":
        return state.loggedIn ? itemDoc(Number(params.get("id"))) : serveHtml(fixture("synthetic", "item-out.html"));
      case "/login":
        return serveHtml(fixture("login.html"));
      default: {
        const list = listDocumentFor(pathname, search);
        if (list) return list;
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html")));
      }
    }
  }

  async function handle(route) {
    const request = route.request();
    const parsed = new URL(request.url());
    const pathname = parsed.pathname;
    const method = request.method();
    const record = { method, path: pathname + parsed.search, params: Object.fromEntries(parsed.searchParams), postData: null, t: Date.now() };
    if (method === "POST") {
      record.postData = request.postData() || "";
      record.bodyParams = Object.fromEntries(new URLSearchParams(record.postData));
      Object.assign(record.params, record.bodyParams);
    }
    requests.push(record);

    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonic mocked asset */"));
    }

    const error = consumeError(pathname);
    if (error) {
      return route.fulfill(serveHtml(withUser(fixture("synthetic", "error-expired.html"))));
    }
    if (pathname === "/logout") {
      return route.fulfill(serveHtml(fixture("news.html")));
    }
    return route.fulfill(documentFor(pathname, parsed.search));
  }

  return { state, requests, handle };
}

// Firebase (items + user records) and Algolia mocks.
function createDataMocks() {
  const now = Math.floor(Date.now() / 1000);
  const stories = {
    [STORY_ID]: { id: STORY_ID, type: "story", by: "submitter_0", title: "Mocked feed story " + STORY_ID, score: 55, time: now - 3600, descendants: 3 },
    [STORY_2]: { id: STORY_2, type: "story", by: "alice_2", title: "Second mocked story", score: 20, time: now - 3000, descendants: 1 },
    [STORY_3]: { id: STORY_3, type: "story", by: "bob_3", title: "Third mocked story", score: 9, time: now - 2000, descendants: 0 },
  };
  const profileAbout = '<p>Hello <b>world</b><script>window.__xssHit=1</script><img src=x onerror="window.__xssHit=2">' +
    '<a href="javascript:alert(1)">bad link</a><a href="https://example.com/ok">ok link</a></p>';
  const profileSubmissions = [STORY_ID, STORY_2, 424242];
  const users = {
    [USER]: {
      id: USER,
      created: 1270000000,
      karma: 512,
      about: profileAbout,
      submitted: profileSubmissions,
    },
    submitter_0: {
      id: "submitter_0",
      created: 1270000000,
      karma: 512,
      about: profileAbout,
      submitted: profileSubmissions,
    },
    commenter_a: { id: "commenter_a", created: 1310000000, karma: 42, about: null, submitted: [] },
  };
  return async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      const userMatch = parsed.pathname.match(/\/user\/([A-Za-z0-9_-]+)\.json$/);
      if (userMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(users[userMatch[1]] || null),
        });
      }
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([STORY_ID, STORY_2, STORY_3]) });
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
            title: "Mocked discussion " + id,
            story_id: STORY_ID,
            story_title: "Mocked feed story " + STORY_ID,
            url: null,
            author: "submitter_0",
            points: 55,
            created_at_i: now - 1800,
            text: "A thread reply worth reading.",
            children: [
              { id: VOTED_COMMENT, author: "seabass", created_at_i: now - 2400, text: "Already-voted comment.", children: [] },
              { id: PLAIN_COMMENT, author: "commenter_a", created_at_i: now - 1800, text: "First mocked comment.", children: [] },
              { id: OWN_COMMENT, author: USER, created_at_i: now - 900, text: "My own seeded comment.", children: [] },
            ],
          }),
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

let currentPage = null;
let passed = 0;
let failed = 0;
const failures = [];

const waitFor = async (fn, timeout = 30000, step = 150, label = "condition") => {
  let pollErrors = 0;
  let pollCount = 0;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
      pollCount++;
      if (pollCount % 25 === 0) {
        try {
          const probe = await currentPage.evaluate(() => ({
            subs: document.querySelectorAll(".user-submission").length,
            card2: document.querySelectorAll('.list-view-body .story-card[data-story-id="50022293"]').length,
            frames: window.frames.length,
            readyState: document.readyState,
          }));
          const rawLoc = await currentPage.locator(".user-submission").count();
          const rawLoc2 = await currentPage.locator('.list-view-body .story-card[data-story-id="50022293"]').count();
          console.log("POLL [" + label + "] t=" + Math.round(Date.now() - start) + "ms value=" + value + " probe=" + JSON.stringify(probe) + " locSubs=" + rawLoc + " locCard2=" + rawLoc2);
        } catch (e) { console.log("POLL probe failed [" + label + "]:", String(e.message).slice(0, 120)); }
      }
    } catch (err) {
      pollErrors++;
      if (pollErrors <= 3) console.log("WAITFOR POLL ERROR [" + label + "]", String((err && err.message) || err).slice(0, 200));
    }
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  try {
    console.log("FN SOURCE [" + label + "]:", fn.toString().slice(0, 300));
    console.log("page===currentPage:", currentPage ? "yes" : "no");
    const dump = await currentPage.evaluate(() => ({
      url: location.href,
      exactCard2: document.querySelectorAll('.list-view-body .story-card[data-story-id="50022293"]').length,
      anyCard2: document.querySelectorAll('.story-card[data-story-id="50022293"]').length,
      listBodies: document.querySelectorAll(".list-view-body").length,
      listViews: document.querySelectorAll(".list-view").length,
      exactSubs: document.querySelectorAll(".user-submission").length,
      overlays: document.querySelectorAll(".harmonic-user-overlay").length,
      karma: document.querySelector(".user-karma")?.textContent,
    }));
    console.log("TIMEOUT DUMP [" + label + "]:", JSON.stringify(dump));
    console.log("NODE locator card2:", await currentPage.locator('.list-view-body .story-card[data-story-id="50022293"]').count());
    console.log("NODE locator subs:", await currentPage.locator(".user-submission").count());
  } catch (e) { console.log("TIMEOUT DUMP failed:", e.message); }
  throw new Error("Timed out waiting for " + label);
};

async function test(name, fn) {
  const hn = createHnMock();
  const dataMocks = createDataMocks();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
    if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
    return route.continue();
  });
  const page = await browser.newPage();
  currentPage = page;
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("pageerror", (error) => consoleMessages.push("pageerror: " + error.message));
  try {
    await fn({ page, hn, consoleMessages });
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

// ---------------------------------------------------------------------------
// List views
// ---------------------------------------------------------------------------

await test("account menu opens the in-Harmonic favorites list with pagination", async ({ page, hn }) => {
  await gotoFeed(page);
  await page.locator("#harmonic-account-chip").click();
  await page.locator(".harmonic-popup .popup-item", { hasText: "Favorites" }).click();
  await page.locator(".list-view").waitFor({ state: "visible", timeout: 20000 });
  assert.ok((await page.locator(".list-view-header h2").textContent()).includes("Your favorites"), "list title");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/favorites")).length, 1, "one list fetch for page 1");
  await waitFor(() => page.locator('.list-view-body .story-card[data-story-id="' + STORY_2 + '"]').count() === 1, 20000, 200, "second favorite card");
  assert.ok(await page.locator('.list-view-body .story-card[data-story-id="' + STORY_ID + '"]').isVisible(), "first favorite card");
  const more = page.locator(".list-view-more");
  assert.ok(await more.isVisible(), "Load more offered while a morelink exists");
  await more.click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/favorites?p=2")), 20000, 200, "page 2 fetch");
  await waitFor(() => page.locator('.list-view-body .story-card[data-story-id="' + STORY_3 + '"]').count() === 1, 20000, 200, "page 2 card");
  assert.ok(!(await more.isVisible()), "Load more hidden when the morelink is gone");
  // Three story cards total, in list order.
  const ids = await page.locator(".list-view-body .story-card").evaluateAll((cards) => cards.map((card) => card.dataset.storyId));
  assert.deepEqual(ids, [String(STORY_ID), String(STORY_2), String(STORY_3)], "cards follow the list order");
});

