import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withExtension} from './helpers/extension.mjs';
await withExtension(async({context,worker})=> {
  const page=await context.newPage();
  // Produce real encoded raster fixtures in Chromium, without remote assets.
  const samples=await page.evaluate(async()=> {
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=700;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#a34c25';ctx.fillRect(0,0,1200,700);
    const out={};for(const type of ['image/png','image/jpeg','image/webp'])out[type]=[...new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,type,.8))).arrayBuffer())];return out;
  });
  for(const [mime,bytes] of Object.entries(samples)) {
    const safe=await worker.evaluate(async({mime,bytes})=>HarmoNovaImagePolicy.sanitize(new Uint8Array(bytes),mime),{mime,bytes});
    assert.ok(safe.src.startsWith('data:image/png;base64,'));
    assert.ok(safe.width<=1024 && safe.height<=1024 && safe.width*safe.height<=1048576);
    assert.ok(Buffer.from(safe.src.split(',')[1],'base64').length<=256*1024);
    assert.match(safe.tint,/^#[0-9a-f]{6}$/);
  }
  const images=[],remoteDom=[];
  await context.addCookies([{name:'synthetic-image-cookie',value:'dummy',domain:'images.example.test',path:'/',secure:true,sameSite:'None'}]);
  context.on('request',request=> {if(request.resourceType()==='image' && new URL(request.url()).hostname!=='news.ycombinator.com' && /^https?:/.test(request.url()))remoteDom.push(request.url());});
  await context.route('https://images.example.test/**',route=> {
    images.push(route.request().headers());return route.fulfill({status:200,contentType:'image/png',body:Buffer.from(samples['image/png'])});
  });
  await context.route('https://source.example.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<meta property="og:image" content="https://images.example.test/safe.png"><link rel="icon" href="https://images.example.test/safe.png">'}));
  await context.route('https://news.ycombinator.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(new URL('./fixtures/hn/news.html',import.meta.url),'utf8')}));
  const story={id:910001,type:'story',title:'Image fixture',url:'https://source.example.test/article',by:'fixture',time:1700000000,score:10,descendants:0};
  await context.route('https://hacker-news.firebaseio.com/v0/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('stories.json')?[910001]:story)}));
  await context.route('https://hn.algolia.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:910001,title:story.title,url:story.url,author:'fixture',children:[]})}));
  console.log('Raster decoders passed');
  await page.goto('https://news.ycombinator.com/news');
  await page.waitForFunction(()=>document.querySelector('.story-preview-image')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
  await page.locator('.story-card').first().click();
  await page.waitForFunction(()=>document.querySelector('.thread-hero-image')?.getAttribute('src')?.startsWith('data:image/png;base64,'));
  assert.ok(images.length>=1);assert.ok(images.every(headers=>!headers.cookie&&!headers.referer));assert.deepEqual(remoteDom,[]);
  await page.evaluate(()=>{for(const img of document.querySelectorAll('img[src^="data:image/png"]')) img.dispatchEvent(new Event('error'));});
  assert.deepEqual(remoteDom,[],'image errors never fall back to remote URLs');
  console.log('PASS P08 real PNG/JPEG/WebP sanitization, cards/heroes, credential omission and zero remote DOM images');
});
