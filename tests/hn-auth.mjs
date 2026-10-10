// Harmonic mocked account e2e suite (Phase 0.5.2 harness; extended per phase).
// Fully mocks Hacker News documents and actions with fixtures so account flows
// can be exercised without credentials. Every HN request is recorded and can be
// asserted for exact method, path, and parameters.
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
const PLACEHOLDER_TOKENS = [TOKEN_A, TOKEN_B];
const USER = "harmonic_test";

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

const STORY_ID = 50022292;
const FIRST_COMMENT = 50034061; // synthetic: voted + unfavorited state
const SECOND_COMMENT = 50029143; // synthetic: plain (not voted) state

// ---------------------------------------------------------------------------
// Mocked Hacker News server
// ---------------------------------------------------------------------------

function createHnMock() {
  const state = {
    loggedIn: true,
    // Error script: consumed in order, one entry per matching request.
    errorScript: [],
    loginUsername: USER,
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
  const redirect = (location) => ({ status: 302, headers: { location }, body: "" });

  function errorPage(classification) {
    const map = {
      expiredLink: "error-expired.html",
      badLogin: "error-badlogin.html",
      rateLimited: "error-ratelimited.html",
      tooFast: "error-toofast.html",
      validationRequired: "error-validation.html",
    };
    const file = map[classification];
    return withUser(file ? fixture("synthetic", file) : fixture("synthetic", "error-expired.html"));
  }

  function documentFor(pathname, search) {
    const params = new URLSearchParams(search);
    switch (pathname) {
      case "/news":
      case "/":
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html")));
      case "/item":
        return serveHtml(withUser(state.loggedIn
          ? fixture("synthetic", "item-in.html")
          : fixture("synthetic", "item-out.html")));
      case "/reply":
        return serveHtml(withUser(fixture("synthetic", "reply-in.html")));
      case "/edit":
        return serveHtml(withUser(fixture("synthetic", "edit-in.html")));
      case "/delete-confirm":
        return serveHtml(withUser(fixture("synthetic", "delete-confirm-in.html")));
      case "/submit":
        return serveHtml(withUser(fixture("synthetic", "submit-in.html")));
      case "/login":
        return serveHtml(fixture("login.html"));
      default:
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html")));
    }
  }

  async function handle(route) {
    const request = route.request();
    const parsed = new URL(request.url());
    const pathname = parsed.pathname;
    const method = request.method();
    const record = { method, path: pathname + parsed.search, params: Object.fromEntries(parsed.searchParams), postData: null };
    if (method === "POST") {
      record.postData = request.postData() || "";
      record.bodyParams = Object.fromEntries(new URLSearchParams(record.postData));
      Object.assign(record.params, record.bodyParams); // POST bodies carry the auth params on HN forms
    }
    requests.push(record);

    // Serve assets as (harmless) HTML so the fixture page loads fully offline;
    // real HN assets are never fetched in these tests.
    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonic mocked asset */"));
    }

    const error = consumeError(pathname);
    if (error) return route.fulfill(serveHtml(errorPage(error)));

    // Serve action responses as the redirect target's document directly:
    // Playwright-fulfilled 3xx responses are not re-intercepted, so a real
    // redirect's follow-up request would escape the mock and hit the network.
    if (["/vote", "/fave", "/hide", "/flag", "/r", "/xedit", "/xdelete"].includes(pathname)) {
      const goto = parsed.searchParams.get("goto");
      const id = parsed.searchParams.get("id");
      const target = goto || (id ? "item?id=" + id : "news");
      const qIndex = target.indexOf("?");
      const targetPath = qIndex === -1 ? target : target.slice(0, qIndex);
      const targetSearch = qIndex === -1 ? "" : target.slice(qIndex + 1);
      return route.fulfill(documentFor(targetPath, targetSearch));
    }
    if (pathname === "/logout") {
      // HN invalidates the session on logout; serve a logged-out document.
      return route.fulfill(serveHtml(fixture("news.html")));
    }
    if (pathname === "/comment") {
      const post = new URLSearchParams(record.postData || "");
      const parent = post.get("parent") || String(STORY_ID);
      return route.fulfill(documentFor("/item", "id=" + parent));
    }
    return route.fulfill(documentFor(pathname, parsed.search));
  }

  return { state, requests, handle };
}

function createDataMocks(feedIds) {
  const stories = feedIds.map((id, index) => ({
    id,
    type: "story",
    by: "submitter_" + index,
    title: "Mocked feed story " + id,
    url: "https://example.test/article-" + id,
    score: 50 + index,
    time: Math.floor(Date.now() / 1000) - 3600 * (index + 1),
    descendants: 2,
    kids: [],
  }));
  const byId = new Map(stories.map((story) => [story.id, story]));
  return async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feedIds) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        const story = byId.get(Number(itemMatch[1]));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(story || { id: Number(itemMatch[1]), type: "story", title: "Mocked story", score: 1, time: Math.floor(Date.now() / 1000), descendants: 0 }),
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
            url: "https://example.test/article-" + id,
            author: "submitter_0",
            points: 55,
            created_at_i: Math.floor(Date.now() / 1000) - 3600,
            text: null,
            children: [
              { id: 50029143, author: "commenter_a", created_at_i: Math.floor(Date.now() / 1000) - 1800, text: "First mocked comment.", children: [] },
              { id: 50032063, author: "commenter_b", created_at_i: Math.floor(Date.now() / 1000) - 900, text: "Second mocked comment.", children: [] },
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
// Isolated-world helpers (content scripts live in an isolated world)
// ---------------------------------------------------------------------------

async function attachIsolatedWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = new Map();
  cdp.on("Runtime.executionContextCreated", (event) => contexts.set(event.context.id, event.context));
  await cdp.send("Runtime.enable");
  // Replay events for contexts that already exist (sent at enable time).
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
  return { cdp, evaluate };
}

// ---------------------------------------------------------------------------
// Leakage assertions (SEC-11): tokens must never leave the hn-session closure
// ---------------------------------------------------------------------------

async function assertNoTokenLeakage(page, consoleMessages) {
  const uiHtml = await page.evaluate(() => {
    const parts = [];
    document.querySelectorAll(".harmonic-app, .harmonic-toast, .harmonic-popup, .harmonic-account-chip").forEach((node) => parts.push(node.outerHTML));
    return parts.join("\n");
  });
  for (const token of PLACEHOLDER_TOKENS) {
    assert.ok(!uiHtml.includes(token), "token must not appear in the rendered Harmonic UI");
  }
  const pageStorage = await page.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage } }));
  for (const token of PLACEHOLDER_TOKENS) assert.ok(!pageStorage.includes(token), "token must not enter page storage");
  const consoleText = (consoleMessages || []).join("\n");
  for (const token of PLACEHOLDER_TOKENS) assert.ok(!consoleText.includes(token), "token must not be logged to the console");
  // Best-effort extension storage check through the service worker.
  try {
    const sw = page.context().serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
    if (sw) {
      const dumped = await sw.evaluate(async () => JSON.stringify({
        local: await chrome.storage.local.get(null),
        session: await chrome.storage.session.get(null),
        sync: await chrome.storage.sync.get(null),
      }));
      for (const token of PLACEHOLDER_TOKENS) assert.ok(!dumped.includes(token), "token must not enter extension storage");
    }
  } catch {}
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

async function test(name, fn) {
  const hn = createHnMock();
  const dataMocks = createDataMocks([910001, 910002, 910003]);
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
    if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
    return route.continue();
  });
  const page = await browser.newPage();
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

await test("session harvests from a logged-in fixture document", async ({ page, hn, consoleMessages }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const session = await world.evaluate("window.HarmonicHN ? (HarmonicHN.session() || null) : null");
  assert.deepEqual(session, { username: "harmonic_test", karma: 512 });
  await assertNoTokenLeakage(page, consoleMessages);
});

await test("logged-out documents produce no session and no tokens", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  assert.equal(await world.evaluate("HarmonicHN.session()"), null);
  assert.equal(await world.evaluate("HarmonicHN._internal.cachedTokenCount()"), 0);
});

await test("ensureItemState parses story and comment vote state via the mock", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const state = await world.evaluate("HarmonicHN.ensureItemState(" + STORY_ID + ")");
  assert.equal(state.status, "ok");
  assert.equal(state.itemId, STORY_ID);
  assert.equal(state.session.username, "harmonic_test");
  assert.equal(state.story.voted, true, "synthetic story is voted");
  assert.equal(state.story.votedDirection, "up");
  assert.equal(state.story.canUp, false, "no second up arrow once voted");
  assert.equal(state.story.favoriteAvailable, true);
  assert.equal(state.story.flagAvailable, true);
  const comment = state.comments[SECOND_COMMENT];
  assert.ok(comment, "comment states returned");
  assert.equal(comment.voted, false);
  assert.equal(state.comments[FIRST_COMMENT].voted, true);
  assert.equal(state.commentFormAvailable, true, "comment form available on item page");
  assert.ok((await world.evaluate("HarmonicHN._internal.cachedTokenCount()")) > 0, "tokens cached after state load");
});

await test("vote sends the exact request shape and succeeds", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const outcome = await world.evaluate("HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "success", JSON.stringify(outcome));
  const voteRequests = hn.requests.filter((request) => request.path.startsWith("/vote"));
  assert.equal(voteRequests.length, 1, "exactly one vote request");
  const vote = voteRequests[0];
  assert.equal(vote.params.id, String(SECOND_COMMENT));
  assert.equal(vote.params.how, "up");
  assert.equal(vote.params.auth, TOKEN_A);
  assert.ok(vote.params.goto, "goto present");
  assert.equal(vote.params.js, "t");
  assert.equal(Object.keys(vote.params).length, 5, "no extra parameters");
});

await test("expired token triggers exactly one refetch and retry", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.errorScript.push({ pathPattern: "/vote", classification: "expiredLink" });
  const outcome = await world.evaluate("HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "success", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 2, "one expired + one retry (SEC-33)");
  assert.ok(hn.requests.some((request) => request.path.startsWith("/item")), "item refetch happened before retry");
});

await test("second expired token fails without endless retries", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.errorScript.push({ pathPattern: "/vote", classification: "expiredLink" });
  hn.state.errorScript.push({ pathPattern: "/vote", classification: "expiredLink" });
  const outcome = await world.evaluate("HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "failure", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 2, "SEC-33: initial + one retry, nothing more");
});

await test("rate limited votes report rateLimited and back off", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  for (let i = 0; i < 4; i++) hn.state.errorScript.push({ pathPattern: "/vote", classification: "rateLimited" });
  const outcome = await world.evaluate("HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "rateLimited", JSON.stringify(outcome));
  const voteRequests = hn.requests.filter((request) => request.path.startsWith("/vote"));
  assert.ok(voteRequests.length >= 1 && voteRequests.length <= 4, "queue retried with backoff, then stopped");
});

await test("logged-out vote never sends a request", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  assert.equal(await world.evaluate("HarmonicHN.session()"), null);
  const outcome = await world.evaluate("HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "loginRequired", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 0, "no vote request while logged out");
});

await test("stale token after account switch aborts with zero vote requests", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  await world.evaluate("HarmonicHN.ensureItemState(" + STORY_ID + ")");
  assert.ok((await world.evaluate("HarmonicHN._internal.cachedTokenCount()")) > 0);
  // Another tab signs in as a different user; force the cached tokens to look
  // stale so the next mutation must re-verify against a fresh page (SEC-35).
  hn.state.loginUsername = "other_test";
  await world.evaluate("HarmonicHN._internal.expireCachedTokens()");
  const outcome = await world.evaluate("HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "accountChanged", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 0, "SEC-35: no mutation after account change");
  // A fresh page fetch happened and the session now reflects the other user.
  const session = await world.evaluate("HarmonicHN.session()");
  assert.equal(session.username, "other_test");
});

await test("unvoting uses the un link token", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const outcome = await world.evaluate("HarmonicHN.vote(" + STORY_ID + ", 'un')");
  assert.equal(outcome.status, "success", JSON.stringify(outcome));
  const vote = hn.requests.find((request) => request.path.startsWith("/vote"));
  assert.equal(vote.params.how, "un");
  assert.equal(vote.params.id, String(STORY_ID));
  assert.equal(vote.params.auth, TOKEN_A);
});

await test("favorite/hide use the exact fave/hide request shape", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const fave = await world.evaluate("HarmonicHN.setFavorite(" + STORY_ID + ", true)");
  assert.equal(fave.status, "success", JSON.stringify(fave));
  const faveRequests = hn.requests.filter((request) => request.path.startsWith("/fave"));
  assert.equal(faveRequests.length, 1);
  assert.equal(faveRequests[0].params.id, String(STORY_ID));
  assert.equal(faveRequests[0].params.auth, TOKEN_A);
  const hide = await world.evaluate("HarmonicHN.setHidden(" + STORY_ID + ", true)");
  assert.equal(hide.status, "success", JSON.stringify(hide));
  const hideRequests = hn.requests.filter((request) => request.path.startsWith("/hide"));
  assert.equal(hideRequests.length, 1);
  assert.equal(hideRequests[0].params.id, String(STORY_ID));
  assert.equal(hideRequests[0].params.auth, TOKEN_B, "the hide link carries placeholder token B");
  // confirmRefetch ran after the favorite.
  assert.ok(hn.requests.filter((request) => request.path.startsWith("/item")).length >= 2);
});

await test("concurrent duplicate mutations are refused (SEC-32)", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const results = await world.evaluate(
    "Promise.all([HarmonicHN.vote(" + SECOND_COMMENT + ", 'up'), HarmonicHN.vote(" + SECOND_COMMENT + ", 'up')])"
  );
  const statuses = results.map((outcome) => outcome.status);
  assert.ok(statuses.includes("success"), JSON.stringify(results));
  assert.ok(statuses.includes("failure"), "concurrent duplicate mutation refused");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 1);
});

await test("logout fetches instead of navigating (SEC-04)", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  // Simulate HN invalidating the session: the redirect target is logged out.
  hn.state.loggedIn = false;
  const outcome = await world.evaluate("HarmonicHN.logout()");
  assert.equal(outcome.status, "success", JSON.stringify(outcome));
  const logoutRequests = hn.requests.filter((request) => request.path.startsWith("/logout"));
  assert.equal(logoutRequests.length, 1);
  assert.equal(logoutRequests[0].params.auth, TOKEN_B);
  assert.equal(await world.evaluate("HarmonicHN.session()"), null, "session cleared");
  const href = await page.evaluate(() => location.href);
  assert.ok(!href.includes("logout"), "token URL must not enter the address bar");
});

await test("reply form opens through the queue and posts once (SEC-34)", async ({ page, hn, consoleMessages }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const opened = await world.evaluate("HarmonicHN.openReplyForm(" + SECOND_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  assert.ok(hn.requests.some((request) => request.path.startsWith("/reply")), "reply form fetched");
  const posted = await world.evaluate("HarmonicHN.postComment(" + JSON.stringify(opened.handle) + ", 'Test reply from the mocked suite')");
  assert.equal(posted.status, "success", JSON.stringify(posted));
  const commentRequests = hn.requests.filter((request) => request.path.startsWith("/comment"));
  assert.equal(commentRequests.length, 1, "SEC-34: comment POST never retried");
  // HN protocol: the POST body must mirror the fetched form's hidden fields.
  const formParent = fixture("synthetic", "reply-in.html").match(/name="parent" value="(\d+)"/)?.[1];
  const formHmac = fixture("synthetic", "reply-in.html").match(/name="hmac" value="([0-9a-f]{40})"/)?.[1];
  assert.equal(commentRequests[0].params.parent, formParent);
  assert.equal(commentRequests[0].params.hmac, formHmac);
  assert.equal(commentRequests[0].method, "POST");
  await assertNoTokenLeakage(page, consoleMessages);
});

await browser.close();
console.log(`\nhn-auth: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}