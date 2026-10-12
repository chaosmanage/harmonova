import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withExtension } from './helpers/extension.mjs';
import { localTlsFixture, localHttpFixture } from './helpers/network.mjs';

// Real browser Fetch, real redirects, real destination-side counters. No fetch shim
// or URL-policy override: public fixture names connect only to our local servers.
test('external redirects never send a second request; direct requests still work', async () => {
  const observed = [];
  const privateServer = await localHttpFixture((req, res) => {
    res.writeHead(302, { location: 'https://destination.test/end' }); res.end();
  });
  const publicServer = await localTlsFixture((req, res) => {
    observed.push({ cookie: Boolean(req.headers.cookie), referer: Boolean(req.headers.referer) });
    const u = new URL(req.url, 'https://api.github.com');
    if (u.pathname.startsWith('/repos/fixture/redirect-')) {
      const [,status,destination]=u.pathname.split('/').pop().split('-');
      const targets = { loopback: 'http://127.0.0.1/chain', private: 'http://10.0.0.1/chain', hn: 'https://news.ycombinator.com/forbidden', public: 'https://destination.test/end' };
      res.writeHead(Number(status), { location: targets[destination] }); res.end();
    } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"direct":true}'); }
  });
  try {
    const destinations = new Map([
      ...['api.github.com:443', 'destination.test:443', 'news.ycombinator.com:443'].map(h => [h, publicServer]),
      ...['127.0.0.1:80', '10.0.0.1:80'].map(h => [h, privateServer]),
    ]);
    await withExtension(async ({ context, worker }) => {
      await context.route(/https?:\/\/(api\.github\.com|destination\.test|news\.ycombinator\.com|127\.0\.0\.1|10\.0\.0\.1)\//, route => route.continue());
      await context.addCookies([{ name: 'synthetic', value: 'dummy', domain: 'api.github.com', path: '/', secure: true, sameSite: 'None' }]);
      for (const status of [301, 302, 303, 307, 308]) {
        for (const destination of ['loopback', 'private', 'hn', 'public']) {
          const result = await worker.evaluate(async target => {
            try { await fetchPolicy(target, { resourceKind:"richJson", signal: AbortSignal.timeout(5000), credentials: 'include', redirect: 'follow', referrer: 'https://api.github.com/source', referrerPolicy: 'unsafe-url' }); return 'accepted'; }
            catch (error) { return error.message; }
          }, `https://api.github.com/repos/fixture/redirect-${status}-${destination}`);
          assert.equal(result, 'REMOTE_FETCH_BLOCKED', `${status} to ${destination}; destination hits=${[...privateServer.hits.values()].reduce((a,b) => a+b, 0)}, public final hits=${publicServer.hits.get('destination.test/end') || 0}`);
          assert.equal(publicServer.hits.get(`api.github.com/repos/fixture/redirect-${status}-${destination}`), 1);
          assert.equal(privateServer.hits.size, 0, 'loopback/private -> public chain must stop before second hop');
          assert.equal(publicServer.hits.get('news.ycombinator.com/forbidden') || 0, 0);
          assert.equal(publicServer.hits.get('destination.test/end') || 0, 0);
        }
      }
      assert.equal(await worker.evaluate(async () => readResponseTextLimited(await fetchPolicy('https://api.github.com/repos/fixture/direct', { resourceKind:'richJson', signal: AbortSignal.timeout(5000) }),100)), '{"direct":true}');
      assert.ok(observed.every(r => !r.cookie && !r.referer), 'all external requests omit cookies and referrers');
    }, { destinations });
  } finally { await Promise.all([privateServer.close(), publicServer.close()]); }
});
