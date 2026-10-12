import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';

await withExtension(async ({context}) => {
  const news=fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8');
  await context.route('https://news.ycombinator.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:news}));
  const ids=Array.from({length:48},(_,i)=>910100+i);
  let slow=true,failOne=false,requests=0;
  await context.route('https://hacker-news.firebaseio.com/v0/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v0/topstories.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ids)});
    const id=Number(url.pathname.match(/item\/(\d+)\.json/)?.[1]);
    if(!ids.includes(id))return route.fulfill({status:404,contentType:'application/json',body:'null'});
    requests++;
    if(slow)await new Promise(resolve=>setTimeout(resolve,900));
    if(failOne&&id===ids[1])return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      id,type:'story',title:'Delayed public story '+id,url:null,by:'fixture',score:11,time:1700000000,descendants:0
    })});
  });
  await context.route('https://hn.algolia.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:ids[0],title:'Story',author:'fixture',children:[]})}));
  const page=await context.newPage();
  const started=Date.now();
  await page.goto('https://news.ycombinator.com/news');
  await page.locator('.story-card').first().waitFor({timeout:13000});
  assert.ok(Date.now()-started<13000,'first stories must render before a full 40-request batch');
  assert.equal(await page.locator('.harmonova-error').count(),0);
  assert.equal(await page.locator('.story-card').count(),20,'initial batch loads 20 stories');
  slow=false;
  await page.locator('.story-card').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelectorAll('.story-card').length>=40,null,{timeout:14000});
  assert.ok(requests>=40,'additional stories lazy-load on scroll');
  failOne=true;
  await page.reload();
  await page.locator('.story-card').first().waitFor({timeout:12000});
  assert.equal(await page.locator('.harmonova-error').count(),0,'one failed item must not blank the feed');
  assert.ok(await page.locator('.story-card').count()>=19,'other stories survive a failed response');
  console.log('PASS slow Firebase feed, early rendering, scroll pagination, isolated item failure');
});
