import { chromium } from 'playwright-core';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { offlineProxy, installOfflineRoutes } from './network.mjs';

export async function launchExtension({ destinations = new Map(), args = [], incognito = false } = {}) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'harmonova-test-'));
  const proxy = await offlineProxy(destinations);
  let context, browserPid;
  async function closeContext() {
    if(!context)return;
    let timer;
    const pending=context.close();
    const timedOut=await Promise.race([pending.then(()=>false,()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(true),10000);})]);
    clearTimeout(timer);
    if(timedOut && Number.isSafeInteger(browserPid)) {
      // Kill only the browser launched with this unique synthetic profile.
      const command=await readFile('/proc/'+browserPid+'/cmdline','utf8').catch(()=> '');
      if(command.includes('--user-data-dir='+profile))try{process.kill(browserPid,'SIGKILL');}catch{}
      await Promise.race([pending.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1000))]);
    }
  }
  try {
    const extensionPath = path.resolve(process.env.EXTENSION_PATH || '.');
    await mkdir(path.resolve(process.env.TEST_OUTPUT_DIR || 'test-results'), { recursive: true });
    const launchOptions = {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true, ignoreHTTPSErrors: true, viewport: { width: 1919, height: 872 },
      proxy: { server: proxy.url, bypass: '<-loopback>' },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--ignore-certificate-errors',
        '--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath, ...args],
    };
    context = await chromium.launchPersistentContext(profile, launchOptions);
    if (incognito) {
      const firstWorker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker",{timeout:15000});
      const extensionId = new URL(firstWorker.url()).host;
      const settings = await context.newPage();
      await settings.goto("chrome://extensions/?id="+extensionId);
      const toggle = settings.locator("#allow-incognito");
      await toggle.waitFor({state:"visible"});
      if (await toggle.getAttribute("checked") === null) await toggle.click();
      await context.close();
      context = await chromium.launchPersistentContext(profile, launchOptions);
    }
    const browserSession=await context.browser().newBrowserCDPSession();
    const processes=await browserSession.send('SystemInfo.getProcessInfo');
    browserPid=processes.processInfo.find(p=>p.type==='browser')?.id;
    await browserSession.detach();
    const assertRoutes = await installOfflineRoutes(context);
    // CONNECT attempts can precede Playwright fulfillment and include Chromium
    // telemetry. The proxy denies them without opening a destination socket;
    // the route guard asserts actual application requests independently.
    const assertOffline = assertRoutes;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    await worker.evaluate(() => Boolean(chrome.runtime.id));
    console.log(`Runtime: Node ${process.version}; Chromium ${context.browser().version()}`);
    return { context, worker, proxy, assertOffline, async close() {
      try { await closeContext(); } finally { await proxy.close(); await rm(profile, { recursive: true, force: true }); }
    } };
  } catch (error) {
    try { await closeContext(); } finally { await proxy.close(); await rm(profile, { recursive: true, force: true }); }
    throw error;
  }
}

export async function withExtension(fn, options) {
  const fixture = await launchExtension(options);
  try { await fn(fixture); fixture.assertOffline(); }
  finally { await fixture.close(); }
}
