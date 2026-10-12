import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withExtension } from './helpers/extension.mjs';
import { localTlsFixture } from './helpers/network.mjs';
import { dummyApiKey, loggedInHn, tinyPng, oversizedPng, chunkedBody, incognitoSender, opaqueRedirect, seedDummyKey } from './helpers/fixtures.mjs';

test('fixtures use synthetic credentials and browser opaque redirect semantics', async () => {
  assert.match(loggedInHn, /logout/);
  assert.match(dummyApiKey, /dummy/);
  assert.equal(tinyPng.readUInt32BE(16), 1);
  assert.equal(oversizedPng().readUInt32BE(16), 100000);
  assert.equal(incognitoSender('test').tab.incognito, true);
  assert.equal(opaqueRedirect().status, 0);
  assert.equal(opaqueRedirect().headers.get('location'), null);
  const reader = chunkedBody(2, 8).getReader();
  assert.equal((await reader.read()).value.length, 8);
  await reader.cancel();
});

test('offline fixture server counts actual destinations and manual redirect is opaque', async () => {
  const server = await localTlsFixture((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'https://destination.test/target' }); res.end(); }
    else { res.writeHead(200); res.end('fixture'); }
  });
  try {
    const destinations = new Map(['api.github.com:443', 'destination.test:443'].map(host => [host, server]));
    await withExtension(async ({ context, worker }) => {
      await seedDummyKey(worker);
      assert.equal(await worker.evaluate(() => chrome.storage.session.get('harmonovaAiApiKeySession').then(value => Boolean(value.harmonovaAiApiKeySession))), true);
      const dimensions = await worker.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions;
      }, [...tinyPng]);
      assert.deepEqual(dimensions, [1, 1]);
      await context.route(/https:\/\/(api\.github\.com|destination\.test)\//, route => route.continue());
      const result = await worker.evaluate(async () => {
        const r = await fetch('https://api.github.com/redirect', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        return { type: r.type, status: r.status, location: r.headers.get('location') };
      });
      assert.deepEqual(result, { type: 'opaqueredirect', status: 0, location: null });
      assert.equal(server.hits.get('api.github.com/redirect'), 1);
      assert.equal(server.hits.get('destination.test/target') || 0, 0);
    }, { destinations });
  } finally { await server.close(); }
});

test('unexpected network is aborted and reported without query secrets', async () => {
  await withExtension(async ({ context, worker, assertOffline }) => {
    // Deliberately consume the guard assertion, then verify cleanup independently.
    await worker.evaluate(() => fetch('https://unexpected.test/path?token=secret', { signal: AbortSignal.timeout(5000) }).catch(() => null));
    assert.throws(assertOffline, error => error.message.includes('https://unexpected.test/path') && !error.message.includes('token=secret'));
    // Reset is not offered by the harness; this case exits before the wrapper assertion.
  }).then(() => assert.fail('guard should fail'), error => {
    assert.match(error.message, /Unexpected network destinations/);
    assert.ok(!error.message.includes('token=secret'));
  });
});
