// Worker-owned resource budgets. All untrusted stream consumers use these
// primitives; the public request policy remains in background.js.
(() => {
  "use strict";
  const Limits = Object.freeze({
    hnHtml: { bytes: 4*1024*1024, deadline: 15000 },
    publicJson: { bytes: 4*1024*1024, deadline: 15000 },
    aiStream: { bytes: 2*1024*1024, deadline:120000 },
    article: { bytes: 2 * 1024 * 1024, deadline: 15000 },
    metadata: { bytes: 1500000, deadline: 6000 },
    richJson: { bytes: 256 * 1024, deadline: 6000 },
    atom: { bytes: 512 * 1024, deadline: 6000 },
    image: { bytes: 2 * 1024 * 1024, deadline: 6000 },
    providerError: { bytes: 16000, deadline: 6000 },
    aiJson: { bytes: 128 * 1024, deadline: 120000 },
    storyLookup: { bytes: 8192, deadline: 6000 },
  });
  const MAX_REQUESTS = 6, MAX_ORIGIN = 2, MAX_QUEUE = 100;
  let active = 0;
  const byOrigin = new Map();
  const pending = [];
  const failure = code => {
    const error = new Error(code === "RESPONSE_TOO_LARGE" ? "Response exceeded size limit" : code);
    error.code = code;
    return error;
  };
  function drain() {
    for (let i = 0; i < pending.length && active < MAX_REQUESTS;) {
      const item = pending[i];
      if (item.signal?.aborted) {
        pending.splice(i, 1); item.cleanup(); item.reject(failure("RESOURCE_CANCELLED")); continue;
      }
      if ((byOrigin.get(item.origin) || 0) >= MAX_ORIGIN) { i++; continue; }
      pending.splice(i, 1); item.cleanup();
      active++; byOrigin.set(item.origin, (byOrigin.get(item.origin) || 0) + 1);
      let released = false;
      item.resolve(() => {
        if (released) return;
        released = true;
        active--; const next = (byOrigin.get(item.origin) || 1) - 1;
        if (next) byOrigin.set(item.origin, next); else byOrigin.delete(item.origin);
        drain();
      });
    }
  }
  function acquire(url, signal) {
    const origin = new URL(url).origin;
    if (signal?.aborted) return Promise.reject(failure("RESOURCE_CANCELLED"));
    if (pending.length >= MAX_QUEUE) return Promise.reject(failure("RESOURCE_BUSY"));
    return new Promise((resolve, reject) => {
      const cancel = () => { const index = pending.indexOf(item); if (index !== -1) { pending.splice(index,1); item.cleanup(); reject(failure("RESOURCE_CANCELLED")); drain(); } };
      const item = { origin, signal, resolve, reject, cleanup: () => signal?.removeEventListener("abort",cancel) };
      signal?.addEventListener("abort",cancel,{once:true});
      pending.push(item); drain();
    });
  }
  // A permit covers queue wait, headers AND body consumption. Aborted mock
  // transports are raced as well, so a stalled reader cannot hold a permit.
  async function request(fetchImpl, url, init, budget, types) {
    const controller = new AbortController();
    const relay = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort",relay,{once:true});
    if (init.signal?.aborted) relay();
    const timer = setTimeout(()=>controller.abort(failure("RESOURCE_TIMEOUT")),budget.deadline);
    const signal = controller.signal;
    let release, reader, response, streamController, ended = false, total = 0;
    const finish = () => { if (ended) return; ended=true; clearTimeout(timer); init.signal?.removeEventListener("abort",relay); signal.removeEventListener("abort",stop); release?.(); };
    const stop = () => { const error=signal.reason || failure("RESOURCE_CANCELLED"); try { streamController?.error(error); } catch {} reader?.cancel().catch(()=>{}); finish(); };
    signal.addEventListener("abort",stop,{once:true});
    const raced = task => new Promise((resolve,reject)=> {
      const abort = () => reject(signal.reason || failure("RESOURCE_CANCELLED"));
      if (signal.aborted) return abort();
      signal.addEventListener("abort",abort,{once:true});
      Promise.resolve(task).then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
    });
    try {
      release = await acquire(url,signal);
      if(signal.aborted) {release();throw failure("RESOURCE_CANCELLED");}
      response = await raced(fetchImpl(url,{...init,signal,credentials:"omit",referrerPolicy:"no-referrer",redirect:"error"}));
      const type=(response.headers.get("content-type") || "").split(";")[0].toLowerCase().trim();
      if (response.type === "opaqueredirect" || response.status >=300 && response.status <400) throw failure("REMOTE_FETCH_BLOCKED");
      if (types?.length && !types.includes(type)) throw failure("UNSUPPORTED_CONTENT_TYPE");
      const cap=response.ok ? budget.bytes : 16*1024;
      const length=Number(response.headers.get("content-length"));
      if (length > cap) throw failure("RESPONSE_TOO_LARGE");
      if (!response.body) { if (![204,205].includes(response.status)) throw failure("RESPONSE_BODY_UNAVAILABLE"); finish(); return response; }
      reader=response.body.getReader();
      const body=new ReadableStream({
        start(c) {streamController=c;},
        async pull(c) {
          try {
            const part=await raced(reader.read());
            if (ended) return;
            if (part.done) { c.close(); reader.releaseLock(); finish(); return; }
            total+=part.value.byteLength;
            if (total>cap) throw failure("RESPONSE_TOO_LARGE");
            c.enqueue(part.value);
          } catch(error) { try {c.error(error);} catch {} reader.cancel().catch(()=>{}); finish(); }
        },
        cancel() { reader.cancel().catch(()=>{}); finish(); },
      },{highWaterMark:0});
      return {ok:response.ok,status:response.status,type:response.type,url:response.url,headers:response.headers,body};
    } catch(error) { if(reader)reader.cancel().catch(()=>{}); else response?.body?.cancel().catch(()=>{}); finish(); throw error; }
  }
  async function readBytes(response, cap) {
    if (!Number.isSafeInteger(cap) || cap < 0) throw failure("INVALID_RESOURCE_LIMIT");
    const advertised = Number(response.headers?.get("content-length"));
    if (Number.isFinite(advertised) && advertised > cap) {
      try { await response.body?.cancel(); } catch {}
      throw failure("RESPONSE_TOO_LARGE");
    }
    if (!response.body) {
      if ([204, 205, 304].includes(response.status)) return new Uint8Array();
      throw failure("RESPONSE_BODY_UNAVAILABLE");
    }
    const reader = response.body.getReader();
    let total = 0, done = false;
    const chunks = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) { done = true; break; }
        if (!ArrayBuffer.isView(part.value) || part.value.BYTES_PER_ELEMENT !== 1) throw failure("INVALID_RESOURCE_CHUNK");
        total += part.value.byteLength;
        if (total > cap) throw failure("RESPONSE_TOO_LARGE");
        chunks.push(part.value);
      }
      const out = new Uint8Array(total);
      let index = 0;
      for (const chunk of chunks) { out.set(chunk, index); index += chunk.byteLength; }
      return out;
    } finally {
      if (!done) try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
    }
  }
  async function readText(response, cap) {
    const bytes = await readBytes(response, cap);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  const sharedJobs=new Map();
  function shared(key, work, signal) {
    if (signal?.aborted) return Promise.reject(failure("RESOURCE_CANCELLED"));
    let job=sharedJobs.get(key);
    if (!job) {
      if (sharedJobs.size>=100) return Promise.reject(failure("RESOURCE_BUSY"));
      const controller=new AbortController();
      job={controller,consumers:0};
      job.promise=Promise.resolve().then(()=>work(controller)).finally(()=>sharedJobs.delete(key));
      sharedJobs.set(key,job);
    }
    job.consumers++;
    return new Promise((resolve,reject)=> {
      let finished=false;
      const leave=()=> { if (finished) return; finished=true; signal?.removeEventListener("abort",cancel); if (--job.consumers===0) job.controller.abort(); };
      const cancel=()=> { leave(); reject(failure("RESOURCE_CANCELLED")); };
      signal?.addEventListener("abort",cancel,{once:true});
      job.promise.then(value=>{if(!finished){leave();resolve(value);}},error=>{if(!finished){leave();reject(error);}});
    });
  }
  function lru({ maxEntries = 200, maxBytes = 4 * 1024 * 1024,
      ttl = 30 * 60 * 1000, failureTtl = 30000 } = {}) {
    const entries = new Map();
    let size = 0;
    const estimate = value => new TextEncoder().encode(JSON.stringify(value) || "").byteLength;
    return Object.freeze({
      get(key) {
        const e = entries.get(key);
        if (!e) return undefined;
        if (e.until < Date.now()) { entries.delete(key); size -= e.bytes; return undefined; }
        entries.delete(key); entries.set(key, e); return e.value;
      },
      set(key, value, failed = false) {
        const bytes = estimate(value);
        if (bytes > maxBytes) return;
        const before = entries.get(key);
        if (before) size -= before.bytes;
        entries.delete(key);
        entries.set(key, { value, bytes,
          until: Date.now() + (failed ? failureTtl : ttl) });
        size += bytes;
        while (entries.size > maxEntries || size > maxBytes) {
          const oldest = entries.keys().next().value;
          size -= entries.get(oldest).bytes; entries.delete(oldest);
        }
      },
      delete(key) { const e = entries.get(key); if (e) size -= e.bytes; entries.delete(key); },
      get count() { return entries.size; },
      get bytes() { return size; },
    });
  }
  globalThis.HarmoNovaResourcePolicy = Object.freeze({
    Limits, shared, acquire, request, readBytes, readText, lru, failure,
    get activeCount() { return active; },
    get queuedCount() { return pending.length; },
  });
})();
