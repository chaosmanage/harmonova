import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withExtension } from './helpers/extension.mjs';

await withExtension(async ({ context, worker }) => {
  const fixture = fs.readFileSync(new URL('./fixtures/hn/news.html', import.meta.url), 'utf8');
  const ids = Array.from({ length: 135 }, (_, i) => 920000 + i);
  const requested = [];
  await context.route('https://news.ycombinator.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await context.route('https://hacker-news.firebaseio.com/v0/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('stories.json'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids) });
    const id = Number(pathname.match(/item\/(\d+)\.json/)?.[1]);
    requested.push(id);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id, type: 'story', title: 'Synthetic '+id, url: null, by: 'tester', score: 4, time: 1700000000, descendants: 0,
    }) });
  });
  await context.route('https://hn.algolia.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: ids[0], children: [] }) }));
  const initialSeen = ids.slice(0, 19);
  const secondSeen = ids.slice(60, 91);
  await worker.evaluate(async ({ initialSeen, secondSeen }) => {
    await readerStore.markSkippedBatch([...initialSeen, ...secondSeen]);
    await preferencesStore.patch({ scrolledStoryBehavior: 'future' });
  }, { initialSeen, secondSeen });
  const page = await context.newPage();
  await page.goto('https://news.ycombinator.com/news');
  await page.waitForFunction(() => document.querySelectorAll('.story-card').length === 20);
  let shown = await page.locator('.story-card').evaluateAll(cards => cards.map(c => Number(c.dataset.storyId)));
  assert.deepEqual(shown, ids.slice(19, 39), '19 pre-skipped candidates are replenished to 20');
  assert.ok(!requested.some(id => initialSeen.includes(id)), 'pre-known hidden candidates were never requested');

  // New skips must NOT remove current cards in recommended mode.
  await page.locator('.story-list').hover();
  await page.mouse.wheel(0, 970);
  await page.waitForFunction(() => document.querySelectorAll('.story-card.is-skipped').length > 0);
  assert.equal(await page.locator('.story-card').count(), 20, 'current feed remains intact when scrolling past');
  const crossed = await page.locator('.story-card.is-skipped').first().getAttribute('data-story-id');
  assert.equal(await page.locator('.harmonova-app').getAttribute('data-scrolledmode'), 'future');
  await page.waitForFunction(async () => {
    // The worker's batched write must persist before reload.
    return document.querySelectorAll('.story-card.is-skipped').length > 0;
  });
  await page.waitForTimeout(800);
  const saved = await worker.evaluate(async () => (await readerStore.stateSnapshot()).skippedIds);
  assert.ok(saved.includes(Number(crossed)), 'scroll history was persisted');

  // Load-more must refill to 32 *new* eligible cards despite another 31 skips.
  await page.locator('.story-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll('.story-card').length >= 52, null, { timeout: 15000 });
  assert.equal(await page.locator('.story-card').count(), 52, 'load more adds exactly 32 eligible cards');
  shown = await page.locator('.story-card').evaluateAll(cards => cards.map(c => Number(c.dataset.storyId)));
  assert.ok(!shown.some(id => secondSeen.includes(id)), 'load more excludes pre-skipped IDs');

  await page.reload();
  await page.locator('.story-card').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.story-card').length === 20);
  shown = await page.locator('.story-card').evaluateAll(cards => cards.map(c => Number(c.dataset.storyId)));
  assert.ok(!shown.includes(Number(crossed)), 'next page load hides previously scrolled story');

  await page.evaluate(() => { location.hash = '#harmonova-settings'; });
  await page.locator('.settings-overlay').waitFor({ state: 'visible' });
  await page.locator('.settings-category').filter({ hasText: 'Stories' }).click();
  assert.equal(await page.locator('input[value="future"]').isChecked(), true);
  assert.ok((await page.locator('.setting-scrolled-group').innerText()).includes('Hide on next load (recommended)'));
  console.log('PASS recommended mode, deferred hide, 20/32 refill, persistence, opt-in settings');
});

await withExtension(async ({ context, worker }) => {
  const seen = Array.from({ length: 30 }, (_, i) => 930000 + i);
  const newIds = Array.from({ length: 30 }, (_, i) => 930030 + i);
  const makePage = (ids, next) => `<html><body><table>${ids.map(id => `<tr class="athing" id="${id}"><td class="title">Story ${id}</td></tr>`).join('')}</table>${next ? '<a class="morelink" href="?p=2">More</a>' : ''}</body></html>`;
  await worker.evaluate(async first => {
    await readerStore.markSkippedBatch(first);
    await preferencesStore.patch({ scrolledStoryBehavior: 'future' });
  }, seen);
  await context.route('https://news.ycombinator.com/**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: url.searchParams.get('p') === '2' ? makePage(newIds, false) : makePage(seen, true) });
  });
  await context.route('https://hacker-news.firebaseio.com/v0/**', route => {
    const id = Number(route.request().url().match(/item\/(\d+)\.json/)?.[1]);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, type: 'story', title: 'HTML list story '+id, url: null, by: 'tester', score: 4, time: 1700000000, descendants: 0 }) });
  });
  await context.route('https://hn.algolia.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: newIds[0], children: [] }) }));
  const page = await context.newPage();
  page.on('pageerror', error => console.log('Page error:', error.message));
  await page.goto('https://news.ycombinator.com/pool');
  await page.waitForFunction(() => document.querySelectorAll('.story-card').length === 20, null, { timeout: 25000 });
  const rendered = await page.locator('.story-card').evaluateAll(cards => cards.map(c => Number(c.dataset.storyId)));
  assert.deepEqual(rendered, newIds.slice(0, 20), 'HTML-backed feed continues to page 2 and fills initial 20');

  // Change to immediate mode. Cards beyond the top must be physically removed.
  await worker.evaluate(async () => preferencesStore.patch({ scrolledStoryBehavior: 'immediate' }));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.story-card').length === 20, null, { timeout: 25000 });
  const firstId = await page.locator('.story-card').first().getAttribute('data-story-id');
  await page.locator('.story-list').hover();
  await page.mouse.wheel(0, 780);
  await page.waitForFunction(id => !document.querySelector(`.story-card[data-story-id="${id}"]`), firstId, { timeout: 12000 });
  assert.ok(await page.locator('.story-card').count() > 0, 'remaining visible cards are retained');
  await page.waitForTimeout(800);
  assert.ok((await worker.evaluate(async () => (await readerStore.stateSnapshot()).skippedIds)).includes(Number(firstId)), 'immediate skip persisted');
  console.log('PASS HTML next-page continuation and immediate removal');
});

await withExtension(async ({ context, worker }) => {
  const fixture = fs.readFileSync(new URL('./fixtures/hn/news.html', import.meta.url), 'utf8');
  const ids = Array.from({ length: 65 }, (_, i) => 940000 + i);
  await context.route('https://news.ycombinator.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await context.route('https://hacker-news.firebaseio.com/v0/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('stories.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ids) });
    const id = Number(pathname.match(/item\/(\d+)\.json/)?.[1]);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id, type: 'story', title: 'Modes fixture '+id, url: null, by: 'tester', score: 4, time: 1700000000, descendants: 0,
    }) });
  });
  await context.route('https://hn.algolia.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: ids[0], children: [] }) }));
  const page = await context.newPage();
  await page.goto('https://news.ycombinator.com/news');
  await page.waitForFunction(() => document.querySelectorAll('.story-card').length === 20);
  assert.equal(await worker.evaluate(async () => (await preferencesStore.snapshot()).settings.scrolledStoryBehavior), 'off', 'default mode is opt-out');
  await page.locator('.story-list').hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(600);
  assert.deepEqual(await worker.evaluate(async () => (await readerStore.stateSnapshot()).skippedIds), [], 'off does not track');

  await page.evaluate(() => { location.hash = '#harmonova-settings'; });
  await page.locator('.settings-overlay').waitFor();
  await page.locator('.settings-category').filter({ hasText: 'Stories' }).click();
  const values = await page.locator('.setting-scrolled-group input[type=radio]').evaluateAll(els => els.map(el => el.value));
  assert.deepEqual(values, ['off', 'future', 'immediate']);
  assert.equal(await page.locator('.setting-scrolled-group input[value=off]').isChecked(), true);
  await page.locator('.setting-scrolled-group input[value=future]').check();
  await page.locator('.settings-header .icon-button').click();
  await page.locator('.story-list').evaluate(el => { el.scrollTop = 0; });
  await page.locator('.story-list').hover();
  await page.mouse.wheel(0, 900);
  await page.waitForFunction(() => document.querySelector('.story-card.is-skipped'));
  assert.equal(await page.locator('.harmonova-app').getAttribute('data-scrolledmode'), 'future');
  assert.ok(await page.locator('.story-card.is-skipped').count() > 0, 'recommended mode retains crossed cards');
  await page.waitForFunction(() => [...document.querySelectorAll('.story-card.is-skipped')].some(card => Number(getComputedStyle(card).opacity) <= .26), null, {timeout:5000}); // allow CSS fade transition
  assert.ok(await page.locator('.story-card.is-skipped').first().evaluate(card => Number(getComputedStyle(card).opacity)) <= .26, 'recommended mode greys skipped cards out immediately');
  assert.ok(await page.locator('.story-card').count() >= 20, 'automatic load-more never shrinks the feed');
  console.log('PASS three exclusive modes, off default, immediately dimmed recommended mode');
});
