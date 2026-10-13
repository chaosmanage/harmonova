import { loadBackground } from './helpers/worker.mjs';
// HarmoNova security regression suite (Phase H).
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
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/url-policy.js"), "utf8"), context);
  return context.HarmoNovaUrlPolicy;
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


test("SEC-22: every background fetch uses credentials omit and validated URLs", async () => {
  const calls = [];
  const response = () => new Response("{}", { headers: { "content-type": "application/json" } });
  const { context } = loadBackground({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response();
    },
  });
  for(const [url,resourceKind] of [['https://api.github.com/repos/a/b','richJson'],['https://hacker-news.firebaseio.com/v0/item/1.json','storyLookup']]) {
    const response=await context.fetchPolicy(url,{resourceKind});await context.readResponseTextLimited(response,100);
  }
  await context.imageTint('https://avatars.githubusercontent.com/u/1?v=4');
  assert.equal(calls.length,3,'only explicit provider paths are fetched');
  for (const call of calls) {
    assert.equal(call.options.credentials, "omit", "credentials omit for " + call.url);
    assert.equal(call.options.redirect, "error", "redirects rejected for " + call.url);
    assert.equal(call.options.referrerPolicy, "no-referrer");
  }
});

test("SEC-22: OpenRouter requests carry no cookies", async () => {
  const calls = [];
  const { context } = loadBackground({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("firebaseio.com")) return new Response(JSON.stringify({ id: 1, type: "story", url: "https://example.com/a" }));
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
  await context.saveAiPolicy({ ...context.HarmoNovaAiPolicy.defaults, consentVersion: 1, enabled: true, streamResponses: false });
  await context.summarizeWithOpenRouter(
    { postMessage() {} },
    { storyId: 1, source:"discussion",discussionText:"A public Hacker News discussion with enough fixture content to summarize.", url: "https://example.com/a", model: "openrouter/free", systemPrompt: "p", streamResponses: false },
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

test("SEC-24: redirects are refused before a second hop", async () => {
  const requested = [];
  const { context } = loadBackground({
    fetchImpl: async (url) => {
      requested.push(String(url));
      const n = Number(new URL(url).pathname.slice(1)) || 0;
      return new Response(null, { status: 302, headers: { location: "https://example.com/" + (n + 1) } });
    },
  });
  await assert.rejects(() => context.fetchPolicy("https://api.github.com/repos/a/b",{resourceKind:"richJson"}), /REMOTE_FETCH_BLOCKED/);
  assert.deepEqual(requested, ["https://api.github.com/repos/a/b"], "no subsequent redirect hops");
  // getMetadata swallows fetch errors by design; it must still return empty metadata.
  const meta = await context.getMetadata("https://example.com/0");
  assert.equal(meta.image, null);
});

test("SEC-24: even public redirects are intentionally refused", async () => {
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
  assert.equal(meta.image, null, "a public redirect must not trigger a second fetch");
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
  assert.equal(meta.favicon, null, "unsupported favicon bytes never become a remote DOM source");
});

test("SEC-52: state handlers only accept the extension's top-frame HN sender", async () => {
  const { context, listeners, stores } = loadBackground({ fetchImpl: async () => new Response("") });
  const send = (message, sender) => new Promise((resolve) => {
    const ok = listeners.message(message, sender, resolve);
    assert.ok(ok, "handler should respond async");
  });
  const trusted = { id: "test-extension-id", frameId: 0, url: "https://news.ycombinator.com/item?id=9", origin: "https://news.ycombinator.com", tab: { id: 1, url: "https://news.ycombinator.com/item?id=9" } };
  const read = await send({ type: "HARMONOVA_MARK_READ", id: 5 }, trusted);
  assert.equal(read.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stores.local.harmonovaReaderStateV1.readIds)), [5]);
  const bookmarks = await send({ type: "HARMONOVA_SET_BOOKMARK", id: 7, desired: true }, trusted);
  assert.equal(bookmarks.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stores.local.harmonovaReaderStateV1.bookmarks)), [7]);

  for (const [name, sender] of [
    ["wrong extension id", { id: "other", frameId: 0, tab: { id: 1, url: "https://news.ycombinator.com/" } }],
    ["iframe sender", { id: "test-extension-id", frameId: 7, tab: { id: 1, url: "https://news.ycombinator.com/" } }],
    ["non-HN origin", { id: "test-extension-id", frameId: 0, tab: { id: 1, url: "https://evil.test/" } }],
    ["no tab", { id: "test-extension-id", frameId: 0, url: "chrome-extension://test-extension-id/ai-settings.html" }],
  ]) {
    const before = JSON.stringify(stores.local);
    const reply = await send({ type: "HARMONOVA_MARK_READ", id: 99 }, sender);
    assert.equal(reply.ok, false, name + " must be refused");
    assert.equal(JSON.stringify(stores.local), before, name + " must not write");
    const reply2 = await send({ type: "HARMONOVA_SET_BOOKMARK", id: 99, desired: true }, sender);
    assert.equal(reply2.ok, false, name + " bookmarks must be refused");
  }
});

test("SEC-52: local state reads require a trusted HN sender", async () => {
  const { context, listeners } = loadBackground({ fetchImpl: async () => new Response("") });
  const send = (message, sender) => new Promise((resolve) => listeners.message(message, sender, resolve));
  const evil = await send({ type: "HARMONOVA_LOCAL_STATE_GET" }, { id: "test-extension-id", frameId: 0, tab: { url: "https://evil.test/" } });
  assert.equal(evil.ok, false);
  const good = await send({ type: "HARMONOVA_LOCAL_STATE_GET" }, { id: "test-extension-id", frameId: 0, url: "https://news.ycombinator.com/news", tab: { id: 1, url: "https://news.ycombinator.com/news" } });
  assert.equal(good.ok, true);
});

// ---------------------------------------------------------------------------
// Part 2: Chromium end-to-end security checks against the real extension
// ---------------------------------------------------------------------------

import { chromium } from "playwright-core";
