import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=process.cwd(), dist=path.resolve(process.env.EXTENSION_PATH||'dist/harmonova');
const read=p=>fs.readFileSync(p);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
// The release's explicit shell copy list is authoritative, never repository-wide copying.
const shell=read('scripts/package.sh').toString();
const expected=new Set();
for(const match of shell.matchAll(/^cp (.+?) "\$tmp\/([^"$]*)"$/gm)) {
  const [sources,destination]=[match[1].split(' '),match[2]];
  for(const source of sources) {
    const directory=path.dirname(source), pattern=path.basename(source);
    const names=pattern.includes('*')?fs.readdirSync(directory).filter(n=>new RegExp('^'+pattern.replaceAll('.','\\.').replaceAll('*','.*')+'$').test(n)):[pattern];
    for(const name of names) {const from=path.join(directory,name),to=destination+name;expected.add(to);assert.ok(read(from).equals(read(path.join(dist,to))),`Source/package mismatch: ${to}`);}
  }
}
const actual=walk(dist).map(p=>path.relative(dist,p));
assert.deepEqual(actual.sort(),[...expected].sort(),'Release file allowlist mismatch');
const manifest=JSON.parse(read(path.join(dist,'manifest.json')));
assert.equal(manifest.version,JSON.parse(read('package.json')).version);
assert.equal(manifest.version,JSON.parse(read('package-lock.json')).version);
const references=new Set([manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,...Object.values(manifest.icons),...Object.values(manifest.action.default_icon),...manifest.content_scripts.flatMap(c=>[...c.js,...c.css]),...manifest.web_accessible_resources.flatMap(r=>r.resources)]);
const add=(from,reference)=> {if(!reference||/^(?:https?:|data:|#)/.test(reference))return;references.add(path.posix.normalize(path.posix.join(path.posix.dirname(from),reference.split(/[?#]/)[0])));};
for(const file of actual) {
 const source=/\.(js|html|css)$/.test(file)?read(path.join(dist,file)).toString():'';
 if(file.endsWith('.html'))for(const m of source.matchAll(/(?:src|href)=["']([^"']+)["']/g))add(file,m[1]);
 if(file.endsWith('.css'))for(const m of source.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g))add(file,m[1]);
 if(file.endsWith('.js')) {
  for(const call of source.matchAll(/importScripts\(([^)]+)\)/g))for(const m of call[1].matchAll(/["']([^"']+)["']/g))add(file,m[1]);
  for(const m of source.matchAll(/(?:chrome\.runtime\.getURL|runtime\.getURL)\(["']([^"']+)["']\)/g))references.add(m[1]);
 }
 // Context-specific credential detection avoids license hashes and synthetic examples.
 if(source && /(?:sk-or-v1-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:auth=|hmac["']?\s*[:=]\s*["']?)[2-9a-f][0-9a-f]{39})/i.test(source))throw new Error(`Credential pattern in release: ${file}`);
}
for(const reference of references)assert.ok(expected.has(reference),`Missing runtime reference: ${reference}`);
const zip=`dist/harmonova-${manifest.version}.zip`;
const zipped=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n').filter(n=>!n.endsWith('/')).map(n=>n.replace(/^harmonova\//,''));
assert.deepEqual(zipped.sort(),actual.sort(),'ZIP differs from unpacked release');
for(const file of actual)assert.ok(execFileSync('unzip',['-p',zip,'harmonova/'+file]).equals(read(path.join(dist,file))),`ZIP byte mismatch: ${file}`);
console.log(`Package checked: ${actual.length} allowlisted files, ${references.size} runtime references, ZIP/source byte parity`);
