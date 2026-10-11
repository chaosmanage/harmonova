import { hnRedirectFixture } from './helpers/network.mjs';
import { launchExtension } from './helpers/extension.mjs';
// HarmoNova mocked account e2e suite (Phase 0.5.2 harness; extended per phase).
// Fully mocks Hacker News documents and actions with fixtures so account flows
// can be exercised without credentials. Every HN request is recorded and can be
// asserted for exact method, path, and parameters.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");

const TOKEN_A = "0".repeat(40);
const TOKEN_B = "1".repeat(40);
const PLACEHOLDER_TOKENS = [TOKEN_A, TOKEN_B];
const USER = "harmonova_test";

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

const STORY_ID = 50022292;
const FIRST_COMMENT = 50034061; // synthetic: voted + unfavorited state
const SECOND_COMMENT = 50029143; // synthetic: plain (not voted) state
const EDIT_COMMENT = 50033557;

// ---------------------------------------------------------------------------
// Mocked Hacker News server
// ---------------------------------------------------------------------------

function createHnMock() {
  const state = {
    loggedIn: true,
    // Error script: consumed in order, one entry per matching request.
    errorScript: [],
    loginUsername: USER,
    postedComment: null,
    bareNews: false,
    bareSubmit: false,
    submitLoginPage: false,
    bareFavoriteResponse: false,
    directCommentResponse: false,
    commentReadLag: 0,
    directSubmitResponse: false,
    newSubmission: null,
    suppressSubmittedIndex: false,
    editFnidForm: false,
    editWrongId: false,
    editedText: null,
    deleteFnidForm: false,
    deleteWrongId: false,
    deletedComment: false,
    deleteReadLag: 0,
  };
  const requests = [];

  const consumeError = (pathname) => {
    const index = state.errorScript.findIndex((entry) => pathname.startsWith(entry.pathPattern));
    if (index === -1) return null;
    const [entry] = state.errorScript.splice(index, 1);
    return entry.classification;
  };

  const withUser = (html) => (state.loginUsername === USER ? html : html.split(USER).join(state.loginUsername));
  const withoutAccountLinks = (html) => html.replace(/<span class="pagetop">[\s\S]*?<\/span>/g,
    (span) => span.includes('id="logout"') ? '<span class="pagetop">Action page</span>' : span);

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
      case "/newest":
      case "/": {
        const html = withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html"));
        return serveHtml(state.bareNews ? withoutAccountLinks(html) : html);
      }
      case "/item": {
        let html = state.loggedIn ? fixture("synthetic", "item-in.html") : fixture("synthetic", "item-out.html");
        if (state.deletedComment && state.deleteReadLag > 0) state.deleteReadLag--;
        else if (state.deletedComment) {
          const row = '<tr class="athing comtr" id="' + EDIT_COMMENT + '"><td><span class="comhead">[deleted]</span><div class="commtext">[deleted]</div></td></tr>';
          html = html.replace('<table border="0" class="comment-tree"><tbody>', '<table border="0" class="comment-tree"><tbody>' + row);
        }
        if (state.editedText !== null) {
          const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const row = '<tr class="athing comtr" id="' + EDIT_COMMENT + '"><td><span class="comhead"><a class="hnuser">' + USER + '</a></span><div class="commtext">' + escape(state.editedText) + '</div></td></tr>';
          html = html.replace('<table border="0" class="comment-tree"><tbody>', '<table border="0" class="comment-tree"><tbody>' + row);
        }
        if (state.postedComment && state.commentReadLag > 0) state.commentReadLag--;
        else if (state.postedComment) {
          const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const row = '<tr class="athing comtr" id="910099"><td colspan="3"><span class="comhead"><a class="hnuser">' + USER + '</a></span><div class="commtext">' + escape(state.postedComment) + '</div></td></tr>';
          html = html.replace('<table border="0" class="comment-tree"><tbody>', '<table border="0" class="comment-tree"><tbody>' + row);
        }
        return serveHtml(withUser(html));
      }
      case "/reply":
        return serveHtml(withUser(fixture("synthetic", "reply-in.html")));
      case "/edit": {
        let html = fixture("synthetic", "edit-in.html");
        if (state.editFnidForm) {
          html = html.replace('action="xedit"', 'action="r"')
            .replace(/<input type="hidden" name="hmac" value="[^"]+">/, '<input type="hidden" name="fnid" value="AbCdEf123456Zz"><input type="hidden" name="fnop" value="edit-comment">')
            .replace(/<input type="hidden" name="id" value="[^"]+">/,
              state.editWrongId ? '<input type="hidden" name="id" value="99999999">' : '');
        }
        return serveHtml(withUser(html));
      }
      case "/delete-confirm": {
        let html = fixture("synthetic", "delete-confirm-in.html");
        if (state.deleteFnidForm) {
          html = html.replace('action="xdelete"', 'action="r"')
            .replace(/<input type="hidden" name="hmac" value="[^"]+">/, '<input type="hidden" name="fnid" value="AbCdEf123456Zz"><input type="hidden" name="fnop" value="delete-comment">')
            .replace(/<input type="hidden" name="id" value="[^"]+">/,
              state.deleteWrongId ? '<input type="hidden" name="id" value="99999999">' : '');
        }
        return serveHtml(withUser(html));
      }
      case "/submitted": {
        const existing = '<tr class="athing" id="910090"><td><span class="titleline"><a href="item?id=910090">test</a></span></td></tr>';
        const latest = state.newSubmission
          ? '<tr class="athing" id="910101"><td><span class="titleline"><a href="' + (state.newSubmission.url || 'item?id=910101') + '">' + state.newSubmission.title + '</a></span></td></tr>' : '';
        return serveHtml('<html><body><table id="hnmain">' + latest + existing + '</table></body></html>');
      }
      case "/submit": {
        if (state.submitLoginPage) return serveHtml(fixture("login.html"));
        const html = withUser(fixture("synthetic", "submit-in.html"));
        return serveHtml(state.bareSubmit ? withoutAccountLinks(html) : html);
      }
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
      record.contentType = request.headers()["content-type"] || "";
      record.bodyParams = Object.fromEntries(new URLSearchParams(record.postData));
      Object.assign(record.params, record.bodyParams); // POST bodies carry the auth params on HN forms
    }
    requests.push(record);

    // Serve assets as (harmless) HTML so the fixture page loads fully offline;
    // real HN assets are never fetched in these tests.
    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonova mocked asset */"));
    }

    const error = consumeError(pathname);
    if (error) return route.fulfill(serveHtml(errorPage(error)));

    // Reproduce HN's form parser: POSTed credentials/fields are not readable
    // when encoded as text/plain (the old extension bug). Do not falsely
    // create a comment or submission just because the bytes contain '='.
    if (method === "POST" && ["/comment", "/r", "/xedit", "/xdelete"].includes(pathname)
      && !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(record.contentType)) {
      return route.fulfill(serveHtml("<html><body><p>Form content type is unsupported.</p></body></html>"));
    }

    // HN's js=t votes return an empty 200 body; no redirect HTML is provided.
    if (pathname === "/vote" && parsed.searchParams.get("js") === "t") {
      return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
    }

    // Serve action responses as the redirect target's document directly:
    // Playwright-fulfilled 3xx responses are not re-intercepted, so a real
    // redirect's follow-up request would escape the mock and hit the network.
    if (pathname === "/r" && method === "POST" && record.bodyParams.fnop === "delete-comment") {
      state.deletedComment = true;
      return route.fulfill(serveHtml(withUser(fixture("synthetic", "news-in.html"))));
    }
    if (pathname === "/r" && method === "POST" && record.bodyParams.fnop === "edit-comment") {
      state.editedText = record.bodyParams.text;
      return route.fulfill(serveHtml(withUser(fixture("synthetic", "news-in.html"))));
    }
    if (pathname === "/r" && method === "POST" && state.directSubmitResponse) {
      if (!state.suppressSubmittedIndex) state.newSubmission = Object.fromEntries(new URLSearchParams(record.postData || ""));
      return route.fulfill(serveHtml(withUser(fixture("synthetic", "news-in.html"))));
    }
    if (["/vote", "/fave", "/hide", "/flag", "/r", "/xedit", "/xdelete"].includes(pathname)) {
      const goto = parsed.searchParams.get("goto");
      const id = parsed.searchParams.get("id");
      const target = goto || (id ? "item?id=" + id : "news");
      const qIndex = target.indexOf("?");
      const targetPath = qIndex === -1 ? target : target.slice(0, qIndex);
      const targetSearch = qIndex === -1 ? "" : target.slice(qIndex + 1);
      const result = documentFor(targetPath, targetSearch);
      if (pathname === "/fave" && state.bareFavoriteResponse) {
        return route.fulfill(serveHtml(withoutAccountLinks(result.body)));
      }
      return route.fulfill(result);
    }
    if (pathname === "/logout") {
      // HN invalidates the session on logout; serve a logged-out document.
      return route.fulfill(serveHtml(fixture("news.html")));
    }
    if (pathname === "/comment") {
      const post = new URLSearchParams(record.postData || "");
      state.postedComment = post.get("text") || "";
      return route.fulfill(state.directCommentResponse
        ? serveHtml(withUser(fixture("synthetic", "news-in.html")))
        : redirect("/item?id=" + STORY_ID));
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
  let harmonovaContextId = null;
  const findHarmoNovaContext = async () => {
    for (const [id] of contexts) {
      try {
        const probe = await cdp.send("Runtime.evaluate", {
          expression: "typeof window.HarmoNovaHN !== 'undefined'",
          contextId: id,
          returnByValue: true,
        });
        if (probe.result?.value === true) {
          harmonovaContextId = id;
          return id;
        }
      } catch {}
    }
    return null;
  };
  const evaluate = async (expression) => {
    if (!harmonovaContextId) {
      if (!(await findHarmoNovaContext())) throw new Error("HarmoNovaHN isolated world not found");
    }
    const result = await cdp.send("Runtime.evaluate", { expression, contextId: harmonovaContextId, returnByValue: true, awaitPromise: true });
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
    document.querySelectorAll(".harmonova-app, .harmonova-toast, .harmonova-popup, .harmonova-account-chip").forEach((node) => parts.push(node.outerHTML));
    return parts.join("\n");
  });
  for (const token of PLACEHOLDER_TOKENS) {
    assert.ok(!uiHtml.includes(token), "token must not appear in the rendered HarmoNova UI");
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

let harness;
let browser;

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  if (process.env.HARMONOVA_TEST_FILTER && !name.toLowerCase().includes(process.env.HARMONOVA_TEST_FILTER.toLowerCase())) return;
  const hn = createHnMock();
  const hnServer = await hnRedirectFixture(hn.handle);
  try {
    harness = await launchExtension({ destinations: new Map([['news.ycombinator.com:443', hnServer]]) });
    browser = harness.context;
    const dataMocks = createDataMocks([910001, 910002, 910003]);
    await browser.route("**/*", async (route) => {
      const parsed = new URL(route.request().url());
      if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
      if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
      return route.fallback();
    });
    await browser.route('https://example.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Offline article</title><p>Fixture</p>' }));
    // Observe completion of the app's automatic item-state update. Initial
    // optimistic vote buttons are built detached and do not trigger this observer.
    await browser.addInitScript(() => {
      window.__initialHnStateApplied = false;
      new MutationObserver(records => {
        if (records.some(r => r.type === 'attributes' && r.attributeName === 'title' && r.target.matches?.('[data-thread-vote]')))
          window.__initialHnStateApplied = true;
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['title'] });
    });
    const page = await browser.newPage();
    const consoleMessages = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    page.on("pageerror", (error) => consoleMessages.push("pageerror: " + error.message));
    await fn({ page, hn, consoleMessages });
    harness.assertOffline();
    passed++;
    console.log("ok -", name);
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  } finally {
    try { await harness?.close(); } finally { await hnServer.close(); }
  }
}

const gotoFeed = async (page) => {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => window.__initialHnStateApplied);
};

await test("session harvests from a logged-in fixture document", async ({ page, hn, consoleMessages }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const session = await world.evaluate("window.HarmoNovaHN ? (HarmoNovaHN.session() || null) : null");
  assert.deepEqual(session, { username: "harmonova_test", karma: 512 });
  await assertNoTokenLeakage(page, consoleMessages);
});

await test("logged-out documents produce no session and no tokens", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  assert.equal(await world.evaluate("HarmoNovaHN.session()"), null);
  assert.equal(await world.evaluate("HarmoNovaHN._internal.cachedTokenCount()"), 0);
});

await test("ensureItemState parses story and comment vote state via the mock", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const state = await world.evaluate("HarmoNovaHN.ensureItemState(" + STORY_ID + ")");
  assert.equal(state.status, "ok");
  assert.equal(state.itemId, STORY_ID);
  assert.equal(state.session.username, "harmonova_test");
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
  assert.ok((await world.evaluate("HarmoNovaHN._internal.cachedTokenCount()")) > 0, "tokens cached after state load");
});

await test("vote sends the exact request shape and succeeds", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')");
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
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')");
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
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "failure", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 2, "SEC-33: initial + one retry, nothing more");
});

await test("rate limited votes report rateLimited and back off", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  for (let i = 0; i < 4; i++) hn.state.errorScript.push({ pathPattern: "/vote", classification: "rateLimited" });
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "rateLimited", JSON.stringify(outcome));
  const voteRequests = hn.requests.filter((request) => request.path.startsWith("/vote"));
  assert.ok(voteRequests.length >= 1 && voteRequests.length <= 4, "queue retried with backoff, then stopped");
});

await test("logged-out vote never sends a request", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  assert.equal(await world.evaluate("HarmoNovaHN.session()"), null);
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "loginRequired", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 0, "no vote request while logged out");
});

await test("stale token after account switch aborts with zero vote requests", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  await world.evaluate("HarmoNovaHN.ensureItemState(" + STORY_ID + ")");
  assert.ok((await world.evaluate("HarmoNovaHN._internal.cachedTokenCount()")) > 0);
  // Another tab signs in as a different user; force the cached tokens to look
  // stale so the next mutation must re-verify against a fresh page (SEC-35).
  hn.state.loginUsername = "other_test";
  await world.evaluate("HarmoNovaHN._internal.expireCachedTokens()");
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')");
  assert.equal(outcome.status, "accountChanged", JSON.stringify(outcome));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 0, "SEC-35: no mutation after account change");
  // A fresh page fetch happened and the session now reflects the other user.
  const session = await world.evaluate("HarmoNovaHN.session()");
  assert.equal(session.username, "other_test");
});

await test("unvoting uses the un link token", async ({ page, hn }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const outcome = await world.evaluate("HarmoNovaHN.vote(" + STORY_ID + ", 'un')");
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
  const fave = await world.evaluate("HarmoNovaHN.setFavorite(" + STORY_ID + ", true)");
  assert.equal(fave.status, "success", JSON.stringify(fave));
  const faveRequests = hn.requests.filter((request) => request.path.startsWith("/fave"));
  assert.equal(faveRequests.length, 1);
  assert.equal(faveRequests[0].params.id, String(STORY_ID));
  assert.equal(faveRequests[0].params.auth, TOKEN_A);
  const hide = await world.evaluate("HarmoNovaHN.setHidden(" + STORY_ID + ", true)");
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
    "Promise.all([HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up'), HarmoNovaHN.vote(" + SECOND_COMMENT + ", 'up')])"
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
  const outcome = await world.evaluate("HarmoNovaHN.logout()");
  assert.equal(outcome.status, "success", JSON.stringify(outcome));
  const logoutRequests = hn.requests.filter((request) => request.path.startsWith("/logout"));
  assert.equal(logoutRequests.length, 1);
  assert.equal(logoutRequests[0].params.auth, TOKEN_B);
  assert.equal(await world.evaluate("HarmoNovaHN.session()"), null, "session cleared");
  const href = await page.evaluate(() => location.href);
  assert.ok(!href.includes("logout"), "token URL must not enter the address bar");
});

await test("reply form opens through the queue and posts once (SEC-34)", async ({ page, hn, consoleMessages }) => {
  hn.state.loggedIn = true;
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const opened = await world.evaluate("HarmoNovaHN.openReplyForm(" + SECOND_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  assert.ok(hn.requests.some((request) => request.path.startsWith("/reply")), "reply form fetched");
  const posted = await world.evaluate("HarmoNovaHN.postComment(" + JSON.stringify(opened.handle) + ", 'Test reply from the mocked suite')");
  // The follow-up read-only item fetch can now confirm a post even when a
  // mocked redirect is not followed by Playwright.
  assert.equal(posted.status, "success", JSON.stringify(posted));
  assert.equal(posted.newComment.id, 910099);
  const commentRequests = hn.requests.filter((request) => request.path.startsWith("/comment"));
  assert.equal(commentRequests.length, 1, "SEC-34: comment POST never retried");
  // HN protocol: the POST body must mirror the fetched form's hidden fields.
  const formParent = fixture("synthetic", "reply-in.html").match(/name="parent" value="(\d+)"/)?.[1];
  const formHmac = fixture("synthetic", "reply-in.html").match(/name="hmac" value="([0-9a-f]{40})"/)?.[1];
  assert.equal(commentRequests[0].params.parent, formParent);
  assert.equal(commentRequests[0].params.hmac, formHmac);
  assert.equal(commentRequests[0].method, "POST");
  assert.match(commentRequests[0].contentType, /^application\/x-www-form-urlencoded(?:\s*;|$)/i, "POST must use a native HTML form content type");
  await assertNoTokenLeakage(page, consoleMessages);
});

await test("partial HN navigation bars do not sign out a confirmed account", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.bareNews = true;
  const list = await world.evaluate("HarmoNovaHN.fetchListPage('/newest')");
  assert.equal(list.status, "ok", JSON.stringify(list));
  assert.equal((await world.evaluate("HarmoNovaHN.session()"))?.username, USER);
  hn.state.bareNews = false;
  hn.state.bareSubmit = true;
  const submit = await world.evaluate("HarmoNovaHN.openSubmitForm()");
  assert.equal(submit.status, "ok", JSON.stringify(submit));
  assert.equal((await world.evaluate("HarmoNovaHN.session()"))?.username, USER);
  assert.ok(hn.requests.filter((request) => request.path === "/news").length >= 2, "submission re-verifies the account");
  assert.equal(hn.requests.filter((request) => request.method === "POST").length, 0, "opening a submit form never posts");
});

await test("HN login gate on submit does not clear an otherwise active account", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.submitLoginPage = true;
  const submit = await world.evaluate("HarmoNovaHN.openSubmitForm()");
  assert.equal(submit.status, "failure", JSON.stringify(submit));
  assert.match(submit.message, /active session/);
  assert.equal((await world.evaluate("HarmoNovaHN.session()"))?.username, USER);
  assert.equal(hn.requests.filter((request) => request.method === "POST").length, 0);
});

await test("favorite response without account links preserves the session", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.bareFavoriteResponse = true;
  const result = await world.evaluate("HarmoNovaHN.setFavorite(" + STORY_ID + ", true)");
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal((await world.evaluate("HarmoNovaHN.session()"))?.username, USER);
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/logout")).length, 0);
});

await test("thread toolbar exposes profile, favorite, share and grouped summaries", async ({ page }) => {
  await gotoFeed(page);
  await page.locator('.story-comment-button').first().click();
  await page.locator('.thread-actions').waitFor({ state: 'visible' });
  const labels = await page.locator('.thread-actions button').evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label')));
  assert.equal(labels.length, 8, JSON.stringify(labels));
  for (const label of ['My profile', 'Add reply', 'Upvote', 'Favorite', 'Share story', 'More', 'Summarize article', 'Summarize discussion']) {
    assert.ok(labels.includes(label), 'toolbar includes ' + label);
  }
  assert.ok(!labels.some((label) => /bookmark/i.test(label)));
  assert.equal(await page.locator('[role="group"][aria-label="AI summaries"]').count(), 1);
  await page.getByRole('button', { name: 'Add reply' }).click();
  await page.locator('.composer-input').waitFor({ state: 'visible' });
  await page.locator('.composer-cancel').click();
  await page.locator('.thread-actions button[aria-label="More"]').click();
  const menuText = await page.locator('.harmonova-popup').textContent();
  assert.ok(menuText.includes('Show only OP comments'));
  assert.ok(!/bookmark story|collapse all comments|expand all comments/i.test(menuText));
});

await test("Chromium bounds long right-click menus and hides job cards", async ({ page }) => {
  await gotoFeed(page);
  await page.locator('.story-card .story-comment-button').first().click();
  const comment = page.locator('.comment-card').first();
  await comment.waitFor({ state: 'visible', timeout: 15000 });
  await comment.locator('.comment-body').evaluate((node) => { node.textContent = 'very long excerpt '.repeat(100); });
  await comment.click({ button: 'right' });
  const popup = await page.locator('.harmonova-popup').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, left: rect.left, top: rect.top,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      color: getComputedStyle(node.querySelector('[data-icon="star"] .harmonova-icon')).color };
  });
  assert.ok(popup.width <= 310 && popup.height <= 540, JSON.stringify(popup));
  assert.ok(popup.left >= 0 && popup.top >= 0 && popup.left + popup.width <= popup.viewportWidth
    && popup.top + popup.height <= popup.viewportHeight, JSON.stringify(popup));
  assert.notEqual(popup.color, 'rgb(200, 198, 207)', 'bookmark icon uses HarmoNova accent');
  await page.mouse.click(3, 3);
  await page.evaluate(() => {
    const job = document.querySelector('.story-list .story-card').cloneNode(true);
    job.dataset.storyId = '999999999';
    job.dataset.type = 'job';
    document.querySelector('.story-list').prepend(job);
  });
  await page.locator('.feed-toolbar-actions .icon-button').last().click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.settings-category', { hasText: 'Stories' }).click();
  const jobs = page.locator('.setting-row').filter({ hasText: 'Hide jobs' }).locator('input[type="checkbox"]');
  await jobs.check();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-story-id="999999999"]')).display === 'none');
  await jobs.uncheck();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-story-id="999999999"]')).display !== 'none');
});

await test("comment confirms via read-only item fetch after a stale POST response", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const opened = await world.evaluate("HarmoNovaHN.openReplyForm(" + SECOND_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  hn.state.directCommentResponse = true;
  hn.state.commentReadLag = 1;
  const result = await world.evaluate("HarmoNovaHN.postComment(" + JSON.stringify(opened.handle) + ", 'fresh comment confirmation')");
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal(result.newComment.id, 910099);
  assert.equal(hn.requests.filter((r) => r.path === "/comment" && r.method === "POST").length, 1);
  assert.ok(hn.requests.filter((r) => r.path.startsWith("/item")).length >= 2);
});

await test("submission confirms from new author-list ID and does not confuse older same-title posts", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.directSubmitResponse = true;
  const opened = await world.evaluate("HarmoNovaHN.openSubmitForm()");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  const result = await world.evaluate("HarmoNovaHN.submitStory(" + JSON.stringify(opened.handle) + ", { title: 'test', text: 'New post' })");
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal(result.newStoryId, 910101);
  const submissions = hn.requests.filter((r) => r.path === "/r" && r.method === "POST");
  assert.equal(submissions.length, 1);
  assert.match(submissions[0].contentType, /^application\/x-www-form-urlencoded(?:\s*;|$)/i);
  assert.ok(hn.requests.filter((r) => r.path.startsWith("/submitted")).length >= 2);
});

await test("unverifiable comment stays indeterminate without retrying POST", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  const opened = await world.evaluate("HarmoNovaHN.openReplyForm(" + SECOND_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok");
  hn.state.directCommentResponse = true;
  hn.state.commentReadLag = 100;
  const result = await world.evaluate("HarmoNovaHN.postComment(" + JSON.stringify(opened.handle) + ", 'unverified test comment')");
  assert.equal(result.status, "indeterminate", JSON.stringify(result));
  assert.equal(hn.requests.filter((r) => r.path === "/comment" && r.method === "POST").length, 1);
});

await test("matching older title cannot confirm a new unindexed submission", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.directSubmitResponse = true;
  hn.state.suppressSubmittedIndex = true;
  const opened = await world.evaluate("HarmoNovaHN.openSubmitForm()");
  assert.equal(opened.status, "ok");
  const result = await world.evaluate("HarmoNovaHN.submitStory(" + JSON.stringify(opened.handle) + ", { title: 'test', text: 'Unindexed' })");
  assert.equal(result.status, "indeterminate", JSON.stringify(result));
  assert.equal(hn.requests.filter((r) => r.path === "/r" && r.method === "POST").length, 1);
});

await test("HN edit form accepts server-bound fnid/fnop without a hidden id", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.editFnidForm = true;
  const opened = await world.evaluate("HarmoNovaHN.openEditForm(" + EDIT_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  const result = await world.evaluate("HarmoNovaHN.saveEdit(" + JSON.stringify(opened.handle) + ", 'Updated comment through fnid')");
  assert.equal(result.status, "success", JSON.stringify(result));
  const posts = hn.requests.filter((request) => request.path === "/r" && request.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].bodyParams.fnid, 'AbCdEf123456Zz');
  assert.equal(posts[0].bodyParams.fnop, 'edit-comment');
  assert.equal(posts[0].bodyParams.text, 'Updated comment through fnid');
  assert.match(posts[0].contentType, /^application\/x-www-form-urlencoded/);
});

await test("HN edit form rejects explicit wrong comment ID", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.editFnidForm = true;
  hn.state.editWrongId = true;
  const opened = await world.evaluate("HarmoNovaHN.openEditForm(" + EDIT_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "failure", JSON.stringify(opened));
  assert.equal(hn.requests.filter((request) => request.method === "POST").length, 0);
});

await test("HN submit form is fetched last before using the one-time token", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.directSubmitResponse = true;
  const opened = await world.evaluate("HarmoNovaHN.openSubmitForm()");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  const before = hn.requests.filter((request) => request.method === "GET");
  assert.equal(before.at(-1).path, "/submit", "form token must be fetched after session and submitted checks");
  const result = await world.evaluate("HarmoNovaHN.submitStory(" + JSON.stringify(opened.handle) + ", { title: 'Fresh token story', text: 'A meaningful description' })");
  assert.equal(result.status, "success", JSON.stringify(result));
  const postIndex = hn.requests.findIndex((request) => request.path === "/r" && request.method === "POST");
  assert.equal(hn.requests[postIndex - 1].path, "/submit", "do not make GET requests between fnid and POST");
  assert.equal(hn.requests.filter((request) => request.path === "/r" && request.method === "POST").length, 1);
});

await test("HN delete form accepts a server-bound fnid without hidden ID and confirms read-only", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.deleteFnidForm = true;
  hn.state.deleteReadLag = 1;
  const opened = await world.evaluate("HarmoNovaHN.openDeleteForm(" + EDIT_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  const result = await world.evaluate("HarmoNovaHN.deleteComment(" + JSON.stringify(opened.handle) + ")");
  assert.equal(result.status, "success", JSON.stringify(result));
  const posts = hn.requests.filter((r) => r.method === 'POST' && r.path === '/r');
  assert.equal(posts.length, 1, "send deletion exactly once");
  assert.equal(posts[0].bodyParams.fnid, 'AbCdEf123456Zz');
  assert.equal(posts[0].bodyParams.fnop, 'delete-comment');
  assert.match(posts[0].contentType, /^application\/x-www-form-urlencoded/);
  assert.ok(hn.requests.some((r) => r.path === '/item?id=' + EDIT_COMMENT), 'check direct permalink after POST');
});

await test("HN delete confirmation with an explicit wrong ID never mutates", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.deleteFnidForm = true;
  hn.state.deleteWrongId = true;
  const result = await world.evaluate("HarmoNovaHN.openDeleteForm(" + EDIT_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(result.status, "failure", JSON.stringify(result));
  assert.equal(hn.requests.filter((r) => r.method === 'POST').length, 0);
});

await test("HN delete cannot be reported successful when readbacks lack a deleted marker", async ({ page, hn }) => {
  await gotoFeed(page);
  const world = await attachIsolatedWorld(page);
  hn.state.deleteFnidForm = true;
  hn.state.deleteReadLag = 100;
  const opened = await world.evaluate("HarmoNovaHN.openDeleteForm(" + EDIT_COMMENT + ", { storyId: " + STORY_ID + " })");
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  const result = await world.evaluate("HarmoNovaHN.deleteComment(" + JSON.stringify(opened.handle) + ")");
  assert.equal(result.status, "indeterminate", JSON.stringify(result));
  assert.equal(hn.requests.filter((r) => r.method === 'POST').length, 1);
});


console.log(`\nhn-auth: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}