import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withExtension} from './helpers/extension.mjs';
const output=process.env.TEST_OUTPUT_DIR||'test-results';
await withExtension(async ({context})=>{
  const html=fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8');
  const now=Math.floor(Date.now()/1000);
  const titles=['A simpler way to build desktop software','How SQLite handles concurrent writes','Running language models on consumer hardware','The browser as a universal application runtime','Understanding the latest Linux kernel changes','A closer look at database indexing','Why software teams should write better documentation','The physics of efficient solar panels','Ask HN: What are you building this month?','A new compiler for the web'];
  const stories=titles.map((title,i)=>({id:920301+i,type:'story',title,url:null,by:'reader_'+i,score:142-i*9,time:now-3600*(i+1),descendants:41-i*3}));
  const c=(id,author,text,children=[])=>({id,author,text,created_at_i:now-3600,children});
  const children=[
    c(920401,'simon','<p>One of the most interesting trade-offs is between a native interface and a shared web-based implementation. Keeping the UI responsive while preserving state matters much more than the rendering framework.</p><p>Here is a useful <a href="https://example.com/architecture">architecture reference</a>.</p>',[
      c(920402,'byteframe','<p>&gt; Keeping the UI responsive while preserving state matters much more than the rendering framework.</p><p>Agreed. A consistent layout and keyboard navigation make a surprisingly big difference when reading long discussions.</p>',[
        c(920403,'willow','<p>The keyboard navigation is especially important. I often switch between the feed and the discussion dozens of times a day.</p>')]),
      c(920404,'atlas','<p>For a code-heavy discussion, horizontal scrolling is essential:</p><pre><code>const result = await reader.restorePosition({ storyId, commentId, scrollOffset, collapsedBranches, preserveSelection: true });</code></pre>')]),
    c(920405,'lantern','<p>Another improvement is to let the reader choose how much width is used for the article and how much is reserved for the story list.</p>'),
    c(920406,'pebble','<p>I prefer the existing dark appearance. Better spacing and subtle hierarchy colors are all I need.</p>')
  ];
  await context.route('https://news.ycombinator.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
  await context.route('https://hacker-news.firebaseio.com/**',r=>{
    const id=Number(new URL(r.request().url()).pathname.match(/item\/(\d+)\.json/)?.[1]);
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stories.find(s=>s.id===id)||stories.map(s=>s.id))});
  });
  await context.route('https://hn.algolia.com/**',r=>{
    const id=Number(new URL(r.request().url()).pathname.match(/items\/(\d+)/)?.[1]);
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id,title:stories.find(s=>s.id===id)?.title||titles[0],author:'simon',points:142,created_at_i:now-7200,children})});
  });
  const page=await context.newPage();
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('https://news.ycombinator.com/news');
  await page.locator('.story-card').first().waitFor();
  await page.locator('.story-card').first().locator('.story-comment-button').click();
  await page.locator('.comment-card').first().waitFor();
  const menu=async(label)=>{
    await page.locator('.thread-actions .thread-action[aria-label="More"]').click();
    await page.locator('.harmonova-popup .popup-item').filter({hasText:label}).click();
  };
  const settings=async(category)=>{
    await page.locator('.feed-toolbar-actions .icon-button[aria-label="More"]').click();
    await page.locator('.harmonova-popup .popup-item').filter({hasText:'Settings'}).click();
    await page.locator('.settings-category').filter({hasText:category}).click();
  };
  await page.screenshot({path:path.join(output,'harmonova-reader.png')});
  await menu('Search in comments');
  await page.locator('.comment-search').fill('keyboard navigation');
  assert.equal(await page.locator('.comment-row.search-match').count(),2);
  await page.locator('.comment-search').press('Enter');
  assert.equal(await page.locator('.comment-row.search-current').count(),1);
  await page.screenshot({path:path.join(output,'harmonova-comment-search.png')});
  await page.locator('.comment-search-tools button').filter({hasText:'Close'}).click();
  assert.equal(await page.locator('.comment-row.search-match').count(),0);
  await settings('Comments');
  await page.locator('.setting-row').filter({hasText:'Collect reference links'}).locator('input').check();
  await page.locator('.setting-row').filter({hasText:'Quote highlighting'}).locator('select').selectOption('rail');
  await page.locator('.setting-row').filter({hasText:'Indicator width'}).locator('input').fill('5');
  await page.screenshot({path:path.join(output,'harmonova-comment-settings.png')});
  await page.locator('.settings-header .icon-button').first().click();
  assert.equal(await page.locator('.comment-references a').count(),1);
  assert.equal(await page.locator('.comment-body pre').evaluate(e=>getComputedStyle(e).whiteSpace),'pre');
  await settings('Stories');
  await page.locator('.setting-row').filter({hasText:'Topic labels'}).locator('input').check();
  await page.locator('.settings-header .icon-button').first().click();
  assert.ok(await page.locator('.story-category:visible').count()>=5);
  await page.screenshot({path:path.join(output,'harmonova-topics.png')});
  await menu('Ask AI');
  await page.locator('.ask-ai-question').fill('What are the main arguments about keyboard navigation?');
  await page.screenshot({path:path.join(output,'harmonova-ask-ai.png')});
  await page.locator('.ask-ai-controls button').filter({hasText:'Close'}).click();
  await page.keyboard.press('f');
  assert.equal(await page.locator('.feed-pane').isVisible(),false);
  await page.screenshot({path:path.join(output,'harmonova-focus.png')});
  await page.keyboard.press('Escape');
  console.log('PASS reading controls, match navigation, local categories, Ask AI UI and focus mode');
});
