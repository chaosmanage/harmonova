import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const realm=vm.createContext({Uint8Array,DataView,Blob,Promise,btoa:v=>Buffer.from(v,'binary').toString('base64')});
vm.runInContext(fs.readFileSync(new URL('../image-policy.js',import.meta.url),'utf8'),realm);
const policy=realm.HarmoNovaImagePolicy;
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFf8AAAAASUVORK5CYII=','base64'));
test('P08 small PNG headers accepted; mismatched types and active formats refused',()=> {
  assert.deepEqual({...policy.dimensions(png,'image/png')},{width:1,height:1});
  for(const type of ['image/jpeg','image/svg+xml','text/html','image/gif','image/x-icon'])assert.throws(()=>policy.dimensions(png,type),/UNSUPPORTED/);
});
test('P08 oversized/truncated PNGs and animation fail before decoding',()=> {
  for(const width of [0,4097,100000]) {const hostile=png.slice();new DataView(hostile.buffer).setUint32(16,width);assert.throws(()=>policy.dimensions(hostile,'image/png'));}
  const hostile=png.slice();new DataView(hostile.buffer).setUint32(16,4096);new DataView(hostile.buffer).setUint32(20,4096);assert.throws(()=>policy.dimensions(hostile,'image/png'));
  for(const length of [0,12,32,png.length-1])assert.throws(()=>policy.dimensions(png.slice(0,length),'image/png'));
  const animated=png.slice();animated.set(new TextEncoder().encode('acTL'),37);assert.throws(()=>policy.dimensions(animated,'image/png'));
});
test('P08 JPEG segment and WebP container lengths fail closed',()=> {
  for(const payload of [[255,216,255,192,255,255,0,0,0,0,255,217], [...Buffer.from('RIFF\xff\xff\xff\xffWEBPVP8X')], [...Buffer.from('<svg>active</svg>')]])
    for(const type of ['image/jpeg','image/webp','image/png'])assert.throws(()=>policy.dimensions(Uint8Array.from(payload),type));
});
test('P08 decoder failure and inconsistent decoded dimensions release the permit',async()=> {
  let closed=0;
  realm.createImageBitmap=async()=>{throw new Error('decode failed');};
  await assert.rejects(policy.sanitize(png,'image/png'),/decode failed/);
  realm.createImageBitmap=async()=>({width:2,height:1,close(){closed++;}});
  await assert.rejects(policy.sanitize(png,'image/png'),/UNSUPPORTED/);assert.equal(closed,1);
});
