import assert from "node:assert/strict";
import fs from "node:fs";
import { launchExtension } from "./helpers/extension.mjs";

const hnFixture = fs.readFileSync(new URL("./fixtures/hn/synthetic/news-in.html", import.meta.url), "utf8");
async function isolatedWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = new Set();
  cdp.on("Runtime.executionContextCreated", e => contexts.add(e.context.id));
  await cdp.send("Runtime.enable");
  const evaluate = async expression => {
    for (const id of contexts) {
      const ready = await cdp.send("Runtime.evaluate", {
        expression: "typeof window.HarmoNovaHN !== 'undefined'",
        contextId: id, returnByValue: true,
      }).catch(() => null);
      if (ready?.result?.value !== true) continue;
      const outcome = await cdp.send("Runtime.evaluate", {
        expression, contextId: id, returnByValue: true, awaitPromise: true,
      });
      if (outcome.exceptionDetails)
        throw new Error(String(outcome.exceptionDetails.exception?.description || "CDP error"));
      return outcome.result.value;
    }
    throw new Error("Extension isolated world is missing");
  };
  return { evaluate, async close() { await cdp.detach(); } };
}
const request = (world, data) => world.evaluate("(async()=>await chrome.runtime.sendMessage(" +
  JSON.stringify(data) + "))()");

async function main() {
  const harness = await launchExtension();
  const { context, worker } = harness;
  try {
    await context.route("https://news.ycombinator.com/**", route => route.fulfill({
      status: 200, contentType: "text/html; charset=utf-8", body: hnFixture,
    }));
    await context.route("https://hacker-news.firebaseio.com/**", route => route.fulfill({
      status: 200, contentType: "application/json", body: "[]",
    }));
    await context.route("https://hn.algolia.com/**", route => route.fulfill({
      status: 200, contentType: "application/json", body: '{"hits":[]}',
    }));
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first, second].map(p =>
      p.goto("https://news.ycombinator.com/news", { waitUntil: "domcontentloaded" })));
    const one = await isolatedWorld(first);
    const two = await isolatedWorld(second);
    const responses = await Promise.all([
      request(one, { type: "HARMONOVA_SET_BOOKMARK", id: 920101, desired: true }),
      request(two, { type: "HARMONOVA_SET_BOOKMARK", id: 920102, desired: true }),
      request(one, { type: "HARMONOVA_MARK_READ", id: 920103 }),
      request(two, { type: "HARMONOVA_MARK_READ", id: 920104 }),
    ]);
    assert.ok(responses.every(r => r.ok), JSON.stringify(responses));
    const state = await worker.evaluate(() =>
      new Promise(resolve => chrome.storage.local.get("harmonovaReaderStateV1",
        v => resolve(v.harmonovaReaderStateV1))));
    assert.deepEqual([...state.bookmarks].sort((a,b)=>a-b), [920101,920102]);
    assert.deepEqual([...state.readIds].sort((a,b)=>a-b), [920103,920104]);
    const revision = state.revision;
    const repeated = await request(one, { type: "HARMONOVA_SET_BOOKMARK",
      id: 920101, desired: true });
    assert.equal(repeated.changed, false);
    const unchanged = await worker.evaluate(() =>
      new Promise(resolve => chrome.storage.local.get("harmonovaReaderStateV1",
        v => resolve(v.harmonovaReaderStateV1.revision))));
    assert.equal(unchanged, revision);
    await one.close(); await two.close();
    await first.close(); await second.close();
    console.log("ok - real-worker cross-tab reader mutations retain all distinct IDs");
  } finally {
    await harness.close();
  }
}
await main();
