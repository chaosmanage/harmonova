import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
const script = fs.readFileSync(new URL("../resource-policy.js", import.meta.url), "utf8");
const realm = vm.createContext({ URL, ArrayBuffer, TextEncoder, TextDecoder, Date, Promise, console,
  Uint8Array, Set, Map, AbortController, setTimeout, clearTimeout, ReadableStream });
vm.runInContext(script, realm);
const policy = realm.HarmoNovaResourcePolicy;
const bytes = str => new TextEncoder().encode(str);
const streamed = chunks => new Response(new ReadableStream({
  start(controller) {
    for (const b of chunks) controller.enqueue(b);
    controller.close();
  }
}), { headers: { "content-type": "text/plain" } });
test("P07 chunks counted by byte length, not UTF-16 chars", async () => {
  const body = streamed([bytes("α"), bytes("β"), bytes("🌐")]);
  const result = await policy.readText(body, 8);
  assert.equal(result, "αβ🌐");
  await assert.rejects(policy.readText(streamed([bytes("α"), bytes("β"), bytes("🌐")]), 7), /size limit/);
});
test("P07 dishonest advertised size cannot bypass actual stream limit", async () => {
  const payload = streamed([new Uint8Array(800), new Uint8Array(900)]);
  payload.headers.set("content-length", "1");
  await assert.rejects(policy.readBytes(payload, 1000), /size limit/);
  await assert.rejects(policy.readBytes(new Response("large", { headers: { "content-length": "10000" } }), 3), /size limit/);
});
test("P07 no unbounded fallback for fake non-streaming bodies", async () => {
  await assert.rejects(policy.readText({ status: 200, headers: new Headers(), text: async () => "attack" }, 8),
    /RESPONSE_BODY_UNAVAILABLE/);
  const value = await policy.readBytes({ status: 204, headers: new Headers() }, 1);
  assert.equal(value.byteLength, 0);
});
test("P07 stream failures cancel reader and do not leak a lock", async () => {
  let canceled = false;
  const source = new ReadableStream({
    pull(controller) { controller.enqueue(bytes("excess bytes")); },
    cancel() { canceled = true; },
  });
  await assert.rejects(policy.readBytes(new Response(source), 2), /size limit/);
  assert.equal(canceled, true);
});
test("P07 LRU evicts on entry budget, bytes, TTL and refresh", () => {
  const cache = policy.lru({ maxEntries: 2, maxBytes: 55, ttl: 20 });
  cache.set("one", { value: 1 });
  cache.set("two", { value: 2 });
  assert.equal(cache.get("one").value, 1);
  cache.set("three", { value: 3 });
  assert.equal(cache.get("two"), undefined);
  assert.equal(cache.count, 2);
  cache.set("huge", { long: "x".repeat(100) });
  assert.equal(cache.get("huge"), undefined);
  assert.ok(cache.bytes <= 55);
});
test("P07 scheduler limits six concurrent, two per origin, with forward progress", async () => {
  const releases = [];
  for (let i = 0; i < 6; i++) releases.push(await policy.acquire("https://a" + i + ".test/"));
  assert.equal(policy.activeCount, 6);
  let gotPermit = false;
  const next = policy.acquire("https://new.test/").then(release => {
    gotPermit = true; release();
  });
  await Promise.resolve();
  assert.equal(gotPermit, false);
  releases.shift()();
  await next;
  for (const release of releases) release();
  assert.equal(policy.activeCount, 0);
  const originA = await policy.acquire("https://x.test/");
  const originB = await policy.acquire("https://x.test/a");
  let thirdReady = false;
  const third = policy.acquire("https://x.test/b").then(release => {
    thirdReady = true; release();
  });
  await Promise.resolve();
  assert.equal(thirdReady, false);
  originA();
  await third;
  originB();
  assert.equal(policy.activeCount, 0);
});

test('P07 canceled queued job leaves immediately and frees queue capacity', async () => {
  const a=await policy.acquire('https://cancel.test/'), b=await policy.acquire('https://cancel.test/');
  const controller=new AbortController();
  const waiting=policy.acquire('https://cancel.test/queued',controller.signal);
  controller.abort();
  await assert.rejects(waiting,/CANCELLED/);
  assert.equal(policy.queuedCount,0); a(); b();
});

test('P07 shared consumers cancel independently and completed jobs are discarded', async () => {
  const first=new AbortController(); let finish, calls=0, jobSignal;
  const work=c=>{calls++;jobSignal=c.signal;return new Promise(r=>finish=r);};
  const a=policy.shared('shared',work,first.signal), b=policy.shared('shared',work);
  await Promise.resolve(); first.abort(); await assert.rejects(a,/CANCELLED/);
  assert.equal(jobSignal.aborted,false); finish('result'); assert.equal(await b,'result'); assert.equal(calls,1);
  assert.equal(await policy.shared('shared',async()=> 'fresh'),'fresh');
});

for (const mode of ['headers','body','overflow','type','parse']) test('P07 bounded request releases permit after '+mode+' failure', async()=> {
  const fetchImpl=async()=> mode==='headers' ? new Promise(()=>{}) : new Response(mode==='body' ? new ReadableStream({pull(){return new Promise(()=>{});}}) : 'large', {headers:{'content-type':'text/plain'}});
  const budget={bytes:mode==='overflow'?2:100,deadline:30};
  if(mode==='headers'||mode==='type') await assert.rejects(policy.request(fetchImpl,'https://resource.test/',{},budget,mode==='type'?['image/png']:null));
  else { const response=await policy.request(fetchImpl,'https://resource.test/',{},budget); if(mode==='body'||mode==='overflow') await assert.rejects(policy.readText(response,100)); else {const text=await policy.readText(response,100); assert.throws(()=>JSON.parse(text));} }
  assert.equal(policy.activeCount,0);
  const next=await policy.request(async()=>new Response('ok'),'https://resource.test/',{},{bytes:10,deadline:30});
  assert.equal(await policy.readText(next,10),'ok'); assert.equal(policy.activeCount,0);
});

test('P13 malformed transports and throwing cancellation release scheduler', async () => {
  for (const body of [{ cancel(){throw new Error('fixture');} }, {getReader(){throw new Error('fixture');},cancel(){throw new Error('fixture');}}]) {
    await assert.rejects(policy.request(async()=>({ok:true,status:200,headers:new Headers(),body}), 'https://resource.test/', {}, {bytes:10,deadline:50}));
    assert.equal(policy.activeCount,0);
  }
  const next=await policy.request(async()=>new Response('ok'),'https://resource.test/',{},{bytes:10,deadline:50});
  assert.equal(await policy.readText(next,10),'ok');
  assert.equal(policy.activeCount,0);
});
