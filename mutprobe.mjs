// Mutation-rate probe: open the favorites list view, then log DOM churn for 4s.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const repoRoot = "/workspace/projects/harmonic";
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const extensionPath = repoRoot;

const TOKEN_B = "1".repeat(40);
const USER = "harmonic_test";
const STORY_ID = 50022292;
const STORY_2 = 50022293;
const STORY_3 = 50022294;
const fixture = (...parts) => fs.readFileSync(path.join(fixtureDir, ...parts), "utf8");

const now = Math.floor(Date.now() / 1000);
const stories = {
  [STORY_ID]: { id: STORY_ID, type: "story", by: "submitter_0", title: "Mocked feed story " + STORY_ID, score: 55, time: now - 3600, descendants: 3 },
  [STORY_2]: { id: STORY_2, type: "story", by: "alice_2", title: "Second mocked story", score: 20, time: now - 3000, descendants: 1 },
  [STORY_3]: { id: STORY_3, type: "story", by: "bob_3", title: "Third mocked story", score: 9, time: now - 2000, descendants: 0 },
};

const listPage = (ids, moreHref, title) =>
  '<!doctype html><html lang="en" op="faves"><head><meta name="referrer" content="origin"><title>' + title + '</title></head><body><center><table id="hnmain" border="0" cellpadding="0" cellspacing="0" width="85%" bgcolor="#f6f6ef">' +
  '<tr><td bgcolor="#ff6600"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding:2px"><tr>' +
  '<td style="line-height:12pt; height:10px;"><span class="pagetop"><b class="hnname"><a href="news">Hacker News</a></b>' +
  '<a href="newest">new</a> | <a href="submit" rel="nofollow">submit</a></span></td>' +
  '<td style="text-align:right;padding-right:4px;"><span class="pagetop"><a id="me" href="user?id=' + USER + '">' + USER + '</a>&nbsp;(<span id="karma">512</span>)&#32;|&#32;' +
  '<a id="logout" href="logout?auth=' + TOKEN_B + '&amp;goto=news">logout</a></span></td></tr></table></td></tr>' +
  '<tr><td style="padding:10px"><table border="0" cellpadding="0" cellspacing="0">' +
  ids.map((id) =>
    '<tr class="athing" id="' + id + '"><td align="right" valign="top" class="title"><span class="rank">1.</span></td>' +
    '<td class="title"><span class="titleline"><a href="item?id=' + id + '">Listed story ' + id + '</a></span></td></tr>'
  ).join("") +
  "</table>" +
  (moreHref ? '<tr><td colspan="2"><a class="morelink" href="' + moreHref + '">More</a></td></tr>' : "") +
  "</td></tr></table></center></body></html>";

const browser = await chromium.launchPersistentContext("", {
  executablePath: "/usr/bin/chromium",
  headless: true,
  viewport: { width: 1919, height: 872 },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-extensions-except=" + extensionPath, "--load-extension=" + extensionPath],
});

const requests = [];
await browser.route("**/*", async (route) => {
  const parsed = new URL(route.request().url());
  if (parsed.hostname === "news.ycombinator.com") {
    requests.push(parsed.pathname + parsed.search);
    if (parsed.pathname === "/favorites") {
      const page = Number(new URL(parsed.href).searchParams.get("p") || 1);
      return route.fulfill({ status: 200, contentType: "text/html", body: page >= 2 ? listPage([STORY_3], null, "p2") : listPage([STORY_ID, STORY_2], "favorites?p=2", "p1") });
    }
    if (parsed.pathname === "/item") return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic/item-in.html") });
    if (parsed.pathname === "/news" || parsed.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic/news-in.html") });
    return route.fulfill({ status: 200, contentType: "text/html", body: fixture("synthetic/news-in.html") });
  }
  if (parsed.hostname === "hacker-news.firebaseio.com") {
    const userMatch = parsed.pathname.match(/\/user\/([A-Za-z0-9_-]+)\.json$/);
    if (userMatch) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(userMatch[1] === USER ? { id: USER, created: 1270000000, karma: 512, about: "<p>hi</p>", submitted: [STORY_ID, STORY_2] } : { id: userMatch[1], created: 1270000000, karma: 512, about: null, submitted: [STORY_ID, STORY_2] }) });
    }
    const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.json/);
    if (itemMatch) {
      const id = Number(itemMatch[1]);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stories[id] || { id, type: "story", title: "Mocked story", score: 1, time: now, descendants: 0 }) });
    }
    if (parsed.pathname.endsWith("/topstories.json")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([STORY_ID, STORY_2, STORY_3]) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  }
  if (parsed.hostname === "hn.algolia.com") {
    const itemMatch = parsed.pathname.match(/\/items\/(\d+)/);
    if (itemMatch) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: Number(itemMatch[1]), title: "D", story_id: STORY_ID, story_title: "S", author: "a", points: 1, created_at_i: now, text: "t", children: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: [] }) });
  }
  return route.continue();
});

const page = await browser.newPage();
const consoleMessages = [];
page.on("console", (m) => consoleMessages.push(m.text()));
page.on("pageerror", (e) => consoleMessages.push("pageerror: " + e.message));
await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 20000 });

// Watch DOM churn on story cards for 6 seconds.
await page.evaluate(() => {
  window.__mut = [];
  const seen = new Set();
  const record = (kind, node) => {
    if (!(node instanceof Element)) return;
    const cls = node.className && typeof node.className === "string" ? node.className.split(" ")[0] : node.tagName;
    const key = kind + ":" + cls + ":" + (node.dataset?.storyId || "");
    const t = Math.round(performance.now());
    const last = window.__mut[window.__mut.length - 1];
    if (last && last.key === key && t - last.t0 < 400) { last.n++; last.t1 = t; return; }
    window.__mut.push({ key, kind, cls, id: node.dataset?.storyId || "", t0: t, t1: t, n: 1 });
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.removedNodes.forEach((n) => record("rm", n));
      m.addedNodes.forEach((n) => record("add", n));
    }
  }).observe(document.body, { childList: true, subtree: true });
});

await page.locator("#harmonic-account-chip").click();
await page.locator(".harmonic-popup .popup-item", { hasText: "Favorites" }).click();
await page.waitForTimeout(6000);

const churn = await page.evaluate(() => window.__mut.filter((m) => m.cls.includes("story-card") || m.cls.includes("list-view") || m.cls.includes("user-") || m.cls.includes("harmonic-")).slice(0, 60));
console.log("CHURN (story/list related):", JSON.stringify(churn, null, 1));
const counts = await page.evaluate(() => ({
  card2Now: document.querySelectorAll('.list-view-body .story-card[data-story-id="50022293"]').length,
  sample: Array.from({ length: 20 }, () => document.querySelectorAll('.list-view-body .story-card[data-story-id="50022293"]').length),
}));
console.log("card2 20 samples over ~1s:", JSON.stringify(counts.sample));
console.log("requests:", requests.join(" | "));
console.log("console:", consoleMessages.slice(-10).join("\n"));
await browser.close();