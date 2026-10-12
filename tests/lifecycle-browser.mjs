import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';
await withExtension(async({context,worker})=> {
  await context.route('https://news.ycombinator.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8')}));
  await context.route('https://hacker-news.firebaseio.com/v0/**',r=>{const id=Number(new URL(r.request().url()).pathname.match(/item\/(\d+)/)?.[1]);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r.request().url().endsWith('stories.json')?[910001,910002]:{id,type:'story',title:'Story '+id,by:'fixture',score:1,time:1700000000,descendants:1})});});
  let release,waiting=false;
  await context.route('https://hn.algolia.com/api/v1/items/**',async r=> {
    const id=Number(new URL(r.request().url()).pathname.split('/').pop());
    if(id===910001&&!waiting){waiting=true;await new Promise(resolve=>release=resolve);}
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id,title:'Thread '+id,author:'fixture',children:[]})}).catch(()=>{});
  });
  const page=await context.newPage();await page.goto('https://news.ycombinator.com/news');await page.locator('.story-card').first().waitFor();
  await page.locator('[data-story-id="910002"] .story-comment-button').click();await page.waitForFunction(()=>document.querySelector('.thread-title')?.textContent==='Thread 910002');
  release?.();await page.waitForTimeout(200);
  assert.equal(await page.locator('.thread-title').textContent(),'Thread 910002','old response cannot replace the current story');
  for(let i=0;i<8;i++){await page.locator('[data-story-id="'+(i%2?910002:910001)+'"] .story-comment-button').click();await page.locator('.thread-title').waitFor();}
  await page.goto('about:blank');
  const resources=await worker.evaluate(()=>({active:HarmoNovaResourcePolicy.activeCount,pending:HarmoNovaResourcePolicy.queuedCount,consumers:previewConsumers.size}));
  assert.deepEqual(resources,{active:0,pending:0,consumers:0});
  console.log('PASS P11 canceled thread switching, late old response and repeated navigation cleanup');
});
