import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','dist','test-results','test-results-packaged','.git'].includes(e.name)?[]:e.isDirectory()?walk(dir+'/'+e.name):/\.(?:js|mjs)$/.test(e.name)?[dir+'/'+e.name]:[]);
for(const file of walk('.'))execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
console.log('Runtime, test and tool syntax passed');
