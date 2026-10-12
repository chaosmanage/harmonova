import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {launchExtension} from "./helpers/extension.mjs";
const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
export const runBrowserTests = async () => {
  const extensionPath = path.resolve(process.env.EXTENSION_PATH || repoRoot);
  const outDir = path.resolve(process.env.TEST_OUTPUT_DIR || "test-results");
  fs.mkdirSync(outDir, { recursive: true });

  const harness = await launchExtension();
  const context = harness.context;
  await context.route('https://news.ycombinator.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(repoRoot, 'tests/fixtures/hn/news.html'), 'utf8') }));

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
    id: story.id, title: "HarmoNova security fixture " + story.id, url: "https://en.wikipedia.org/wiki/" + story.path,
    author: "harmonova_test", points: 42, created_at_i: Math.floor(Date.now() / 1000) - 3600,
    text: null, children: [{
      id: story.id + 10, author: "harmonova_test", created_at_i: Math.floor(Date.now() / 1000) - 1800,
      text: "A comment.", children: [],
    }],
  });
  const storyFixture = (story) => JSON.stringify({
    id: story.id, type: "story", by: "harmonova_test", title: "HarmoNova security fixture " + story.id,
    url: "https://en.wikipedia.org/wiki/" + story.path, score: 42, time: Math.floor(Date.now() / 1000) - 3600,
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
        headers: { "set-cookie": "harmonova-cookie-test=1; SameSite=None; Secure" },
        contentType: "text/html",
        body: "<html><body>cookie page</body></html>",
      });
    }
    articleRequests.push({ url: request.url(), cookie: request.headers()["cookie"] || null });
    return route.fulfill({ status: 200, contentType: "text/html", body: ARTICLE_HTML });
  });
  await context.route('https://en.wikipedia.org/wiki/**',route=> {
    articleRequests.push({url:route.request().url(),cookie:route.request().headers().cookie||null});
    return route.fulfill({status:200,contentType:'text/html',body:ARTICLE_HTML});
  });
  await context.route('https://en.wikipedia.org/api/rest_v1/page/summary/**',route=> {
    articleRequests.push({url:route.request().url(),cookie:route.request().headers().cookie||null});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({type:'standard',title:'Fixture',extract:'A public provider extract long enough for an offline summary.'})});
  });
  let aiPosts = 0;
  await context.route("https://openrouter.ai/api/v1/chat/completions", (route) => {
    if (route.request().method() === "POST") aiPosts++;
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
    // P03: audit repro in ordinary page world. Neither old storage nor a
    // synthetic story click can enable paid work before extension-page consent.
    await page.evaluate(() => {
      localStorage.setItem("harmonova:settings:v1", JSON.stringify({
        aiEnabled: true, aiAutoSummarize: true, aiModel: "attacker/paid-model",
        aiSystemPrompt: "Injected", aiStreamResponses: true,
      }));
      location.hash = "harmonova-settings";
      document.querySelectorAll("input,textarea").forEach(node => node.dispatchEvent(new Event("change", { bubbles: true })));
      document.querySelector(".story-comment-button")?.click();
    });
    await page.waitForTimeout(400);
    assert.equal(aiPosts, 0, "page-world synthetic AI activation must never reach provider");
    await page.evaluate(() => document.querySelector(".settings-overlay")?.remove());

    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/ai-settings.html`, { waitUntil: "domcontentloaded" });
    await settingsPage.fill("#api-key", "security-test-key");
    await settingsPage.locator('input[name="storage"][value="session"]').check();
    await settingsPage.click("#save");
    await settingsPage.waitForFunction(() => document.querySelector("#message")?.textContent?.includes("saved"), null, { timeout: 5000 });
    assert.equal(await settingsPage.locator("#previews-enabled").isChecked(), true);
    await settingsPage.locator("#policy-enabled").check();
    await settingsPage.locator("#policy-save").click();
    await settingsPage.waitForFunction(() => document.querySelector("#policy-message")?.textContent?.includes("saved"));
    await settingsPage.close();

    await page.locator('[data-story-id="910001"]').locator(".story-comment-button").click();
    await page.locator(".thread-title").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(aiPosts, 0, "disabled automatic mode must not issue a provider request");
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
    assert.equal(aiPosts, 1, "trusted explicit click makes exactly one provider request");
    const updatedSettingsPage = await context.newPage();
    await updatedSettingsPage.goto(`chrome-extension://${extensionId}/ai-settings.html`);
    await updatedSettingsPage.locator("#policy-auto").check();
    await updatedSettingsPage.locator("#policy-save").click();
    await updatedSettingsPage.waitForFunction(() => document.querySelector("#policy-message")?.textContent?.includes("saved"));
    await updatedSettingsPage.close();
    await page.locator('[data-story-id="910002"] .story-comment-button').click();
    await page.waitForFunction(() => document.querySelector('[data-summary-story-id="910002"]')?.dataset.status === "success");
    assert.equal(aiPosts, 2, "trusted automatic selection issues one request");
    await page.evaluate(() => document.querySelector('[data-story-id="910001"] .story-comment-button')?.click());
    await page.waitForTimeout(500);
    assert.equal(aiPosts, 2, "synthetic selection with automatic consent still does not bill");

    // Stop an actual MV3 worker with a paid request in flight. A fresh worker
    // and ordinary page reload must never replay that request.
    const policyPage=await context.newPage();await policyPage.goto(`chrome-extension://${extensionId}/ai-settings.html`);
    await policyPage.locator('#policy-auto').uncheck();await policyPage.locator('#policy-save').click();
    await policyPage.waitForFunction(()=>document.querySelector('#policy-message')?.textContent.includes('saved'));
    let heldRoute;
    const hold=async route=>{if(route.request().method()==='POST')aiPosts++;heldRoute=route;};
    await context.route('https://openrouter.ai/api/v1/chat/completions',hold);
    await page.locator('[data-summary-action-id="910001"][data-summary-source="article"]').click();
    for(let i=0;i<100&&!heldRoute;i++)await page.waitForTimeout(50);
    assert.ok(heldRoute,'trusted request reached synthetic provider');assert.equal(aiPosts,3);
    const cdp=await context.newCDPSession(page);let versions=[];
    cdp.on('ServiceWorker.workerVersionUpdated',event=>{versions=event.versions;});
    await cdp.send('ServiceWorker.enable');
    for(let i=0;i<100&&!versions.some(v=>v.scriptURL===`chrome-extension://${extensionId}/background.js`&&v.runningStatus==='running');i++)await page.waitForTimeout(50);
    const active=versions.find(v=>v.scriptURL===`chrome-extension://${extensionId}/background.js`&&v.runningStatus==='running');assert.ok(active);
    await cdp.send('ServiceWorker.stopWorker',{versionId:active.versionId});
    await policyPage.reload();await policyPage.waitForFunction(()=>!document.querySelector('#key-status').textContent.includes('Checking'));
    await page.reload();await page.locator('.story-card').first().waitFor();
    await page.waitForTimeout(500);assert.equal(aiPosts,3,'worker restart and page reload do not replay paid work');
    await heldRoute.abort().catch(()=>{});await context.unroute('https://openrouter.ai/api/v1/chat/completions',hold);await cdp.detach();await policyPage.close();

    // -- SEC-22: background requests never carry cookies --------------------
    await context.addCookies([{name:"provider-cookie",value:"synthetic",domain:"en.wikipedia.org",path:"/",secure:true,sameSite:"None"}]);
    articleRequests.length = 0; // drop the pre-cookie preview requests
    const cookiePage = await context.newPage();
    await cookiePage.goto("https://example.test/cookie-page", { waitUntil: "domcontentloaded" });
    const jarCookie = await cookiePage.evaluate(() => document.cookie);
    assert.ok(jarCookie.includes("harmonova-cookie-test=1"), "the routed origin must hold the test cookie");
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
        chrome.runtime?.sendMessage?.(extId, { type: "HARMONOVA_PREVIEW", url: "https://evil.test/x" }, () => {});
        return "sent";
      } catch {
        return "blocked";
      }
    }, extensionId);
    assert.ok(["sent", "blocked"].includes(messageProbe));
    assert.equal(evilRequests.length, 0, "SEC-53: messaging from a web page must never reach handlers");

    // -- SEC-43: HarmoNova DOM never uses names hn.js reacts to --------------
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
    assert.deepEqual(reserved, [], "SEC-43: no hn.js-reserved class or id names in HarmoNova DOM");

    // -- SEC-01: no password inputs in HarmoNova DOM -------------------------
    const passwordInputs = await page.evaluate(() => document.querySelectorAll('input[type="password"]').length);
    assert.equal(passwordInputs, 0, "SEC-01: no password inputs in the HarmoNova UI");

    fs.writeFileSync(path.join(outDir, "security.png"), await page.screenshot());
    harness.assertOffline();
  } finally {
    await harness.close();
  }
};

await runBrowserTests();
console.log("Browser security gate passed");
