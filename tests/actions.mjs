import { hnRedirectFixture } from './helpers/network.mjs';
import { launchExtension } from './helpers/extension.mjs';
// HarmoNova Phase 4+5 UI suite: favorites, hide-with-undo, flag, bookmark bulk
// favorite (SEC-37), and the story-submission modal — driven through the real
// Chromium extension against fully mocked Hacker News documents. Companion to
// tests/comments.mjs (composer) and tests/voting.mjs (voting); this file
// asserts confirm-refetch favorites, undo toasts, confirmation-gated flagging
// (SEC-36), serial cancellable bulk actions, and the exact POST /r submit
// payload with every outcome branch.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");

const TOKEN_A = "0".repeat(40);
const TOKEN_B = "1".repeat(40);
const USER = "harmonova_test";
const FNID = "AbCdEf123456Zz";

const STORY_ID = 50022292;
const STORY_2 = 50022293;
const STORY_3 = 50022294;
const PLAIN_COMMENT = 50029143;
const VOTED_COMMENT = 50034061;
const OWN_COMMENT = 50032063;
const EXISTING_ITEM_ID = 770001;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Mocked Hacker News server: stateful votes + favorite/hide/flag anchors
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
    removeFavoriteLink: false,
    removeHideLink: false,
    commentFlag: false,
    submitMode: "success", // success | already | validation | tooFast
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

  // Reflect fave/hide/flag state on the story's subtext anchors, optionally
  // strip the links (availability gating), and inject a comment flag link.
  function applyActions(html) {
    const favHref = 'href="fave?id=' + STORY_ID + '&amp;auth=' + TOKEN_A + '"';
    if (state.removeFavoriteLink) {
      html = html.replace('<a ' + favHref + '>favorite</a>', "");
    } else if (state.favorites.has(STORY_ID)) {
      html = html.replace(favHref, favHref.slice(0, -2) + '&amp;un=t"');
    }
    const hideHref = 'href="hide?id=' + STORY_ID + '&amp;auth=' + TOKEN_B + '&amp;goto=item%3Fid%3D' + STORY_ID + '"';
    if (state.removeHideLink) {
      html = html.replace('<a ' + hideHref + '>hide</a>', "");
    } else if (state.hidden.has(STORY_ID)) {
      html = html.replace(hideHref, hideHref.slice(0, -2) + '&amp;un=t"');
    }
    const flagHref = 'href="flag?id=' + STORY_ID + '&amp;auth=' + TOKEN_B + '"';
    if (state.flagged.has(STORY_ID)) {
      html = html.replace(flagHref, flagHref.slice(0, -2) + '&amp;un=t"');
    }
    if (state.commentFlag) {
      const commentFave = new RegExp('<a href="fave\\?id=' + PLAIN_COMMENT + '[^"]*">favorite</a>');
      if (commentFave.test(html)) {
        html = html.replace(
          commentFave,
          (match) => match + ' <a href="flag?id=' + PLAIN_COMMENT + '&amp;auth=' + TOKEN_A + '">flag</a>'
        );
      }
    }
    return html;
  }

  // Extra story-action anchors for the non-first stories so favorite/hide/
  // flag can be exercised against any item document.
  function extraStoryAnchors(id) {
    if (!Number.isInteger(id) || id === STORY_ID) return "";
    const part = (kind, auth) =>
      '<a href="' + kind + '?id=' + id + '&amp;auth=' + auth + '&amp;goto=item%3Fid%3D' + id +
      (kind === "fave" && state.favorites.has(id) ? '&amp;un=t' : "") +
      (kind === "hide" && state.hidden.has(id) ? '&amp;un=t' : "") +
      (kind === "flag" && state.flagged.has(id) ? '&amp;un=t' : "") +
      '">' + (kind === "fave" ? "favorite" : kind) + '</a>';
    return part("fave", TOKEN_A) + " " + part("hide", TOKEN_B) + " " + part("flag", TOKEN_B);
  }

  function itemDoc(id) {
    let html = fixture("synthetic", "item-in.html");
    const extra = extraStoryAnchors(id);
    if (extra) html = html.replace('"votelinks"><center>', '"votelinks"><center>' + extra);
    return serveHtml(withUser(applyActions(applyVotes(html))));
  }

  function documentFor(pathname, search) {
    const params = new URLSearchParams(search);
    switch (pathname) {
      case "/news":
      case "/":
      case "/newest":
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html")));
      case "/item":
        return state.loggedIn ? itemDoc(Number(params.get("id"))) : serveHtml(fixture("synthetic", "item-out.html"));
      case "/login":
        return serveHtml(fixture("login.html"));
      case "/reply":
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "reply-in.html") : fixture("login.html")));
      case "/submit":
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "submit-in.html") : fixture("login.html")));
      default:
        return serveHtml(withUser(state.loggedIn ? fixture("synthetic", "news-in.html") : fixture("news.html")));
    }
  }

  async function handle(route) {
    const request = route.request();
    const parsed = new URL(request.url());
    const pathname = parsed.pathname;
    const method = request.method();
    const record = {
      method,
      path: pathname + parsed.search,
      params: Object.fromEntries(parsed.searchParams),
      postData: null,
      t: Date.now(),
    };
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

    // Token mutations: record the toggle, then serve the redirect target's
    // document directly (fulfilled 3xx responses are not re-intercepted).
    if (pathname === "/fave" || pathname === "/hide" || pathname === "/flag") {
      const id = Number(parsed.searchParams.get("id"));
      const isUn = parsed.searchParams.get("un") === "t";
      if (pathname === "/fave") {
        if (isUn) state.favorites.delete(id);
        else state.favorites.add(id);
        return route.fulfill(itemDoc(id));
      }
      if (pathname === "/hide") {
        if (isUn) state.hidden.delete(id);
        else state.hidden.add(id);
        return route.fulfill(documentFor("/news", ""));
      }
      // /flag
      if (isUn) state.flagged.delete(id);
      else state.flagged.add(id);
      return route.fulfill(itemDoc(id));
    }
    if (pathname === "/r" && method === "POST") {
      if (state.submitMode === "already") {
        // HN's "already submitted" redirect lands on the existing item page.
        return route.fulfill({
          status: 302,
          contentType: "text/html; charset=utf-8",
          headers: { Location: "https://news.ycombinator.com/item?id=" + EXISTING_ITEM_ID },
          body: "",
        });
      }
      return route.fulfill(documentFor("/newest", ""));
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

// Firebase + Algolia mocks with three feed stories (bulk-favorite test).
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
    [STORY_2]: { id: STORY_2, type: "story", by: "alice_2", title: "Second mocked story", score: 20, time: now - 3000, descendants: 1 },
    [STORY_3]: { id: STORY_3, type: "story", by: "bob_3", title: "Third mocked story", score: 9, time: now - 2000, descendants: 0 },
  };
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
    let timer;
    try {await Promise.race([fn({page,hn}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Offline action case exceeded 120 seconds")),120000);})]);}
    finally {clearTimeout(timer);}
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

const openThreadFully = async (page) => {
  await page.locator('.story-card[data-story-id="' + STORY_ID + '"]').click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(
    id => document.querySelector('.comment-row[data-comment-id="' + id + '"] [data-comment-vote-mark]')?.hidden === false,
    VOTED_COMMENT, { timeout: 20000 }
  );
};

const storyMenuAction = async (page, label) => {
  await page.locator('.thread-actions button.thread-action[aria-label="More"]').click();
  await page.locator('.harmonova-popup .popup-item', { hasText: label }).click();
};
const newPost = async (page) => {
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator('.harmonova-popup .popup-item', { hasText: "New post" }).click();
};
const toastText = async (page) =>
  page.waitForFunction(() => {
    const toast = document.querySelector(".harmonova-toast");
    return toast?.classList.contains("show") ? toast.textContent : null;
  }, { timeout: 15000 }).then((handle) => handle.jsonValue());

// ---------------------------------------------------------------------------
// Phase 4: favorite, hide, flag
// ---------------------------------------------------------------------------

await test("favorite toggles through HN's token with a confirmation re-fetch", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await storyMenuAction(page, "Favorite");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/fave")), 20000, 150, "GET /fave");
  const fave = hn.requests.find((request) => request.path.startsWith("/fave"));
  assert.equal(fave.params.id, String(STORY_ID));
  assert.equal(fave.params.auth, TOKEN_A, "favorite token harvested from the item document");
  assert.notEqual(fave.params.un, "t", "first favorite sends no un=t");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const itemFetches = hn.requests.filter((request) => request.path.startsWith("/item")).length;
  assert.ok(itemFetches >= 2, "confirmRefetch re-reads the item document after the favorite");
  await page.locator('.thread-actions button.thread-action[aria-label="More"]').click();
  assert.ok(await page.locator('.harmonova-popup .popup-item', { hasText: "Unfavorite" }).count(), "menu reflects favorite state");
  const toast = await toastText(page);
  assert.ok(toast.includes("Favorited"), "favorite toast: " + toast);

  await page.locator('.harmonova-popup .popup-item', { hasText: "Unfavorite" }).click();
  await waitFor(() => hn.requests.filter((request) => request.path.startsWith("/fave")).length >= 2, 20000, 150, "unfavorite");
  const unfave = hn.requests.filter((request) => request.path.startsWith("/fave"))[1];
  assert.equal(unfave.params.un, "t", "unfavorite sends un=t");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await page.locator('.thread-actions button.thread-action[aria-label="More"]').click();
  assert.ok(await page.locator('.harmonova-popup .popup-item', { hasText: "Favorite" }).count(), "menu reverts to favorite");
  const toast2 = await toastText(page);
  assert.ok(toast2.includes("Removed from favorites"), "unfavorite toast: " + toast2);
});

await test("favorite star is disabled when the item document offers no favorite link", async ({ page, hn }) => {
  hn.state.removeFavoriteLink = true;
  await gotoFeed(page);
  await openThreadFully(page);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-thread-favorite]");
    return button && !button.hidden && button.disabled;
  }, { timeout: 10000 });
});

await test("hide from the thread offers undo; undo unhides with un=t", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await storyMenuAction(page, "Hide");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/hide")), 20000, 150, "GET /hide");
  const hide = hn.requests.find((request) => request.path.startsWith("/hide"));
  assert.equal(hide.params.id, String(STORY_ID));
  assert.equal(hide.params.auth, TOKEN_B);
  assert.notEqual(hide.params.un, "t", "hide sends no un=t");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const toast = await toastText(page);
  assert.ok(toast.includes("Story hidden"), "hide toast: " + toast);
  const undoButton = page.locator(".harmonova-toast .harmonova-toast-action", { hasText: "Undo" });
  await undoButton.waitFor({ state: "visible", timeout: 5000 });
  await undoButton.click();
  await waitFor(() => hn.requests.filter((request) => request.path.startsWith("/hide")).length >= 2, 20000, 150, "unhide");
  const unhide = hn.requests.filter((request) => request.path.startsWith("/hide"))[1];
  assert.equal(unhide.params.un, "t", "undo sends un=t");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const toast2 = await toastText(page);
  assert.ok(toast2.includes("Story unhidden"), "undo toast: " + toast2);
});

await test("hide control is hidden when the item document offers no hide link", async ({ page, hn }) => {
  hn.state.removeHideLink = true;
  await gotoFeed(page);
  await openThreadFully(page);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-thread-hide]");
    return button && button.hidden;
  }, { timeout: 10000 });
});

await test("card menu hide removes the card and undo restores it", async ({ page, hn }) => {
  await gotoFeed(page);
  const card = page.locator('.story-card[data-story-id="' + STORY_2 + '"]');
  await card.click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Hide story" }).click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/hide")), 25000, 200, "card hide request");
  const hide = hn.requests.find((request) => request.path.startsWith("/hide"));
  assert.equal(hide.params.id, String(STORY_2));
  await page.waitForFunction(
    (id) => document.querySelector('.story-card[data-story-id="' + id + '"]')?.classList.contains("is-hidden"),
    STORY_2,
    { timeout: 10000 }
  );
  const undoButton = page.locator(".harmonova-toast .harmonova-toast-action", { hasText: "Undo" });
  await undoButton.waitFor({ state: "visible", timeout: 5000 });
  await undoButton.click();
  await waitFor(() => hn.requests.filter((request) => request.path.startsWith("/hide")).length >= 2, 25000, 200, "unhide");
  await page.waitForFunction(
    (id) => !document.querySelector('.story-card[data-story-id="' + id + '"]')?.classList.contains("is-hidden"),
    STORY_2,
    { timeout: 10000 }
  );
});

await test("flag story requires confirmation: cancel sends nothing, confirm flags once", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await page.locator(".thread-actions button.thread-action[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Flag story" }).click();
  await page.locator(".harmonova-confirm-overlay").waitFor({ state: "visible", timeout: 5000 });
  assert.ok(
    (await page.locator(".harmonova-confirm h3").textContent()).includes("Flag this story?"),
    "dialog names the action"
  );
  await page.locator(".harmonova-confirm-cancel").click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/flag")).length, 0, "SEC-36: cancel sends nothing");

  await page.locator(".thread-actions button.thread-action[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Flag story" }).click();
  await page.locator(".harmonova-confirm-overlay").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".harmonova-confirm-confirm").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/flag")), 20000, 150, "GET /flag");
  const flag = hn.requests.find((request) => request.path.startsWith("/flag"));
  assert.equal(flag.params.id, String(STORY_ID));
  assert.equal(flag.params.auth, TOKEN_B);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const toast = await toastText(page);
  assert.ok(toast.includes("Story flagged"), "flag toast: " + toast);
});

await test("comment flag appears only when HN offers the link and cancels safely", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  const row = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await row.locator(":scope > .comment-card").click({ button: "right" });
  assert.equal(
    await page.locator(".harmonova-popup .popup-item", { hasText: "Flag comment" }).count(),
    0,
    "no flag entry when the document offers no flag link"
  );

  hn.state.commentFlag = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await openThreadFully(page);
  // Wait for the on-demand item-state fetch (600ms after open) to land, then
  // settle so applyItemState has run before the menu is inspected.
  await waitFor(() => hn.requests.some((request) => request.path === "/item?id=" + STORY_ID), 20000, 200, "item state fetch");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const row2 = page.locator('.comment-row[data-comment-id="' + PLAIN_COMMENT + '"]');
  await row2.locator(":scope > .comment-card").click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "Flag comment" }).click();
  await page.locator(".harmonova-confirm-overlay").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".harmonova-confirm-cancel").click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/flag")).length, 0, "SEC-36: comment flag cancel sends nothing");
});

// ---------------------------------------------------------------------------
// SEC-37: bookmarks → favorites bulk
// ---------------------------------------------------------------------------

await test("bookmarks bulk-favorite runs serially with progress and is cancellable", async ({ page, hn }) => {
  await gotoFeed(page);
  // Bookmark all three feed stories via their card menus.
  for (const id of [STORY_ID, STORY_2, STORY_3]) {
    const card = page.locator('.story-card[data-story-id="' + id + '"]');
    await card.click({ button: "right" });
    await page.locator(".harmonova-popup .popup-item", { hasText: "Bookmark" }).click();
  }
  await page.locator(".feed-toolbar-actions .icon-button[aria-label='More']").click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Add bookmarks to HN favorites" }).click();
  await page.locator(".harmonova-confirm-overlay").waitFor({ state: "visible", timeout: 5000 });
  const dialogMessage = await page.locator(".harmonova-confirm-message").textContent();
  assert.ok(dialogMessage.includes("3 bookmarked stories"), "dialog counts the bookmarks: " + dialogMessage);
  await page.locator(".harmonova-confirm-confirm").click();
  await waitFor(() => hn.requests.filter((request) => request.path.startsWith("/fave")).length >= 1, 30000, 200, "first bulk favorite");

  // Cancel during the second item's in-flight window.
  const cancelButton = page.locator(".harmonova-toast .harmonova-toast-action", { hasText: "Cancel" });
  await cancelButton.waitFor({ state: "visible", timeout: 5000 });
  await cancelButton.click();
  const toast = await toastText(page);
  assert.ok(toast.includes("cancelled"), "cancel toast: " + toast);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const faveCount = hn.requests.filter((request) => request.path.startsWith("/fave")).length;
  assert.ok(faveCount >= 1 && faveCount <= 2, "cancellation stops the bulk run early (sent " + faveCount + " of 3)");
  const faves = hn.requests.filter((request) => request.path.startsWith("/fave"));
  for (let i = 1; i < faves.length; i++) {
    assert.ok(faves[i].t - faves[i - 1].t >= 600, "SEC-37: bulk favorites are serially spaced (gap " + (faves[i].t - faves[i - 1].t) + "ms)");
  }
});

// ---------------------------------------------------------------------------
// Phase 5: submit modal
// ---------------------------------------------------------------------------

await test("New post sends the exact /r payload once and preserves data if redirect is unconfirmed", async ({ page, hn }) => {
  await gotoFeed(page);
  await newPost(page);
  const modal = page.locator(".harmonova-submit");
  await modal.waitFor({ state: "visible", timeout: 5000 });
  assert.ok((await page.locator(".submit-as").textContent()).includes(USER), "modal names the acting account");
  await page.locator(".submit-title").fill("HarmoNova submits a story");
  await page.locator(".submit-url").fill("https://example.com/harmonova");
  assert.equal((await page.locator(".submit-count").textContent()).trim(), "25/80", "title counter tracks input");
  await page.locator(".submit-go").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/submit") && request.method === "GET"), 20000, 150, "GET /submit");
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/r")), 20000, 150, "POST /r");
  const posted = hn.requests.find((request) => request.path.startsWith("/r"));
  assert.equal(posted.bodyParams.fnid, FNID, "fnid comes from HN's own submit form");
  assert.equal(posted.bodyParams.fnop, "submit-page");
  assert.equal(posted.bodyParams.title, "HarmoNova submits a story");
  assert.equal(posted.bodyParams.url, "https://example.com/harmonova");
  // Verification makes bounded GET reads against the author's submitted list,
  // so wait until the final outcome rather than observing the in-flight status.
  await page.waitForFunction(() => /has not confirmed|has not shown|did not confirm/i.test(
    document.querySelector('.submit-status')?.textContent || ''), null, { timeout: 16000 });
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/r")).length, 1, "SEC-34: submit never retried");
  // The offline mock serves /newest HTML directly at /r rather than a real
  // redirect; without a new submission ID the app must keep the form open.
  assert.equal(await modal.count(), 1, "unconfirmed response keeps submission form");
  const status = await page.locator(".submit-status").textContent();
  assert.match(status, /has not confirmed|has not shown|did not confirm/i, "ambiguous response is not reported as success: " + status);
  assert.equal(await page.locator(".submit-title").inputValue(), "HarmoNova submits a story", "title kept");
  assert.equal(await page.locator(".submit-hn-open").count(), 2, "unconfirmed post offers native submit and submissions links");
});

await test("submit validation refuses empty posts and unsafe URLs locally", async ({ page, hn }) => {
  await gotoFeed(page);
  await newPost(page);
  await page.locator(".harmonova-submit").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".submit-title").fill("Only a title");
  await page.locator(".submit-go").click();
  assert.ok((await page.locator(".submit-status").textContent()).includes("Add a URL or some text"), "URL/text validation");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/submit")).length, 0, "no HN traffic for invalid input");

  await page.locator(".submit-url").fill("javascript:alert(1)");
  await page.locator(".submit-go").click();
  assert.ok((await page.locator(".submit-status").textContent()).includes("not allowed"), "safeHref validation");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/submit")).length, 0, "no HN traffic for unsafe URL");
});

await test("already-submitted redirect opens the existing discussion", async ({ page, hn }) => {
  hn.state.submitMode = "already";
  await gotoFeed(page);
  await newPost(page);
  await page.locator(".harmonova-submit").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".submit-title").fill("A duplicate story");
  await page.locator(".submit-url").fill("https://example.com/dup");
  await page.locator(".submit-go").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/r")), 20000, 150, "POST /r");
  const toast = await toastText(page);
  assert.ok(toast.toLowerCase().includes("already"), "already-submitted toast: " + toast);
  // The existing discussion (770001) opens in HarmoNova: its on-demand item
  // state fetch fires and the thread header re-renders.
  await waitFor(
    () => hn.requests.some((request) => request.path === "/item?id=" + EXISTING_ITEM_ID),
    25000,
    200,
    "GET /item?id=770001 for the existing discussion"
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await page.locator("[data-thread-vote]").count(), 1, "existing discussion opens in HarmoNova");
});

await test("validationRequired on POST keeps the values and hands off to HN's stock form", async ({ page, hn }) => {
  hn.state.errorScript.push({ pathPattern: "/r", classification: "validationRequired" });
  await gotoFeed(page);
  await newPost(page);
  await page.locator(".harmonova-submit").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".submit-title").fill("Verification wall story");
  await page.locator(".submit-url").fill("https://example.com/verify");
  await page.locator(".submit-go").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/r")), 20000, 150, "POST /r");
  await page.locator(".submit-hn-open").waitFor({ state: "visible", timeout: 10000 });
  assert.equal((await page.locator(".submit-title").inputValue()), "Verification wall story", "values kept");
  // HN's stock form opens in a new original-mode tab (never auto-filled).
  await page.locator(".submit-hn-open").click();
  // Find the committed HN page, rather than racing the first blank target
  // event during Chromium's popup initialization.
  await waitFor(()=>browser.pages().some(p=>p!==page && p.url().startsWith("https://news.ycombinator.com/submit")),20000,50,"native submit navigation");
  const hnTab=browser.pages().find(p=>p!==page && p.url().startsWith("https://news.ycombinator.com/submit"));
  // A native HN handoff succeeds once navigation commits; the public login
  // page may stall during network load on CI or in a headless browser.
  assert.ok(hnTab.url().startsWith("https://news.ycombinator.com/submit"), "stock HN submit form opens (never auto-filled)");
  await hnTab.close();
});

await test("too-fast submit keeps the modal and never retries", async ({ page, hn }) => {
  hn.state.errorScript.push({ pathPattern: "/r", classification: "tooFast" });
  await gotoFeed(page);
  await newPost(page);
  await page.locator(".harmonova-submit").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".submit-title").fill("Too fast story");
  await page.locator(".submit-url").fill("https://example.com/fast");
  await page.locator(".submit-go").click();
  await waitFor(() => hn.requests.some((request) => request.path.startsWith("/r")), 20000, 150, "POST /r");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/r")).length, 1, "SEC-34: exactly one POST");
  assert.ok(
    (await page.locator(".submit-status").textContent()).toLowerCase().includes("too fast"),
    "too-fast message surfaced in the modal"
  );
  assert.equal((await page.locator(".submit-title").inputValue()), "Too fast story", "values kept");
  assert.equal(await page.locator(".harmonova-submit").count(), 1, "modal stays open");
});

await test("untrusted scripted clicks never favorite, hide, flag, or open submit", async ({ page, hn }) => {
  await gotoFeed(page);
  await openThreadFully(page);
  await page.evaluate(() => {
    document.querySelector("[data-thread-favorite]")?.click();
    document.querySelector("[data-thread-hide]")?.click();
    document.querySelector(".feed-toolbar-actions .icon-button[aria-label='New post']")?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/fave")).length, 0, "no /fave traffic");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/hide")).length, 0, "no /hide traffic");
  assert.equal(hn.requests.filter((request) => request.path.startsWith("/submit")).length, 0, "no /submit traffic");
  assert.equal(await page.locator(".harmonova-submit").count(), 0, "no submit modal from scripted clicks");
});


if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");