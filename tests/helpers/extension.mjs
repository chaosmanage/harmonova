import { chromium } from 'playwright-core';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { offlineProxy, installOfflineRoutes } from './network.mjs';

export async function launchExtension({ destinations = new Map(), args = [] } = {}) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'harmonova-test-'));
  const proxy = await offlineProxy(destinations);
  let context;
  try {
    const extensionPath = path.resolve(process.env.EXTENSION_PATH || '.');
    await mkdir(path.resolve(process.env.TEST_OUTPUT_DIR || 'test-results'), { recursive: true });
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true, ignoreHTTPSErrors: true, viewport: { width: 1919, height: 872 },
      proxy: { server: proxy.url, bypass: '<-loopback>' },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--ignore-certificate-errors',
        '--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath, ...args],
    });
    const assertRoutes = await installOfflineRoutes(context);
    // CONNECT attempts can precede Playwright fulfillment and include Chromium
    // telemetry. The proxy denies them without opening a destination socket;
    // the route guard asserts actual application requests independently.
    const assertOffline = assertRoutes;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    await worker.evaluate(() => Boolean(chrome.runtime.id));
    console.log(`Runtime: Node ${process.version}; Chromium ${context.browser().version()}`);
    return { context, worker, proxy, assertOffline, async close() {
      try { await context.close(); } finally { await proxy.close(); await rm(profile, { recursive: true, force: true }); }
    } };
  } catch (error) {
    try { await context?.close(); } finally { await proxy.close(); await rm(profile, { recursive: true, force: true }); }
    throw error;
  }
}

export async function withExtension(fn, options) {
  const fixture = await launchExtension(options);
  try { await fn(fixture); fixture.assertOffline(); }
  finally { await fixture.close(); }
}
