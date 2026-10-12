/* global saveAiKey, document -- Playwright callbacks execute in worker/page realms. */
// Capture genuine HarmoNova UI for the docs. The AI example uses a deterministic
// response based on the linked article, without a real key or paid request.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const root = process.cwd();
const output = path.join(root, 'docs/assets');
fs.mkdirSync(output, { recursive: true });
const context = await chromium.launchPersistentContext('', {
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  viewport: { width: 1600, height: 950 },
  deviceScaleFactor: 1,
  args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--disable-extensions-except=' + root, '--load-extension=' + root],
});
const clipLeft = { x: 0, y: 0, width: 1080, height: 850 };
try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://news.ycombinator.com/news', { waitUntil: 'domcontentloaded', timeout: 24000 });
  await page.locator('.story-card').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('.thread-title').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(output, 'overview.png') });

  // Show the exact Chrome UI used to install an unpacked extension.
  const extensionsPage = await context.newPage();
  await extensionsPage.setViewportSize({ width: 1280, height: 650 });
  await extensionsPage.goto('chrome://extensions/');
  await extensionsPage.locator('extensions-toolbar cr-toggle').click();
  await extensionsPage.getByText('Load unpacked').waitFor({ state: 'visible' });
  await extensionsPage.waitForTimeout(950);
  await extensionsPage.screenshot({ path: path.join(output, 'install-chrome.png') });
  await extensionsPage.close();

  // Show feed choices without relying on a different screenshot tool.
  await page.locator('.feed-title-button').click();
  await page.screenshot({ path: path.join(output, 'feeds.png'), clip: clipLeft });
  await page.keyboard.press('Escape');
  await page.locator('.feed-toolbar-actions [aria-label="Search"]').click();
  await page.locator('.hn-search-panel').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'search.png'), clip: clipLeft });
  await page.locator('.feed-toolbar-actions [aria-label="Search"]').click();

  // Settings categories are captured separately so the actual controls can be read.
  await page.locator('.feed-toolbar-actions [aria-label="More"]').click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-overlay').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'settings.png') });
  for (const [category, filename] of [['Appearance', 'appearance.png'], ['Stories', 'story-settings.png'], ['AI', 'ai-settings.png']]) {
    await page.locator('.settings-category', { hasText: category }).click();
    await page.screenshot({ path: path.join(output, filename) });
    await page.locator('.settings-back').click();
  }
  await page.locator('.settings-header .icon-button').click();
  await page.locator('.settings-overlay').waitFor({ state: 'detached' });

  // Anchor the demonstration to a specific HN article, rather than whichever
  // external story happens to be first in the live Top Stories feed.
  await page.goto('https://news.ycombinator.com/item?id=50045984', {
    waitUntil: 'domcontentloaded', timeout: 24000,
  });
  await page.locator('.thread-title').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('.story-card').first().waitFor({ state: 'visible', timeout: 20000 });
  const articleUrl = await page.locator('.thread-title').getAttribute('href');
  if (new URL(articleUrl).hostname !== 'nanolathe.gg') {
    throw Error(`AI demo story is not the Nanolathe article: ${articleUrl}`);
  }

  // Supply article facts and an illustrative summary locally so screenshot
  // generation never requires an OpenRouter key or consumes API credits.
  const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))
    || await context.waitForEvent('serviceworker', { timeout: 15000 });
  await worker.evaluate((key) => saveAiKey(key, 'session'), 'docs-demo-key-not-real');
  await context.route(articleUrl, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<main><h1>Total Annihilation, rebuilt for modern computers</h1>
      <p>Nanolathe is an independent, open-source, MIT-licensed engine that reimplements Total Annihilation through clean-room research.</p>
      <p>Its modern GPU renderer adds zoom, lighting, glow and richer detail; a Classic renderer remains available.</p>
      <p>Three original demo missions run in desktop browsers. The native Windows, Mac and Linux beta uses your own game files for full campaigns and skirmishes.</p></main>`,
  }));
  const summary = [
    '- **Rebuilt engine:** Clean-room, MIT-licensed reimplementation of Total Annihilation.',
    '- **Modern visuals:** GPU lighting, zoom and effects, with a Classic mode.',
    '- **Play it:** Three browser demo missions; bring your own files for the full beta.',
  ].join('\n');
  await context.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({
    status: 200, headers: { 'content-type': 'text/event-stream' },
    body: ['data: ' + JSON.stringify({ choices: [{ delta: { content: summary } }] }), '', 'data: [DONE]', ''].join('\n'),
  }));
  await page.getByRole('button', { name: 'Summarize article' }).click();
  await page.waitForFunction(() => document.querySelector('.story-summary')?.dataset.status === 'success', null, { timeout: 20000 });
  await page.locator('.thread-pane').evaluate(e => e.scrollTop = 0);
  await page.screenshot({ path: path.join(output, 'ai-summary-demo.png') });
  console.log('Captured:', fs.readdirSync(output).filter(x => x.endsWith('.png')).join(', '));
} finally {
  await context.close();
}
