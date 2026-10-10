// Captures live logged-out Hacker News pages as raw fixtures.
// Raw captures land in tests/fixtures/hn/raw/ (gitignored) and are redacted
// into tests/fixtures/hn/ by scripts/redact-fixtures.mjs before any commit.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(repoRoot, "tests", "fixtures", "hn", "raw");
fs.mkdirSync(rawDir, { recursive: true });

const captures = [
  { name: "news.html", path: "/news" },
  { name: "news-page2.html", path: "/news?p=2" },
  { name: "newest.html", path: "/newest" },
  { name: "best.html", path: "/best" },
  { name: "front.html", path: "/front" },
  { name: "newcomments.html", path: "/newcomments" },
  { name: "ask.html", path: "/ask" },
  { name: "show.html", path: "/show" },
  { name: "jobs.html", path: "/jobs" },
  { name: "item-thread.html", path: process.env.CAPTURE_ITEM || "" },
  { name: "user.html", path: "/user?id=pg" },
  { name: "submitted.html", path: "/submitted?id=pg" },
  { name: "threads.html", path: "/threads?id=pg" },
  { name: "login.html", path: "/login?goto=news" },
  { name: "favorites-logged-out.html", path: "/favorites?id=pg" },
  { name: "upvoted-logged-out.html", path: "/upvoted?id=pg" },
  { name: "hidden-logged-out.html", path: "/hidden" },
  { name: "submit-logged-out.html", path: "/submit" },
];

// Locate a story with a healthy discussion to capture as the item fixture.
async function pickThreadItem(browser) {
  if (process.env.CAPTURE_ITEM) return process.env.CAPTURE_ITEM;
  const page = await browser.newPage();
  try {
    const res = await page.request.get("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=50&numericFilters=num_comments%3E30");
    const data = await res.json();
    const hit = (data.hits || []).find((h) => h.num_comments >= 30 && h.num_comments <= 200 && h.story_text === null);
    return hit ? String(hit.objectID) : null;
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

// Locate a poll item for parser coverage (may be absent; capture is optional).
async function pickPollItem(browser) {
  const page = await browser.newPage();
  try {
    const res = await page.request.get("https://hn.algolia.com/api/v1/search_by_date?tags=poll&hitsPerPage=10");
    const data = await res.json();
    const hit = (data.hits || []).find((h) => h.objectID);
    return hit ? String(hit.objectID) : null;
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});
try {
  const threadId = await pickThreadItem(browser);
  const pollId = await pickPollItem(browser);
  if (threadId) captures.push({ name: "item-thread.html", path: "/item?id=" + threadId });
  if (pollId) captures.push({ name: "item-poll.html", path: "/item?id=" + pollId });

  const context = await browser.newContext({ viewport: { width: 1919, height: 872 } });
  const page = await context.newPage();
  for (const capture of captures) {
    if (!capture.path) continue;
    const target = "https://news.ycombinator.com" + capture.path;
    try {
      const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
      const html = await page.content();
      const file = path.join(rawDir, capture.name);
      fs.writeFileSync(file, html);
      console.log("captured", capture.name, capture.path, "status", response?.status(), "bytes", html.length);
    } catch (error) {
      console.log("FAILED", capture.name, capture.path, error.message);
    }
  }
  await context.close();
} finally {
  await browser.close();
}
console.log("raw fixtures in", rawDir);