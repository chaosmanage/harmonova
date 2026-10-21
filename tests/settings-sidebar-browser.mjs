import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';

await withExtension(async({context,worker})=>{
  const html=fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8');
  await context.route('https://news.ycombinator.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
  const story={id:910061,type:'story',title:'Public website fixture',url:'https://public.example/story',by:'fixture',score:11,time:1700000000,descendants:0};
  await context.route('https://hacker-news.firebaseio.com/v0/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r.request().url().endsWith('stories.json')?[story.id]:story)}));
  await context.route('https://hn.algolia.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:story.id,title:story.title,url:story.url,author:'fixture',children:[]})}));
  let publicRequests=0;
  await context.route('https://public.example/story',r=>{
    publicRequests++;
    assert.equal(r.request().headers()['cookie'],undefined);
    return r.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><meta property="og:title" content="Full public headline"><meta name="description" content="Preview of this public website"></head><body><article><h1>Full public headline</h1><p>The entire article content goes into the summarizer rather than just its metadata.</p></article></body></html>`});
  });
  let aiPayload=null;
  await context.route('https://openrouter.ai/api/v1/chat/completions',r=>{
    aiPayload=r.request().postDataJSON();
    const body=['data: {"choices":[{"delta":{"content":"Summary of complete article"}}]}','data: [DONE]'].join("\n\n")+"\n\n";
    return r.fulfill({status:200,contentType:'text/event-stream',body});
  });
  let releasedTag='v0.15.0', releaseRequests=0, simulateFailure=false;
  await context.route('https://api.github.com/repos/chaosmanage/harmonova/releases/latest',r=>{
    releaseRequests++;
    if(simulateFailure)return r.fulfill({status:503,contentType:'text/plain',body:'unavailable'});
    return r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({tag_name:releasedTag,draft:false,prerelease:false})});
  });
  const page=await context.newPage();
  await page.goto('https://news.ycombinator.com/news');
  await page.locator('.story-card').first().waitFor();
  await page.evaluate(()=>{location.hash='#harmonova-settings';});
  await page.locator('.settings-overlay').waitFor({state:'visible'});
  assert.equal(await page.locator('.settings-category').filter({hasText:'Updates'}).count(),1);
  await page.locator('.settings-category').filter({hasText:'Appearance'}).click();
  assert.equal(await page.locator('.settings-section:not([hidden]) .settings-check-updates').count(),0,'not in Appearance');
  await page.locator('.settings-back').click();
  await page.locator('.settings-category').filter({hasText:'Updates'}).click();
  const notify=page.locator('.settings-section:not([hidden]) .setting-row',{hasText:'Notify about new releases'}).locator('input');
  assert.equal(await notify.isChecked(),true);
  await notify.uncheck();
  assert.equal(await notify.isChecked(),false);
  await page.locator('.settings-group-summary', {hasText:'Check for updates'}).click();
  const check=page.locator('.settings-section:not([hidden]) .settings-check-updates');
  await check.click();
  await page.locator('.settings-update-status').getByText(/Update available: v0\.15\.0/).waitFor();
  assert.equal(await page.locator('.settings-update-status a').getAttribute('href'),
    'https://github.com/chaosmanage/harmonova/releases/latest');
  assert.equal(releaseRequests,1,'manual check fetches with notifications disabled');
  releasedTag='v0.14.0';
  await check.click();
  await page.locator('.settings-update-status').getByText("You're up to date.").waitFor();
  simulateFailure=true;
  await check.click();
  await page.locator('.settings-update-status').getByText('Could not check for updates. Try again.').waitFor();
  assert.equal(releaseRequests,3);
  await page.locator('.settings-back').click();
  await page.locator('.settings-category').filter({hasText:'Web and links'}).click();
  await page.locator('.settings-group-summary', {hasText:'External preview access'}).click();
  const previewFrame=page.frameLocator('.preview-settings-frame');
  await previewFrame.locator('#previews-enabled').waitFor();
  assert.equal(await previewFrame.locator('#previews-enabled').isChecked(),true,'previews should default on under Web and links');
  assert.ok((await previewFrame.locator('body').getAttribute('class')).includes('embedded'));
  await previewFrame.locator('#previews-enabled').uncheck();
  await previewFrame.locator('#previews-status').getByText('Previews disabled.').waitFor();
  assert.equal((await worker.evaluate(async()=> (await chrome.storage.local.get('harmonovaNetworkPolicyV1')).harmonovaNetworkPolicyV1.externalPreviewsEnabled)),false);
  await previewFrame.locator('#previews-enabled').check();
  await previewFrame.locator('#previews-status').getByText('Previews enabled.').waitFor();
  await page.locator('.settings-back').click();
  await page.locator('.settings-category').filter({hasText:'AI'}).click();
  assert.equal(await page.locator('.settings-header h2').innerText(),'AI Summarization');
  const frame=page.frameLocator('.ai-settings-frame:not(.preview-settings-frame)');
  assert.equal(await frame.locator('#previews-enabled').count(),0,'preview controls moved out of AI');
  const buttonOffset=await frame.locator('#policy-save').evaluate(button=>
    button.getBoundingClientRect().left-button.closest('.group').getBoundingClientRect().left);
  assert.ok(buttonOffset>=13 && buttonOffset<=20,'save permissions button aligns with group in embedded layout');
  assert.equal(await frame.locator('#policy-prompt').inputValue(),
    'You are an expert at summarizing articles into concise, information-dense bullet points. Prioritize key takeaways, significant facts, and noteworthy insights while eliminating fluff and repetition. Preserve accuracy and essential context. Keep summaries under 500 characters whenever possible. Use Markdown formatting. Output only the summary, with no introductions, conclusions, or additional commentary.');
  const actualFrame=page.frames().find(f=>f.url().includes('/ai-settings.html'));
  assert.ok(actualFrame,'trusted extension page is embedded in sidebar');
  assert.ok(actualFrame.url().startsWith('chrome-extension://'));
  assert.equal(await page.evaluate(()=>document.querySelector('.ai-settings-frame:not(.preview-settings-frame)').contentDocument),null,'HN document cannot inspect extension-owned key form');
  const pagesBefore=context.pages().length;
  await frame.locator('#policy-enabled').check();
  assert.equal(await frame.locator('#ai-privacy-notice').isVisible(),true,'enabling AI discloses provider text transfer and charges');
  // Keyboard activation avoids Chromium's flaky cross-origin mouse coordinates
  // when the tall extension iframe is inside a scrolled settings sidebar.
  await frame.locator('#policy-save').focus();
  await frame.locator('#policy-save').press('Enter');
  await frame.locator('#policy-message').getByText(/saved/i).waitFor();
  const policy=await worker.evaluate(async()=> (await chrome.storage.local.get('harmonovaAiPolicyV1')).harmonovaAiPolicyV1);
  assert.equal(policy.enabled,true);
  await frame.locator('#api-key').fill('sk-or-v1-synthetic-sidebar-fixture');
  await frame.locator('#save').click();
  await frame.locator('#message').getByText(/saved/i).waitFor();
  assert.equal(await worker.evaluate(async()=>Boolean((await chrome.storage.local.get('harmonovaAiApiKey')).harmonovaAiApiKey)),true);
  assert.equal(context.pages().length,pagesBefore,'sidebar configuration should not open another tab');
  assert.equal(await page.evaluate(()=>Object.values(localStorage).some(x=>String(x).includes('synthetic-sidebar-fixture'))),false);
  const info=await worker.evaluate(async()=>getMetadata('https://public.example/story',true));
  assert.equal(info.rich.title,'Full public headline','general website metadata restored');
  assert.equal(info.rich.lines[0],'Preview of this public website');
  const fullText=await worker.evaluate(async()=>fetchArticleText('https://public.example/story'));
  assert.ok(fullText.includes('entire article content'),'full article text is extracted');
  assert.ok(publicRequests>=2,'website was fetched for metadata and article');
  await page.locator('.settings-header .icon-button').click();
  await page.locator('.settings-overlay').waitFor({state:'detached'});
  await page.locator('.story-comment-button').first().click();
  await page.locator('.thread-title').waitFor();
  await page.locator('[data-summary-action-id="910061"][data-summary-source="article"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-summary-story-id="910061"]')?.dataset.status==='success',{},{timeout:15000});
  assert.ok(aiPayload?.messages?.[1]?.content.includes('entire article content'),'OpenRouter receives actual full article, not provider excerpt');
  // Destructive controls require trusted confirmation and affect distinct stores.
  const dataPage=async()=>{
    await page.locator('.story-card').first().waitFor({state:'visible'});
    await page.evaluate(()=>{location.hash='#harmonova-settings';});
    await page.locator('.settings-overlay').waitFor();
    await page.locator('.settings-category').filter({hasText:'Data'}).click();
    await page.locator('.settings-group-summary', {hasText:'Delete & reset'}).click();
  };
  const reset=async (scope)=>{
    const selector='.settings-delete-'+scope;
    page.once('dialog',dialog=>dialog.accept());
    await page.locator(selector).click();
    await page.locator('.settings-overlay').waitFor({state:'detached',timeout:12000});
    await page.locator('.story-card').first().waitFor({state:'visible'});
  };
  await worker.evaluate(async()=>{
    await readerStore.markRead(910061);
    await readerStore.setTag('testuser','important');
    await readerStore.markSeen(910061,Date.now());
    const draft=await readerStore.beginDraft('testuser',910061);
    await readerStore.saveDraft('testuser',910061,draft.token,0,'unsent note');
  });
  await dataPage();
  // A rejected confirmation must preserve the original history.
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('.settings-delete-history').click();
  assert.ok((await worker.evaluate(()=>readerStore.stateSnapshot())).readIds.includes(910061));
  await reset('history');
  let reader=await worker.evaluate(()=>readerStore.stateSnapshot());
  assert.deepEqual(reader.readIds,[]);
  assert.deepEqual(reader.seenTimes,{});
  assert.equal(reader.tags.testuser,'important','history deletion preserves saved tags');
  await dataPage();
  await reset('saved');
  reader=await worker.evaluate(()=>readerStore.stateSnapshot());
  assert.deepEqual(reader.tags,{});
  assert.equal(await worker.evaluate(async()=> (await readerStore.beginDraft('testuser',910061)).text),'');
  assert.equal(await worker.evaluate(async()=> (await preferencesStore.snapshot()).settings.notifyUpdates),false,'saved deletion preserves settings');
  await dataPage();
  await reset('settings');
  assert.equal(await worker.evaluate(async()=> (await preferencesStore.snapshot()).settings.notifyUpdates),true,'settings restored');
  assert.equal((await worker.evaluate(()=>currentNetworkPolicy())).externalPreviewsEnabled,true);
  assert.equal((await worker.evaluate(()=>currentAiPolicy())).enabled,false);
  assert.equal((await worker.evaluate(()=>aiKeyStatus())).hasKey,true,'settings reset preserves API key');
  await dataPage();
  await reset('all');
  assert.equal((await worker.evaluate(()=>aiKeyStatus())).hasKey,false,'all data removes API key');
  assert.deepEqual((await worker.evaluate(()=>readerStore.stateSnapshot())).readIds,[]);
  console.log('PASS Updates, Web and links preview consent, Data deletion, and secure inline AI');
});
