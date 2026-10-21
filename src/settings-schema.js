// Pure cosmetic schemas. Network authorization, AI policy and credentials
// have separate worker-owned records and never enter this schema.
(() => {
  'use strict';
  const defaults = Object.freeze({
    previewImages: "small",
    tintedCards: true,
    showFavicons: true,
    showPoints: true,
    showComments: true,
    showIndex: true,
    dimRead: true,
    commentStyle: "outlined",
    depthMode: "colors",
    roundedRails: true,
    continuousRails: false,
    storyTextSize: 17.5,
    commentTextSize: 15.5,
    commentZoom: 85,
    contentScale: 70,
    notifyUpdates: true,
    commentSort: "Default",
    cardClickComments: false,
    cardClickEnabled: true,
    alwaysOpenComments: false,
    headerTint: true,
    headerImage: true,
    // Phase 7 part 2 (0.12.1): comment parity
    markNewComments: true,
    hideDelayed: true,
    showAvatars: false,
    swapCommentActions: false,
    // Phase 7 (0.12.0): feed parity
    showDomain: true,
    compactPoints: false,
    hotnessColors: false,
    hideJobs: false,
    hideRead: false,
    scrolledStoryBehavior: "off",
    hiddenDomains: "",
    hiddenKeywords: "",
    feedOrder: [],
    feedHidden: ["pool", "active", "bestcomments", "launches", "whoishiring", "noobstories", "classic", "front"],
    frontDate: "",
    faviconProvider: "google",
    // Phase 7 part 3 (0.12.2): links & appearance
    richPreviews: true,
    uiTheme: "amoled",
    uiFont: "rounded",
  });
  const backupFields=Object.freeze(['uiTheme','uiFont','storyTextSize','commentTextSize','commentZoom','contentScale']);
  const blockedKeys=new Set(['__proto__','prototype','constructor']);
  const username=v=>typeof v==='string' && /^[A-Za-z0-9_-]{1,32}$/.test(v) && !blockedKeys.has(v);
  const ranges={storyTextSize:[14.5,20.5],commentTextSize:[12,18],commentZoom:[65,150],contentScale:[65,150]};
  const enums={scrolledStoryBehavior:['off','track','dim','future','immediate'],previewImages:['small','medium','off'],commentStyle:['outlined','raised','standard','flat'],depthMode:['theme_default','material_you','colors','author','monochrome','none'],commentSort:['Default','Newest first','Oldest first','Reply count'],faviconProvider:['google','duckduckgo','direct'],uiTheme:['amoled','charcoal','navy'],uiFont:['rounded','system','serif']};
  const feeds=['top','new','best','ask','show','jobs','pool','active','bestcomments','launches','whoishiring','noobstories','classic','front'];
  function valid(key,value) {
    if(!Object.hasOwn(defaults,key)||blockedKeys.has(key))return false;
    if(enums[key])return enums[key].includes(value);
    if(ranges[key])return Number.isFinite(value)&&value>=ranges[key][0]&&value<=ranges[key][1];
    if(typeof defaults[key]==='boolean')return typeof value==='boolean';
    if(key==='feedOrder'||key==='feedHidden')return Array.isArray(value)&&value.length<=feeds.length&&value.every(v=>feeds.includes(v));
    if(key==='frontDate')return typeof value==='string' && (value==='' || /^\d{4}-\d{2}-\d{2}$/.test(value));
    if(typeof defaults[key]==='string')return typeof value==='string'&&new TextEncoder().encode(value).byteLength<=2000;
    return false;
  }
  function normalize(value,complete=true) {
    const out=complete?{...defaults}:{};
    if(!value || typeof value!=='object' || Array.isArray(value))return out;
    for(const key of Object.keys(defaults)) {
      const v=key==='uiFont'&&value[key]==='harmonic'?'system':value[key];
      if(Object.hasOwn(value,key)&&valid(key,v))out[key]=Array.isArray(v)?[...new Set(v)]:v;
    }
    return out;
  }
  function patch(value) {
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>Object.keys(defaults).length)return null;
    if(Object.entries(value).some(([key,v])=>!valid(key,v)))return null;
    return normalize(value,false);
  }
  const backup=value=>Object.fromEntries(backupFields.map(k=>[k,normalize(value)[k]]));
  globalThis.HarmoNovaSettingsSchema=Object.freeze({defaults,normalize,patch,backup,backupFields,username});
})();
