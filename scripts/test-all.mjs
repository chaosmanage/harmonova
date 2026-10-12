import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const unit=['ai-worker','ai-consent','security','remote-policy','message-boundary','storage-state','reader-cross-tab','incognito','resource-limits','image-policy','provider-policy','hn-queue','fixture-guard'];
const browser=['harness','network-boundary','security-browser','hn-parser','hn-auth','search','voting','comments','actions','profile','parity','comment-parity','links','fix-regressions','reload','provider-browser','settings-sidebar-browser','feed-resilience-browser','image-browser','migration-browser','lifecycle-browser','incognito-browser','resource-browser'];
const mode=process.argv[2]||'all';
if(!['unit','browser','all'].includes(mode))throw new Error('Unknown test mode');
const output=path.resolve(process.env.TEST_OUTPUT_DIR||'test-results');fs.mkdirSync(output,{recursive:true});
// Run each browser suite in its own process group, sequentially. No retries.
// Only synthetic data is used; diagnostics redact credentials/body-bearing URLs.
const sanitize=text=>text.replace(/https?:\/\/[^\s"'<>]+/g,value=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[URL]';}}).replace(/sk-or-v1-[\w-]+/g,'[synthetic key redacted]').replace(/\b[0-9a-f]{40}\b/gi,'[token redacted]');
async function run(name,args,timeout=600000) {
 console.log(`Running ${name} (${process.env.EXTENSION_PATH||'source'})`);
 const child=spawn(process.execPath,args,{env:{...process.env,HARMONOVA_TEST_FILTER:'',HARMONOVA_ALLOW_LIVE:'0',NODE_OPTIONS:'--unhandled-rejections=strict'},detached:true,stdio:['ignore','pipe','pipe']});
 let data='',tail='';const collect=chunk=>{data+=chunk.toString();if(data.length>2*1024*1024)data=data.slice(-2*1024*1024);tail=(tail+chunk).slice(-1000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 let expired=false;const timer=setTimeout(()=>{expired=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},timeout);
 const heartbeat=setInterval(()=>console.log(`Still running ${name}`),45000);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timer);clearInterval(heartbeat);
 fs.writeFileSync(path.join(output,name+'.log'),sanitize(data));
 if(code!==0||expired){console.error(sanitize(data));throw new Error(`${name} ${expired?'timed out':'failed'}; sanitized log in ${output}`);}
 console.log(sanitize(tail).trim());
}
if(mode!=='browser') {await run('unit',['--test',...unit.map(n=>'tests/'+n+'.mjs')],120000);}
if(mode!=='unit')for(const name of browser)await run(name,['tests/'+name+'.mjs']);
console.log(`${mode} offline gate passed`);
