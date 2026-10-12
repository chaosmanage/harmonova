import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';
await withExtension(async({context,worker})=> {
  await context.route('https://news.ycombinator.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8')}));
  await context.route('https://hacker-news.firebaseio.com/v0/**',r=>r.fulfill({status:200,contentType:'application/json',body:r.request().url().endsWith('stories.json')?'[910001]':JSON.stringify({id:910001,type:'story',title:'Migration fixture',by:'fixture',time:1700000000,score:1})}));
  await context.route('https://hn.algolia.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:910001,title:'Migration fixture',author:'fixture',children:[]})}));
  await worker.evaluate(async()=> {
    await chrome.storage.sync.set({harmonicSettings:{uiTheme:'navy',aiEnabled:true,aiAutoSummarize:true}});
    await chrome.storage.local.set({harmonovaReaderStateV1:{version:1,revision:1,pageOriginMigrated:false,readIds:[8],bookmarks:[9],tags:{alice:'new'},blockedUsers:[],seenTimes:{}}});
  });
  await context.addInitScript(()=> {
    localStorage.setItem('harmonicUserTags',JSON.stringify({alice:'old',bob:'legacy'}));
    localStorage.setItem('harmonicBlockedUsers',JSON.stringify(['legacyblocked']));
    localStorage.setItem('harmonicSeenComments',JSON.stringify({'1':1234}));
    localStorage.setItem('harmonic:settings:v1',JSON.stringify({uiTheme:'charcoal',uiFont:'serif',aiEnabled:true,aiAutoSummarize:true,history:[1],unknown:'discard'}));
  });
  await worker.evaluate(()=>{globalThis.savedSet=chrome.storage.local.set;chrome.storage.local.set=()=>Promise.reject(new Error('SYNTHETIC_WRITE_FAILURE'));});
  const failed=await context.newPage();await failed.goto('https://news.ycombinator.com/news');await failed.locator('.story-card').first().waitFor();
  assert.ok(await failed.evaluate(()=>localStorage.getItem('harmonicUserTags')),'failed write keeps legacy source');
  await worker.evaluate(()=>{chrome.storage.local.set=globalThis.savedSet;delete globalThis.savedSet;});
  await failed.close();
  const a=await context.newPage(),b=await context.newPage();
  await Promise.all([a.goto('https://news.ycombinator.com/news'),b.goto('https://news.ycombinator.com/news')]);
  await Promise.all([a.locator('.story-card').first().waitFor(),b.locator('.story-card').first().waitFor()]);
  const records=await worker.evaluate(async()=>({reader:(await chrome.storage.local.get('harmonovaReaderStateV1')).harmonovaReaderStateV1,prefs:(await chrome.storage.local.get('harmonovaPreferencesV1')).harmonovaPreferencesV1,ai:await currentAiPolicy()}));
  assert.equal(records.reader.tags.alice,'new');assert.equal(records.reader.tags.bob,'legacy');assert.deepEqual(records.reader.bookmarks,[9]);assert.equal(records.prefs.settings.uiTheme,'navy');assert.equal(records.prefs.settings.uiFont,'serif');assert.equal(records.ai.enabled,false);assert.equal(records.ai.consentVersion,0);
  const keys=await a.evaluate(()=>Object.keys(localStorage));assert.ok(keys.every(k=>['harmonova:settings:v1','harmonova:enabled:v1'].includes(k)));
  const backup=await a.evaluate(()=>JSON.parse(localStorage.getItem('harmonova:settings:v1')));assert.deepEqual(Object.keys(backup).sort(),['commentTextSize','commentZoom','contentScale','storyTextSize','uiFont','uiTheme']);
  await a.reload();await a.locator('.story-card').first().waitFor();assert.equal((await worker.evaluate(async()=>readerStore.stateSnapshot())).tags.alice,'new');
  await worker.evaluate(()=>preferencesStore.patch({uiTheme:'charcoal'}));
  await Promise.all([a.waitForFunction(()=>document.querySelector('#harmonova-root')?.dataset.theme==='charcoal'||document.querySelector('[data-theme="charcoal"]')),b.waitForFunction(()=>document.querySelector('[data-theme="charcoal"]'))]);
  console.log('PASS P10 real two-tab migration, legacy cleanup, appearance-only backup, recreated keys and preference broadcast');
});
