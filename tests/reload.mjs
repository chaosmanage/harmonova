import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const extensionPath = path.resolve(process.env.EXTENSION_PATH || '.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'harmonova-reload-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath],
});
let context = await launch();
try {
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const openOptions = async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/ai-settings.html`);
    await page.waitForFunction(() => !document.querySelector('#key-status').textContent.includes('Checking'));
    return page;
  };
  let options = await openOptions();
  await options.locator('#api-key').fill('sk-or-v1-reload-test');
  await options.locator('#save').click();
  await options.waitForFunction(() => document.querySelector('#message').textContent.includes('saved'));
  await worker.evaluate(() => chrome.storage.sync.set({ harmonovaSettings: { aiModel: 'openrouter/free', aiStreamResponses: false, aiAutoSummarize: true } }));
  const reload = async () => {
    await context.close();
    context = await launch();
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(new URL(worker.url()).host, extensionId, 'reloaded installation should keep the same extension ID');
    options = await openOptions();
  };
  await reload();
  assert.ok((await options.locator('#key-status').textContent()).includes('saved locally'), 'persistent key should survive browser restart');
  const settings = await worker.evaluate(async () => (await chrome.storage.sync.get('harmonovaSettings')).harmonovaSettings);
  assert.deepEqual(settings, { aiModel: 'openrouter/free', aiStreamResponses: false, aiAutoSummarize: true });
  await options.locator('#api-key').fill('sk-or-v1-session-test');
  await options.locator('input[value="session"]').check();
  await options.locator('#save').click();
  await options.waitForFunction(() => document.querySelector('#message').textContent.includes('saved'));
  await reload();
  assert.ok((await options.locator('#key-status').textContent()).includes('No API key'), 'session-only key should be cleared by browser restart');
  console.log(JSON.stringify({ browserRestart: 'passed', preferencesPersisted: true, persistentKeyRetained: true, sessionKeyCleared: true }));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
