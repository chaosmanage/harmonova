// Trusted worker-only GitHub release checks. No page-supplied URLs or versions.
(() => {
  'use strict';
  const ENDPOINT='https://api.github.com/repos/chaosmanage/harmonova/releases/latest';
  const RELEASE_URL='https://github.com/chaosmanage/harmonova/releases/latest';
  const KEY='harmonovaReleaseStateV1';
  const MAX_RESPONSE_BYTES=128*1024; // Release notes and asset manifests can be sizeable.
  const version=value=>typeof value==='string' && /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)
    ? value.replace(/^v/,'').split('.').map(Number) : null;
  const newer=(candidate,current)=>{
    const a=version(candidate),b=version(current);
    if(!a||!b)return false;
    for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}
    return false;
  };
  function create({localGet,localSet,fetchRelease,installedVersion,onAvailable=()=>{},now=()=>Date.now()}) {
    const read=async()=>{
      const raw=(await localGet({[KEY]:null}))[KEY];
      return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    };
    const available=record=>newer(record.tag,installedVersion)
      && record.ignoredTag!==record.tag
      ? {ok:true,available:true,tag:record.tag,url:RELEASE_URL}
      : {ok:true,available:false};
    async function status(enabled=true) {
      return enabled ? available(await read()) : {ok:true,available:false};
    }
    async function ignore(tag) {
      const record=await read();
      if(!version(tag)||record.tag!==tag)return {ok:false};
      await localSet({[KEY]:{...record,ignoredTag:tag}});
      return {ok:true};
    }
    async function check(enabled=true,manual=false) {
      // Explicit checks are user-initiated, independent of the automatic
      // notification preference and any previously dismissed release.
      if(!enabled&&!manual)return {ok:true,available:false};
      const failure=()=>manual?{ok:false,available:false}:{ok:true,available:false};
      try {
        const response=await fetchRelease(ENDPOINT,{
          headers:{Accept:'application/vnd.github+json'},credentials:'omit',redirect:'error',
          cache:'no-store',signal:AbortSignal.timeout(7000)
        });
        if(!response.ok||!response.headers.get('content-type')?.includes('json')){
          await response.body?.cancel();return failure();
        }
        if(Number(response.headers.get('content-length')||0)>MAX_RESPONSE_BYTES){
          await response.body?.cancel();return failure();
        }
        // Limit an untrusted network response even without Content-Length.
        const reader=response.body?.getReader();if(!reader)return failure();
        let size=0;const chunks=[];
        try {
          while(true) {
            const {done,value}=await reader.read();if(done)break;
            size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();return failure();}
            chunks.push(value);
          }
        }finally{reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;
        for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        const release=JSON.parse(new TextDecoder().decode(bytes));
        const tag=release?.tag_name;
        if(release?.draft||release?.prerelease||!version(tag))return failure();
        const previous=await read();
        const record={tag,checkedAt:now(),ignoredTag:previous.ignoredTag||''};
        await localSet({[KEY]:record});
        const result=manual
          ? newer(tag,installedVersion) ? {ok:true,available:true,tag,url:RELEASE_URL} : {ok:true,available:false}
          : available(record);
        if(!manual&&result.available&&tag!==previous.tag)await onAvailable(result);
        return result;
      }catch{return failure();}
    }
    return Object.freeze({status,ignore,check,checkNow:()=>check(true,true)});
  }
  globalThis.HarmoNovaReleaseUpdates=Object.freeze({create,newer});
})();
