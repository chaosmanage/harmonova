import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackground } from './helpers/worker.mjs';
import { opaqueRedirect } from './helpers/fixtures.mjs';

const load = fetchImpl => loadBackground({ fetchImpl }).context;

test('P01 canonical URL table: DNS spelling, authority, literal addresses and scheme ports', () => {
  const policy = load(async () => { throw new Error('unexpected network'); }).HarmoNovaUrlPolicy;
  const blocked = [
    'http://0.1.2.3/', 'https://news.ycombinator.com./audit', 'http://printer/', 'https://[ff02::1]/',
    'https://NEWS.YCOMBINATOR.COM./', 'https://news%2eycombinator.com/', 'https://example.com../',
    'https://.example.com/', 'https://example..com/', 'https://bad_host.com/', 'https://-bad.com/',
    'https://example.com:80/', 'http://example.com:443/', 'https://user@example.com/',
    'https://user:pass@example.com/', 'https://%75ser@example.com/', 'https://example.com%2f.evil/',
    'https://box.local/', 'https://box.internal/', 'https://box.lan/', 'https://box.home.arpa/',
    'https://localhost./', 'https://[::ffff:8.8.8.8]/', 'https://[::ffff:192.168.1.1]/',
    'https://[64:ff9b::a00:1]/', 'https://[2002:a00:1::]/', 'https://[2001::1]/',
    'https://[::]/', 'https://[::1]/', 'https://[fe80::1]/', 'https://[fc00::1]/',
    'https://[2001:4860:4860::8888]/', 'https://8.8.8.8/',
    'http://134744072/', 'http://0x08080808/', 'http://010.010.010.010/', 'http://8.134744/',
    '/relative', '//example.com/', 'https:example.com', ' https://example.com/', 'https://example.com\\@evil.test/',
  ];
  for (const value of blocked) assert.equal(policy.isAllowedRemoteUrl(value), false, value);
  for (const value of ['https://EXAMPLE.COM./a', 'https://bücher.de/', 'https://xn--bcher-kva.de/',
    'https://%65xample.com/a%2fb', 'https://example.com:443/', 'http://example.com:80/',
    'https://notycombinator.com/', 'https://news.ycombinator.com.evil.test/', 'https://box.local.evil.test/'])
    assert.equal(policy.isAllowedRemoteUrl(value), true, value);
  assert.equal(policy.canonicalRemoteUrl('https://EXAMPLE.COM./a'), 'https://example.com/a');
  assert.equal(policy.isHackerNewsHost('NEWS.YCOMBINATOR.COM.'), true);
});

test('P01 CIDR boundaries reviewed against IANA; all literal fetches rejected regardless of classification', () => {
  const p = load(async () => {}).HarmoNovaUrlPolicy;
  const ranges = [ ['0.0.0.0','0.255.255.255'], ['10.0.0.0','10.255.255.255'],
    ['100.64.0.0','100.127.255.255'], ['127.0.0.0','127.255.255.255'], ['169.254.0.0','169.254.255.255'],
    ['172.16.0.0','172.31.255.255'], ['192.0.0.0','192.0.0.8'], ['192.0.0.11','192.0.0.255'],
    ['192.0.2.0','192.0.2.255'], ['192.88.99.0','192.88.99.255'], ['192.168.0.0','192.168.255.255'],
    ['198.18.0.0','198.19.255.255'], ['198.51.100.0','198.51.100.255'], ['203.0.113.0','203.0.113.255'],
    ['224.0.0.0','239.255.255.255'], ['240.0.0.0','255.255.255.255'] ];
  const integer = ip => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
  for (const [first,last] of ranges) for (const ip of [first,last]) {
    assert.equal(p.isPrivateIpv4(integer(ip)), true, ip);
    assert.equal(p.isAllowedRemoteUrl('https://' + ip), false, ip);
  }
  for (const ip of ['1.0.0.0','9.255.255.255','11.0.0.0','100.63.255.255','100.128.0.0',
    '126.255.255.255','128.0.0.0','169.253.255.255','169.255.0.0','172.15.255.255','172.32.0.0',
    '192.0.0.9','192.0.0.10','192.0.1.0','192.0.3.0','192.168.255.255']) {
    if (ip === '192.168.255.255') continue;
    assert.equal(p.isPrivateIpv4(integer(ip)), false, ip);
    assert.equal(p.isAllowedRemoteUrl('https://' + ip), false, ip);
  }
  for (const ip of ['192.167.255.255','192.169.0.0','198.17.255.255','198.20.0.0',
    '198.51.99.255','198.51.101.0','203.0.112.255','203.0.114.0','223.255.255.255'])
    assert.equal(p.isPrivateIpv4(integer(ip)), false, ip);
});

test('P01 transport fixes caller overrides and rejects opaque/readable redirects and unspecified network errors', async () => {
  for (const response of [opaqueRedirect(), ...[301,302,303,307,308].map(status => new Response(null, { status, headers: { location: 'https://public.test/' } }))]) {
    let calls = 0;
    const worker = load(async (url, init) => {
      calls++;
      assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
      return response;
    });
    await assert.rejects(() => worker.fetchPolicy('https://example.com/', { redirect: 'follow', credentials: 'include', referrerPolicy: 'unsafe-url' }), error => error.message === 'REMOTE_FETCH_BLOCKED' && error.code === 'REMOTE_FETCH_BLOCKED');
    assert.equal(calls, 1);
  }
  for (const message of ['Failed to fetch', 'Redirect disallowed', 'sensitive arbitrary network detail']) {
    const worker = load(async () => { throw new TypeError(message); });
    await assert.rejects(() => worker.fetchPolicy('https://example.com/'), error => error.message === 'REMOTE_FETCH_BLOCKED');
  }
});

test('P01 article, metadata, rich preview and image paths never follow redirects', async () => {
  for (const operation of ['article','metadata','rich','image']) {
    const calls = [];
    const worker = load(async (url, init) => { calls.push(init); return opaqueRedirect(); });
    if (operation === 'article') await assert.rejects(() => worker.fetchArticleText('https://example.com/'), /REMOTE_FETCH_BLOCKED/);
    if (operation === 'metadata') assert.equal((await worker.getMetadata('https://example.com/')).image, null);
    if (operation === 'rich') await worker.getRichPreview('https://github.com/user/repo');
    if (operation === 'image') assert.equal(await worker.imageTint('https://example.com/image'), null);
    assert.ok(calls.length > 0, operation);
    for (const init of calls) { assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); }
  }
});

test('P01 AI initial and empty-summary recovery POSTs share the external policy', async () => {
  for (const redirectAt of [1,2,0]) {
    let posts = 0;
    const worker = load(async (url, init) => {
      assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
      if (!String(url).includes('openrouter.ai')) return new Response('Direct article', { headers: { 'content-type': 'text/plain' } });
      posts++;
      if (posts === redirectAt) return opaqueRedirect();
      if (posts === 1) return new Response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Summary' } }] }), { headers: { 'content-type': 'application/json' } });
    });
    await worker.saveAiKey('dummy', 'session');
    const summarize = () => worker.summarizeWithOpenRouter({ postMessage() {} }, { storyId: 1, url: 'https://example.com/', model: 'openrouter/free', systemPrompt: 'Summarize', streamResponses: true }, new AbortController());
    if (redirectAt) await assert.rejects(summarize, /REMOTE_FETCH_BLOCKED/); else await summarize();
    assert.equal(posts, redirectAt === 1 ? 1 : 2);
  }
});
