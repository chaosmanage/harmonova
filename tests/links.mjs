// HarmoNova Phase 7 part 3 (0.12.2) UI suite: links & appearance — rich link
// previews from public provider APIs (GitHub, Wikipedia, arXiv) with strict
// validation and text-only rendering, the "View on archive" action (Wayback
// Machine) from the thread and card menus, the new
// surface-theme and font settings. Drives the real Chromium extension against
// mocked HN + Firebase + Algolia documents plus mocked provider endpoints.
//
// Route handlers are registered once and dispatch through a mutable
// activeMocks object so per-test fixtures can never be shadowed by handlers
// from earlier tests.
import { launchExtension } from "./helpers/extension.mjs";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);

const USER = "harmonic_test";
const OP_USER = "submitter_0";
const STORY_ID = 50022292;

const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

const GENERIC_HTML = "<!doctype html><html><head><title>mocked article</title></head><body><p>mocked article body</p></body></html>";

function createHnMock() {
  const serveHtml = (html) => ({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  async function handle(route) {
    const parsed = new URL(route.request().url());
    const pathname = parsed.pathname;
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
  return { handle };
}

// Per-test Firebase/Algolia fixtures. storyUrl decides which article (and
// therefore which provider API) the thread header previews.
function createDataMocks({ storyUrl, commentText }) {
  const now = Math.floor(Date.now() / 1000);
  const stories = {
    [STORY_ID]: {
      id: STORY_ID,
      type: "story",
      by: OP_USER,
      title: "Mocked feed story " + STORY_ID,
      url: storyUrl,
      score: 55,
      time: now - 3600,
      descendants: 5,
    },
  };
  const discussion = {
    id: STORY_ID,
    title: "Mocked feed story " + STORY_ID,
    url: storyUrl,
    author: OP_USER,
    points: 55,
    created_at_i: now - 3600,
    text: null,
    children: [
      { id: 50034100, author: OP_USER, created_at_i: now - 3600, text: "The original poster explains the story.", children: [] },
      { id: 50034061, author: "seabass", created_at_i: now - 3600, text: commentText || "Seabass says something clever here.", children: [] },
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
          body: JSON.stringify({
            id,
            author: USER,
            text: "A mocked comment.",
            created_at_i: now - 1800,
            story_id: STORY_ID,
            story_title: "Mocked feed story " + STORY_ID,
            // The real Algolia items API echoes the story's fields, url included.
            url: storyUrl,
            points: 55,
            title: "Mocked feed story " + STORY_ID,
            children: discussion.children,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
    }
    return route.fallback();
  };
}

// ---------------------------------------------------------------------------
// Provider endpoint mocks: {host, path (regex), hits, fulfill} — every hit is
// counted so tests can assert requests happened (or never did).
// ---------------------------------------------------------------------------

const providerSpec = (host, path, body, contentType = "application/json") => {
  const spec = { host, path: new RegExp(path), hits: 0 };
  spec.fulfill = { status: 200, contentType, body };
  return spec;
};

const ARTICLE_HOSTS = [
  "github.com", "arxiv.org", "en.wikipedia.org", "plain-example.com",
  "twitter.com", "x.com", "web.archive.org", "mocked-cdn.example",
];

// Factories (not shared objects): each test gets fresh specs with fresh hit
// counters so counts never leak across tests.
const GITHUB_GOOD = () => [
  providerSpec("api.github.com", "^/repos/octocat/harmonova$", JSON.stringify({
    full_name: "octocat/harmonova",
    description: "A mocked repository for tests.",
    stargazers_count: 12345,
    forks_count: 678,
    open_issues_count: 9,
    language: "TypeScript",
    license: { spdx_id: "MIT" },
  })),
];

const GITHUB_BAD = () => [
  providerSpec("api.github.com", "^/repos/octocat/broken$", JSON.stringify({
    full_name: 42,
    description: { hostile: true },
    stargazers_count: "many",
    forks_count: -5,
    open_issues_count: null,
    language: 12345,
    license: "MIT",
  })),
];

const GITHUB_OFF = () => [
  providerSpec("api.github.com", "^/repos/octocat/off$", JSON.stringify({
    full_name: "octocat/off",
    stargazers_count: 1,
    forks_count: 1,
    open_issues_count: 1,
    language: "Rust",
    license: { spdx_id: "MIT" },
  })),
];

const WIKI_GOOD = () => [
  providerSpec("en.wikipedia.org", "^/api/rest_v1/page/summary/Harmonic_(?:%28|\\()mathematics(?:%29|\\))$", JSON.stringify({
    type: "standard",
    title: "Harmonic (mathematics)",
    extract: "A <b>harmonova</b> function is a twice-differentiable function that satisfies Laplace's equation.",
  })),
];

const WIKI_DISAMBIG = () => [
  providerSpec("en.wikipedia.org", "^/api/rest_v1/page/summary/Disambiguation_page$", JSON.stringify({
    type: "disambiguation",
    title: "Disambiguation page",
    extract: "This disambiguation page lists articles associated with the title.",
  })),
];

const ARXIV_XML = () => [
  providerSpec(
    "export.arxiv.org",
    "^/api/query$",
    '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>ArXiv Query</title>' +
      "<entry><id>http://arxiv.org/abs/2401.01234v1</id>" +
      "<title>A Mocked Study of <i>Harmonic</i> Analysis</title>" +
      "<summary>  We study harmonova\n functions in a mocked setting. </summary>" +
      "<author><name>Alice Author</name></author><author><name>Bob Builder</name></author>" +
      "<published>2024-01-05T18:00:00Z</published></entry></feed>",
    "application/atom+xml"
  ),
];

const harness = await launchExtension();
const browser = harness.context;

let activeMocks = null;

await browser.route("**/*", async (route) => {
  const parsed = new URL(route.request().url());
  if (!activeMocks) return route.fallback();
  if (parsed.hostname === "news.ycombinator.com") return activeMocks.hn.handle(route);
  if (parsed.hostname === "hacker-news.firebaseio.com" || parsed.hostname === "hn.algolia.com") return activeMocks.data(route);
  for (const spec of activeMocks.providers) {
    if (parsed.hostname === spec.host && spec.path.test(parsed.pathname)) {
      spec.hits += 1;
      return route.fulfill(spec.fulfill);
    }
  }
  if (ARTICLE_HOSTS.includes(parsed.hostname)) {
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: GENERIC_HTML });
  }
  return route.fallback();
});

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fixtures, fn) {
  activeMocks = {
    hn: createHnMock(),
    data: createDataMocks({ storyUrl: fixtures.storyUrl, commentText: fixtures.commentText }),
    providers: fixtures.providers || [],
  };
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("  pageerror:", String(error).slice(0, 160)));
  try {
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
    const sw = browser.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
    if (sw) {
      await sw.evaluate(() => Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()])).catch(() => {});
      await sw.evaluate(()=>chrome.storage.local.set({harmonovaNetworkPolicyV1:{version:1,externalPreviewsEnabled:true}}));
      if (fixtures.settings) await sw.evaluate((value) => chrome.storage.sync.set({ harmonovaSettings: value }), fixtures.settings);
    }
    await fn({ page, providers: activeMocks.providers });
    passed++;
    console.log("ok -", name);
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  } finally {
    activeMocks = null;
    await page.close();
  }
}

const gotoFeed = async (page) => {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
};

const openThread = async (page) => {
  // The comment button deterministically opens the discussion in this tab
  // (a card/title click would also pop the article into a new tab).
  await page.locator('.story-card[data-story-id="' + STORY_ID + '"] .story-comment-button').click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".comments > .comment-row").length >= 1, null, { timeout: 20000 });
};

const richBox = (page) => page.locator(".thread-header .rich-preview").first();

// ---------------------------------------------------------------------------

await test("GitHub rich preview renders validated text facts", { storyUrl: "https://github.com/octocat/harmonova", providers: GITHUB_GOOD() }, async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  const box = richBox(page);
  await box.waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await box.locator(".rich-preview-provider").textContent(), "GitHub", "provider chip says GitHub");
  const widths = await box.evaluate(element => {
    const parent = element.parentElement;
    const padding = getComputedStyle(parent);
    return { actual: element.getBoundingClientRect().width,
      available: parent.getBoundingClientRect().width - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) };
  });
  assert.ok(Math.abs(widths.actual - widths.available) < 2, "rich preview fills story header width");
  assert.equal(await box.locator(".rich-preview-title").textContent(), "octocat/harmonova", "repo full_name rendered");
  const text = await box.textContent();
  assert.ok(text.includes("★ 12,345"), "star count rendered: " + text);
  assert.ok(text.includes("678 forks"), "fork count rendered");
  assert.ok(text.includes("9 issues"), "issue count rendered");
  assert.ok(text.includes("Language: TypeScript"), "language rendered");
  assert.ok(text.includes("License: MIT"), "license rendered");
  assert.equal(await box.locator("img,script,iframe").count(), 0, "rich box is text-only");
});

await test("GitHub responses that fail validation render nothing", { storyUrl: "https://github.com/octocat/broken", providers: GITHUB_BAD() }, async ({ page, providers }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.waitForTimeout(2500);
  assert.equal(await page.locator(".rich-preview").count(), 0, "no rich box for a hostile payload");
  assert.equal(providers[0].hits, 1, "the provider API was called exactly once");
});

await test("Wikipedia rich preview shows the extract as plain text", { storyUrl: "https://en.wikipedia.org/wiki/Harmonic_(mathematics)", providers: WIKI_GOOD() }, async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  const box = richBox(page);
  await box.waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await box.locator(".rich-preview-provider").textContent(), "Wikipedia", "provider chip says Wikipedia");
  assert.equal(await box.locator(".rich-preview-title").textContent(), "Harmonic (mathematics)", "summary title rendered");
  const text = await box.textContent();
  assert.ok(text.includes("A <b>harmonova</b> function"), "markup arrives as literal text: " + text);
  assert.equal(await box.locator("b,script,img").count(), 0, "extract is never parsed as HTML");
});

await test("Wikipedia disambiguation pages render nothing", { storyUrl: "https://en.wikipedia.org/wiki/Disambiguation_page", providers: WIKI_DISAMBIG() }, async ({ page, providers }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.waitForTimeout(2500);
  assert.equal(await page.locator(".rich-preview").count(), 0, "no rich box for a disambiguation summary");
  assert.equal(providers[0].hits, 1, "the summary API was called and then rejected");
});

await test("arXiv rich preview parses the Atom XML as text", { storyUrl: "https://arxiv.org/abs/2401.01234", providers: ARXIV_XML() }, async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  const box = richBox(page);
  await box.waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await box.locator(".rich-preview-provider").textContent(), "arXiv", "provider chip says arXiv");
  assert.equal(await box.locator(".rich-preview-title").textContent(), "A Mocked Study of Harmonic Analysis", "title tags stripped");
  const text = await box.textContent();
  assert.ok(text.includes("We study harmonova functions in a mocked setting."), "summary rendered");
  assert.ok(text.includes("By Alice Author, Bob Builder"), "authors rendered");
  assert.ok(text.includes("Published 2024"), "publication year rendered");
  assert.equal(await box.locator("i,script,img").count(), 0, "arXiv box is text-only");
});

await test("non-provider articles never touch a provider API", { storyUrl: "https://plain-example.com/x", providers: GITHUB_GOOD() }, async ({ page, providers }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.waitForTimeout(2000);
  assert.equal(await page.locator(".rich-preview").count(), 0, "no rich box without a provider");
  assert.equal(providers[0].hits, 0, "no provider API request fired");
});

await test("richPreviews toggle off skips provider requests entirely", { storyUrl: "https://github.com/octocat/off", providers: GITHUB_OFF(), settings: { richPreviews: false } }, async ({ page, providers }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.waitForTimeout(2000);
  assert.equal(await page.locator(".rich-preview").count(), 0, "no rich box while the toggle is off");
  assert.equal(providers[0].hits, 0, "no provider API request while the toggle is off");
});

const openWayback = async (page) => {
  const popupPromise = browser.waitForEvent("page", { timeout: 15000 });
  return popupPromise;
};

await test("View on archive opens the Wayback URL from the thread menu", { storyUrl: "https://github.com/octocat/harmonova", providers: GITHUB_GOOD() }, async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  const popupPromise = openWayback(page);
  await page.locator(".thread-actions button[aria-label='More']").first().click();
  await page.locator(".harmonova-popup .popup-item", { hasText: "View on archive" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://web.archive.org/web/2/https://github.com/octocat/harmonova", { timeout: 15000 });
  assert.ok(popup.url().startsWith("https://web.archive.org/web/2/https://github.com/octocat/harmonova"), "Wayback URL carries the article: " + popup.url());
  await popup.close();
});

await test("View on archive opens the Wayback URL from the card menu", { storyUrl: "https://github.com/octocat/harmonova", providers: GITHUB_GOOD() }, async ({ page }) => {
  await gotoFeed(page);
  const popupPromise = openWayback(page);
  await page.locator('.story-card[data-story-id="' + STORY_ID + '"]').click({ button: "right" });
  await page.locator(".harmonova-popup .popup-item", { hasText: "View on archive" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://web.archive.org/web/2/https://github.com/octocat/harmonova", { timeout: 15000 });
  assert.ok(popup.url().startsWith("https://web.archive.org/web/2/https://github.com/octocat/harmonova"), "card menu archive URL matches");
  await popup.close();
});

await test("X links remain direct and settings have no redirect control", { storyUrl: "https://x.com/user/status/123" }, async ({ page }) => {
  await gotoFeed(page);
  assert.equal(await page.locator('.story-card-title').first().getAttribute('href'), 'https://x.com/user/status/123');
  await page.goto('https://news.ycombinator.com/news#harmonova-settings');
  await page.locator('.settings-category', {hasText:'Web and links'}).click();
  assert.equal(await page.locator('.settings-section:not([hidden]) .setting-row').count(), 1);
  assert.equal(await page.locator('.settings-section:not([hidden]) .setting-row strong').first().innerText(), 'Rich link previews');
});

await test("Right click can mark a read story unread and persist it", { storyUrl: "https://plain-example.com/x" }, async ({ page }) => {
  await gotoFeed(page);
  await openThread(page);
  await page.goBack();
  const card = page.locator('.story-card[data-story-id="' + STORY_ID + '"]');
  await card.waitFor({state:'visible'});
  assert.equal(await card.evaluate(node=>node.classList.contains('is-read')),true);
  await card.click({button:'right'});
  await page.locator('.harmonova-popup .popup-item', {hasText:'Mark as unread'}).click();
  assert.equal(await card.evaluate(node=>node.classList.contains('is-read')),false);
  const worker = browser.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
  await page.waitForFunction(() => !document.querySelector('.story-card.is-read'));
  assert.equal(await worker.evaluate(async id => { const state=(await chrome.storage.local.get('harmonovaReaderStateV1')).harmonovaReaderStateV1;return state?.readIds.includes(id); }, STORY_ID), false);
  await card.click({button:'right'});
  assert.equal(await page.locator('.harmonova-popup .popup-item', {hasText:'Mark as unread'}).count(), 0);
});

await test("theme and font settings apply and persist through a reload", { storyUrl: "https://plain-example.com/x", settings: { uiTheme: "navy", uiFont: "serif" } }, async ({ page }) => {
  await gotoFeed(page);
  const root = page.locator("html");
  assert.equal(await root.getAttribute("data-theme"), "navy", "navy theme applied");
  assert.equal(await root.getAttribute("data-font"), "serif", "serif font applied");
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bodyBg, "rgb(11, 17, 32)", "body background uses the navy void color");
  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.ok(fontFamily.includes("Georgia"), "body font stack switches to serif: " + fontFamily);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "navy", "theme persists through a reload");
  assert.equal(await page.locator("html").getAttribute("data-font"), "serif", "font persists through a reload");
});

await test("default theme and font are AMOLED black + Google Sans Flex Rounded", { storyUrl: "https://plain-example.com/x" }, async ({ page }) => {
  await gotoFeed(page);
  const root = page.locator("html");
  assert.equal(await root.getAttribute("data-theme"), "amoled", "default theme is amoled");
  assert.equal(await root.getAttribute("data-font"), "rounded", "default font is Google Sans Flex Rounded");
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.ok(family.includes('Google Sans Flex Rounded'), 'rounded family selected: ' + family);
  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('400 16px "Google Sans Flex Rounded"');
    return faces.some((face) => face.family === 'Google Sans Flex Rounded' && face.status === 'loaded');
  });
  assert.ok(loaded, 'bundled rounded font is loadable in the browser');
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bodyBg, "rgb(0, 0, 0)", "default body background is pure black");
});

harness.assertOffline();
await harness.close();
if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed");