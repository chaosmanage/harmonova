import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBackground } from "./helpers/worker.mjs";
const sender = { id: "test-extension-id", frameId: 0,
  url: "https://news.ycombinator.com/item?id=910001",
  tab: { id: 73, url: "https://news.ycombinator.com/news" } };
const options = { id: "test-extension-id",
  url: "chrome-extension://test-extension-id/ai-settings.html" };
const ask = (listeners, message, caller) =>
  new Promise(resolve => listeners.message(message, caller, resolve));
const consent = patch => ({
  version: 1, consentVersion: 1, enabled: true, autoSummarize: false,
  model: "openrouter/free", systemPrompt: "Summarize the provided public source.",
  streamResponses: false, allowEmptyRetry: false, ...patch,
});
test("new installations ship the concise Markdown article-summary prompt", () => {
  const { context } = loadBackground();
  const prompt = context.HarmoNovaAiPolicy.defaults.systemPrompt;
  assert.equal(prompt, "You are an expert at summarizing articles into concise, information-dense bullet points. Prioritize key takeaways, significant facts, and noteworthy insights while eliminating fluff and repetition. Preserve accuracy and essential context. Keep summaries under 500 characters whenever possible. Use Markdown formatting. Output only the summary, with no introductions, conclusions, or additional commentary.");
  assert.ok(new TextEncoder().encode(prompt).byteLength <= 8192);
});
test("P03 disabled by default despite stored API key and older preferences", async () => {
  const { context, listeners, stores } = loadBackground({ fetchImpl: async () => {
    throw new Error("Unexpected provider call");
  }});
  await context.saveAiKey("dummy-no-consent", "session");
  stores.sync.harmonovaSettings = { aiEnabled: true, aiModel: "paid/model", aiAutoSummarize: true };
  const status = await ask(listeners, { type: "HARMONOVA_AI_STATUS" }, sender);
  assert.equal(status.enabled, false);
  assert.equal(status.autoSummarize, false);
  await assert.rejects(context.summarizeWithOpenRouter({ postMessage() {} },
    { storyId: 1, requestId: "one", source: "discussion", discussionText: "a".repeat(50) },
    new AbortController()), /consent required/);
});
test("P03 only exact options page can set validated billable policy", async () => {
  const { listeners, stores } = loadBackground({ fetchImpl: async () => { throw Error("network"); } });
  for (const caller of [sender, { ...options, url: "chrome-extension://test-extension-id/popup.html" }]) {
    assert.equal((await ask(listeners, { type: "HARMONOVA_AI_POLICY_SAVE", policy: consent() }, caller)).ok, false);
  }
  for (const invalid of [
    consent({ consentVersion: 0 }), consent({ model: "paid/model;evil" }),
    consent({ systemPrompt: "x".repeat(8193) }), consent({ enabled: "true" }),
    { ...consent(), userGesture: true },
  ]) {
    const reply = await ask(listeners, { type: "HARMONOVA_AI_POLICY_SAVE", policy: invalid }, options);
    assert.equal(reply.ok, false);
  }
  assert.equal(stores.local.harmonovaAiPolicyV1, undefined);
  const applied = await ask(listeners, { type: "HARMONOVA_AI_POLICY_SAVE", policy: consent({ model: "strict/test" }) }, options);
  assert.equal(applied.ok, true);
  assert.equal(stores.local.harmonovaAiPolicyV1.model, "strict/test");
  assert.equal((await ask(listeners, { type: "HARMONOVA_AI_STATUS" }, sender)).model, undefined);
});
test("P03 configured discussion uses worker model and refuses caller overrides", async () => {
  const network = [], events = [];
  const { context, listeners } = loadBackground({ fetchImpl: async (url, init) => {
    network.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "- Authorized" } }] }), {headers:{"content-type":"application/json"}});
  }});
  await context.saveAiKey("dummy-auth-key", "session");
  assert.equal((await ask(listeners, { type: "HARMONOVA_AI_POLICY_SAVE",
    policy: consent({ model: "configured/model" }) }, options)).ok, true);
  const forged = context.HarmoNovaMessageBoundary.validateAiMessage({
    type: "summarize", requestId: "summary-73", storyId: 12, source: "discussion",
    discussionText: "A public discussion sufficiently long for tests.",
    model: "attacker/expensive", streamResponses: true, allowEmptyRetry: true });
  assert.equal(forged.ok, false);
  await context.summarizeWithOpenRouter({ postMessage: e => events.push(e) }, {
    type: "summarize", requestId: "summary-73", storyId: 12, source: "discussion",
    discussionText: "A public discussion sufficiently long for tests.",
  }, new AbortController());
  assert.equal(network.length, 1);
  const post = JSON.parse(network[0].init.body);
  assert.equal(post.model, "configured/model");
  assert.equal(post.stream, false);
  assert.equal(network[0].init.credentials, "omit");
  assert.equal(network[0].init.redirect, "error");
  assert.equal(events.at(-1).requestId, "summary-73");
});

test("P03 one active paid request per tab; duplicate cannot restart it", async () => {
  let posts = 0;
  const { context, listeners } = loadBackground({ fetchImpl: async (url, init) => {
    posts++;
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }});
  await context.saveAiKey("dummy-key", "session");
  await ask(listeners, { type: "HARMONOVA_AI_POLICY_SAVE",
    policy: consent() }, options);
  const makePort = () => {
    const events = [], callbacks = {};
    const port = { name: "harmonova-ai", sender,
      disconnect() {},
      onMessage: { addListener(fn) { callbacks.message = fn; } },
      onDisconnect: { addListener(fn) { callbacks.disconnect = fn; } },
      postMessage(event) { events.push(event); } };
    listeners.connect(port);
    return { events, callbacks };
  };
  const first = makePort();
  const second = makePort();
  const req = { type: "summarize", requestId: "paid-one", storyId: 12,
    source: "discussion", discussionText: "This is a public discussion long enough to summarize." };
  first.callbacks.message(req);
  second.callbacks.message({ ...req, requestId: "paid-two" });
  assert.equal(second.events.at(-1).code, "AI_BUSY");
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(posts <= 1, "duplicate must never generate a second request");
  first.callbacks.message({ type: "cancel", requestId: "paid-one" });
  first.callbacks.disconnect();
});
