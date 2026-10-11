import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const stores = { local: {}, session: {}, sync: {} };
const messages = [];
const listeners = {};
const area = (name) => ({
  get(keys, cb) { const result = { ...keys, ...stores[name] }; cb?.(result); return Promise.resolve(result); },
  set(value, cb) { Object.assign(stores[name], value); cb?.(); return Promise.resolve(); },
  remove(keys, cb) { for (const key of [keys].flat()) delete stores[name][key]; cb?.(); return Promise.resolve(); },
  setAccessLevel(value) { assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS'); return Promise.resolve(); },
});
const worker = vm.createContext({
  chrome: {
    storage: Object.fromEntries(Object.keys(stores).map((name) => [name, area(name)])),
    tabs: { onRemoved: { addListener() {} } },
    runtime: {
      getURL: (path) => 'chrome-extension://test/' + path,
      onConnect: { addListener(fn) { listeners.connect = fn; } },
      onMessage: { addListener(fn) { listeners.message = fn; } },
    },
  },
  importScripts: (...files) => {
    for (const file of files) {
      vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), worker);
    }
  },
  URL, AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout,
  crypto: { subtle: { digest: (algo, bytes) => crypto.subtle.digest(algo, bytes) } },
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  fetch: async () => { throw new Error('Unexpected network request'); },
  Response, ReadableStream, OffscreenCanvas: class {}, createImageBitmap: async () => { throw new Error('no image'); },
});
vm.runInContext(fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8'), worker);
const stream = (chunks) => new Response(new ReadableStream({ start(controller) {
  for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
  controller.close();
} }));

test('SSE handles fragmented CRLF, comments, usage events and completion', async () => {
  const progress = [];
  const response = stream([': heartbeat\r', '\n\r', '\ndata: {"choices":[{"delta":{"content":"Alpha"}}]}\r', '\n\r', '\ndata: {"choices":[],"usage":{}}\n\ndata: {"choices":[{"delta":{"content":" β"}}]}\n\ndata: [DONE]\n\n']);
  assert.equal(await worker.streamOpenRouter(response, (value) => progress.push(value)), 'Alpha β');
  assert.deepEqual(progress, ['Alpha', 'Alpha β']);
});

test('SSE rejects errors, empty summaries, malformed and oversized events', async () => {
  for (const [body, error] of [
    ['data: {"error":{"message":"Rate limited"}}\n\n', /Rate limited/],
    ['data: {"choices":[{"finish_reason":"error"}]}\n\n', /stream failed/],
    ['data: [DONE]\n\n', /empty summary/],
    ['data: invalid\n\n', /invalid streaming/],
    ['data: ' + 'x'.repeat(140000), /size limit/],
  ]) await assert.rejects(worker.streamOpenRouter(stream([body]), () => {}), error);
});

test('article extraction handles plain text, malformed HTML, input limits and unsupported types', async () => {
  worker.fetch = async () => new Response('<body><script>secret()</script><p>Visible &amp; readable &#x1f600;</p>' + 'x'.repeat(18000), { headers: { 'content-type': 'text/html' } });
  const text = await worker.fetchArticleText('https://example.com/article');
  assert.equal(text.length, 15000);
  assert.ok(text.startsWith('Visible & readable 😀'));
  assert.ok(!text.includes('secret()'));
  worker.fetch = async () => new Response('plain article', { headers: { 'content-type': 'text/plain' } });
  assert.equal(await worker.fetchArticleText('https://example.com'), 'plain article');
  worker.fetch = async () => new Response('binary', { headers: { 'content-type': 'application/pdf' } });
  await assert.rejects(worker.fetchArticleText('https://example.com'), /not readable/);
  await assert.rejects(worker.fetchArticleText('file:///secret'), /Unsupported/);
  await assert.rejects(worker.readResponseTextLimited(stream(['oversized']), 2), /size limit/);
});

test('credentials move between persistent and session stores and reject content-script mutation', async () => {
  await worker.saveAiKey('test-private-key', 'persistent');
  assert.equal(stores.local.harmonovaAiApiKey, 'test-private-key');
  await worker.saveAiKey('test-session-key', 'session');
  assert.equal(stores.local.harmonovaAiApiKey, undefined);
  assert.equal(stores.session.harmonovaAiApiKeySession, 'test-session-key');
  assert.ok(!JSON.stringify(stores.sync).includes('test-session-key'));
  listeners.message({ type: 'HARMONOVA_AI_CLEAR_KEY' }, { tab: { id: 1 }, url: 'https://news.ycombinator.com' }, (value) => messages.push(value));
  assert.equal(messages.at(-1).ok, false);
  assert.equal(stores.session.harmonovaAiApiKeySession, 'test-session-key');
  await worker.clearAiKey();
  assert.equal((await worker.aiKeyStatus()).hasKey, false);
});

test('non-streaming request uses private credentials and the capped article', async () => {
  await worker.saveAiKey('test-private-key', 'session');
  let request;
  worker.fetch = async (url, options) => {
    if (url.includes('openrouter.ai')) {
      request = options;
      return new Response(JSON.stringify({ choices: [{ message: { content: '- Summary' } }] }));
    }
    return new Response('x'.repeat(20000), { headers: { 'content-type': 'text/plain' } });
  };
  const progress = [];
  await worker.summarizeWithOpenRouter({ postMessage: (value) => progress.push(value) }, { storyId: 1, url: 'https://example.com', model: 'openrouter/free', systemPrompt: 'Summarize', streamResponses: false }, new AbortController());
  assert.equal(request.headers.Authorization, 'Bearer test-private-key');
  assert.equal(JSON.parse(request.body).messages[1].content.length, 15000);
  assert.equal(progress.at(-1).type, 'success');
  assert.equal(progress.at(-1).text, '- Summary');
  assert.ok(!JSON.stringify(progress).includes('test-private-key'));
  await worker.clearAiKey();
  await assert.rejects(worker.summarizeWithOpenRouter({ postMessage() {} }, { storyId: 1, url: 'https://example.com', model: 'openrouter/free', systemPrompt: 'Summarize' }, new AbortController()), /key is not configured/);
});


test('empty streamed reasoning output retries once without streaming', async () => {
  await worker.saveAiKey('retry-test-key', 'session');
  const requests = [];
  worker.fetch = async (url, options) => {
    if (!url.includes('openrouter.ai')) return new Response('Article content', { headers: { 'content-type': 'text/plain' } });
    const request = JSON.parse(options.body);
    requests.push(request);
    if (request.stream) return stream(['data: {"choices":[{"delta":{"reasoning":"thinking"},"finish_reason":"length"}],"usage":{"completion_tokens":2200}}\n\n', 'data: [DONE]\n\n']);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Recovered summary' } }] }));
  };
  const events = [];
  await worker.summarizeWithOpenRouter({ postMessage: (event) => events.push(event) }, { storyId: 77, url: 'https://example.com/story', model: 'example/reasoning', systemPrompt: 'Summarize', streamResponses: true }, new AbortController());
  assert.equal(requests.length, 2, 'one recovery request only');
  assert.equal(requests[0].max_tokens, 2200);
  assert.equal(requests[1].max_tokens, 3500);
  assert.equal(requests[1].stream, false);
  assert.ok(events.some((event) => event.detail === 'Retrying without streaming…'));
  assert.equal(events.at(-1).text, 'Recovered summary');
  await worker.clearAiKey();
});

test('HTTP 403 gives a clear access restriction instead of a generic fetch error', async () => {
  worker.fetch = async () => new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
  await assert.rejects(worker.fetchArticleText('https://example.com/blocked'), (error) => {
    assert.equal(error.code, 'ARTICLE_ACCESS_DENIED');
    assert.match(error.message, /website does not allow HarmoNova to read/i);
    assert.match(error.message, /discussion instead/i);
    return true;
  });
});

test('opt-in discussion summary does not fetch blocked articles or mislabel source', async () => {
  await worker.saveAiKey('private-discussion-key', 'session');
  const requests = [];
  worker.fetch = async (url, options) => {
    requests.push({ url, body: options?.body });
    if (!url.includes('openrouter.ai')) throw new Error('Article network request must not be made for discussion mode');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Summary of commenters' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  const messages = [];
  await worker.summarizeWithOpenRouter({ postMessage: (value) => messages.push(value) }, {
    storyId: 17, source: 'discussion', discussionText: 'HN discussion: browser extension usability, preferences, feedback and concerns.',
    model: 'openrouter/free', systemPrompt: 'Summarize this article', streamResponses: false,
  }, new AbortController());
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].body);
  assert.match(body.messages[0].content, /NOT read the linked article/);
  assert.match(body.messages[1].content, /extension usability/);
  assert.equal(messages.at(-1).text, 'Summary of commenters');
  await worker.clearAiKey();
});
