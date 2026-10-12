import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {withExtension} from './helpers/extension.mjs';
import {localTlsFixture} from './helpers/network.mjs';
const server=await localTlsFixture((req,res)=>{
 if(req.url.endsWith('/compressed')){res.writeHead(200,{'content-type':'application/json','content-encoding':'gzip'});res.end(gzipSync('x'.repeat(400000)));}
 else if(req.url.endsWith('/stalled')){res.writeHead(200,{'content-type':'application/json'});res.write('{');}
 else {res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');}
});
try {
 await withExtension(async({context,worker})=>{
  await context.route('https://api.github.com/**',r=>r.continue());
  const result=await worker.evaluate(async()=>{
   const outcomes=[];
   for(const name of ['compressed','stalled']) {
    try{const response=await HarmoNovaResourcePolicy.request(fetch,'https://api.github.com/repos/fixture/'+name,{},{bytes:262144,deadline:250},['application/json']);await HarmoNovaResourcePolicy.readText(response,262144);outcomes.push('accepted');}
    catch(e){outcomes.push(e.code||e.message);}
    if(HarmoNovaResourcePolicy.activeCount!==0)throw new Error('Permit retained');
   }
   const next=await fetchPolicy('https://api.github.com/repos/fixture/next',{resourceKind:'richJson'});
   return {outcomes,text:await readResponseTextLimited(next,100),active:HarmoNovaResourcePolicy.activeCount};
  });
  assert.equal(result.outcomes[0],'RESPONSE_TOO_LARGE');assert.equal(result.outcomes[1],'RESOURCE_TIMEOUT');assert.equal(result.text,'{"ok":true}');assert.equal(result.active,0);
  console.log('PASS real decompressed-byte cap, stalled-body deadline, scheduler forward progress');
 },{destinations:new Map([['api.github.com:443',server]])});
}finally{await server.close();}
