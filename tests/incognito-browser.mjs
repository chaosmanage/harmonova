import assert from "node:assert/strict";
import fs from "node:fs";
import { launchExtension } from "./helpers/extension.mjs";
import { installOfflineRoutes } from "./helpers/network.mjs";

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
  const h = await launchExtension({incognito:true});
  let privateContext;
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
    privateContext = await h.context.browser().newContext({ ignoreHTTPSErrors:true });
    await installOfflineRoutes(privateContext);
    let signedIn=true;
    await privateContext.route("https://news.ycombinator.com/**", route => {
      const pathname=new URL(route.request().url()).pathname;
      if (pathname==='/logout') signedIn=false;
      const file=pathname==='/item' ? (signedIn?'synthetic/item-in.html':'synthetic/item-out.html') : (signedIn?'synthetic/news-in.html':'news.html');
      return route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(new URL('./fixtures/hn/'+file,import.meta.url),'utf8')});
    });
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
    const page = await privateContext.newPage();
    await page.goto('https://news.ycombinator.com/news');
    await page.locator('.story-card').first().waitFor({timeout:15000});
    // This is a real browser incognito context: no mocked sender flags.
    const privateTab = await h.worker.evaluate(async () => (await chrome.tabs.query({url:'https://news.ycombinator.com/*'})).find(t=>t.incognito));
    assert.ok(privateTab?.incognito, 'real private tab must be visible to the extension');
    await page.locator('.story-card').first().click({button:'right'});
    await page.getByText('Bookmark',{exact:true}).click();
    await page.evaluate(()=> {location.hash='#harmonova-settings';});
    await page.locator('.settings-category', {hasText:'Data'}).click();
    await page.locator('input[type=file]').setInputFiles({name:'private.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,bookmarks:[50022292,910002],readStoryIds:[50022292],userTags:{privateauthor:'private'},blockedUsers:['privateblocked']}))});
    await page.waitForFunction(()=>document.querySelector('.harmonova-toast')?.textContent.includes('Imported'));
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button',{name:'Export user data (JSON)',exact:true}).click();
    const download = await downloaded;
    const exported = JSON.parse(fs.readFileSync(await download.path(),'utf8'));
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
    await privateContext.close(); privateContext=null;
    await validateNoPrivateWrites(h.worker,baseline);
    console.log('PASS P06 real private imports/export/bookmarks/reload: normal stores unchanged');
    h.assertOffline();
  } finally { await privateContext?.close(); await h.close(); }
}
await incognitoBrowserCheck();
