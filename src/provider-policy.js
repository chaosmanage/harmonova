// Privileged routes: fixed API methods for OpenRouter/providers, plus bounded
// public-web GETs for story previews and article extraction. DNS/TLS are trust
// assumptions; URL validation does not bind a hostname to a public IP.
(() => {
  'use strict';
  const languages=Object.freeze(['en','de','fr','es','ja','zh']);
  const original=value=> {
    if(typeof value!=='string'||value.length>4096)return null;
    try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname===u.hostname.replace(/\.$/,'') ? u : null;}catch{return null;}
  };
  function allowed(value,kind,method='GET') {
    if(['metadata','article','image'].includes(kind))return method==='GET'
      && HarmoNovaUrlPolicy.isAllowedRemoteUrl(value)
      && (kind!=='image'||value.startsWith('https://'));
    const u=original(value);if(!u)return false;
    const p=u.pathname;
    if(kind==='storyLookup')return method==='GET' && u.origin==='https://hacker-news.firebaseio.com' && /^\/v0\/item\/[1-9][0-9]*\.json$/.test(p)&&!u.search;
    if(['aiJson','aiStream'].includes(kind))return method==='POST'&&u.origin==='https://openrouter.ai'&&p==='/api/v1/chat/completions'&&!u.search;
    if(kind==='richJson') {
      if(method!=='GET')return false;
      if(u.origin==='https://api.github.com')return /^\/repos\/[A-Za-z0-9-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(p)&&!u.search&&!p.split('/').some(v=>v==='.'||v==='..');
      return languages.some(lang=>u.origin==='https://'+lang+'.wikipedia.org') && /^\/api\/rest_v1\/page\/summary\/[^/]{1,1800}$/.test(p)&&!u.search;
    }
    if(kind==='atom')return method==='GET'&&u.origin==='https://export.arxiv.org'&&p==='/api/query'&&[...u.searchParams.keys()].sort().join(',')==='id_list,max_results'&&u.searchParams.get('max_results')==='1'&&/^([0-9]{4}\.[0-9]{4,5}|[a-z-]{2,30}\/[0-9]{7})$/.test(u.searchParams.get('id_list')||'');
    if(kind==='image') {
      if(method!=='GET')return false;
      if(u.origin==='https://avatars.githubusercontent.com')return /^\/u\/[1-9][0-9]*$/.test(p)&&[...u.searchParams.keys()].every(k=>['v','s'].includes(k))&&[...u.searchParams.values()].every(v=>/^\d{1,4}$/.test(v));
      return u.origin==='https://upload.wikimedia.org'&&/^\/wikipedia\/(commons|en|de|fr|es|ja|zh)\/(thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/[^?]{1,1800}\.(png|jpg|jpeg|webp)$/i.test(p)&&!u.search;
    }
    return false;
  }
  globalThis.HarmoNovaProviderPolicy=Object.freeze({allowed,languages});
})();
