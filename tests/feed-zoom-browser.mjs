// Content Zoom changes the number of fully visible stories, not just text size.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';

await withExtension(async ({context}) => {
  const html=fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8');
  await context.route('https://news.ycombinator.com/**',route=>
    route.fulfill({status:200,contentType:'text/html',body:html}));
  const ids=Array.from({length:35},(_,i)=>910300+i);
  await context.route('https://hacker-news.firebaseio.com/v0/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('stories.json'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ids)});
    const id=Number(path.match(/item\/(\d+)\.json/)?.[1]);
    const story={id,type:'story',title:'A detailed technical headline about programming languages and developer tooling '+id,
      url:null,by:'fixture',score:42,time:1700000000,descendants:24};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(story)});
  });
  await context.route('https://hn.algolia.com/**',route=>
    route.fulfill({status:200,contentType:'application/json',body:'{"children":[]}'}));
  const page=await context.newPage();
  await page.setViewportSize({width:1856,height:832});
  await page.goto('https://news.ycombinator.com/news');
  await page.waitForFunction(()=>document.querySelectorAll('.story-list > .story-card').length>=10);
  const metrics=()=>page.evaluate(()=>{
    const list=document.querySelector('.story-list');
    const bounds=list.getBoundingClientRect();
    const cards=[...list.querySelectorAll('.story-card')].filter(c=>getComputedStyle(c).display!=='none');
    const full=cards.filter(c=>{const r=c.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom+0.5;});
    const first=cards[0].getBoundingClientRect();
    return {count:full.length,height:first.height,gap:parseFloat(getComputedStyle(list).gap),
      clipped:cards.slice(0,10).some(c=>c.scrollHeight>c.clientHeight+1)};
  });
  const normal=await metrics();
  assert.ok(normal.count>=8&&normal.count<=10,
    'default 70% zoom should show 8-10 stories at screenshot desktop size: '+JSON.stringify(normal));
  assert.equal(normal.clipped,false,'story text and previews should not clip at default');
  await page.evaluate(()=>{location.hash='#harmonova-settings';});
  await page.locator('.settings-overlay').waitFor({state:'visible'});
  await page.locator('.settings-category').filter({hasText:'Stories'}).click();
  const slider=page.locator('.setting-row').filter({hasText:'Content zoom'}).locator('input[type=range]');
  assert.equal(await slider.inputValue(),'70');
  await slider.fill('100');
  const larger=await metrics();
  assert.ok(larger.height>normal.height&&larger.gap>normal.gap&&larger.count<normal.count,
    'raising zoom must reduce visible stories: '+JSON.stringify({normal,larger}));
  await slider.fill('125');
  const largest=await metrics();
  assert.ok(largest.height>larger.height&&largest.count<=larger.count);
  await slider.fill('150');
  const maximum=await metrics();
  assert.ok(maximum.height>=largest.height&&maximum.count<=largest.count&&!maximum.clipped,
    '150% story zoom remains usable without clipping');
  await slider.fill('65');
  const smallest=await metrics();
  assert.ok(smallest.height<normal.height&&smallest.count>=normal.count);
  assert.equal(smallest.clipped,false,'smallest zoom should not clip content');
  // The right pane has its own independent zoom, including card padding and gaps.
  await page.evaluate(()=>{
    const pane=document.querySelector('.thread-pane');
    pane.replaceChildren();
    const list=document.createElement('div');list.className='comments';
    for(let i=0;i<24;i++){
      const row=document.createElement('div');row.className='comment-row';
      const card=document.createElement('div');card.className='comment-card';
      const meta=document.createElement('div');meta.className='comment-meta';
      meta.innerHTML='<span class="comment-author">reader</span><span class="comment-age">2h</span>';
      const body=document.createElement('div');body.className='comment-body';
      const p=document.createElement('p');p.textContent='A useful reply about the article and the developer experience.';
      body.append(p);card.append(meta,body);row.append(card);list.append(row);
    }
    pane.append(list);pane.scrollTop=0;
  });
  const commentMetrics=()=>page.evaluate(()=>{
    const pane=document.querySelector('.thread-pane');
    const cards=[...pane.querySelectorAll('.comment-card')];
    const visible=cards.filter(c=>c.getBoundingClientRect().bottom<=pane.getBoundingClientRect().bottom);
    const first=cards[0],style=getComputedStyle(first);
    return {count:visible.length,height:first.getBoundingClientRect().height,pad:parseFloat(style.paddingTop),
      font:parseFloat(getComputedStyle(first.querySelector('.comment-body')).fontSize)};
  });
  const commentsDefault=await commentMetrics();
  await slider.fill('125');
  const commentsAfterFeedZoom=await commentMetrics();
  assert.deepEqual(commentsAfterFeedZoom,commentsDefault,'content zoom must not affect comment geometry');
  await page.locator('.settings-back').click();
  await page.locator('.settings-category').filter({hasText:'Comments'}).click();
  const commentSlider=page.locator('.setting-row').filter({hasText:'Comment zoom'}).locator('input[type=range]');
  assert.equal(await commentSlider.inputValue(),'90');
  await commentSlider.fill('65');
  const compact=await commentMetrics();
  await commentSlider.fill('150');
  const expanded=await commentMetrics();
  assert.ok(compact.count>commentsDefault.count&&commentsDefault.count>expanded.count,
    'comment zoom changes the number visible: '+JSON.stringify({compact,commentsDefault,expanded}));
  assert.ok(compact.pad<commentsDefault.pad&&commentsDefault.pad<expanded.pad);
  assert.ok(compact.font<commentsDefault.font&&commentsDefault.font<expanded.font);
  console.log('PASS feed and comment zoom independently scale card density',JSON.stringify({normal,larger,smallest,compact,commentsDefault,expanded}));
});
