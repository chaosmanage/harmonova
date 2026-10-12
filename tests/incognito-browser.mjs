import assert from "node:assert/strict";
import fs from "node:fs";
import { launchExtension } from "./helpers/extension.mjs";
import { hnRedirectFixture } from "./helpers/network.mjs";

const fixtureHtml = fs.readFileSync(new URL("./fixtures/hn/news.html", import.meta.url), "utf8");
const validateNoPrivateWrites = async (worker, before) => {
  const after = await worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
    session: await chrome.storage.session.get(["harmonovaDraftsV2"]),
  }));
  assert.deepEqual(after, before, "private reading may not mutate normal stores");
};

export async function incognitoBrowserCheck() {
  let signedIn=true;
  const handleHn=route=> {
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/logout')signedIn=false;
    const file=pathname==='/item' ? (signedIn?'synthetic/item-in.html':'synthetic/item-out.html') : (signedIn?'synthetic/news-in.html':'news.html');
    return route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(new URL('./fixtures/hn/'+file,import.meta.url),'utf8')});
  };
  const hnServer=await hnRedirectFixture(handleHn);
  const h = await launchExtension({incognito:true,destinations:new Map([['news.ycombinator.com:443',hnServer]])}).catch(async error=>{await hnServer.close();throw error;});
  let privateContext,privateWindow;
  try {
    await h.worker.evaluate(async () => {
      await chrome.storage.local.set({ harmonovaReaderStateV1: { version:1, revision:1,
        pageOriginMigrated:true,readIds:[42],bookmarks:[42],tags:{normal:"tag"},
        blockedUsers:["normalblocked"],seenTimes:{"42":1234} } });
      await chrome.storage.session.set({ harmonovaDraftsV2: { version:2,
        drafts:{"harmonova_test:50022292":{username:"harmonova_test",parentId:50022292,text:"normal draft",revision:1}},
        generations:{},accountGenerations:{} } });
    });
    const baseline = await h.worker.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
      session: await chrome.storage.session.get(["harmonovaDraftsV2"]),
    }));
    // Use a real Chrome private window. CDP-created browser contexts have
    // virtual window IDs that chrome.tabs.create cannot address.
    privateContext=h.context;
    await privateContext.route("https://news.ycombinator.com/**",handleHn);
    await privateContext.route("https://example.com/**",route=>route.fulfill({status:200,contentType:"text/html",body:"<html><body>Private synthetic article</body></html>"}));
    await privateContext.route("https://hacker-news.firebaseio.com/v0/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("stories.json")) return route.fulfill({ status:200,
        contentType:"application/json",body:JSON.stringify([50022292]) });
      return route.fulfill({ status:200,contentType:"application/json",body:JSON.stringify({
        id:50022292,type:"story",by:"fixture",title:"Private fixture story",
        url:"https://example.com/",time:1690000000,score:10,descendants:0,
      }) });
    });
    await privateContext.route("https://hn.algolia.com/**", route => route.fulfill({
      status:200,contentType:"application/json",body:JSON.stringify({
        id:50022292,title:"Private fixture story",children:[],author:"fixture",points:10,
      }),
    }));
    const openedPrivate=privateContext.waitForEvent('page');
    privateWindow=await h.worker.evaluate(()=>chrome.windows.create({incognito:true,url:'about:blank'}));
    assert.equal(privateWindow.incognito,true,'actual Chrome private window');
    const page = await openedPrivate;
    await page.goto('https://news.ycombinator.com/news');
    await page.locator('.story-card').first().waitFor({timeout:15000});
    // This is a real browser incognito context: no mocked sender flags.
    const privateTab = await h.worker.evaluate(async () => (await chrome.tabs.query({url:'https://news.ycombinator.com/*'})).find(t=>t.incognito));
    assert.equal(privateTab.windowId,privateWindow.id);
    assert.ok(privateTab?.incognito, 'real private tab must be visible to the extension');
    await page.locator('.story-card').first().click({button:'right'});
    await page.getByText('Bookmark',{exact:true}).click();
    await page.evaluate(()=> {location.hash='#harmonova-settings';});
    await page.locator('.settings-category', {hasText:'Data'}).click();
    await page.locator('input[type=file]').setInputFiles({name:'private.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,bookmarks:[50022292,910002],readStoryIds:[50022292],userTags:{privateauthor:'private'},blockedUsers:['privateblocked']}))});
    await page.waitForFunction(()=>document.querySelector('.harmonova-toast')?.textContent.includes('Imported'));
    // Real native private windows prompt for download confirmation in headless
    // Chrome. Capture the exact browser-created export Blob before that dialog;
    // no alternate serializer or reader implementation is used.
    await page.evaluate(()=>{
      window.privateExportBytes=null;
      document.addEventListener('click',async event=>{
        if(event.target instanceof HTMLAnchorElement && event.target.download==='harmonova-user-data.json'){
          event.preventDefault();window.privateExportBytes=await (await fetch(event.target.href)).text();
        }
      },{capture:true});
    });
    await page.getByRole('button',{name:'Export user data (JSON)',exact:true}).click();
    await page.waitForFunction(()=>typeof window.privateExportBytes==='string');
    const exported = JSON.parse(await page.evaluate(()=>window.privateExportBytes));
    assert.ok(exported.bookmarks.includes(910002));
    assert.ok(!exported.bookmarks.includes(42));
    assert.equal(exported.userTags.privateauthor,'private');
    await validateNoPrivateWrites(h.worker,baseline);
    await page.reload();
    await page.locator('.story-card').first().waitFor();
    await page.locator('.story-card').first().click({button:'right'});
    assert.equal(await page.getByText('Remove bookmark',{exact:true}).count(),0);
    await page.keyboard.press('Escape');
    await page.locator('.story-card').first().click();
    await page.locator('[data-thread-vote]').waitFor();
    const openComposer=async()=> {
      await page.locator('.thread-actions [aria-label="More"]').click();
      await page.locator('.popup-item',{hasText:'Reply to story'}).click();
      await page.locator('.composer-input').waitFor();
    };
    await openComposer();
    assert.equal(await page.locator('.composer-input').inputValue(),'','normal draft must not restore privately');
    assert.ok((await page.locator('.composer-footnote').textContent()).includes('Private draft disappears'));
    await page.locator('.composer-input').fill('private browser draft');
    await page.locator('.composer-input').press('Escape');
    await page.locator('.composer').waitFor({state:'hidden'});
    await openComposer();
    await page.waitForFunction(()=>document.querySelector('.composer-input')?.value==='private browser draft');
    await page.locator('.composer-input').press('Escape');
    await page.locator('.composer').waitFor({state:'hidden'});
    await validateNoPrivateWrites(h.worker,baseline);
    await page.goto('https://news.ycombinator.com/news');
    await page.locator('.story-card').first().waitFor();
    await page.locator('.feed-toolbar [aria-label="More"]').click();
    await page.locator('.popup-item',{hasText:'harmonova_test'}).click();
    await page.locator('.popup-item',{hasText:'Log out'}).click();
    await page.waitForFunction(()=>document.querySelector('.account-chip') && !document.querySelector('.account-chip').classList.contains('logged-in'));
    await validateNoPrivateWrites(h.worker,baseline);
    await page.locator('.feed-toolbar [aria-label="More"]').click();
    const existingPages=new Set(privateContext.pages());
    await page.locator('.popup-item',{hasText:'Open original Hacker News'}).click();
    let original;
    for(let i=0;i<600&&!original;i++) {
      original=privateContext.pages().find(p=>!existingPages.has(p)&&p.url()==='https://news.ycombinator.com/news');
      if(!original)await page.waitForTimeout(50);
    }
    assert.ok(original,'committed native private HN tab');
    const originalTab=await h.worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://news.ycombinator.com/*'});const ids=await originalTabIds();return tabs.find(t=>ids.includes(t.id));});
    assert.equal(originalTab.incognito,true);assert.equal(originalTab.windowId,privateTab.windowId);
    assert.equal(await original.locator('.harmonova-app').count(),0,'bypass recorded before native navigation');
    await original.close();
    await validateNoPrivateWrites(h.worker,baseline);
    await h.worker.evaluate(id=>chrome.windows.remove(id),privateWindow.id);privateWindow=null;privateContext=null;
    await validateNoPrivateWrites(h.worker,baseline);
    console.log('PASS P06 real private imports/export/bookmarks/reload: normal stores unchanged');
    h.assertOffline();
  } finally { if(privateWindow)await h.worker.evaluate(id=>chrome.windows.remove(id),privateWindow.id).catch(()=>{});await h.close();await hnServer.close(); }
}
await incognitoBrowserCheck();
