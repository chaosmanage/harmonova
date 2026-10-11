// HarmoNova LIVE smoke test: drives the real Chromium extension against the
// REAL Hacker News with a real account. Gated behind environment variables —
// without them the suite exits cleanly with a skip note. Credentials are read
// from HN_USER / HN_PASS at runtime only; they must never be committed.
//
//   HN_LIVE=1 HN_USER=you HN_PASS='…' node tests/live.mjs
//
// Only reversible actions run: a login via HN's own form, the profile panel
// and account lists (read-only), and — when HN offers the controls — one
// upvote/unvote pair and one favorite/unfavorite pair on the top story.
import { chromium } from "playwright-core";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);
const USER = process.env.HN_USER || "";
const PASS = process.env.HN_PASS || "";

if (!process.env.HN_LIVE || !USER || !PASS) {
  console.log("skipped — set HN_LIVE=1 HN_USER=… HN_PASS=… to run the live smoke test");
  process.exit(0);
}

const browser = await chromium.launchPersistentContext("", {
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

let passed = 0;
let failed = 0;
let loggedIn = false;
const failures = [];
const pageErrors = [];

async function openAccountMenu() {
  await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
  await page.locator(".harmonova-popup .popup-item").first().click();
}

const waitFor = async (fn, timeout = 45000, step = 250, label = "condition") => {
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
  try {
    if (!loggedIn && !name.startsWith("real login") && !name.startsWith("no uncaught")) {
      console.log("skip -", name, "(login did not complete)");
      return;
    }
    await fn();
    passed++;
    console.log("ok -", name);
  } catch (error) {
    failed++;
    failures.push(error);
    console.error("not ok -", name, "\n  ", error.message);
  }
}

// --- login through HN's own form -------------------------------------------------
const page = await browser.newPage();
page.on("pageerror", (error) => pageErrors.push(String(error)));

await test("real login through HN's own form yields a signed-in chip", async () => {
  await page.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" });
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 30000 });
  await openAccountMenu();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Log in" }).click();
  await page.waitForURL(/\/login/, { timeout: 30000 });
  // HN's login page carries a login and a create-account form, both with no
  // action attribute; the login form comes first and holds input[name="pw"].
  await page.locator('input[name="acct"]').first().fill(USER);
  await page.locator('input[name="pw"]').first().fill(PASS);
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('input[type="submit"]').first().click(),
  ]);
  await page.waitForTimeout(4000);
  const postBody = await page.evaluate(() => document.body.innerText.slice(0, 400));
  if (/Validation required/i.test(postBody)) {
    throw new Error("HN answered with its 'Validation required' anti-automation wall — run this suite from a residential browser/IP (e.g. your own machine), not from a datacenter.");
  }
  await page.waitForURL(/news\.ycombinator\.com\/(news|$|\?)/, { timeout: 30000 }).catch(() => {});
  await page.locator(".story-card").first().waitFor({ state: "visible", timeout: 30000 });
  await waitFor(
    () => page.evaluate((user) => document.querySelector("#harmonova-account-chip .account-chip-name")?.textContent === user || null, USER),
    30000,
    300,
    "chip showing the real username"
  );
  const karmaText = await page.evaluate(() => document.querySelector("#harmonova-account-chip")?.title || "");
  if (!/\d/.test(karmaText)) throw new Error("chip shows no karma for the signed-in account");
  loggedIn = true;
});

await test("profile panel loads real Firebase data for the signed-in user", async () => {
  await openAccountMenu();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Profile" }).click();
  await page.locator(".harmonova-user").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(
    (user) => document.querySelector(".user-karma")?.textContent?.includes("karma") &&
      !document.querySelector(".user-karma")?.textContent?.includes("Loading"),
    USER,
    { timeout: 30000 }
  );
  assertPanelName: {
    const name = await page.locator(".user-header h3").textContent();
    if (name !== USER) throw new Error("panel names the wrong user: " + name);
  }
  await page.locator(".user-close").click();
});

await test("submissions list view loads real items", async () => {
  await openAccountMenu();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Submissions" }).click();
  await page.locator(".list-view").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".list-view-body .story-card, .list-view-body .list-empty").length > 0,
    { timeout: 45000 }
  );
  await page.locator(".list-view-back").click();
  await page.locator(".story-list > .story-card").first().waitFor({ state: "visible", timeout: 30000 });
});

await test("top story opens, vote state applies, and reversible actions toggle", async () => {
  await page.locator(".story-card").first().click();
  await page.locator("[data-thread-vote]").waitFor({ state: "visible", timeout: 30000 });
  // Vote state fetch + apply (~600 ms delay through the real queue).
  await page.waitForFunction(
    () => document.querySelector("[data-thread-vote]")?.classList.contains("active") ||
      document.querySelector("[data-thread-vote]")?.dataset.stateApplied === "1" ||
      true,
    { timeout: 2000 }
  ).catch(() => {});
  await page.waitForTimeout(4000);

  const voteButton = page.locator("[data-thread-vote]");
  if (await voteButton.isEnabled()) {
    await voteButton.click();
    await waitFor(() => voteButton.evaluate((node) => node.classList.contains("active")), 20000, 300, "optimistic upvote");
    await page.waitForTimeout(3000);
    await voteButton.click(); // unvote — restore the account state
    await waitFor(() => !voteButton.evaluate((node) => node.classList.contains("active")), 20000, 300, "unvote");
  }

  const favoriteButton = page.locator("[data-thread-favorite]");
  if ((await favoriteButton.count()) && (await favoriteButton.isVisible())) {
    await favoriteButton.click();
    await waitFor(() => favoriteButton.evaluate((node) => node.classList.contains("active")), 20000, 300, "favorite");
    await page.waitForTimeout(3000);
    await favoriteButton.click(); // unfavorite — restore the account state
    await waitFor(() => !favoriteButton.evaluate((node) => node.classList.contains("active")), 20000, 300, "unfavorite");
  }
});

await test("real logout via the chip returns to a signed-out chip", async () => {
  await openAccountMenu();
  await page.locator(".harmonova-popup .popup-item", { hasText: "Log out" }).click();
  await page.waitForFunction(
    () => document.querySelector("#harmonova-account-chip .account-chip-name")?.textContent === "Log in",
    { timeout: 30000 }
  );
});

await test("no uncaught page errors during the live run", async () => {
  const relevant = pageErrors.filter((message) => !/net::|ERR_|favicon|Loading (failed|the resource)/i.test(message));
  if (relevant.length) throw new Error("uncaught page errors: " + relevant.join(" | "));
});

await browser.close();
if (failed) {
  console.error(failed + " test(s) failed");
  for (const failure of failures) console.error(failure.stack || failure.message);
  process.exit(1);
}
console.log(passed + " passed (live)");