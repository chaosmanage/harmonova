// Per-tab HN queue: spacing is deliberately not a cross-tab rate guarantee.
(() => {
  'use strict';
  const failure=(kind,code)=>({status:kind==='mutation'?'indeterminate':'failure',message:code==='STALE_ACCOUNT'?'Account changed before this action was sent.':'Hacker News request could not be confirmed.',code});
  function create({execute,identity,validCredential=()=>true,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
    const pending=[];let running=false,lastAt=0,active=null,disposed=false;
    const rejectQueued=(job,error)=>{const index=pending.indexOf(job);if(index!==-1)pending.splice(index,1);job.cleanup();job.reject(error);};
    function add(path,options) {
      if(disposed)return Promise.reject(failure(options.operationKind,'QUEUE_DISPOSED'));
      if(pending.length>=50)return Promise.reject(failure(options.operationKind,'QUEUE_FULL'));
      if(options.signal?.aborted)return Promise.reject(failure(options.operationKind,'REQUEST_CANCELLED'));
      return new Promise((resolve,reject)=>{
        const job={path,options,resolve,reject};
        const cancel=()=>rejectQueued(job,failure(options.operationKind,'REQUEST_CANCELLED'));
        const timeout=setTimeout(()=>rejectQueued(job,failure(options.operationKind,'QUEUE_TIMEOUT')),30000);
        job.cleanup=()=>{clearTimeout(timeout);options.signal?.removeEventListener('abort',cancel);};
        options.signal?.addEventListener('abort',cancel,{once:true});pending.push(job);pump();
      });
    }
    async function pump() {
      if(running)return;running=true;
      try {
        while(pending.length) {
          const job=pending.shift();job.cleanup();
          const controller=new AbortController();active=controller;
          const relay=()=>controller.abort();job.options.signal?.addEventListener('abort',relay,{once:true});
          const timeout=setTimeout(()=>controller.abort(),Math.min(job.options.timeoutMs||15000,15000));
          const aborted=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(failure(job.options.operationKind,'REQUEST_TIMEOUT')),{once:true});});
          try {
            const run=async()=> {
              const wait=Math.max(0,750-(now()-lastAt));if(wait)await sleep(wait);
              if(controller.signal.aborted)throw failure(job.options.operationKind,'REQUEST_CANCELLED');
              if(job.options.operationKind==='mutation' && (identity()!==job.options.expectedIdentity || !validCredential(job.path,job.options)))throw failure('mutation','STALE_ACCOUNT');
              lastAt=now();return execute(job.path,{...job.options,signal:controller.signal});
            };
            job.resolve(await Promise.race([run(),aborted]));
          } catch(error){job.reject(error);}finally{clearTimeout(timeout);job.options.signal?.removeEventListener('abort',relay);if(active===controller)active=null;}
        }
      } finally {running=false;}
    }
    function dispose(){disposed=true;active?.abort();for(const job of [...pending])rejectQueued(job,failure(job.options.operationKind,'QUEUE_DISPOSED'));}
    return Object.freeze({add,dispose,get depth(){return pending.length;}});
  }
  globalThis.HarmoNovaHnQueue=Object.freeze({create});
})();
