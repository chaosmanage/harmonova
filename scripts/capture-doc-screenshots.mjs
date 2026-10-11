// Capture genuine HarmoNova UI for the docs. AI example uses a clearly labeled
// mocked OpenRouter reply, with no real API key or paid request.
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
  await page.locator('.hn-search-mode[data-mode="global"]').click();
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

  // Screenshot the actual summary UI with a deterministic mocked response.
  const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))
    || await context.waitForEvent('serviceworker', { timeout: 15000 });
  await worker.evaluate((key) => saveAiKey(key, 'session'), 'docs-demo-key-not-real');
  const cards = page.locator('.story-card');
  const idx = await cards.evaluateAll(nodes => nodes.findIndex(n => {
    const url = n.querySelector('.story-card-title')?.href;
    try { return url && new URL(url).hostname !== 'news.ycombinator.com'; } catch { return false; }
  }));
  if (idx < 0) throw Error('No external story link for summary screenshot');
  await cards.nth(idx).locator('.story-comment-button').click();
  await page.locator('.thread-title').waitFor({ state: 'visible' });
  const articleUrl = await page.locator('.thread-title').getAttribute('href');
  await context.route(articleUrl, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<main><h1>Reading on the web</h1><p>This example demonstrates a simple extension for browsing, threaded comments, and summary tools.</p></main>' }));
  await context.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({
    status: 200, headers: { 'content-type': 'text/event-stream' },
    body: ['data: {"choices":[{"delta":{"content":"- **Demo only:** This is a test response, not a summary of the story above.\\n- **Article:** Summarizes a linked page when available.\\n- **Discussion:** Summarizes public Hacker News comments."}}]}', '', 'data: [DONE]', ''].join('\n'),
  }));
  await page.getByRole('button', { name: 'Summarize article' }).click();
  await page.waitForFunction(() => document.querySelector('.story-summary')?.dataset.status === 'success', null, { timeout: 20000 });
  await page.locator('.thread-pane').evaluate(e => e.scrollTop = 0);
  await page.screenshot({ path: path.join(output, 'ai-summary-demo.png') });
  console.log('Captured:', fs.readdirSync(output).filter(x => x.endsWith('.png')).join(', '));
} finally {
  await context.close();
}
