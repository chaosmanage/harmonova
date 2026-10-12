import assert from 'node:assert/strict';
export async function stopExtensionWorker(context,page,scriptURL) {
 const cdp=await context.newCDPSession(page);let versions=[];
 try {
  cdp.on('ServiceWorker.workerVersionUpdated',event=>{versions=event.versions;});await cdp.send('ServiceWorker.enable');
  for(let i=0;i<100&&!versions.some(v=>v.scriptURL===scriptURL&&v.runningStatus==='running');i++)await page.waitForTimeout(50);
  const active=versions.find(v=>v.scriptURL===scriptURL&&v.runningStatus==='running');assert.ok(active,'actual extension worker must be running');
  await cdp.send('ServiceWorker.stopWorker',{versionId:active.versionId});
 }finally{await cdp.detach();}
}
