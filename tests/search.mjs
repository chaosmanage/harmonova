// HarmoNova site-wide search suite (Phase S).
// Part 1: hn-search.js unit tests in a Node vm (query construction, hit
//         validation, SEC-40 highlight tokenization, paging, errors, aborts).
// Part 2: browser end-to-end tests with a fully mocked Algolia API.
import { launchExtension } from "./helpers/extension.mjs";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);
const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Part 1 — unit tests
// ---------------------------------------------------------------------------

const unitCalls = [];
let unitResponder = null; // (url, options) => ({ ok, status, json })
let unitDeferred = null; // { resolve, reject, url }

function makeVm() {
  const context = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    AbortController,AbortSignal,TextEncoder,TextDecoder,Response,ReadableStream,
    fetch: (url, options) => {
      unitCalls.push({ url, options });
      if (unitDeferred) {
        return new Promise((resolve, reject) => {
          unitDeferred.resolve = (value) => resolve(value);
          unitDeferred.reject = (error) => reject(error);
          unitDeferred.url = url;
        });
      }
      const payload = unitResponder ? unitResponder(url, options) : { ok: false, status: 500 };
      return Promise.resolve(new Response(payload.jsonThrows ? 'not json' : JSON.stringify(payload.json ?? null),{
        status:payload.status??500,headers:{'content-type':'application/json'},
      }));
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  for(const file of ["resource-policy.js","lifecycle.js","hn-search.js"])vm.runInContext(fs.readFileSync(path.join(repoRoot,"src",file),"utf8"),context);
  return context;
}

const runUnit = (name, fn) => {
  try {
    fn();
    passedUnit++;
    console.log("ok -", name);
  } catch (error) {
    failedUnit++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  }
};

let passedUnit = 0;
let failedUnit = 0;
const failures = [];

const context = makeVm();
const HarmoNovaSearch = context.HarmoNovaSearch;
assert.ok(HarmoNovaSearch, "hn-search.js exposes HarmoNovaSearch");

runUnit("buildSearchUrl: full options produce the exact /search URL", () => {
  const built = HarmoNovaSearch.buildSearchUrl({
    query: "  sqlite wal  ",
    tags: ["story", "author_pg"],
    since: 1700000000,
    minPoints: 25,
    sort: "relevance",
    page: 0,
    hitsPerPage: 30,
  });
  assert.equal(built.error, undefined);
  const parsed = new URL(built.url);
  assert.equal(parsed.origin + parsed.pathname, "https://hn.algolia.com/api/v1/search");
  assert.equal(parsed.searchParams.get("query"), "sqlite wal");
  assert.equal(parsed.searchParams.get("tags"), "story,author_pg");
  assert.equal(parsed.searchParams.get("numericFilters"), "created_at_i>1700000000,points>=25");
  assert.equal(parsed.searchParams.get("page"), "0");
  assert.equal(parsed.searchParams.get("hitsPerPage"), "30");
});

runUnit("buildSearchUrl: newest sort uses /search_by_date", () => {
  const built = HarmoNovaSearch.buildSearchUrl({ query: "x", sort: "newest" });
  assert.ok(built.url.includes("/search_by_date?"));
});

runUnit("buildSearchUrl: query is trimmed and capped at 200 chars", () => {
  const built = HarmoNovaSearch.buildSearchUrl({ query: "  " + "x".repeat(300) + "  " });
  const parsed = new URL(built.url);
  assert.equal(parsed.searchParams.get("query"), "x".repeat(200));
});

runUnit("buildSearchUrl: empty query is an error", () => {
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "   " }).error);
});

runUnit("buildSearchUrl: hostile tags are rejected", () => {
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", tags: ["story;drop"] }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", tags: ["author_bad name!"] }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", tags: ["author_" + "a".repeat(40)] }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", tags: [["story"]] }).error);
  // Valid author names pass.
  assert.ok(!HarmoNovaSearch.buildSearchUrl({ query: "x", tags: ["author_pg"] }).error);
});

runUnit("buildSearchUrl: numeric filters accept integers only", () => {
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", since: 1.5 }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", since: "10" }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", minPoints: 2.5 }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", minPoints: -1 }).error);
  assert.ok(!HarmoNovaSearch.buildSearchUrl({ query: "x", minPoints: 0 }).error);
});

runUnit("buildSearchUrl: hitsPerPage is capped at 50 and pages bounded", () => {
  const capped = new URL(HarmoNovaSearch.buildSearchUrl({ query: "x", hitsPerPage: 500 }).url);
  assert.equal(capped.searchParams.get("hitsPerPage"), "50");
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", page: -1 }).error);
  assert.ok(HarmoNovaSearch.buildSearchUrl({ query: "x", page: 1.5 }).error);
});

runUnit("validateHit: story and comment hits map to safe shapes", () => {
  const story = HarmoNovaSearch.validateHit({
    objectID: "42", title: "A story", url: "https://example.test/a", author: "pg",
    points: 100, num_comments: 7, created_at_i: 1700000000,
  });
  // JSON round-trip: values cross the vm realm, so compare structurally.
  assert.deepEqual(JSON.parse(JSON.stringify(story)), {
    id: 42, kind: "story", title: "A story", url: "https://example.test/a",
    author: "pg", points: 100, numComments: 7, created_at_i: 1700000000,
  });
  const modernStory = HarmoNovaSearch.validateHit({
    objectID: "27016630", story_id: 27016630, _tags: ["story", "author_pg"],
    title: "SQLite WAL", author: "pg", comment_text: null, points: 42,
  });
  assert.equal(modernStory.kind, "story", "Algolia story_id must not turn stories into comments");
  const comment = HarmoNovaSearch.validateHit({
    objectID: "99", author: "pg", story_id: 42, story_title: "A story",
    comment_text: "hello", points: 5, created_at_i: 1700000001,
  });
  assert.equal(comment.kind, "comment");
  assert.equal(comment.story_id, 42);
  assert.equal(comment.commentText, "hello");
});

runUnit("validateHit: malformed hits are dropped", () => {
  assert.equal(HarmoNovaSearch.validateHit(null), null);
  assert.equal(HarmoNovaSearch.validateHit("nope"), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "abc" }), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "-4" }), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "4.5" }), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "4", points: "12" }), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "4", title: 9 }), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "4", author: ["pg"] }), null);
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "4", story_id: "42" }), null, "story_id must be a number");
  assert.equal(HarmoNovaSearch.validateHit({ objectID: "4", comment_text: "x" }), null, "comment without story_id is dropped");
  // Absent fields become null/defaults instead of dropping the hit.
  const sparse = HarmoNovaSearch.validateHit({ objectID: "7" });
  assert.equal(sparse.kind, "story");
  assert.equal(sparse.title, null);
  assert.equal(sparse.author, null);
});

runUnit("validateHit: keeps SEC-40 highlight strings verbatim", () => {
  const hit = HarmoNovaSearch.validateHit({
    objectID: "9", story_id: 8, comment_text: "plain",
    _highlightResult: { comment_text: { value: "<em>hi</em> <img onerror=alert(1) src=x>" } },
  });
  assert.equal(hit.highlight, "<em>hi</em> <img onerror=alert(1) src=x>");
});

const runAsyncUnit = async (name, fn) => {
  try {
    await fn();
    passedUnit++;
    console.log("ok -", name);
  } catch (error) {
    failedUnit++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  }
};

await runAsyncUnit("runSearch: validates payloads and respects nbPages", async () => {
  unitCalls.length = 0;
  unitResponder = () => ({
    ok: true,
    status: 200,
    json: { hits: [{ objectID: "1", title: "one" }, { objectID: "bad" }, { objectID: "2", title: 5 }], page: 0, nbPages: 4 },
  });
  const result = await HarmoNovaSearch.runSearch({ query: "test" });
  assert.equal(result.error, undefined);
  assert.equal(result.hits.length, 1, "malformed hits are dropped");
  assert.equal(result.nbPages, 4);
  assert.ok(unitCalls[0].url.startsWith("https://hn.algolia.com/api/v1/search?"));
});

runUnit("runSearch (sync paths): non-array hits is malformed", () => {
  unitResponder = () => ({ ok: true, status: 200, json: { hits: "nope" } });
  // runSearch is async; assert via the returned promise handled below.
});

await runAsyncUnit("runSearch: non-array hits and non-JSON bodies are errors", async () => {
  unitResponder = () => ({ ok: true, status: 200, json: { hits: "nope" } });
  assert.ok((await HarmoNovaSearch.runSearch({ query: "x" })).error, "string hits is an error");
  unitResponder = () => ({ ok: true, status: 200, json: { hits: null } });
  assert.ok((await HarmoNovaSearch.runSearch({ query: "x" })).error, "null hits is an error");
  unitResponder = () => ({ ok: true, status: 200, jsonThrows: true });
  assert.ok((await HarmoNovaSearch.runSearch({ query: "x" })).error, "invalid JSON is an error");
  unitResponder = () => ({ ok: true, status: 200, json: null });
  assert.ok((await HarmoNovaSearch.runSearch({ query: "x" })).error, "null payload is an error");
});

await runAsyncUnit("runSearch: HTTP errors and network failures are reported", async () => {
  unitResponder = () => ({ ok: false, status: 503 });
  const failed = await HarmoNovaSearch.runSearch({ query: "x" });
  assert.ok(failed.error.includes("503"));
});

await runAsyncUnit("runSearch: aborted requests report aborted, not error", async () => {
  unitCalls.length = 0;
  unitDeferred = {};
  const controller = new AbortController();
  const promise = HarmoNovaSearch.runSearch({ query: "x" }, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  unitDeferred.reject(new Error("The operation was aborted"));
  const result = await promise;
  assert.equal(result.aborted, true);
  assert.equal(result.error, undefined);
});

// ---------------------------------------------------------------------------
// Part 2 — browser tests with a mocked Algolia
// ---------------------------------------------------------------------------

const STORY_HITS_PAGE_0 = {
  hits: [
    { objectID: "880001", title: "Alpha story about databases", url: "https://example.test/a1", author: "pg", points: 120, num_comments: 44, created_at_i: Math.floor(Date.now() / 1000) - 3600 },
    { objectID: "880002", title: "Beta story about wasm", url: "https://example.test/a2", author: "jmp", points: 60, num_comments: 12, created_at_i: Math.floor(Date.now() / 1000) - 7200 },
    { objectID: "not-a-number", title: "malformed", author: "x", points: 1, num_comments: 1, created_at_i: 1 },
  ],
  page: 0,
  nbPages: 2,
};
const STORY_HITS_PAGE_1 = {
  hits: [
    { objectID: "880003", title: "Gamma story on page two", url: "https://example.test/a3", author: "pg", points: 30, num_comments: 3, created_at_i: Math.floor(Date.now() / 1000) - 10800 },
  ],
  page: 1,
  nbPages: 2,
};
const COMMENT_HIT = {
  hits: [
    {
      objectID: "990001", author: "dang", story_id: 880001, story_title: "Alpha story about databases",
      comment_text: "The interesting part is the write-ahead log design.",
      points: 4, created_at_i: Math.floor(Date.now() / 1000) - 600,
      _highlightResult: {
        comment_text: { value: "The interesting part is the <em>write-ahead log</em> design. <img onerror=alert(1) src=x> <script>alert(2)</script>" },
        story_title: { value: "Alpha story about <em>databases</em>" },
      },
    },
  ],
  page: 0,
  nbPages: 1,
};
const THREAD_CHILDREN = [
  { id: 990001, author: "dang", created_at_i: Math.floor(Date.now() / 1000) - 600, text: "The interesting part is the write-ahead log design.", children: [] },
];

let passedBrowser = 0;
let failedBrowser = 0;

function createAlgoliaMock() {
  const requests = [];
  const handler = async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.pathname.endsWith("/search") || parsed.pathname.endsWith("/search_by_date")) {
      const params = Object.fromEntries(parsed.searchParams);
      requests.push({ path: parsed.pathname, params });
      const query = params.query || "";
      const tags = params.tags || "";
      const respond = (payload) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      if (query === "empty") return respond({ hits: [], page: 0, nbPages: 1 });
      if (query === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      if (tags.includes("comment")) return respond(COMMENT_HIT);
      if (params.page === "1") return respond(STORY_HITS_PAGE_1);
      if (query === "slow") {
        // Stay pending forever: a stale in-flight search is cancelled by the
        // client and must never render, even though its response never arrives.
        return new Promise(() => {});
      }
      return respond(STORY_HITS_PAGE_0);
    }
    if (parsed.pathname.startsWith("/api/v1/items/")) {
      const id = Number(parsed.pathname.split("/").pop());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id, title: "Alpha story about databases", url: "https://example.test/a1",
          author: "pg", points: 120, created_at_i: Math.floor(Date.now() / 1000) - 3600, text: null,
          children: THREAD_CHILDREN,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
  };
  return { requests, handler };
}

async function withBrowser(fn) {
  const harness = await launchExtension();
  const browser = harness.context;
  try {
    await fn(browser);
    harness.assertOffline();
  } finally {
    await harness.close();
  }
}

const runBrowser = async (name, fn) => {
  try {
    await withBrowser(fn);
    passedBrowser++;
    console.log("ok -", name);
  } catch (error) {
    failedBrowser++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  }
};

// Waits until the mocked Algolia has seen a matching request (debounce makes
// request timing asynchronous from UI actions).
const waitForAlgoliaRequest = async (algolia, predicate, page, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (algolia.requests.some(predicate)) return;
    await page.waitForTimeout(120);
  }
  throw new Error("Timed out waiting for an Algolia request");
};

await runBrowser("browser: site search renders story and comment hits with safe highlights", async (browser) => {
  const algolia = createAlgoliaMock();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hn.algolia.com") return algolia.handler(route);
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([910001, 910002, 910003]) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: Number(itemMatch[1]), type: "story", by: "s", title: "Feed story", url: "https://example.test/feed", score: 5, time: Math.floor(Date.now() / 1000), descendants: 2 }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (parsed.hostname === "news.ycombinator.com") {
      return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic", "news-in.html") });
    }
    if (parsed.hostname === "example.test") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>x</body></html>" });
    }
    return route.fallback();
  });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });

  // Open search, switch to global mode, and run a story search.
  await page.locator(".feed-toolbar-actions button").first().click();
  await page.locator(".feed-search-input").fill("sqlite wal");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-results").waitFor({ state: "visible", timeout: 10000 });

  const header = await page.locator(".hn-search-header strong").textContent();
  assert.ok(header.includes("sqlite wal"), "header names the query");
  const meta = await page.locator(".hn-search-meta").textContent();
  assert.ok(meta.includes("2 stories"), "malformed hit dropped from the count");
  const storyCards = page.locator(".hn-search-results .story-card");
  assert.equal(await storyCards.count(), 2, "two valid story hits render");
  assert.equal((await storyCards.nth(0).locator(".story-card-title").textContent()).trim(), "Alpha story about databases");

  assert.equal(await page.locator('.hn-search-mode').count(), 0, 'loaded-stories mode removed');
  assert.equal(await page.locator('.feed-search-close').count(), 1, 'search close button visible');

  // Comment chip switches tags and renders the comment hit safely.
  await page.locator('.hn-search-chip[data-tag="comment"]').click();
  await page.locator(".comment-hit").waitFor({ state: "visible", timeout: 10000 });
  const excerptText = await page.locator(".comment-hit-excerpt").innerText();
  assert.ok(excerptText.includes("write-ahead log"), "excerpt text present");
  const hostileCount = await page.locator(".comment-hit-excerpt img, .comment-hit-excerpt script").count();
  assert.equal(hostileCount, 0, "SEC-40: hostile highlight markup never becomes elements");
  const emSpans = await page.locator(".comment-hit-excerpt .search-hit-em").count();
  assert.equal(emSpans, 1, "exactly one highlighted segment");
  const storyTextHtml = await page.locator(".comment-hit-story-text").innerHTML();
  assert.ok(storyTextHtml.includes("databases"), "story title highlight rendered");

  // Algolia received the expected query params.
  const commentRequest = algolia.requests.find((r) => (r.params.tags || "").includes("comment"));
  assert.equal(commentRequest.params.query, "sqlite wal");
  assert.equal(commentRequest.params.hitsPerPage, "30");
  assert.ok(commentRequest.path.endsWith("/search"), "relevance sort uses /search");
  await page.locator('.feed-search-close').click();
  assert.equal(await page.locator('.feed-search.open').count(), 0, 'close button hides search');
  assert.equal(await page.locator('.hn-search-results').count(), 0, 'closing search restores the feed');
  await page.close();
});

await runBrowser("browser: filters, paging, empty and error states work", async (browser) => {
  const algolia = createAlgoliaMock();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hn.algolia.com") return algolia.handler(route);
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([910001]) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: Number(itemMatch[1]), type: "story", by: "s", title: "Feed story", url: "https://example.test/feed", score: 5, time: Math.floor(Date.now() / 1000), descendants: 2 }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (parsed.hostname === "news.ycombinator.com") {
      return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic", "news-in.html") });
    }
    if (parsed.hostname === "example.test") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>x</body></html>" });
    }
    return route.fallback();
  });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".feed-toolbar-actions button").first().click();

  // Filters are applied to the request.
  await page.locator(".hn-search-select").first().selectOption("week");
  await page.locator(".hn-search-number").fill("10");
  await page.locator(".feed-search-input").fill("sqlite wal");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-results").waitFor({ state: "visible", timeout: 10000 });
  const lastRequest = algolia.requests[algolia.requests.length - 1];
  assert.ok(lastRequest.params.numericFilters.includes("created_at_i>"), "date range becomes created_at_i filter");
  assert.ok(lastRequest.params.numericFilters.includes("points>=10"), "min points becomes points filter");
  assert.ok(Number(lastRequest.params.numericFilters.split("created_at_i>")[1].split(",")[0]) <= Math.floor(Date.now() / 1000) - 604800 + 5);

  // Newest sort hits search_by_date.
  await page.locator(".hn-search-select").nth(1).selectOption("newest");
  await waitForAlgoliaRequest(algolia, (r) => r.path.endsWith("/search_by_date"), page);
  await page.locator(".hn-search-results .story-card").first().waitFor({ state: "visible", timeout: 10000 });
  assert.ok(algolia.requests.some((r) => r.path.endsWith("/search_by_date")), "newest sort uses /search_by_date");

  // Paging: load more appends page 2 and hides the button at nbPages.
  await page.locator('.hn-search-select').nth(1).selectOption("relevance");
  await waitForAlgoliaRequest(algolia, (r) => r.path.endsWith("/search") && !r.path.endsWith("/search_by_date") && r.params.page === "0", page);
  await page.locator(".hn-search-more").waitFor({ state: "visible", timeout: 10000 });
  assert.ok(algolia.requests.some((r) => r.params.page === "0"), "first page requested");
  await page.locator(".hn-search-more").click();
  await waitForAlgoliaRequest(algolia, (r) => r.params.page === "1", page);
  await page.locator(".hn-search-results .story-card").nth(2).waitFor({ state: "visible", timeout: 10000 });
  assert.ok(algolia.requests.some((r) => r.params.page === "1"), "second page requested");
  assert.equal(await page.locator(".hn-search-results .story-card").count(), 3, "hits appended across pages");
  assert.equal(await page.locator(".hn-search-more").count(), 0, "no load-more after the last page");

  // Empty state.
  await page.locator(".feed-search-input").fill("empty");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-empty").waitFor({ state: "visible", timeout: 10000 });

  // Error state; retry re-issues the request.
  await page.locator(".feed-search-input").fill("fail");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".harmonova-error").waitFor({ state: "visible", timeout: 10000 });
  const requestsBeforeRetry = algolia.requests.length;
  await page.locator(".hn-search-retry").click();
  await page.waitForTimeout(600);
  assert.ok(algolia.requests.length > requestsBeforeRetry, "retry re-issues the search request");

  // Author filter with a hostile value is skipped (and hinted). A searchable
  // query must be in place for results — and therefore the hint — to render.
  await page.locator(".feed-search-input").fill("sqlite wal");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-text").fill("bad name!");
  await page.locator(".hn-search-results .story-card").first().waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".hn-search-hint").waitFor({ state: "visible", timeout: 10000 });
  const hintRequest = algolia.requests[algolia.requests.length - 1];
  assert.ok(!(hintRequest.params.tags || "").includes("author_"), "invalid author never sent to Algolia");

  // Escape restores the feed list.
  await page.locator(".feed-search-input").press("Escape");
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".hn-search-results").count(), 0);
  await page.close();
});

await runBrowser("browser: stale in-flight searches are cancelled (AbortController)", async (browser) => {
  const algolia = createAlgoliaMock();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hn.algolia.com") return algolia.handler(route);
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([910001]) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: Number(itemMatch[1]), type: "story", by: "s", title: "Feed story", url: "https://example.test/feed", score: 5, time: Math.floor(Date.now() / 1000), descendants: 2 }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (parsed.hostname === "news.ycombinator.com") {
      return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic", "news-in.html") });
    }
    if (parsed.hostname === "example.test") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>x</body></html>" });
    }
    return route.fallback();
  });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".feed-toolbar-actions button").first().click();
  await page.locator(".feed-search-input").fill("slow");
  await page.locator(".feed-search-input").press("Enter");
  await page.getByText("Searching Hacker News…").waitFor({ state: "visible", timeout: 10000 });
  // Fire a second search while the first is still pending. The stale
  // response never arrives at all — its result must never render.
  await page.locator(".feed-search-input").fill("sqlite wal");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-results .story-card").first().waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(400);
  const titles = await page.locator(".hn-search-results .story-card-title").allTextContents();
  assert.ok(titles.some((t) => t.includes("Alpha story")), "fresh results rendered");
  assert.ok(titles.every((t) => !t.includes("stale")), "no stale results rendered");
  await page.close();
});

await runBrowser("browser: comment hits open the thread and scroll to the comment", async (browser) => {
  const algolia = createAlgoliaMock();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hn.algolia.com") return algolia.handler(route);
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([910001]) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: Number(itemMatch[1]), type: "story", by: "s", title: "Feed story", url: "https://example.test/feed", score: 5, time: Math.floor(Date.now() / 1000), descendants: 2 }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (parsed.hostname === "news.ycombinator.com") {
      return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic", "news-in.html") });
    }
    if (parsed.hostname === "example.test") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>x</body></html>" });
    }
    return route.fallback();
  });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".feed-toolbar-actions button").first().click();
  await page.locator(".feed-search-input").fill("sqlite wal");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-results .story-card").first().waitFor({ state: "visible", timeout: 10000 });
  await page.locator('.hn-search-chip[data-tag="comment"]').click();
  await page.locator(".comment-hit").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".comment-hit-open").click();
  await page.locator(".thread-pane .comment-row").first().waitFor({ state: "visible", timeout: 10000 });
  const flashed = await page.locator('.comment-row[data-comment-id="990001"].comment-flash').count();
  assert.equal(flashed, 1, "the target comment row exists and is flashed");
  await page.close();
});

await runBrowser("browser: recent searches are offered and memory-only", async (browser) => {
  const algolia = createAlgoliaMock();
  await browser.route("**/*", async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.hostname === "hn.algolia.com") return algolia.handler(route);
    if (parsed.hostname === "hacker-news.firebaseio.com") {
      if (parsed.pathname.endsWith("/topstories.json")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([910001]) });
      }
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: Number(itemMatch[1]), type: "story", by: "s", title: "Feed story", url: "https://example.test/feed", score: 5, time: Math.floor(Date.now() / 1000), descendants: 2 }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (parsed.hostname === "news.ycombinator.com") {
      return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic", "news-in.html") });
    }
    if (parsed.hostname === "example.test") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>x</body></html>" });
    }
    return route.fallback();
  });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".feed-toolbar-actions button").first().click();
  await page.locator(".feed-search-input").fill("sqlite wal");
  await page.locator(".feed-search-input").press("Enter");
  await page.locator(".hn-search-results .story-card").first().waitFor({ state: "visible", timeout: 10000 });
  // Clear the input: recents should appear.
  await page.locator(".feed-search-input").fill("");
  await page.locator(".hn-search-recent-item").first().waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".hn-search-recent-item").count(), 1);
  // Reload: recents are memory-only and must be gone (SEC-51).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".feed-toolbar-actions button").first().click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".hn-search-recent-item").count(), 0, "recent searches never survive a reload");
  await page.close();
});

const passedTotal = passedUnit + passedBrowser;
const failedTotal = failedUnit + failedBrowser;
console.log(`\nsearch: ${passedTotal} passed, ${failedTotal} failed (unit ${passedUnit}/${passedUnit + failedUnit}, browser ${passedBrowser}/${passedBrowser + failedBrowser})`);
if (failedTotal) {
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}