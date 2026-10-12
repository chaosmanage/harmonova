// HarmoNova Phase 1+2 UI suite: account chip + voting, driven through the real
// Chromium extension against fully mocked Hacker News documents. Companion to
// tests/hn-auth.mjs (module-level flows); this file asserts what the user sees
// and clicks: chips, menus, vote buttons, optimistic states, and toasts.
import { launchExtension } from "./helpers/extension.mjs";
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
const USER = "harmonova_test";

const STORY_ID = 50022292; // synthetic story: voted on the item document
const VOTED_COMMENT = 50034061; // synthetic comment: already voted (un_ anchor)
const PLAIN_COMMENT = 50029143; // synthetic comment: not voted (up_ anchor)
const UNLISTED_COMMENT = 50032063; // Algolia child with no vote entry in the fixture
const POLL_OPT_A = 930001;
const POLL_OPT_B = 930002;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Mocked Hacker News server (stateful for votes so UI flips can be asserted)
// ---------------------------------------------------------------------------

function createHnMock() {
  const state = {
    loggedIn: true,
    errorScript: [],
    loginUsername: USER,
    withDownvote: false, // inject a downvote arrow for PLAIN_COMMENT
    votes: new Map(), // id -> { kind, title } applied to served item documents
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
      const unv = new RegExp('<span id="unv_' + id + '">[\\s\\S]*?</span>');
      if (vote.kind === "un") {
        const unvote = '<span id="unv_' + id + '"> | <a id="un_' + id +
          '" class="clicky" href="vote?id=' + id + '&amp;how=un&amp;auth=' +
          TOKEN_A + '&amp;goto=item%3Fid%3D' + STORY_ID + '">' +
          (vote.title === "downvote" ? "undown" : "unvote") + '</a></span>';
        html = html.replace(unv, unvote);
        html = html.replace('id="up_' + id + '" href=', 'id="up_' + id + '" class="nosee" href=');
      } else {
        html = html.replace(unv, '<span id="unv_' + id + '"></span>');
        html = html.replace('id="up_' + id + '" class="nosee" href=', 'id="up_' + id + '" href=');
      }
    }
    return html;
  }

  function itemDoc(id) {
    let html = fixture("synthetic", "item-in.html");
    if (state.withDownvote) {
      html = html.replace(
        '"votelinks"><center>',
        '"votelinks"><center>' + anchorFor(PLAIN_COMMENT, "down", "downvote")
      );
    }
    if ([POLL_OPT_A, POLL_OPT_B].includes(id)) {
      // Poll options are voted through anchors on their own item documents.
      html = html.replace('"votelinks"><center>', '"votelinks"><center>' + anchorFor(id, "up", "upvote"));
    }
    return serveHtml(withUser(applyVotes(html)));
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
      Object.assign(record.params, record.bodyParams);
    }
    requests.push(record);

    if (/\.(css|js|svg|ico|png)$/.test(pathname)) {
      return route.fulfill(serveHtml("/* harmonova mocked asset */"));
    }

    const error = consumeError(pathname);
    if (error) {
      const map = {
        expiredLink: "error-expired.html",
        rateLimited: "error-ratelimited.html",
      };
      return route.fulfill(serveHtml(withUser(fixture("synthetic", map[error] || "error-expired.html"))));
    }

    // Vote actions: record the flip so subsequent documents reflect the new
    // state, then serve the redirect target's document directly (fulfilled
    // 3xx responses are not re-intercepted by Playwright).
    if (pathname === "/vote") {
      const id = Number(parsed.searchParams.get("id"));
      const how = parsed.searchParams.get("how");
      if (how === "up") state.votes.set(id, { kind: "un", title: "unvote" });
      else if (how === "down") state.votes.set(id, { kind: "un", title: "downvote" });
      else if (how === "un") state.votes.set(id, { kind: "up", title: "upvote" });
      const goto = parsed.searchParams.get("goto") || ("item?id=" + id);
      const qIndex = goto.indexOf("?");
      let targetPath = qIndex === -1 ? goto : goto.slice(0, qIndex);
      if (!targetPath.startsWith("/")) targetPath = "/" + targetPath; // HN gotos are relative ("item?id=1")
      const targetSearch = qIndex === -1 ? "id=" + id : goto.slice(qIndex + 1);
      // HN returns a blank successful response for js=t votes.
      if (parsed.searchParams.get("js") === "t") {
        return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
      }
      return route.fulfill(documentFor(targetPath, targetSearch));
    }
    if (pathname === "/logout") {
      state.loggedIn = false;
      return route.fulfill(serveHtml(fixture("news.html")));
    }
    return route.fulfill(documentFor(pathname, parsed.search));
  }

  return { state, requests, handle };
}

// Firebase + Algolia mocks. The feed story is the synthetic poll story so the
// poll-option UI can be exercised end to end.
function createDataMocks() {
  const now = Math.floor(Date.now() / 1000);
  const pollStory = {
    id: STORY_ID,
    type: "poll",
    by: "submitter_0",
    title: "Mocked feed story " + STORY_ID,
    score: 55,
    time: now - 3600,
    descendants: 2,
    parts: [POLL_OPT_A, POLL_OPT_B],
  };
  const pollOptions = {
    [POLL_OPT_A]: { id: POLL_OPT_A, type: "pollopt", by: "submitter_0", text: "Option A", points: 12, time: now - 3600 },
    [POLL_OPT_B]: { id: POLL_OPT_B, type: "pollopt", by: "submitter_0", text: "Option B", points: 7, time: now - 3600 },
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
        const item = id === STORY_ID ? pollStory : pollOptions[id];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(item || { id, type: "story", title: "Mocked story", score: 1, time: now, descendants: 0 }),
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
            url: null,
            author: "submitter_0",
            points: 55,
            created_at_i: now - 3600,
            text: null,
            children: [
              { id: VOTED_COMMENT, author: "seabass", created_at_i: now - 2400, text: "Already-voted comment.", children: [] },
              { id: PLAIN_COMMENT, author: "commenter_a", created_at_i: now - 1800, text: "First mocked comment.", children: [] },
              { id: UNLISTED_COMMENT, author: "commenter_b", created_at_i: now - 900, text: "Second mocked comment.", children: [] },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
    }
    return route.abort();
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const harness = await launchExtension();
const browser = harness.context;

let passed = 0;
let failed = 0;
const failures = [];

const waitFor = async (fn, timeout = 30000, step = 200, label = "condition") => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = fn();
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
    return route.abort();
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

const gotoFeed = async (page, search = "") => {
  await page.goto("https://news.ycombinator.com/news" + search, { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
};

const chipText = (page) => page.locator("#harmonova-account-chip").textContent();
const openThread = async (page) => {
  await page.locator(".story-card").first().click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  // Wait for the on-demand item-state fetch (600ms after open) to land.
  await page.waitForFunction(
    () => document.querySelector("[data-thread-vote]")?.classList.contains("active"),
    { timeout: 20000 }
  );
};
const toastText = async (page) =>
  page.waitForFunction(() => {
    const toast = document.querySelector(".harmonova-toast");
    return toast?.classList.contains("show") ? toast.textContent : null;
  }, { timeout: 15000 }).then((handle) => handle.jsonValue());

// ---------------------------------------------------------------------------
// Phase 1: account chip
// ---------------------------------------------------------------------------

await test("account chip shows the signed-in user and karma", async ({ page }) => {
  await gotoFeed(page);
  const text = await chipText(page);
  assert.ok(text.includes(USER), "chip shows the username: " + text);
  const title = await page.locator("#harmonova-account-chip").getAttribute("title");
  assert.ok(title.includes("512 karma"), "chip title includes karma: " + title);
});

await test("account chip offers Log in when signed out", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page);
  assert.equal((await chipText(page)).trim(), "Log in");
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item").first().click();
  await page.locator(".harmonova-popup").waitFor({ state: "visible" });
  const labels = await page.locator(".harmonova-popup .popup-item span").allTextContents();
  assert.deepEqual(labels.map((label) => label.trim()), ["Log in", "Create account"]);
});

await test("login hand-off uses an allowlisted goto and never reflects query input", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page, "?q=EVIL_REFLECTION");
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item").first().click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Log in" }).first().click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  const url1 = page.url();
  assert.ok(url1.startsWith("https://news.ycombinator.com/login?goto=news"), "feed login goto: " + url1);
  assert.ok(!url1.includes("EVIL_REFLECTION"), "user input must not be reflected (SEC-02)");

  // From an item page the goto points back at that discussion. Visit the item
// directly while signed out so the chip offers Log in.
  await page.goto("https://news.ycombinator.com/item?id=" + STORY_ID, { waitUntil: "domcontentloaded" });
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item").first().click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Log in" }).first().click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  assert.equal(page.url(), "https://news.ycombinator.com/login?goto=item%3Fid%3D" + STORY_ID);
});

await test("signed-in account menu lists profile destinations and logout", async ({ page }) => {
  await gotoFeed(page);
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item").first().click();
  await page.locator(".harmonova-popup").waitFor({ state: "visible" });
  const heading = await page.locator(".harmonova-popup .popup-heading").textContent();
  assert.ok(heading.includes(USER) && heading.includes("512"), "heading shows user + karma: " + heading);
  const labels = await page.locator(".harmonova-popup .popup-item span").allTextContents();
  for (const expected of ["Profile", "Threads", "Upvoted", "Favorites", "Submissions", "Log out"]) {
    assert.ok(labels.includes(expected), "menu item present: " + expected);
  }
});

await test("Settings Account keeps the same actions as the toolbar", async ({ page }) => {
  await gotoFeed(page);
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator('.harmonova-popup .popup-item', { hasText: 'Settings' }).click();
  await page.locator('.settings-category', { hasText: 'Account' }).click();
  assert.match(await page.locator('.settings-section:not([hidden]) .settings-note').first().innerText(), /harmonic_test|512 karma/);
  const buttons = await page.locator('.settings-account-actions button').allTextContents();
  assert.deepEqual(buttons, ['Profile','Threads','Upvoted','Favorites','Submissions','Hidden','Log out']);
  await page.locator('.settings-account-actions button', { hasText: 'Upvoted' }).click();
  await page.locator('.settings-overlay').waitFor({ state: 'detached' });
  await page.locator('.list-view-header h2').getByText('Your upvoted').waitFor();
});

await test("logout through the chip fetches, never navigates to /logout, and reloads signed out", async ({ page, hn }) => {
  await gotoFeed(page);
  // Mock invalidates HN session on the actual /logout request, not before click.
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item").first().click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Log out" }).click();
  await page.waitForFunction(() => {
    const chip = document.querySelector("#harmonova-account-chip");
    return chip && chip.textContent.trim() === "Log in";
  }, { timeout: 20000 });
  const logoutRequests = hn.requests.filter((request) => request.path.startsWith("/logout"));
  assert.equal(logoutRequests.length, 1, "exactly one logout fetch");
  assert.equal(logoutRequests[0].params.auth, TOKEN_B);
  assert.ok(!page.url().includes("logout"), "token URL must not enter the address bar (SEC-04)");
});

await test("no password fields exist anywhere in HarmoNova UI (SEC-01)", async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  const passwords = await page.evaluate(() => document.querySelectorAll(".harmonova-app input[type=password], .harmonova-toast input[type=password]").length);
  assert.equal(passwords, 0, "HarmoNova must never render a password field");
});

await test("account switch on a fetched page updates the chip and toasts (SEC-35)", async ({ page, hn }) => {
  await gotoFeed(page);
  hn.state.loginUsername = "other_test";
  await openThread(page); // item-state fetch observes the other account
  const toast = await toastText(page);
  assert.ok(toast.includes("Signed in as other_test"), "session-change toast: " + toast);
  const text = await chipText(page);
  assert.ok(text.includes("other_test"), "chip reflects the new account: " + text);
  const voteRequests = hn.requests.filter((request) => request.path.startsWith("/vote")).length;
  assert.equal(voteRequests, 0, "no vote requests from the account switch");
});

await test("settings panel has an Account section and never asks for passwords", async ({ page }) => {
  await gotoFeed(page);
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='More']").click(); // More
  await page.locator(".harmonova-popup .popup-item", { hasText: "Settings" }).click();
  await page.locator(".settings-panel").waitFor({ state: "visible" });
  const account = await page.locator(".settings-section", { has: page.locator("h3", { hasText: "Account" }) }).textContent();
  assert.ok(account.includes("never sees or stores your Hacker News password"), "password explainer present");
  const passwords = await page.evaluate(() => document.querySelectorAll(".settings-panel input[type=password]").length);
  assert.equal(passwords, 0);
});

// ---------------------------------------------------------------------------
// Phase 2: voting
// ---------------------------------------------------------------------------

await test("story upvote reflects fixture state; unvote sends the exact request and flips UI", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThread(page); // story is voted in the fixture -> button active
  const button = page.locator("[data-thread-vote]");
  assert.equal(await button.getAttribute("title"), "Unvote");
  await button.click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/vote")), 20000, 150, "vote request");
  const vote = hn.requests.find((request) => request.path.startsWith("/vote"));
  assert.equal(vote.params.id, String(STORY_ID));
  assert.equal(vote.params.how, "un");
  assert.equal(vote.params.auth, TOKEN_A);
  assert.equal(vote.params.js, "t");
  assert.ok(vote.params.goto.includes("item?id=" + STORY_ID), "goto present: " + vote.params.goto);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // let the outcome land
  assert.equal(await button.getAttribute("title"), "Upvote");
  const points = await page.locator("[data-thread-points] span").last().textContent();
  assert.equal(points, "54", "points drop by one after unvote");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 1, "exactly one vote request");

  // Upvote again: how=up, points restored, button re-activates.
  await button.click();
  await waitFor(() => hn.requests.filter((request) => request.path.startsWith("/vote")).length >= 2, 20000, 150, "second vote request");
  const votes = hn.requests.filter((request) => request.path.startsWith("/vote"));
  assert.equal(votes[1].params.how, "up");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(await button.evaluate((node) => node.classList.contains("active")), "button active after upvote");
  assert.equal(await page.locator("[data-thread-points] span").last().textContent(), "55");
});

await test("fast click waits for existing vote state before deciding direction", async ({ page, hn }) => {
  await gotoFeed(page);
  await page.locator(".story-card").first().click();
  const button = page.locator("[data-thread-vote]");
  await button.waitFor({ state: "visible", timeout: 20000 });
  await button.click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/vote")),
    20000, 150, "vote request");
  const vote = hn.requests.find((request) => request.path.startsWith("/vote"));
  assert.equal(vote.params.how, "un", "early click unvotes a pre-voted story");
  assert.equal(vote.params.js, "t");
});

await test("comment overlay sends exact upvote and unvote requests", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThread(page);
  const row = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await row.locator(":scope > .comment-card").click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Vote up" }).click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/vote")), 20000, 150, "comment vote request");
  const vote = hn.requests.find((request) => request.path.startsWith("/vote"));
  assert.equal(vote.params.id, String(PLAIN_COMMENT));
  assert.equal(vote.params.how, "up");
  assert.equal(vote.params.auth, TOKEN_A);
  await page.waitForFunction(id => document.querySelector('.comment-row[data-comment-id="' + id + '"] .comment-vote-mark')?.hidden === false, PLAIN_COMMENT);
  await row.locator(":scope > .comment-card").click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Unvote" }).click();
  await waitFor(() => hn.requests.filter((request) => request.path.startsWith("/vote")).length === 2, 20000);
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote"))[1].params.how, "un");
  await page.waitForFunction(id => document.querySelector('.comment-row[data-comment-id="' + id + '"] .comment-vote-mark')?.hidden === true, PLAIN_COMMENT);
});

await test("scripted clicks never send votes (SEC-30)", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.evaluate(() => document.querySelector("[data-thread-vote]").click());
  await page.evaluate(() => document.querySelector("[data-comment-vote]")?.click());
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 0, "isTrusted=false clicks must be refused");
});

await test("double expired token rolls back the optimistic UI with a toast", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThread(page);
  // First un-vote succeeds so the next click is an upvote.
  await page.locator("[data-thread-vote]").click();
  await page.waitForFunction(() => !document.querySelector("[data-thread-vote]")?.classList.contains("active"), { timeout: 20000 });
  assert.equal(await page.locator("[data-thread-points] span").last().textContent(), "54");
  hn.state.errorScript.push({ pathPattern: "/vote", classification: "expiredLink" });
  hn.state.errorScript.push({ pathPattern: "/vote", classification: "expiredLink" });
  await page.locator("[data-thread-vote]").click();
  const toast = await toastText(page);
  assert.ok(toast.includes("rejected this twice"), "failure toast shown: " + toast);
  await page.waitForFunction(() => !document.querySelector("[data-thread-vote]")?.classList.contains("active"), { timeout: 20000 });
  assert.equal(await page.locator("[data-thread-points] span").last().textContent(), "54", "optimistic bump rolled back");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/vote")).length, 2, "SEC-33: initial + one retry, then stop");
});

await test("rate-limited upvote backs off, rolls back, and keeps the Open on HN escape hatch", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.locator("[data-thread-vote]").click(); // unvote first
  await page.waitForFunction(() => !document.querySelector("[data-thread-vote]")?.classList.contains("active"), { timeout: 20000 });
  assert.equal(await page.locator("[data-thread-points] span").last().textContent(), "54");
  for (let i = 0; i < 4; i++) hn.state.errorScript.push({ pathPattern: "/vote", classification: "rateLimited" });
  await page.locator("[data-thread-vote]").click();
  const toast = await toastText(page);
  assert.match(toast, /rate.?limit/i, "rate-limit toast: " + toast);
  await page.waitForFunction(() => !document.querySelector("[data-thread-vote]")?.classList.contains("active"), { timeout: 30000 });
  assert.equal(await page.locator("[data-thread-points] span").last().textContent(), "54", "rollback after rate limit");
  // The thread More menu keeps the "Open on original Hacker News" escape hatch.
  await page.locator(".thread-actions .thread-action").last().click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Open on original Hacker News" }).waitFor({ state: "visible" });
});

await test("feed card menu upvote uses the harvested token and badges the card", async ({ page, hn }) => {
  await gotoFeed(page);
  const card = page.locator('.story-card[data-story-id="' + STORY_ID + '"]');
  assert.ok(!(await card.evaluate((node) => node.classList.contains("voted"))), "card not badged before voting");
  await card.click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Upvote" }).click();
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.classList.contains("voted"),
    STORY_ID,
    { timeout: 20000 }
  );
  const vote = hn.requests.find((request) => request.path.startsWith("/vote"));
  assert.equal(vote.params.id, String(STORY_ID));
  assert.equal(vote.params.how, "up");
  assert.equal(vote.params.auth, TOKEN_A, "token comes from the harvested feed document");
  const toast = await toastText(page);
  assert.ok(toast.includes("Upvoted"), "confirmation toast: " + toast);
  // Menu now offers Unvote; clicking it clears the badge.
  await card.click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Unvote" }).click();
  await page.waitForFunction(
    (id) => !document.querySelector('.story-card[data-story-id="' + id + '"]')?.classList.contains("voted"),
    STORY_ID,
    { timeout: 20000 }
  );
});

await test("poll options render and vote through their own tokens", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThread(page);
  const poll = page.locator(".thread-poll");
  await poll.waitFor({ state: "visible", timeout: 20000 });
  const optionA = poll.locator('.poll-option').first();
  assert.ok((await optionA.textContent()).includes("Option A"));
  await optionA.locator(".poll-option-vote").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/vote")), 25000, 200, "poll vote request");
  const vote = hn.requests.find((request) => request.path.startsWith("/vote"));
  assert.equal(vote.params.id, String(POLL_OPT_A));
  assert.equal(vote.params.how, "up");
  assert.equal(vote.params.auth, TOKEN_A);
  // After the request the option stays active (not just the optimistic toggle).
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.ok(await optionA.locator(".poll-option-vote").evaluate((node) => node.classList.contains("active")), "poll option active after success");
});

await test("tokens never leak into the UI, storage, or console", async ({ page, hn, consoleMessages }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.locator("[data-thread-vote]").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/vote")), 20000, 150, "vote request");
  await new Promise((resolve) => setTimeout(resolve, 2500)); // let the UI settle
  const uiHtml = await page.evaluate(() => {
    const parts = [];
    document.querySelectorAll(".harmonova-app, .harmonova-toast, .harmonova-popup").forEach((node) => parts.push(node.outerHTML));
    return parts.join("\n");
  });
  for (const token of PLACEHOLDER_TOKENS) {
    assert.ok(!uiHtml.includes(token), "token must not appear in the rendered UI");
  }
  const storage = await page.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage } }));
  for (const token of PLACEHOLDER_TOKENS) assert.ok(!storage.includes(token), "token must not enter page storage");
  const consoleText = consoleMessages.join("\n");
  for (const token of PLACEHOLDER_TOKENS) assert.ok(!consoleText.includes(token), "token must not be logged");
});

await test("comment overlay downvotes only with an offered HN token", async ({ page, hn }) => {
  hn.state.withDownvote = true;
  await gotoFeed(page);
  await openThread(page);
  const row = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await row.locator(":scope > .comment-card").click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Vote down" }).click();
  await waitFor(() => hn.requests.some(request => request.path.startsWith("/vote")), 20000);
  assert.equal(hn.requests.find(request => request.path.startsWith("/vote")).params.how, "down");
  await page.waitForFunction(id => document.querySelector('.comment-row[data-comment-id="' + id + '"] .comment-vote-mark')?.textContent === "↓", PLAIN_COMMENT, { timeout: 20000 });
  await row.locator(":scope > .comment-card").click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Undown" }).click();
  await waitFor(() => hn.requests.filter(request => request.path.startsWith("/vote")).length === 2, 20000);
  assert.equal(hn.requests.filter(request => request.path.startsWith("/vote"))[1].params.how, "un");
});

await test("comment overlay excludes downvote without an offered token", async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  const row = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await row.locator(":scope > .comment-card").click({ button: "right" });
  assert.equal(await page.locator('.harmonova-popup .popup-item', { hasText: "Vote down" }).count(), 0);
});

harness.assertOffline();
await harness.close();
if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");