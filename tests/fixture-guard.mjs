import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {leakGuard} from '../scripts/redact-fixtures.mjs';
test('P13 fixture scanning is recursive and never reports suspect values',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harmonova-scan-'));
 try{fs.mkdirSync(dir+'/nested');const token='2'.repeat(40);fs.writeFileSync(dir+'/nested/new-format.json',JSON.stringify({auth:token}));const errors=leakGuard(dir);assert.equal(errors.length,1);assert.ok(errors[0].includes('nested/new-format.json'));assert.ok(!errors[0].includes(token));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
