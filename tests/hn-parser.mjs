// Harmonic parser tests: load redacted/synthetic HN fixtures into Chromium and
// exercise the hn-session.js parsers through the _internal inspection hooks.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import assert from "node:assert/strict";
import { leakGuard, redactHtml, PLACEHOLDER_TOKEN_A, PLACEHOLDER_TOKEN_B } from "../scripts/redact-fixtures.mjs";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");

const readFixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});

let passed = 0;
let failed = 0;
const failures = [];

async function withPage(fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page);
    passed++;
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("FAIL:", error.message);
  } finally {
    await context.close();
  }
}

async function loadFixture(page, html) {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ path: path.join(repoRoot, "hn-session.js") });
  return page;
}

const test = async (name, fn) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page, context);
    passed++;
    console.log("ok -", name);
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  } finally {
    await context.close();
  }
};

await test("logged-out fixtures expose no session", async (page) => {
  await loadFixture(page, readFixture("news.html"));
  const session = await page.evaluate(() => window.HarmonicHN.session());
  assert.equal(session, null);
  const top = await page.evaluate(() => window.HarmonicHN._internal.parseTopBar(document));
  assert.equal(top.username, null);
  assert.equal(top.hasLogout, false);
});

await test("synthetic logged-in topbar parses username, karma, logout", async (page) => {
  await loadFixture(page, readFixture("synthetic", "news-in.html"));
  const session = await page.evaluate(() => window.HarmonicHN.harvest(document));
  assert.deepEqual(session, { username: "harmonic_test", karma: 512 });
  const top = await page.evaluate(() => window.HarmonicHN._internal.parseTopBar(document));
  assert.equal(top.username, "harmonic_test");
  assert.equal(top.karma, 512);
  assert.equal(top.hasLogout, true);
  // The logout token must stay private: nothing exposes it.
  const leaked = await page.evaluate(() => {
    const globalKeys = ["HarmonicHN"];
    const out = { topbar: null };
    for (const key of globalKeys) {
      out[key] = JSON.stringify(window[key]).includes("1".repeat(40));
    }
    return out;
  });
  assert.equal(leaked.HarmonicHN, false, "no token may be reachable from the public surface");
});

await test("vote links parse into per-item state", async (page) => {
  await loadFixture(page, readFixture("synthetic", "news-in.html"));
  const votes = await page.evaluate(() => window.HarmonicHN._internal.parseVoteLinks(document));
  assert.ok(Object.keys(votes).length >= 30, "every story row exposes vote state");
  // Story 1: plain up arrow.
  const first = Object.entries(votes)[0][1];
  assert.equal(first.canUp, true);
  assert.equal(first.voted, false);
  // Story 2: synthetic voted state (un link).
  const voted = Object.values(votes).find((entry) => entry.voted);
  assert.ok(voted, "one story should be marked voted");
  assert.equal(voted.votedDirection, "up");
});

await test("item actions parse fave/hide/flag with auth and active flags", async (page) => {
  await loadFixture(page, readFixture("synthetic", "item-in.html"));
  const actions = await page.evaluate(() => window.HarmonicHN._internal.parseItemActions(document));
  const story = actions["50022292"];
  assert.ok(story, "story actions parsed");
  assert.equal(story.favorite, true, "fave link exists");
  assert.equal(story.favoriteHasAuth, true, "fave link carries auth token");
  assert.equal(story.favoriteActive, false, "story is not favorited");
  assert.equal(story.hide, true);
  assert.equal(story.hideHasAuth, true);
  assert.equal(story.flag, true, "synthetic flag link parsed");
  const votedComment = actions["50034061"];
  assert.ok(votedComment, "first comment actions parsed");
  assert.equal(votedComment.favoriteActive, true, "first comment is favorited (un=t)");
  // Logged-out item fixture: fave/hide links exist with tokens but no flag.
  await loadFixture(page, readFixture("synthetic", "item-out.html"));
  const loggedOut = await page.evaluate(() => window.HarmonicHN._internal.parseItemActions(document));
  assert.equal(loggedOut["50022292"].favorite, true);
  assert.equal(loggedOut["50022292"].favoriteHasAuth, true, "logged-out fave links still carry tokens");
  assert.equal(loggedOut["50022292"].flag, false, "flag is login-gated");
  // Logged-out pages expose no session.
  await loadFixture(page, readFixture("synthetic", "item-out.html"));
  const session = await page.evaluate(() => window.HarmonicHN.harvest(document));
  assert.equal(session, null);
});

await test("comment form parses hidden fields", async (page) => {
  await loadFixture(page, readFixture("synthetic", "item-in.html"));
  const form = await page.evaluate(() => window.HarmonicHN._internal.parseCommentForm(document));
  assert.ok(form, "item page hosts a top-level comment form");
  assert.ok(form.fields.parent, "parent field present");
  assert.ok(form.fields.goto, "goto field present");
  assert.equal(form.fields.hmac, "<set>", "hmac field present (value masked)");
  await loadFixture(page, readFixture("synthetic", "reply-in.html"));
  const replyForm = await page.evaluate(() => window.HarmonicHN._internal.parseCommentForm(document));
  assert.ok(replyForm, "reply page hosts a comment form");
  assert.equal(replyForm.fields.parent, "<set>");
});

await test("list parser reads rows and pagination", async (page) => {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.setContent(readFixture("news.html"), { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ path: path.join(repoRoot, "hn-session.js") });
  const list = await page.evaluate(() => window.HarmonicHN._internal.parseList(document));
  assert.equal(list.ids.length, 30, "front page holds 30 stories");
  assert.ok(list.morePath, "front page has a morelink");
  // parseList returns the morelink href verbatim (DOMParser docs inherit the
  // host page baseURI, so URL resolution there is wrong); fetchListPage
  // resolves "?…" hrefs against the requested list path instead.
  assert.equal(list.morePath, "?p=2", "morelink href returned verbatim: " + list.morePath);
  await page.setContent(readFixture("item-thread.html"), { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ path: path.join(repoRoot, "hn-session.js") });
  const threadList = await page.evaluate(() => window.HarmonicHN._internal.parseList(document));
  assert.ok(threadList.ids.length > 1000, "large thread parses every comment row: " + threadList.ids.length);
  // Modern HN renders whole threads on one page; morePath stays null there but
  // the parser must still resolve it when HN paginates list pages.
});

await test("submit form parses fnid and fnop", async (page) => {
  await loadFixture(page, readFixture("synthetic", "submit-in.html"));
  const form = await page.evaluate(() => window.HarmonicHN._internal.parseFnidForm(document));
  assert.ok(form, "submit form parsed");
  assert.equal(form.action, "r");
  assert.equal(form.hasFnid, true);
  assert.ok(form.fields.includes("fnop"));
  assert.ok(form.fields.includes("title"));
  assert.ok(form.fields.includes("url"));
  assert.ok(form.fields.includes("text"));
});

await test("error pages classify correctly", async (page) => {
  const cases = [
    [["synthetic", "error-expired.html"], "expiredLink"],
    [["synthetic", "error-badlogin.html"], "badLogin"],
    [["synthetic", "error-ratelimited.html"], "rateLimited"],
    [["synthetic", "error-toofast.html"], "tooFast"],
    [["synthetic", "error-validation.html"], "validationRequired"],
    [["login.html"], "loginPage"],
    [["synthetic", "reply-in.html"], "ok"],
    [["synthetic", "news-in.html"], "ok"],
    [["item-fresh.html"], "ok"],
  ];
  for (const parts of cases) {
    const expected = parts.pop();
    const html = readFixture(...parts.flat());
    await loadFixture(page, html);
    const actual = await page.evaluate(() => window.HarmonicHN._internal.classifyDoc(document));
    assert.equal(actual, expected, "classification of " + parts.join("/"));
  }
});

await test("comment text cannot spoof page-level error classification", async (page) => {
  const spoofed = readFixture("synthetic", "news-in.html").replace(
    '<span class="titleline">',
    '<span class="titleline"><a href="x">Story</a></span><span class="commtext c00">Unknown or expired link. Bad login. Validation required'
  );
  await loadFixture(page, spoofed);
  const classification = await page.evaluate(() => window.HarmonicHN._internal.classifyDoc(document));
  assert.equal(classification, "ok", "error strings inside comment regions must be ignored");
});

await test("fixture leak guard passes on committed fixtures (SEC-62)", async () => {
  const problems = leakGuard();
  assert.deepEqual(problems, []);
});

await test("redaction replaces live tokens and emails deterministically", async () => {
  const sample = `<a href="vote?id=1&auth=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef">v</a> mail me: someone@example.org or ${PLACEHOLDER_TOKEN_A}`;
  const out = redactHtml(sample);
  assert.ok(out.includes(PLACEHOLDER_TOKEN_A) || out.includes(PLACEHOLDER_TOKEN_B));
  assert.ok(out.includes("removed@example.invalid"));
  assert.ok(!out.includes("deadbeef"));
  assert.ok(!out.includes("someone@example.org"));
});

await test("no committed fixture contains a live-looking 40-hex token outside placeholders", async (page) => {
  const placeholders = new Set([PLACEHOLDER_TOKEN_A, PLACEHOLDER_TOKEN_B]);
  const dir = fixtureDir;
  const check = (file) => {
    const html = fs.readFileSync(file, "utf8");
    for (const token of html.match(/\b[0-9a-f]{40}\b/gi) || []) {
      if (!placeholders.has(token)) throw new Error("non-placeholder token in " + file + ": " + token);
    }
  };
  for (const entry of fs.readdirSync(dir, { recursive: false })) {
    const full = path.join(dir, entry);
    if (entry === "raw") continue; // gitignored raw captures are exempt
    if (fs.statSync(full).isDirectory()) {
      for (const inner of fs.readdirSync(full)) {
        if (inner.endsWith(".html")) check(path.join(full, inner));
      }
    } else if (entry.endsWith(".html")) {
      check(full);
    }
  }
});

await browser.close();
console.log(`\nhn-parser: ${passed} passed, ${failed} failed`);
if (failed) {
  process.exit(1);
}