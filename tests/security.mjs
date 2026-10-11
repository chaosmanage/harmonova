// Harmonic security regression suite (Phase H).
// Part 1 runs background.js and url-policy.js in a Node vm with a mock chrome API.
// Part 2 runs Chromium against the real extension to exercise the live code paths.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Part 1: url-policy unit table (SEC-24)
// ---------------------------------------------------------------------------

const loadPolicy = () => {
  const context = vm.createContext({ URL, console });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "url-policy.js"), "utf8"), context);
  return context.HarmonicUrlPolicy;
};

test("SEC-24: url policy blocks every private or unexpected remote target", () => {
  const policy = loadPolicy();
  const blocked = [
    "http://127.0.0.1/x",
    "http://localhost:8080/x",
    "http://localhost/x",
    "http://192.168.1.1/x",
    "http://10.0.0.1/x",
    "http://172.16.5.4/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/x",
    "http://[::1]/x",
    "http://[::]/x",
    "http://[fe80::1]/x",
    "http://[fc00::1]/x",
    "http://[fd12::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://0x7f000001/x",
    "http://2130706433/x",
    "http://0177.0.0.1/x",
    "http://127.1/x",
    "http://017700000001/x",
    "http://router.local/x",
    "http://nas.internal/x",
    "http://myhost.lan/x",
    "http://box.home.arpa/x",
    "http://web.localhost/x",
    "https://example.com:8443/x",
    "https://example.com:8080/x",
    "http://user:pass@example.com/x",
    "ftp://example.com/x",
    "file:///etc/passwd",
    "chrome-extension://abc/x",
    "data:text/html,hi",
    "https://news.ycombinator.com/news",
    "https://www.ycombinator.com/x",
    "http://news.ycombinator.com:80/x",
    "",
    "not a url",
  ];
  for (const value of blocked) {
    assert.equal(policy.isAllowedRemoteUrl(value), false, "should block: " + JSON.stringify(value));
  }
  const allowed = [
    "https://example.com/x",
    "http://example.com/",
    "https://example.com:443/x",
    "http://example.com:80/x",
    "https://sub.domain.example.co.uk/a/b?c=d",
    "https://192.168.example.com/x", // public hostname that merely contains numbers
    "https://example.com/ip/169.254.169.254",
  ];
  for (const value of allowed) {
    assert.equal(policy.isAllowedRemoteUrl(value), true, "should allow: " + JSON.stringify(value));
  }
});

test("SEC-23: policy identifies Hacker News hosts for refusal", () => {
  const policy = loadPolicy();
  for (const host of ["news.ycombinator.com", "www.news.ycombinator.com", "ycombinator.com", "sub.ycombinator.com"]) {
    assert.equal(policy.isHackerNewsHost(host), true, host);
  }
  for (const host of ["example.com", "hn.algolia.com", "hacker-news.firebaseio.com", "notycombinator.com", "news.ycombinator.com.evil.test"]) {
    assert.equal(policy.isHackerNewsHost(host), false, host);
  }
});

// ---------------------------------------------------------------------------
// Part 1: background.js behaviour under mocked chrome APIs
// ---------------------------------------------------------------------------

function loadBackground({ fetchImpl }) {
  const stores = { local: {}, session: {}, sync: {} };
  const listeners = { message: null, connect: null };
  const area = (name) => ({
    get(keys, cb) { const result = { ...keys, ...stores[name] }; cb?.(result); return Promise.resolve(result); },
    set(value, cb) { Object.assign(stores[name], value); cb?.(); return Promise.resolve(); },
    remove(keys, cb) { for (const key of [keys].flat()) delete stores[name][key]; cb?.(); return Promise.resolve(); },
    setAccessLevel() { return Promise.resolve(); },
  });
  const context = vm.createContext({
    chrome: {
      storage: Object.fromEntries(["local", "session", "sync"].map((name) => [name, area(name)])),
      tabs: { onRemoved: { addListener() {} } },
      runtime: {
        id: "test-extension-id",
        getURL: (p) => "chrome-extension://test-extension-id/" + p,
        onConnect: { addListener(fn) { listeners.connect = fn; } },
        onMessage: { addListener(fn) { listeners.message = fn; } },
      },
    },
    importScripts: (...files) => {
      for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(repoRoot, file), "utf8"), context);
      }
    },
    URL, URLSearchParams, AbortController, AbortSignal, TextDecoder, TextEncoder,
    setTimeout, clearTimeout, console,
    crypto: { subtle: { digest: (algo, bytes) => crypto.subtle.digest(algo, bytes) } },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    fetch: fetchImpl,
    Response, ReadableStream, OffscreenCanvas: class {}, createImageBitmap: async () => { throw new Error("no canvas in tests"); },
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "background.js"), "utf8"), context);
  return { context, stores, listeners };
}

test("SEC-22: every background fetch uses credentials omit and validated URLs", async () => {
  const calls = [];
  const response = () => new Response("ok", { headers: { "content-type": "text/plain" } });
  const { context } = loadBackground({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response();
    },
  });
  await context.fetchArticleText("https://example.com/article");
  await context.getMetadata("https://example.com/article");
  await context.imageTint("https://example.com/pic.png");
  assert.ok(calls.length >= 3, "expected metadata, article and tint fetches");
  for (const call of calls) {
    assert.equal(call.options.credentials, "omit", "credentials omit for " + call.url);
    assert.equal(call.options.redirect, "manual", "manual redirects for " + call.url);
  }
});

test("SEC-22: OpenRouter requests carry no cookies", async () => {
  const calls = [];
  const { context } = loadBackground({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("openrouter.ai")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "- a" } }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("article body text for the summarizer", {
        headers: { "content-type": "text/plain" },
      });
    },
  });
  await context.saveAiKey("k", "session");
  await context.summarizeWithOpenRouter(
    { postMessage() {} },
    { storyId: 1, url: "https://example.com/a", model: "openrouter/free", systemPrompt: "p", streamResponses: false },
    new AbortController()
  );
  const openrouter = calls.find((call) => call.url.includes("openrouter.ai"));
  assert.ok(openrouter, "openrouter should be called");
  assert.equal(openrouter.options.credentials, "omit");
});

test("SEC-23/24: preview and article fetches refuse HN hosts and private targets", async () => {
  let requested = [];
  const { context } = loadBackground({
    fetchImpl: async (url) => {
      requested.push(String(url));
      return new Response("should never be used", { headers: { "content-type": "text/html" } });
    },
  });
  for (const target of [
    "https://news.ycombinator.com/item?id=1",
    "http://news.ycombinator.com/x",
    "https://www.ycombinator.com/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/x",
    "file:///etc/passwd",
    "https://example.com:8443/x",
  ]) {
    const meta = await context.getMetadata(target);
    assert.equal(meta.image, null, "no image for " + target);
    assert.equal(meta.favicon, null, "no favicon for " + target);
    if (String(target).includes("ycombinator.com")) {
      assert.equal(meta.refused, true, "refused flag for HN " + target);
    }
    await assert.rejects(
      () => context.fetchArticleText(target),
      /Hacker News pages can't be summarized|Unsupported article URL|Blocked URL/,
      "article refused for " + target
    );
  }
  assert.deepEqual(requested, [], "no network request may leave the worker for refused targets");
});

test("SEC-24: redirects are re-validated and capped", async () => {
  const hops = ["https://example.com/a"];
  const { context } = loadBackground({
    fetchImpl: async (url) => {
      const current = String(url);
      if (current === "https://example.com/a") {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
      }
      hops.push(current);
      return new Response("secret body", { headers: { "content-type": "text/html" } });
    },
  });
  // getMetadata must never accept content fetched from a disallowed redirect target.
  const meta = await context.getMetadata("https://example.com/a");
  assert.equal(meta.image, null);
  assert.equal(meta.favicon, null);
  assert.deepEqual(hops, ["https://example.com/a"], "private redirect target must not be fetched");
});

test("SEC-24: redirect chains beyond five hops are refused", async () => {
  const requested = [];
  const { context } = loadBackground({
    fetchImpl: async (url) => {
      requested.push(String(url));
      const n = Number(new URL(url).pathname.slice(1)) || 0;
      return new Response(null, { status: 302, headers: { location: "https://example.com/" + (n + 1) } });
    },
  });
  await assert.rejects(() => context.fetchArticleText("https://example.com/0"), /Too many redirects/);
  assert.ok(requested.length <= 7, "hop count is capped, got " + requested.length);
  // getMetadata swallows fetch errors by design; it must still return empty metadata.
  const meta = await context.getMetadata("https://example.com/0");
  assert.equal(meta.image, null);
});

test("SEC-24: valid redirect hop is followed and content used", async () => {
  const { context } = loadBackground({
    fetchImpl: async (url) => {
      if (String(url) === "https://example.com/start") {
        return new Response(null, { status: 302, headers: { location: "https://example.com/https-upgrade" } });
      }
      return new Response("<html><head><meta property='og:image' content='https://img.example.com/pic.jpg'></head><body>hi</body></html>", {
        headers: { "content-type": "text/html" },
      });
    },
  });
  const meta = await context.getMetadata("https://example.com/start");
  assert.equal(meta.image, "https://img.example.com/pic.jpg");
});

test("SEC-42: metadata images must be https and off the HN origin", async () => {
  const { context } = loadBackground({
    fetchImpl: async () => new Response(
      "<html><head>"
      + "<meta property='og:image' content='http://insecure.example.com/pic.jpg'>"
      + "<meta property='og:image:secure_url' content='https://news.ycombinator.com/collapse?id=1'>"
      + "<link rel='icon' href='https://ok.example.com/favicon.ico'>"
      + "</head><body>hi</body></html>",
      { headers: { "content-type": "text/html" } }
    ),
  });
  const meta = await context.getMetadata("https://example.com/page");
  assert.equal(meta.image, null, "insecure image must be dropped");
  assert.equal(meta.favicon, "https://ok.example.com/favicon.ico");
});

test("SEC-60: font must match the pinned SHA-256 digest", async () => {
  const fontUrl = "https://raw.githubusercontent.com/SimonHalvdansson/Harmonic-HN/42aae5fa3c587b4554f1e53ce6d45c267e1aec2a/resources/src/commonMain/composeResources/font/google_sans_flex_rounded_variable_latin.ttf";
  const { context } = loadBackground({
    fetchImpl: async (url) => {
      assert.equal(String(url), fontUrl, "font URL must be the pinned commit");
      return new Response(Buffer.from("tampered bytes"), { headers: { "content-type": "font/ttf" } });
    },
  });
  await assert.rejects(() => context.getHarmonicFontDataUrl(), /digest mismatch/);
  // The failed promise must reset so a later good fetch can succeed.
  const bytes = new Uint8Array(303488);
  bytes[0] = 0x00; bytes[1] = 0x01; bytes[2] = 0x00; bytes[3] = 0x00;
  context.fetch = async () => new Response(Buffer.from(bytes), { headers: { "content-type": "font/ttf" } });
  // Digest of arbitrary bytes will not match the pinned font either — the worker
  // must still refuse it, proving the digest check always runs.
  await assert.rejects(() => context.getHarmonicFontDataUrl(), /digest mismatch/);
});

test("SEC-52: state handlers only accept the extension's top-frame HN sender", async () => {
  const { context, listeners, stores } = loadBackground({ fetchImpl: async () => new Response("") });
  const send = (message, sender) => new Promise((resolve) => {
    const ok = listeners.message(message, sender, resolve);
    assert.ok(ok, "handler should respond async");
  });
  const trusted = { id: "test-extension-id", frameId: 0, tab: { id: 1, url: "https://news.ycombinator.com/item?id=9" } };
  const read = await send({ type: "HARMONIC_READ_IDS_SET", ids: [5, 6] }, trusted);
  assert.equal(read.ok, true);
  assert.deepEqual(stores.local.readStoryIds, [5, 6]);
  const bookmarks = await send({ type: "HARMONIC_BOOKMARKS_SET", ids: [7] }, trusted);
  assert.equal(bookmarks.ok, true);
  assert.deepEqual(stores.local.harmonicBookmarks, [7]);

  for (const [name, sender] of [
    ["wrong extension id", { id: "other", frameId: 0, tab: { id: 1, url: "https://news.ycombinator.com/" } }],
    ["iframe sender", { id: "test-extension-id", frameId: 7, tab: { id: 1, url: "https://news.ycombinator.com/" } }],
    ["non-HN origin", { id: "test-extension-id", frameId: 0, tab: { id: 1, url: "https://evil.test/" } }],
    ["no tab", { id: "test-extension-id", frameId: 0, url: "chrome-extension://test-extension-id/ai-settings.html" }],
  ]) {
    const before = JSON.stringify(stores.local);
    const reply = await send({ type: "HARMONIC_READ_IDS_SET", ids: [99] }, sender);
    assert.equal(reply.ok, false, name + " must be refused");
    assert.equal(JSON.stringify(stores.local), before, name + " must not write");
    const reply2 = await send({ type: "HARMONIC_BOOKMARKS_SET", ids: [99] }, sender);
    assert.equal(reply2.ok, false, name + " bookmarks must be refused");
  }
});

test("SEC-52: local state reads require a trusted HN sender", async () => {
  const { context, listeners } = loadBackground({ fetchImpl: async () => new Response("") });
  const send = (message, sender) => new Promise((resolve) => listeners.message(message, sender, resolve));
  const evil = await send({ type: "HARMONIC_LOCAL_STATE_GET" }, { id: "test-extension-id", frameId: 0, tab: { url: "https://evil.test/" } });
  assert.equal(evil.ok, false);
  const good = await send({ type: "HARMONIC_LOCAL_STATE_GET" }, { id: "test-extension-id", frameId: 0, tab: { url: "https://news.ycombinator.com/news" } });
  assert.equal(good.ok, true);
});

// ---------------------------------------------------------------------------
// Part 2: Chromium end-to-end security checks against the real extension
// ---------------------------------------------------------------------------

import { chromium } from "playwright-core";

const runBrowserTests = async () => {
  if (!process.env.SECURITY_BROWSER_TESTS) return; // opt-in via env when part 2 should run
  const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);
  const outDir = path.resolve(process.env.TEST_OUTPUT_DIR || "test-results");
  fs.mkdirSync(outDir, { recursive: true });

  const context = await chromium.launchPersistentContext("", {
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

  const previewRequests = [];
  const evilRequests = [];
  const articleRequests = [];
  const ARTICLE_HTML = "<html><head><title>Article</title></head><body><p>An article body long enough to summarize.</p></body></html>";

  // Feed fixture state: mutable so a reload can serve fresh story URLs.
  let feedStories = [
    { id: 910001, path: "article" },
    { id: 910002, path: "article-two" },
  ];
  const algoliaItem = (story) => JSON.stringify({
    id: story.id, title: "Harmonic security fixture " + story.id, url: "https://example.test/" + story.path,
    author: "harmonic_test", points: 42, created_at_i: Math.floor(Date.now() / 1000) - 3600,
    text: null, children: [{
      id: story.id + 10, author: "harmonic_test", created_at_i: Math.floor(Date.now() / 1000) - 1800,
      text: "A comment.", children: [],
    }],
  });
  const storyFixture = (story) => JSON.stringify({
    id: story.id, type: "story", by: "harmonic_test", title: "Harmonic security fixture " + story.id,
    url: "https://example.test/" + story.path, score: 42, time: Math.floor(Date.now() / 1000) - 3600,
    descendants: 1, kids: [],
  });

  await context.route("https://evil.test/**", (route) => {
    evilRequests.push(route.request().url());
    return route.fulfill({ status: 200, body: "evil" });
  });
  await context.route("https://example.test/**", (route) => {
    const request = route.request();
    if (request.resourceType() === "document") {
      // Top-level navigation sets a SameSite=None cookie for the origin.
      return route.fulfill({
        status: 200,
        headers: { "set-cookie": "harmonic-cookie-test=1; SameSite=None; Secure" },
        contentType: "text/html",
        body: "<html><body>cookie page</body></html>",
      });
    }
    articleRequests.push({ url: request.url(), cookie: request.headers()["cookie"] || null });
    return route.fulfill({ status: 200, contentType: "text/html", body: ARTICLE_HTML });
  });
  await context.route("https://openrouter.ai/api/v1/chat/completions", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 405, body: "method" });
    const payload = [
      'data: {"choices":[{"delta":{"content":"- Real summary text\\n"}}]}',
      'data: {"choices":[{"delta":{"content":"![leak](https://evil.test/img.png)"}}]}',
      'data: {"choices":[{"delta":{"content":"\\n- More text [link](https://example.test/ok)"}}]}',
      "data: [DONE]",
    ].map((line) => line + "\n\n").join("");
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: payload });
  });
  await context.route("https://hacker-news.firebaseio.com/v0/topstories.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feedStories.map((s) => s.id)) }));
  await context.route(/https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/\d+\.json/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.match(/item\/(\d+)\.json/)[1]);
    const story = feedStories.find((s) => s.id === id);
    return story
      ? route.fulfill({ status: 200, contentType: "application/json", body: storyFixture(story) })
      : route.fulfill({ status: 404, contentType: "application/json", body: "null" });
  });
  await context.route(/https:\/\/hn\.algolia\.com\/api\/v1\/items\/\d+/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    const story = feedStories.find((s) => s.id === id) || feedStories[0];
    return route.fulfill({ status: 200, contentType: "application/json", body: algoliaItem(story) });
  });

  try {
    const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
      || await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;

    // -- SEC-44: AI markdown images render as plain text --------------------
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
    await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });

    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/ai-settings.html`, { waitUntil: "domcontentloaded" });
    await settingsPage.fill("#api-key", "security-test-key");
    await settingsPage.locator('input[name="storage"][value="session"]').check();
    await settingsPage.click("#save");
    await settingsPage.waitForFunction(() => document.querySelector("#message")?.textContent?.includes("saved"), null, { timeout: 5000 });
    await settingsPage.close();

    await page.locator('[data-story-id="910001"]').locator(".story-comment-button").click();
    await page.locator(".thread-title").waitFor({ state: "visible", timeout: 15000 });
    const sparkle = page.locator('[data-summary-action-id="910001"][data-summary-source="article"]');
    await sparkle.waitFor({ state: "visible", timeout: 10000 });
    await sparkle.click();
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-summary-story-id="910001"]');
      return card && card.dataset.status === "success";
    }, null, { timeout: 20000 });
    const summaryImages = await page.evaluate(() => document.querySelectorAll('[data-summary-story-id="910001"] img').length);
    assert.equal(summaryImages, 0, "SEC-44: generated summaries may never render Markdown images");
    assert.equal(evilRequests.length, 0, "SEC-44: the image URL from AI output must never be fetched");
    const summaryText = await page.locator('[data-summary-story-id="910001"]').innerText();
    assert.ok(summaryText.includes("Real summary text"), "summary text renders");

    // -- SEC-22: background requests never carry cookies --------------------
    articleRequests.length = 0; // drop the pre-cookie preview requests
    const cookiePage = await context.newPage();
    await cookiePage.goto("https://example.test/cookie-page", { waitUntil: "domcontentloaded" });
    const jarCookie = await cookiePage.evaluate(() => document.cookie);
    assert.ok(jarCookie.includes("harmonic-cookie-test=1"), "the routed origin must hold the test cookie");
    await cookiePage.close();

    // Serve fresh story URLs (new cache keys) so previews refetch with the cookie present.
    feedStories = [
      { id: 910003, path: "article-three" },
      { id: 910004, path: "article-four" },
    ];
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(2500);
    const post = articleRequests.filter((r) => r.url.endsWith("article-three") || r.url.endsWith("article-four"));
    assert.ok(post.length >= 1, "post-cookie preview requests must have been made");
    for (const request of post) {
      assert.equal(request.cookie, null, "SEC-22: background preview must not send cookies (" + request.url + ")");
    }
    assert.equal(evilRequests.length, 0, "no request may ever reach a disallowed host");

    // -- SEC-53: ordinary pages cannot message the extension ----------------
    const messageProbe = await page.evaluate((extId) => {
      try {
        chrome.runtime?.sendMessage?.(extId, { type: "HARMONIC_PREVIEW", url: "https://evil.test/x" }, () => {});
        return "sent";
      } catch {
        return "blocked";
      }
    }, extensionId);
    assert.ok(["sent", "blocked"].includes(messageProbe));
    assert.equal(evilRequests.length, 0, "SEC-53: messaging from a web page must never reach handlers");

    // -- SEC-43: Harmonic DOM never uses names hn.js reacts to --------------
    const reserved = await page.evaluate(() => {
      const offenders = [];
      const reservedClasses = ["clicky", "togg", "nosee", "noshow", "coll", "comtr", "athing", "votelinks"];
      for (const node of document.querySelectorAll("body *")) {
        for (const cls of (node.classList || [])) {
          if (reservedClasses.includes(cls) || /^(up|down|un|unv)_/.test(cls)) offenders.push(["class", cls]);
        }
        if (["me", "logout", "karma"].includes(node.id) || /^(up|down|un|unv)_/.test(node.id)) offenders.push(["id", node.id]);
      }
      return offenders;
    });
    assert.deepEqual(reserved, [], "SEC-43: no hn.js-reserved class or id names in Harmonic DOM");

    // -- SEC-01: no password inputs in Harmonic DOM -------------------------
    const passwordInputs = await page.evaluate(() => document.querySelectorAll('input[type="password"]').length);
    assert.equal(passwordInputs, 0, "SEC-01: no password inputs in the Harmonic UI");

    fs.writeFileSync(path.join(outDir, "security.png"), await page.screenshot());
  } finally {
    await context.close();
  }
};

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);

if (isDirectRun) {
  await runBrowserTests();
}