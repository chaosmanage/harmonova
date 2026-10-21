import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';

await withExtension(async ({context, worker}) => {
  const html = fs.readFileSync(new URL('./fixtures/hn/news.html', import.meta.url), 'utf8');
  const ids = Array.from({length: 55}, (_,i) => 960100 + i);
  await context.route('https://news.ycombinator.com/**', r=>r.fulfill({status:200,contentType:'text/html',body:html}));
  await context.route('https://hacker-news.firebaseio.com/v0/**', r => {
    const path = new URL(r.request().url()).pathname;
    if(path.endsWith('stories.json')) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ids)});
    const id = Number(path.match(/item\/(\d+)\.json/)?.[1]);
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id,type:'story',by:'tester',title:'A story '+id,time:1700000000,score:7,descendants:1})});
  });
  await context.route('https://hn.algolia.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:ids[0],children:[]})}));
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://news.ycombinator.com/news');
  await page.locator('.story-card').first().waitFor();
  await page.evaluate(()=>{location.hash='#harmonova-settings';});
  await page.locator('.settings-categories').waitFor();

  const categories=await page.locator('.settings-category strong').allTextContents();
  assert.deepEqual(categories,['Stories','Comments','Appearance','Web and links','AI Summarization','Account','Data','Updates']);
  assert.equal(await page.locator('.settings-find-input').isVisible(),true,'all-category settings search is visible');
  const nav=async label=>{
    await page.locator('.settings-category').filter({hasText:label}).click();
    assert.equal(await page.locator('.settings-header h2').innerText(),label);
  };
  const goBack=async()=>{await page.locator('.settings-back').click();};
  await nav('Stories');
  const storyGroups=await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').allTextContents();
  assert.deepEqual(storyGroups,['Seen & skipped stories','Feed filters','Previews & card design','Story details','Text & density','Opening stories']);
  assert.equal(await page.locator('.settings-section:not([hidden]) .settings-group[open]').count(),1,'one recommended first group open');
  assert.equal(await page.locator('.setting-scrolled-group input[type=radio]').count(),5,'five modes not lost');
  assert.equal(await page.locator('.setting-scrolled-group input[value=off]').isChecked(),true);
  await page.locator('.settings-group-summary',{hasText:'Previews & card design'}).click();
  const tint=page.locator('.settings-section:not([hidden]) .setting-row',{hasText:'Tint cards from images'}).locator('input');
  assert.equal(await tint.isChecked(),true);
  await tint.uncheck();
  await page.waitForTimeout(250);
  assert.equal((await worker.evaluate(async()=> (await preferencesStore.snapshot()).settings.tintedCards)),false,'existing preference saves from moved control');
  await page.locator('.settings-group-summary',{hasText:'Opening stories'}).click();
  assert.equal(await page.locator('.setting-row',{hasText:'Enable story card click'}).locator('input').isChecked(),true);
  await goBack();

  await page.locator('.settings-find-input').fill('Card click opens comments');
  await page.locator('.settings-find-item',{hasText:'Card click opens comments'}).click();
  assert.equal(await page.locator('.settings-header h2').innerText(),'Stories');
  assert.equal(await page.locator('.settings-group',{hasText:'Opening stories'}).getAttribute('open'),'','matching group is expanded');
  await goBack();
  await page.locator('.settings-find-input').fill('no-such-setting-zzzz');
  assert.equal(await page.locator('.settings-find-empty').count(),1,'empty search has feedback');
  await page.locator('.settings-find-input').fill('');
  await nav('Comments');
  assert.deepEqual(await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').allTextContents(),
    ['Reading & visibility','Layout & sorting','Interaction & authors','Text & size']);
  await goBack();
  await nav('Appearance');
  assert.deepEqual(await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').allTextContents(),
    ['Theme & typography','Discussion header']);
  await goBack();
  await nav('Web and links');
  assert.deepEqual(await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').allTextContents(),
    ['Link preview details','External preview access']);
  await goBack();
  await nav('AI Summarization');
  assert.equal(await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').first().innerText(),'Model & permissions');
  assert.equal(await page.locator('.settings-section:not([hidden]) .ai-settings-frame').count(),1,'secure AI iframe remains');
  await goBack();
  await nav('Account');
  assert.deepEqual(await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').allTextContents(),
    ['Hacker News session','Account actions','Account privacy']);
  await goBack();
  await nav('Data');
  const reset=page.locator('.settings-section:not([hidden]) .settings-delete-all');
  assert.equal(await reset.isVisible(),false,'destructive actions are collapsed by default');
  await page.locator('.settings-group-summary',{hasText:'Delete & reset'}).click();
  assert.equal(await reset.isVisible(),true,'destructive actions remain available by explicit choice');
  await goBack();
  await nav('Updates');
  assert.deepEqual(await page.locator('.settings-section:not([hidden]) .settings-group-heading strong').allTextContents(),
    ['Release notices','Check for updates']);
  await page.locator('.settings-group-summary',{hasText:'Check for updates'}).click();
  assert.equal(await page.locator('.settings-check-updates').isVisible(),true);
  await goBack();
  // Search can open a group belonging to a different category.
  await page.locator('.settings-find-input').fill('comment sorting');
  await page.locator('.settings-find-item',{hasText:'Comment sorting'}).click();
  assert.equal(await page.locator('.settings-header h2').innerText(),'Comments');
  assert.equal(await page.locator('.setting-row',{hasText:'Comment sorting'}).locator('select').isVisible(),true);
  await goBack();
  await page.setViewportSize({width:375,height:780});
  await nav('Stories');
  const mobile = await page.locator('.settings-panel').evaluate(panel =>
    ({viewport: panel.clientWidth, content: panel.scrollWidth}));
  assert.ok(mobile.content <= mobile.viewport + 2, 'settings panel does not overflow on narrow screens');
  const summary = page.locator('.settings-group-summary',{hasText:'Feed filters'});
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.settings-group',{hasText:'Feed filters'}).getAttribute('open'),'','native disclosure works with keyboard');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.settings-group',{hasText:'Feed filters'}).getAttribute('open'),null,'keyboard can collapse the group');
  assert.ok(errors.every(error => error === "Unexpected token '<'"), 'no settings script errors; the synthetic HN HTML returns HTML for its own script');
  console.log('PASS eight organized settings categories, keyword search, group navigation, settings persistence, safe data controls');
});
