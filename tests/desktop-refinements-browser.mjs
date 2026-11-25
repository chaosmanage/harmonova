import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withExtension} from './helpers/extension.mjs';

await withExtension(async ({context}) => {
  const html=fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8');
  const ids=[910301,910302,910303];
  const stories=ids.map(id=>({id,type:'story',title:'Desktop discussion '+id,url:null,by:'fixture',score:42,time:1700000000,descendants:5}));
  const comment=(id,children=[])=>({id,author:'fixture',text:'A sample comment about desktop reading and navigation.',created_at_i:1700000000,children});
  const children=[comment(910401,[comment(910402,[comment(910403)]),comment(910404)]),comment(910405)];
  await context.route('https://news.ycombinator.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await context.route('https://hacker-news.firebaseio.com/**',route=>{
    const p=new URL(route.request().url()).pathname;
    const id=Number(p.match(/item\/(\d+)\.json/)?.[1]);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stories.find(s=>s.id===id)||ids)});
  });
  await context.route('https://hn.algolia.com/**',route=>{
    const id=Number(new URL(route.request().url()).pathname.match(/items\/(\d+)/)?.[1]);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id,title:'Desktop discussion '+id,author:'fixture',created_at_i:1700000000,children})});
  });
  const page=await context.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.goto('https://news.ycombinator.com/news');
  await page.locator('.story-card').first().waitFor();
  assert.equal(await page.locator('.thread-placeholder').isVisible(),true,'placeholder stays visible until a story is chosen');
  assert.equal(await page.locator('.thread-title, .comment-card').count(),0,'no story comments open automatically on launch');
  assert.equal(await page.locator('.story-card.selected, .story-card.is-read').count(),0,'no story is preselected or greyed out on launch');
  await page.locator('.story-card').first().focus();
  await page.keyboard.press('Enter');
  await page.locator('.comment-card').first().waitFor();
  assert.equal(await page.locator('.story-card').first().evaluate(e=>e.classList.contains('selected')&&e.classList.contains('is-read')),true,'chosen story is marked selected and read');
  assert.equal(await page.locator('.story-card.is-read').count(),1,'only the chosen story is marked read');
  const metrics=()=>page.evaluate(()=>{
    const cards=[...document.querySelectorAll('.comment-card')].filter(c=>c.getClientRects().length);
    return {gaps:cards.slice(1).map((c,i)=>c.getBoundingClientRect().top-cards[i].getBoundingClientRect().bottom),
      lefts:cards.map(c=>c.getBoundingClientRect().left),
      cardBg:getComputedStyle(cards[0]).backgroundColor,
      bodyBg:getComputedStyle(document.body).backgroundColor,
      colors:cards.map(c=>getComputedStyle(c,'::before').backgroundColor),
      widths:cards.map(c=>getComputedStyle(c,'::before').width),
      theme:document.documentElement.dataset.theme};
  });
  const initial=await metrics();
  assert.equal(initial.theme,'amoled');
  assert.notEqual(initial.cardBg,initial.bodyBg);
  assert.ok(initial.lefts[1]-initial.lefts[0]>=19,JSON.stringify(initial.lefts));
  assert.ok(initial.lefts[2]-initial.lefts[1]>=19,JSON.stringify(initial.lefts));
  assert.equal(initial.colors[0],'rgb(255, 177, 195)');
  assert.equal(initial.colors[1],'rgb(185, 128, 70)');
  assert.ok(initial.widths.every(w=>w==='3px'));
  assert.ok(initial.gaps.every(g=>Math.abs(g-initial.gaps[0])<0.6),JSON.stringify(initial));
  const splitter=page.locator('.desktop-splitter');
  const old=await page.locator('.feed-pane').evaluate(e=>e.clientWidth);
  const bounds=await splitter.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,400);
  await page.mouse.down();await page.mouse.move(660,400,{steps:5});await page.mouse.up();
  const resized=await page.locator('.feed-pane').evaluate(e=>e.clientWidth);
  assert.ok(resized>old+30);
  await page.keyboard.press('n');
  assert.ok(await page.locator('.comment-card').first().evaluate(e=>e===document.activeElement));
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.comment-card:visible').count(),2);
  await page.keyboard.press('f');
  assert.equal(await page.locator('.feed-pane').isVisible(),false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.feed-pane').isVisible(),true);
  await page.locator('.story-card').nth(1).focus();await page.keyboard.press('Enter');
  await page.locator('.thread-title').filter({hasText:'910302'}).waitFor();
  await page.locator('.story-card').first().focus();await page.keyboard.press('Enter');
  await page.locator('.thread-title').filter({hasText:'910301'}).waitFor();
  assert.ok(await page.locator('.comment-row[data-comment-id="910401"]').evaluate(e=>e.classList.contains('collapsed')));
  await page.locator('.comment-card').first().focus();await page.keyboard.press('Enter');
  await page.screenshot({path:path.join(process.env.TEST_OUTPUT_DIR||'test-results','desktop-refinements.png')});
  await page.setViewportSize({width:800,height:800});
  assert.equal(await splitter.isVisible(),false);
  console.log('PASS desktop comment gaps, rails, resizing, keyboard controls and reading state');
});
