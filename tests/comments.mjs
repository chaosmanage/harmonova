import {stopExtensionWorker} from "./helpers/worker-lifecycle.mjs";
import { hnRedirectFixture } from './helpers/network.mjs';
import { launchExtension } from './helpers/extension.mjs';
// HarmoNova Phase 3 UI suite: commenting, replies, edits, deletes, and drafts,
// driven through the real Chromium extension against fully mocked Hacker News
// documents. Companion to tests/hn-auth.mjs (module flows) and tests/voting.mjs
// (voting UI); this file asserts the composer loop end to end: draft autosave
// and restore, the exact POST /comment payload, no-retry POSTs, native
// Hacker News edit/delete handoffs (without mutations), and trusted-click
// gating (SEC-30).
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");

const TOKEN_A = "0".repeat(40);
const TOKEN_B = "1".repeat(40);
const USER = "harmonova_test";

const STORY_ID = 50022292; // synthetic poll story used across the suites
const PLAIN_COMMENT = 50029143; // someone else's comment (reply target)
const VOTED_COMMENT = 50034061; // someone else's voted comment
const OWN_COMMENT = 50032063; // seeded as authored by the signed-in user

// The fixture reply form's hidden fields — the composer must POST exactly
// what HN's own form provided (never invented values).
const FORM_PARENT = "50033557";
const FORM_GOTO = "item%3Fid%3D50022292";

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Mocked Hacker News server (form documents + stateful vote flips)
// ---------------------------------------------------------------------------

function createHnMock() {
  const state = {
    loggedIn: true,
    errorScript: [],
    loginUsername: USER,
    votes: new Map(),
    postedText: null,
    deleted: false,
    editedText: null,
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
    let html = applyVotes(fixture("synthetic", "item-in.html"));
    if (state.postedText) {
      const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const row = '<tr class="athing comtr" id="990010"><td colspan="3"><span class="comhead"><a class="hnuser">' +
        USER + '</a></span><div class="commtext">' + escape(state.postedText) + '</div></td></tr>';
      html = html.replace('<table border="0" class="comment-tree"><tbody>', '<table border="0" class="comment-tree"><tbody>' + row);
    }
    if (state.editedText || state.deleted) {
      // A faithful HN item read-back for the comment being edited/deleted.
      const start = html.indexOf('<tr class="athing comtr" id="' + OWN_COMMENT + '">');
      const end = html.indexOf('<tr class="athing comtr"', start + 1);
      if (start >= 0) {
        const stop = end < 0 ? html.length : end;
        let row = html.slice(start, stop).replace('class="hnuser">FeepingCreature</a>', 'class="hnuser">' + USER + '</a>');
        const bodyStart = row.indexOf('<div class="commtext c00">');
        if (bodyStart >= 0) {
          const textStart = bodyStart + '<div class="commtext c00">'.length;
          const replyStart = row.indexOf('<div class="reply">', textStart);
          if (replyStart > textStart) {
            const originalEnd = row.lastIndexOf('</div>', replyStart);
            if (originalEnd > textStart) {
              const escaped = String(state.editedText || '[deleted]').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              row = row.slice(0, textStart) + escaped + row.slice(originalEnd);
            }
          }
        }
        html = html.slice(0, start) + row + html.slice(stop);
      }
    }
    return serveHtml(withUser(html));
  }

  function formDoc(name) {
    let html = state.loggedIn ? fixture("synthetic", name) : fixture("login.html");
    if (["edit-in.html", "delete-confirm-in.html"].includes(name))
      html = html.replaceAll("50033557", String(OWN_COMMENT));
    return serveHtml(withUser(html));
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
      case "/reply":
        return formDoc("reply-in.html");
      case "/edit":
        return formDoc("edit-in.html");
      case "/delete-confirm":
        return formDoc("delete-confirm-in.html");
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
        tooFast: "error-toofast.html",
        validationRequired: "error-validation.html",
        badLogin: "error-badlogin.html",
      };
      return route.fulfill(serveHtml(withUser(fixture("synthetic", map[error] || "error-expired.html"))));
    }

    // Comment POSTs: serve the redirect target's item document directly
    // (fulfilled 3xx responses are not re-intercepted by Playwright).
    if (method === "POST" && ["/comment", "/xedit", "/xdelete"].includes(pathname)) {
      if (pathname === "/comment") state.postedText = record.bodyParams?.text || null;
      if (pathname === "/xedit") state.editedText = record.bodyParams?.text || null;
      if (pathname === "/xdelete") state.deleted = true;
      return route.fulfill(itemDoc(STORY_ID));
    }
    if (pathname === "/vote") {
      const id = Number(parsed.searchParams.get("id"));
      const how = parsed.searchParams.get("how");
      if (how === "up") state.votes.set(id, { kind: "un", title: "unvote" });
      else if (how === "down") state.votes.set(id, { kind: "un", title: "downvote" });
      else if (how === "un") state.votes.set(id, { kind: "up", title: "upvote" });
      const goto = parsed.searchParams.get("goto") || ("item?id=" + id);
      const qIndex = goto.indexOf("?");
      let targetPath = qIndex === -1 ? goto : goto.slice(0, qIndex);
      if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;
      const targetSearch = qIndex === -1 ? "id=" + id : goto.slice(qIndex + 1);
      return route.fulfill(documentFor(targetPath, targetSearch));
    }
    if (pathname === "/logout") {
      return route.fulfill(serveHtml(fixture("news.html")));
    }
    return route.fulfill(documentFor(pathname, parsed.search));
  }

  return { state, requests, handle };
}

// Firebase + Algolia mocks. OWN_COMMENT is authored by the signed-in user so
// the Edit/Delete buttons render for it.
function createDataMocks() {
  const now = Math.floor(Date.now() / 1000);
  const story = {
    id: STORY_ID,
    type: "story",
    by: "submitter_0",
    title: "Mocked feed story " + STORY_ID,
    score: 55,
    time: now - 3600,
    descendants: 3,
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
          body: JSON.stringify(id === STORY_ID ? story : { id, type: "story", title: "Mocked story", score: 1, time: now, descendants: 0 }),
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
              { id: OWN_COMMENT, author: USER, created_at_i: now - 900, text: "My own seeded comment.", children: [] },
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

let harness;
let browser;

let passed = 0;
let failed = 0;
const failures = [];

const waitFor = async (fn, timeout = 30000, step = 150, label = "condition") => {
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
  const hnServer = await hnRedirectFixture(hn.handle);
  try {
    harness = await launchExtension({ destinations: new Map([['news.ycombinator.com:443', hnServer]]) });
    browser = harness.context;
    const dataMocks = createDataMocks();
    await browser.route("**/*", async (route) => {
      const parsed = new URL(route.request().url());
      if (parsed.hostname === "news.ycombinator.com") return hn.handle(route);
      if (["hacker-news.firebaseio.com", "hn.algolia.com"].includes(parsed.hostname)) return dataMocks(route);
      return route.fallback();
    });
    const page = await browser.newPage();
    await fn({ page, hn });
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
};

const openThread = async (page) => {
  await page.locator(".story-card").first().click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
};

const openThreadFully = async (page) => {
  await openThread(page);
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

// Read the background worker's draft store directly (chrome.storage.session).
const swDrafts = async () => {
  const worker = browser.serviceWorkers().find((sw) => sw.url().includes("background"));
  if (!worker) throw new Error("background service worker not running");
  return worker.evaluate(
    () => new Promise((resolve) => chrome.storage.session.get(["harmonovaDraftsV2"], (data) => resolve(data.harmonovaDraftsV2?.drafts || {})))
  );
};

const composer = (page) => page.locator(".composer");
const openStoryReply = async (page) => {
  await page.locator('.thread-actions .thread-action[aria-label="More"]').click();
  await page.locator('.harmonova-popup .popup-item', { hasText: "Reply to story" }).click();
  if (await page.locator(".composer").count()) {
    await page.waitForFunction(() => !document.querySelector(".composer-submit")?.disabled ||
      document.querySelector(".composer-status")?.classList.contains("error"), { timeout: 15000 });
  }
};
const openCommentAction = async (page, row, label) => {
  await row.locator(":scope > .comment-card").click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: label }).click();
};
const typeInto = async (page, text) => {
  const box = page.locator(".composer .composer-input");
  await box.click();
  await box.fill("");
  await box.type(text);
};

// ---------------------------------------------------------------------------
// Composer basics + posting
// ---------------------------------------------------------------------------

await test("Reply to post opens the composer; Ctrl+Enter posts HN's exact payload once", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  assert.equal(
    (await page.locator(".composer .composer-identity").textContent()).trim(),
    "Commenting on as " + USER,
    "composer names the acting account"
  );
  await typeInto(page, "Reply from HarmoNova");
  assert.equal(
    (await page.locator(".composer .composer-chars").textContent()).trim(),
    "20 characters",
    "char counter tracks input"
  );

  await page.locator(".composer .composer-input").press("Control+Enter");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/comment")), 20000, 150, "POST /comment");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/reply")).length, 0,
    "top-level comment uses the existing item form, not GET /reply");

  const posted = hn.requests.find((request) => request.path.startsWith("/comment"));
  assert.equal(posted.bodyParams.parent, String(STORY_ID), "parent comes from HN's item form");
  assert.equal(posted.bodyParams.goto, "item?id=" + STORY_ID, "goto comes from HN's item form");
  assert.equal(posted.bodyParams.hmac, TOKEN_B, "hmac comes from HN's item form");
  assert.equal(posted.bodyParams.text, "Reply from HarmoNova");

  await new Promise((resolve) => setTimeout(resolve, 1800)); // let the outcome land
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/comment")).length, 1, "SEC-34: the POST is never retried");
  assert.equal(await composer(page).count(), 0, "composer closes after success");
  const toast = await toastText(page);
  assert.ok(toast.includes("Reply posted"), "success toast: " + toast);
  assert.ok(await page.locator('.comment-row[data-comment-id="990010"].just-posted').count(),
    "confirmed comment appears immediately without reloading Algolia");
});

await test("empty submits are blocked locally without touching HN", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".composer .composer-submit").click();
  assert.ok(
    (await page.locator(".composer .composer-status").textContent()).includes("Write something first"),
    "local validation message"
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/comment")).length, 0, "empty text never sends a POST");
});

await test("preview toggle renders the draft text; Write returns to the textarea", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await typeInto(page, "Preview me");
  await page.locator(".composer .composer-secondary", { hasText: "Preview" }).first().click();
  const preview = page.locator(".composer .composer-preview");
  await preview.waitFor({ state: "visible", timeout: 5000 });
  assert.ok((await preview.textContent()).includes("Preview me"), "preview shows the typed text");
  await page.locator(".composer .composer-secondary", { hasText: "Write" }).first().click();
  assert.ok(await page.locator(".composer .composer-input").isVisible(), "Write toggles back to the textarea");
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

await test("drafts autosave into the background store, restore on reopen, and Discard wipes them", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await typeInto(page, "Persistent draft");
  await new Promise((resolve) => setTimeout(resolve, 1100)); // autosave debounce (500ms)
  const drafts = await swDrafts();
  const entry = Object.values(drafts).find((draft) => draft?.text === "Persistent draft");
  assert.ok(entry, "draft stored in chrome.storage.session: " + JSON.stringify(drafts));
  assert.equal(entry.username, USER, "draft keyed by acting username");

  await page.locator(".composer .composer-close").click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector(".composer .composer-status");
    return status && !status.hidden && status.textContent.includes("Draft restored");
  }, { timeout: 8000 });
  assert.equal(
    await page.locator(".composer .composer-input").inputValue(),
    "Persistent draft",
    "draft text restored"
  );

  await page.locator(".composer .composer-discard").click();
  const toast = await toastText(page);
  assert.ok(toast.includes("Draft discarded"), "discard toast: " + toast);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const afterDiscard = await swDrafts();
  assert.ok(!Object.values(afterDiscard).some((draft) => draft?.text === "Persistent draft"), "discard removes the stored draft");
});

await test("Esc closes the composer, keeps the draft, and toasts", async ({ page }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await typeInto(page, "Escape hatch draft");
  await page.locator(".composer .composer-input").press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await composer(page).count(), 0, "composer removed on Esc");
  const toast = await toastText(page);
  assert.ok(toast.includes("Draft saved"), "Esc toast: " + toast);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector(".composer .composer-status");
    return status && !status.hidden && status.textContent.includes("Draft restored");
  }, { timeout: 8000 });
});

await test("drafts are cleared on logout", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await typeInto(page, "Doomed draft");
  await waitFor(async () => Object.values(await swDrafts()).some(d => d?.text === "Doomed draft"), 20000, 150, "logout draft persisted");

  hn.state.loggedIn = false; // HN invalidates the session on logout
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator('.harmonova-popup .popup-item').first().click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Log out" }).click();
  await page.waitForFunction(
    () => document.querySelector("#harmonova-account-chip")?.textContent.trim() === "Log in",
    { timeout: 20000 }
  );
  let cleared = false;
  for (let i = 0; i < 60; i++) {
    if (Object.keys(await swDrafts()).length === 0) { cleared = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(cleared, "logout clears every draft (CLEAR_ALL)");
});

// ---------------------------------------------------------------------------
// Inline replies + failure paths
// ---------------------------------------------------------------------------

await test("inline reply on a comment opens under it and posts HN's form payload", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const row = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await openCommentAction(page, row, "Reply");
  await row.locator(".composer").waitFor({ state: "visible", timeout: 10000 });
  assert.ok(
    (await page.locator(".composer .composer-identity").textContent()).includes("Replying to"),
    "inline composer labels the reply target"
  );
  await typeInto(page, "Inline reply body");
  await page.waitForFunction(() => document.querySelector(".composer-submit")?.disabled === false
    || document.querySelector(".composer-status")?.classList.contains("error"), { timeout: 12000 });
  const statusBeforePost = await page.locator(".composer-status").textContent();
  if (await page.locator(".composer-submit").isDisabled()) throw new Error("Form unavailable: " + statusBeforePost);
  await page.locator(".composer .composer-input").press("Control+Enter");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/reply") && request.method === "GET"), 20000, 150, "GET /reply");
  assert.ok(hn.requests.find((request) => request.path.startsWith("/reply")).path.includes("id=" + PLAIN_COMMENT), "reply form opened for the comment id");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/comment")), 20000, 150, "POST /comment");
  const posted = hn.requests.find((request) => request.path.startsWith("/comment"));
  assert.equal(posted.bodyParams.parent, FORM_PARENT, "parent is whatever HN's form carried");
  assert.equal(posted.bodyParams.text, "Inline reply body");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(await composer(page).count(), 0, "composer closes after success");
});

await test("validationRequired on open keeps the draft and offers the HN escape hatch", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  hn.state.errorScript.push({ pathPattern: "/reply", classification: "validationRequired" });
  const row = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await openCommentAction(page, row, "Reply");
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector(".composer .composer-status");
    return status && !status.hidden && status.textContent.includes("asks for verification");
  }, { timeout: 20000 });
  await typeInto(page, "Kept while HN verifies");
  assert.ok(
    await page.locator(".composer .composer-hn-open").isVisible(),
    "'Open this reply on Hacker News' button appears"
  );
  assert.equal(await composer(page).count(), 1, "composer stays open");
  await waitFor(async () => Object.values(await swDrafts()).some(d => d?.text === "Kept while HN verifies"), 20000, 150, "verification draft persisted");
});

await test("tooFast on post keeps the draft and never retries the POST", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await typeInto(page, "Too fast draft");
  hn.state.errorScript.push({ pathPattern: "/comment", classification: "tooFast" });
  await page.locator(".composer .composer-input").press("Control+Enter");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/comment")), 20000, 150, "POST /comment");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/comment")).length, 1, "SEC-34: exactly one POST, no retry");
  const status = await page.locator(".composer .composer-status").textContent();
  assert.ok(status.toLowerCase().includes("too fast"), "too-fast message surfaced: " + status);
  assert.equal(await composer(page).count(), 1, "composer stays open so the user can retry");
  await page.locator(".composer .composer-input").press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 400));
  await openStoryReply(page);
  await composer(page).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector(".composer .composer-status");
    return status && !status.hidden && status.textContent.includes("Draft restored");
  }, { timeout: 8000 });
});

// ---------------------------------------------------------------------------
// Edit + delete (own comments only)
// ---------------------------------------------------------------------------

await test("Edit shows a not-supported prompt, then opens HN's native editor without posting", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const ownRow = page.locator('.comment-row[data-comment-id="' + OWN_COMMENT + '"]');
  const otherRow = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await otherRow.locator(":scope > .comment-card").click({ button: "right" });
  assert.equal(await page.locator('.harmonova-popup .popup-item', { hasText: 'Edit' }).count(), 0, "others have no edit action");
  assert.equal(await page.locator('.harmonova-popup .popup-item', { hasText: 'Delete' }).count(), 0, "others have no delete action");
  await page.mouse.click(3, 3);
  await page.locator(".harmonova-popup").waitFor({state:"hidden"});

  // The compact UI exposes Edit in the comment's right-click More menu.
  await openCommentAction(page, ownRow, "Edit");
  const prompt = page.locator('.harmonova-confirm-overlay');
  await prompt.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await prompt.textContent(), /Editing comments isn't supported in HarmoNova yet/);
  assert.match(await prompt.textContent(), /Nothing will be changed in HarmoNova/);
  await prompt.locator('.harmonova-confirm-cancel').click();
  assert.equal(await prompt.count(), 0, "Cancel closes the prompt");
  assert.equal(hn.requests.filter(r => /^\/(?:edit|xedit|r)(?:\?|$)/.test(r.path)).length, 0, "cancel sends no edit requests");

  await openCommentAction(page, ownRow, "Edit");
  await prompt.waitFor({ state: 'visible', timeout: 5000 });
  await prompt.locator('.harmonova-confirm-confirm').click();
  await waitFor(()=>browser.pages().some(p=>new URL(p.url()).pathname==='/edit'),30000,50,'committed native edit page');
  const native=browser.pages().find(p=>new URL(p.url()).pathname==='/edit');
  assert.equal(new URL(native.url()).searchParams.get('id'),String(OWN_COMMENT));
  assert.equal(await native.locator('#harmonova-app').count(), 0, "stock HN edit page is not replaced by HarmoNova");
  await native.locator('form[action="xedit"] textarea[name="text"]').waitFor();
  assert.equal(hn.requests.filter(r => r.method === 'POST').length, 0, "HarmoNova sends no edit POST");
  assert.equal(hn.state.editedText, null, "comment is unchanged locally");
  await native.close();
});

await test("Delete prompts for a native HN confirmation; cancel and handoff never delete in HarmoNova", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const ownRow = page.locator('.comment-row[data-comment-id="' + OWN_COMMENT + '"]');
  await openCommentAction(page, ownRow, "Delete");
  const prompt = page.locator('.harmonova-confirm-overlay');
  await prompt.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await prompt.textContent(), /Deleting comments isn't supported in HarmoNova yet/);
  assert.match(await prompt.textContent(), /Nothing will be deleted in HarmoNova/);
  await prompt.locator('.harmonova-confirm-cancel').click();
  assert.equal(hn.requests.filter(r => /\/(?:delete-confirm|xdelete|r)(?:\?|$)/.test(r.path)).length, 0, "Cancel sends no delete requests");

  await openCommentAction(page, ownRow, "Delete");
  await prompt.waitFor({ state: 'visible', timeout: 5000 });
  await prompt.locator('.harmonova-confirm-confirm').click();
  await waitFor(()=>browser.pages().some(p=>new URL(p.url()).pathname==='/delete-confirm'),30000,50,'committed native delete page');
  const native=browser.pages().find(p=>new URL(p.url()).pathname==='/delete-confirm');
  assert.equal(new URL(native.url()).searchParams.get('id'),String(OWN_COMMENT));
  assert.equal(new URL(native.url()).searchParams.get('goto'),'item?id='+STORY_ID);
  assert.equal(await native.locator('#harmonova-app').count(), 0, 'stock HN delete page is not replaced by HarmoNova');
  await native.getByText('Do you want to delete this comment?',{exact:false}).waitFor();
  assert.equal(hn.requests.filter(r => r.method === 'POST').length, 0, 'HarmoNova sends no delete POST');
  assert.equal(hn.state.deleted, false, 'comment has not been deleted');
  assert.equal(await page.locator('.comment-row[data-comment-id="' + OWN_COMMENT + '"]').count(), 1, 'comment remains on HarmoNova');
  await native.close();
});

// ---------------------------------------------------------------------------
// Safety rails
// ---------------------------------------------------------------------------

await test("untrusted scripted clicks never open the composer or hit /reply (SEC-30)", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await page.evaluate((ids) => {
    document.querySelector('.thread-actions button.thread-action[aria-label="More"]')?.click();
    document.querySelector('.comment-row[data-comment-id="' + ids[0] + '"] .comment-card')?.click();
    document.querySelector('.comment-row[data-comment-id="' + ids[1] + '"] .comment-card')?.click();
  }, [PLAIN_COMMENT, OWN_COMMENT]);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(await composer(page).count(), 0, "no composer opens from scripted clicks");
  assert.equal(await page.locator(".harmonova-confirm-overlay").count(), 0, "no delete dialog from scripted clicks");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/reply")).length, 0, "no /reply traffic");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/edit")).length, 0, "no /edit traffic");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/delete-confirm")).length, 0, "no /delete-confirm traffic");
});

await test("P04 open composer rejects page-world click, Ctrl/Cmd+Enter and discard", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await typeInto(page, "Preserved trusted draft");
  await waitFor(async () => Object.values(await swDrafts()).some(d => d?.text === "Preserved trusted draft"), 20000, 150, "trusted draft persisted");
  await page.evaluate(() => {
    const input = document.querySelector(".composer-input");
    input.value = "Page-world synthetic text";
    document.querySelector(".composer-submit").click();
    for (const modifier of ["ctrlKey", "metaKey"]) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", [modifier]: true, bubbles: true }));
    document.querySelector(".composer-discard").click();
  });
  await page.waitForTimeout(1200);
  assert.equal(hn.requests.filter(r => r.method === "POST").length, 0);
  assert.equal(await page.locator(".composer-input").inputValue(), "Page-world synthetic text");
  assert.ok(Object.values(await swDrafts()).some(d => d.text === "Preserved trusted draft"), "draft state: " + JSON.stringify(await swDrafts()));
  await typeInto(page, "Real trusted button text");
  await page.locator(".composer-submit").dblclick();
  await page.locator(".composer").waitFor({ state: "hidden", timeout: 15000 });
  const posts = hn.requests.filter(r => r.method === "POST" && r.path === "/comment");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].params.text, "Real trusted button text");
});

await test("P04 trusted Cmd+Enter submits exactly once", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await openStoryReply(page);
  await typeInto(page, "Trusted command keyboard");
  await page.locator(".composer-input").press("Meta+Enter");
  await page.locator(".composer").waitFor({ state: "hidden", timeout: 15000 });
  assert.equal(hn.requests.filter(r => r.method === "POST").length, 1);
});

await test("P13 worker termination during an ambiguous comment never replays the mutation",async({page})=>{
 await gotoFeed(page);await openThreadFully(page);await openStoryReply(page);
 let posts=0,held;
 await browser.route('https://news.ycombinator.com/comment',route=>{posts++;held=route;});
 await page.locator('.composer-input').fill('Synthetic draft survives worker restart');
 await page.locator('.composer-submit').click();
 await waitFor(()=>Boolean(held),10000,50,'single pending POST');
 const scriptURL=harness.worker.url();await stopExtensionWorker(browser,page,scriptURL);
 await held.abort();
 await page.waitForFunction(()=>document.querySelector('.composer-status')?.textContent.length>0);
 await page.reload();await page.locator('.story-card').first().waitFor();await openThreadFully(page);await openStoryReply(page);
 await page.waitForFunction(()=>document.querySelector('.composer-input')?.value==='Synthetic draft survives worker restart');
 assert.equal(posts,1,'restart/reload never sends another comment POST');
});

await test("signed out, replying asks for sign-in and opens no HN forms", async ({ page, hn }) => {
  hn.state.loggedIn = false;
  await gotoFeed(page);
  await page.goto("https://news.ycombinator.com/item?id=" + STORY_ID, { waitUntil: "domcontentloaded" });
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  assert.equal((await page.locator("#harmonova-account-chip").textContent()).trim(), "Log in");
  await openStoryReply(page);
  const toast = await toastText(page);
  assert.ok(toast.includes("Sign in to reply"), "sign-in toast: " + toast);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await composer(page).count(), 0, "no composer without a session");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/reply")).length, 0, "no /reply traffic signed out");
});


if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");