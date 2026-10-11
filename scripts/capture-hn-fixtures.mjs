// Capture HN protocol fixtures without ever entering, logging or saving credentials.
// Usage: HN_CAPTURE_STORY_ID=123456 HN_CAPTURE_COMMENT_ID=456789 node scripts/capture-hn-fixtures.mjs
// A PERSON signs in on HN's own form in the headed browser, then presses Enter.
import { chromium } from "playwright-core";
import { createInterface } from "node:readline/promises";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { stdin, stdout } from "node:process";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "tests/fixtures/real");
const id = Number(process.env.HN_CAPTURE_STORY_ID);
const comment = Number(process.env.HN_CAPTURE_COMMENT_ID);
const own = Number(process.env.HN_CAPTURE_OWN_COMMENT_ID);
if (!Number.isSafeInteger(id) || id <= 0) {
  console.error("Set HN_CAPTURE_STORY_ID to a public HN discussion id.");
  process.exit(1);
}
const paths = [
  ["news.html", "/news"],
  ["story.html", "/item?id=" + id],
  ["submit.html", "/submit"],
  ["favorites.html", "/favorites"],
  ["upvoted.html", "/upvoted"],
  ...(Number.isSafeInteger(comment) && comment > 0 ? [["reply.html", "/reply?id=" + comment]] : []),
  ...(Number.isSafeInteger(own) && own > 0 ? [["own-edit.html", "/edit?id=" + own]] : []),
];
const browser = await chromium.launchPersistentContext("", {
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: false, viewport: { width: 1440, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const input = createInterface({ input: stdin, output: stdout });
const captured = new Map();
const errors = [];
let actingUser = "";
const TOKEN40 = /\b[0-9a-f]{40}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function redact(source) {
  let text = String(source || "");
  text = text.replace(TOKEN40, "0".repeat(40));
  text = text.replace(EMAIL, "removed@example.invalid");
  if (actingUser) text = text.split(actingUser).join("harmonic_test");
  // No field value from a login form is retained even in an unexpected page.
  text = text.replace(/(<input[^>]*name=["'](?:acct|pw|password)["'][^>]*value=["'])[^"']*(["'])/gi, "$1REDACTED$2");
  text = text.replace(/(<input[^>]*value=["'])[^"']*(["'][^>]*name=["'](?:acct|pw|password)["'])/gi, "$1REDACTED$2");
  text = text.replace(/(<span[^>]*id=["']karma["'][^>]*>)[\s\S]*?(<\/span>)/gi, (_, before, after) => before + "512" + after);
  return text;
}
function assertSafe(label, text) {
  if (actingUser && text.includes(actingUser)) errors.push(label + ": username still present");
  for (const match of text.match(TOKEN40) || [])
    if (match !== "0".repeat(40) && match !== "1".repeat(40)) errors.push(label + ": token");
  for (const email of text.match(EMAIL) || [])
    if (!email.endsWith("@example.invalid")) errors.push(label + ": email");
  if (/name=["']pw["'][^>]*value=["'][^"']+["']/i.test(text)) errors.push(label + ": password field value");
}
const votes = [];
page.on("response", async (response) => {
  let url;
  try { url = new URL(response.url()); } catch { return; }
  if (url.origin !== "https://news.ycombinator.com" || url.pathname !== "/vote" || url.searchParams.get("js") !== "t") return;
  const body = await response.text().catch(() => "");
  // Save only status + redacted response BODY; URLs contain auth tokens.
  votes.push({ status: response.status(), body: redact(body) });
});
try {
  await page.goto("https://news.ycombinator.com/login", { waitUntil: "domcontentloaded" });
  await input.question("Sign in manually on Hacker News (no password is handled by this script), then press Enter: ");
  actingUser = await page.locator("#me").textContent().catch(() => "");
  if (!actingUser || !/^[A-Za-z0-9_-]{1,32}$/.test(actingUser)) throw new Error("HN did not report a signed-in username; nothing captured.");
  for (const [name, pathName] of paths) {
    await page.goto("https://news.ycombinator.com" + pathName, { waitUntil: "domcontentloaded" });
    const html = redact(await page.content());
    assertSafe(name, html);
    captured.set(name, html);
  }
  await page.goto("https://news.ycombinator.com/item?id=" + id, { waitUntil: "domcontentloaded" });
  await input.question("Optional: manually vote then unvote THIS test story, then press Enter to save sanitized vote response(s): ");
  const voteJson = JSON.stringify(votes);
  assertSafe("vote-replies.json", voteJson);
  if (errors.length) throw new Error("Redaction check failed: " + errors.join("; "));
  await fs.mkdir(destination, { recursive: true });
  for (const [name, html] of captured) await fs.writeFile(path.join(destination, name), html, { mode: 0o600 });
  await fs.writeFile(path.join(destination, "vote-replies.json"), voteJson, { mode: 0o600 });
  await fs.writeFile(path.join(destination, "README.md"),
    "# Sanitized HN fixtures\n\nCaptured " + new Date().toISOString().slice(0, 10) +
    ". Usernames, tokens, karma and email addresses are replaced in memory before any fixture is written. No cookies or credentials are accessed.\n");
  console.log("Wrote", captured.size, "sanitized HN page fixtures and", votes.length, "vote responses.");
} finally {
  input.close();
  await browser.close();
}
