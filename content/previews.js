// Isolated-world HarmoNovaContentPreviews module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  let nextPreviewRequest=0;
  const getPreview = (story, signal) => new Promise((resolve) => {
    if (dependencies.INCOGNITO || !story?.url) return resolve({ image: null, tint: null, favicon: null });
    const cached = model.previewById.get(story.id);
    if (cached?.failedUntil && cached.failedUntil > Date.now()) return resolve(cached);
    if (cached?.failedUntil) model.previewById.delete(story.id);
    const requestId="preview"+ ++nextPreviewRequest;
    const cancel=()=> {dependencies.stateUI.runtimeMessage({type:"HARMONOVA_PREVIEW_CANCEL",requestId});resolve({image:null,tint:null,favicon:null});};
    if(signal?.aborted) return cancel();
    signal?.addEventListener("abort",cancel,{once:true});
    const timer = setTimeout(cancel,7000);
    const wantRich = model.settings.richPreviews !== false;
    chrome.runtime.sendMessage({ type: "HARMONOVA_PREVIEW", url: story.url, rich: wantRich, requestId }, (response) => {
      clearTimeout(timer); signal?.removeEventListener("abort",cancel);
      const value = response?.ok ? response : { image: null, tint: null, favicon: null };
      // Without rich facts the response stays uncached while the toggle is
      // on, so enabling the feature refetches instead of waiting out the TTL.
      if (value.rich || !wantRich) model.previewById.set(story.id, value);
      while(model.previewById.size>200)model.previewById.delete(model.previewById.keys().next().value);
      resolve(value);
    });
  });

  // Preview requests are lazy for global-search results, with at most three
  // concurrent metadata fetches. The same queue serves feed cards too.
  const previewJobs = [];
  let previewRunning = 0;
  let previewObserver = null;
  const previewCardScopes=new Map();
  const previewCleanupObserver=new MutationObserver(()=> {
    for(const [card,controller] of previewCardScopes) if(!card.isConnected) {
      controller.abort();previewCardScopes.delete(card);previewObserver?.unobserve(card);delete card._loadHarmoNovaPreview;
    }
    for(let i=previewJobs.length-1;i>=0;i--) if(!previewJobs[i].card.isConnected)previewJobs.splice(i,1);
  });
  const pumpPreviews = () => {
    while (previewRunning < 3 && previewJobs.length) {
      const task = previewJobs.shift();
      if (!task.card.isConnected || task.controller.signal.aborted) continue;
      previewRunning++;
      getPreview(task.story,task.controller.signal).then((result) => {
        if (task.card.isConnected) task.show(result);
      }).finally(() => { previewCardScopes.delete(task.card); previewRunning--; pumpPreviews(); });
    }
  };
  const requestCardPreview = (card, story, show) => {
    if(previewCardScopes.size>=200){const [old,controller]=previewCardScopes.entries().next().value;controller.abort();previewCardScopes.delete(old);previewObserver?.unobserve(old);delete old._loadHarmoNovaPreview;}
    const controller=new AbortController();previewCardScopes.set(card,controller);
    const add=()=> {
      if(controller.signal.aborted||previewJobs.length>=100)return;
      previewJobs.push({card,story,show,controller});Promise.resolve().then(pumpPreviews);
    };
    if(model.search.active&&typeof IntersectionObserver!=="undefined") {
      if(!previewObserver)previewObserver=new IntersectionObserver(entries=>{
        for(const entry of entries)if(entry.isIntersecting){previewObserver.unobserve(entry.target);entry.target._loadHarmoNovaPreview?.();delete entry.target._loadHarmoNovaPreview;}
      },{root:dependencies.storyList,rootMargin:"300px"});
      card._loadHarmoNovaPreview=add;previewObserver.observe(card);
    }else add();
  };

  const faviconUrl = () => null; // Unsupported remote favicons use a local placeholder.


    return Object.freeze({get getPreview(){return getPreview;},
get previewObserver(){return previewObserver;},set previewObserver(value){previewObserver=value;},
get previewCardScopes(){return previewCardScopes;},
get previewCleanupObserver(){return previewCleanupObserver;},
get requestCardPreview(){return requestCardPreview;},
get faviconUrl(){return faviconUrl;}});
  }
  globalThis.HarmoNovaContentPreviews=Object.freeze({create});
})();
