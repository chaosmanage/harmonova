import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';

await withExtension(async({context,worker})=>{
  const html=fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8');
  await context.route('https://news.ycombinator.com/**',route=>
    route.fulfill({status:200,contentType:'text/html',body:html}));
  const ids=Array.from({length:30},(_,i)=>910500+i);
  await context.route('https://hacker-news.firebaseio.com/v0/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('stories.json'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ids)});
    const id=Number(path.match(/item\/(\d+)\.json/)?.[1]);
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({id,type:'story',title:'Test story '+id,by:'fixture',score:3,time:1700000000,descendants:0})});
  });
  await context.route('https://hn.algolia.com/**',route=>
    route.fulfill({status:200,contentType:'application/json',body:'{"children":[]}'}));
  let version='v0.15.0',requests=0;
  await context.route('https://api.github.com/repos/chaosmanage/harmonova/releases/latest',route=>{
    requests++;
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({tag_name:version,draft:false,prerelease:false})});
  });
  const page=await context.newPage();
  await page.goto('https://news.ycombinator.com/news');
  await page.locator('.story-card').first().waitFor();
  assert.equal(await page.locator('.harmonova-release-notice').count(),0,'do not show unsolicited notices');
  const first=await worker.evaluate(()=>releaseUpdates.check());
  assert.equal(first.available,true);
  await page.locator('.harmonova-release-notice').waitFor();
  assert.match(await page.locator('.harmonova-release-notice').textContent(),/v0.15.0/);
  await page.getByRole('button',{name:'Ignore this version'}).click();
  await page.locator('.harmonova-release-notice').waitFor({state:'detached'});
  await page.reload();await page.locator('.story-card').first().waitFor();
  assert.equal(await page.locator('.harmonova-release-notice').count(),0,'ignored version stays dismissed');
  version='v0.16.0';
  await worker.evaluate(()=>releaseUpdates.check());
  await page.locator('.harmonova-release-notice').waitFor();
  await page.getByRole('button',{name:"Don't notify me again"}).click();
  await page.locator('.harmonova-release-notice').waitFor({state:'detached'});
  const settings=await worker.evaluate(async()=> (await chrome.storage.local.get('harmonovaPreferencesV1')).harmonovaPreferencesV1.settings);
  assert.equal(settings.notifyUpdates,false,'permanent opt-out saved through settings');
  version='v0.17.0';
  const countBefore=requests;
  const disabled=await worker.evaluate(async()=>releaseUpdates.check((await preferencesStore.snapshot()).settings.notifyUpdates));
  assert.equal(disabled.available,false);
  assert.equal(requests,countBefore,'disabled release checks make no network requests');
  await page.locator('.feed-toolbar-actions .icon-button').last().click();
  assert.doesNotMatch(await page.locator('.harmonova-popup').textContent(),/Add bookmarks to HN favorites/);
  await page.getByRole('button',{name:'Settings'}).click();
  await page.locator('.settings-category').filter({hasText:'Appearance'}).click();
  const toggle=page.locator('.setting-row').filter({hasText:'Notify about new releases'}).locator('input');
  assert.equal(await toggle.isChecked(),false);
  console.log('PASS release notice, per-version ignore and permanent opt-out');
});
