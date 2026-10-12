// Isolated-world HarmoNovaWorkerNetwork module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
// All privileged external fetches fail closed on redirects.
function remoteFetchBlocked() {
  const error = new Error("REMOTE_FETCH_BLOCKED");
  error.code = "REMOTE_FETCH_BLOCKED";
  return error;
}
async function fetchPolicy(value, init = {}) {
  const target = HarmoNovaUrlPolicy.canonicalRemoteUrl(value);
  if (!target) throw remoteFetchBlocked();
  const { resourceKind = "metadata", ...settings } = init;
  delete settings.expectedTypes;
  if(!HarmoNovaProviderPolicy.allowed(value,resourceKind,settings.method || "GET"))throw remoteFetchBlocked();
  const budget=HarmoNovaResourcePolicy.Limits[resourceKind];
  if (!budget) throw remoteFetchBlocked();
  const types={storyLookup:["application/json"],richJson:["application/json"],atom:["application/atom+xml","application/xml","text/xml"],image:["image/png","image/jpeg","image/webp"],aiJson:["application/json"],aiStream:["text/event-stream"]};
  try {return await HarmoNovaResourcePolicy.request(fetch,target,settings,budget,types[resourceKind]);}
  catch(error) {if(error?.code?.startsWith("RESOURCE_") || ["RESPONSE_TOO_LARGE","UNSUPPORTED_CONTENT_TYPE"].includes(error?.code))throw error;throw remoteFetchBlocked();}
}

async function verifiedStoryArticleUrl(storyId, signal) {
  if (!Number.isSafeInteger(storyId) || storyId <= 0) throw remoteFetchBlocked();
  const response = await fetchPolicy(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`, { signal, resourceKind:"storyLookup" });
  if (!response.ok) throw remoteFetchBlocked();
  const record = JSON.parse(await readResponseTextLimited(response, 8192));
  if (record?.type !== "story" || record?.id !== storyId || typeof record.url !== "string")
    throw remoteFetchBlocked();
  const url = HarmoNovaUrlPolicy.canonicalRemoteUrl(record.url);
  if (!url) throw remoteFetchBlocked();
  return url;
}

const metadataCache = HarmoNovaResourcePolicy.lru();
const paletteCache = HarmoNovaResourcePolicy.lru({maxEntries:40,maxBytes:8*1024*1024,ttl:600000});

// Phase 7 part 3: rich link previews. Public provider APIs only — fixed,
// allowlisted API hosts derived from the article URL by strict regexes. Every
// field is validated and capped before use; the content script renders the
// result as text only (never HTML). SEC-22/24: fetchPolicy sends no cookies
// and re-validates every redirect hop.
const richPendingCache = metadataCache;

const capText = (value, max) => {
  if (typeof value !== "string") return null;
  const text = value.slice(0,max*4).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

const capCount = (value) => {
  // Strictly numeric: JSON null, strings, and booleans never become 0.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), 1e12);
};

const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

async function fetchRichJson(url, signal) {
  const response = await fetchPolicy(url, {
    resourceKind:"article", signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    resourceKind:"richJson", expectedTypes:["application/json"],
    headers: { Accept: "application/json" },
  });
  const type = response.headers ? response.headers.get("content-type") || "" : "";
  if (!response.ok || !type.includes("json")) { await response.body?.cancel(); throw new Error("not json"); }
  const raw = await readResponseTextLimited(response, 256 * 1024);
  return JSON.parse(raw);
}

function githubRich(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,100})\/([A-Za-z0-9._-]{1,100})(?:[\/?#]|$)/.exec(url);
  if (!m) return null;
  return {
    api: "https://api.github.com/repos/" + m[1] + "/" + m[2],
    parse: (data) => {
      if (!plainObject(data)) return null;
      const lines = [];
      const stars = capCount(data.stargazers_count);
      const forks = capCount(data.forks_count);
      const issues = capCount(data.open_issues_count);
      const stats = [
        stars !== null ? "★ " + stars.toLocaleString("en-US") : null,
        forks !== null ? forks.toLocaleString("en-US") + " forks" : null,
        issues !== null ? issues.toLocaleString("en-US") + " issues" : null,
      ].filter(Boolean);
      if (stats.length) lines.push(stats.join(" · "));
      const lang = capText(data.language, 60);
      if (lang) lines.push("Language: " + lang);
      const license = plainObject(data.license) ? capText(data.license.spdx_id, 40) : null;
      if (license && license !== "NOASSERTION") lines.push("License: " + license);
      return { provider: "github", title: capText(data.full_name, 200), lines, imageUrl:typeof data.owner?.avatar_url==="string" ? data.owner.avatar_url.slice(0,4096) : null };
    },
  };
}

function wikipediaRich(url) {
  const m = /^https:\/\/([a-z-]{2,8})\.wikipedia\.org\/wiki\/([^\/?#]+?)(?:[\/?#]|$)/.exec(url);
  if (!m || !HarmoNovaProviderPolicy.languages.includes(m[1])) return null;
  let title = "";
  try { title = dependencies.decodeURIComponent(m[2]); } catch { title = m[2]; }
  title = title.slice(0, 300);
  if (!title) return null;
  return {
    api: "https://" + m[1] + ".wikipedia.org/api/rest_v1/page/summary/" + dependencies.encodeURIComponent(title),
    parse: (data) => {
      if (!plainObject(data) || data.type === "disambiguation") return null;
      const lines = [];
      const extract = capText(data.extract, 600);
      if (extract) lines.push(extract);
      return { provider: "wikipedia", title: capText(data.title, 300), lines, imageUrl:typeof data.thumbnail?.source==="string" ? data.thumbnail.source.slice(0,4096) : null };
    },
  };
}

function arxivRich(url) {
  const m = /^https:\/\/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]{2,30}\/[0-9]{7})(?:v[0-9]+)?(?:[?#]|$)/.exec(url);
  if (!m) return null;
  return {
    api: "https://export.arxiv.org/api/query?id_list=" + dependencies.encodeURIComponent(m[1]) + "&max_results=1",
    parse: (raw) => {
      const entry = /<entry>[\s\S]*?<\/entry>/.exec(raw);
      if (!entry) return null;
      const pick = (tag, max) => {
        const value = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">").exec(entry[0]);
        return value ? capText(value[1].replace(/<[^>]+>/g, " "), max) : null;
      };
      const lines = [];
      const summary = pick("summary", 600);
      if (summary) lines.push(summary);
      const authors = [...entry[0].matchAll(/<name>([^<]{1,120})<\/name>/g)]
        .slice(0, 3)
        .map((match) => capText(match[1], 120))
        .filter(Boolean);
      if (authors.length) lines.push("By " + authors.join(", "));
      const published = /<published>(\d{4})-/.exec(entry[0]);
      if (published) lines.push("Published " + published[1]);
      return { provider: "arxiv", title: pick("title", 300), lines };
    },
  };
}

async function getRichPreview(url, signal) {
  const cached = richPendingCache.get("rich:"+url);
  if (cached !== undefined) return cached;
  const job = (async () => {
    const provider = githubRich(url) || wikipediaRich(url) || arxivRich(url);
    if (!provider) return null;
    try {
      if (provider.api.endsWith("/api/query") || provider.api.includes("export.arxiv.org")) {
        const response = await fetchPolicy(provider.api, {
          signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
          resourceKind:"atom",
          headers: { Accept: "application/atom+xml, application/xml, text/xml" },
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error("arxiv"); }
        const raw = await readResponseTextLimited(response, 512 * 1024);
        return provider.parse(raw);
      }
      return provider.parse(await fetchRichJson(provider.api,signal));
    } catch {
      return null;
    }
  })();
  const result = await job;
  richPendingCache.set("rich:"+url,result,!result);
  return result;
}















// SEC-42: images used by HarmoNova must be https and must never point at HN.


async function sanitizedImage(url,signal) {
  if(!url)return null;
  const canonical=HarmoNovaUrlPolicy.canonicalRemoteUrl(url);
  if(!canonical || !canonical.startsWith("https:"))return null;
  const cached=paletteCache.get(canonical);if(cached!==undefined)return cached;
  try {
    const response=await fetchPolicy(canonical,{signal,resourceKind:"image",expectedTypes:["image/png","image/jpeg","image/webp"]});
    if(!response.ok){await response.body?.cancel();throw new Error("IMAGE_UNAVAILABLE");}
    const mime=response.headers.get("content-type").split(";")[0].trim().toLowerCase();
    const bytes=await HarmoNovaResourcePolicy.readBytes(response,2*1024*1024);
    const value=await HarmoNovaImagePolicy.sanitize(bytes,mime,signal);
    paletteCache.set(canonical,value);return value;
  } catch {paletteCache.set(canonical,null,true);return null;}
}
async function imageTint(url,signal) {return (await sanitizedImage(url,signal))?.tint || null;}

const NETWORK_POLICY_KEY="harmonovaNetworkPolicyV1";
async function currentNetworkPolicy() {
  const value=(await dependencies.workerStorage.localGet({[NETWORK_POLICY_KEY]:null}))[NETWORK_POLICY_KEY];
  return {version:1,externalPreviewsEnabled:value?.version===1 && value.externalPreviewsEnabled===true};
}
async function saveNetworkPolicy(policy) {
  if(!policy||Object.keys(policy).some(k=>!["version","externalPreviewsEnabled"].includes(k))||policy.version!==1||typeof policy.externalPreviewsEnabled!=="boolean")return {ok:false};
  await dependencies.workerStorage.localSet({[NETWORK_POLICY_KEY]:policy});
  for(const controller of previewConsumers.values())controller.abort();
  previewConsumers.clear(); metadataCache.clear();paletteCache.clear();
  return {ok:true,policy};
}
async function getMetadataWork(url,wantRich=false,signal) {
  const empty={image:null,favicon:null,tint:null,rich:null,richState:wantRich?"unavailable":"notRequested",pageUrl:url,
    refused:HarmoNovaUrlPolicy.isHackerNewsUrl(url),unavailableReason:"Previews are available only for supported providers."};
  if(!(await currentNetworkPolicy()).externalPreviewsEnabled)return {...empty,unavailableReason:"External previews are disabled."};
  const canonical=HarmoNovaUrlPolicy.canonicalRemoteUrl(url);if(!canonical)return empty;
  const key="meta:"+wantRich+":"+canonical;
  const cached=metadataCache.get(key);if(cached)return cached;
  if(!wantRich)return empty;
  const facts=await getRichPreview(canonical,signal);
  const raster=await sanitizedImage(facts?.imageUrl,signal);
  if(signal?.aborted || !(await currentNetworkPolicy()).externalPreviewsEnabled)return empty;
  const value={...empty,image:raster?.src||null,tint:raster?.tint||null,
    imageDimensions:raster?{width:raster.width,height:raster.height}:null,
    rich:wantRich && facts ? {provider:facts.provider,title:facts.title,lines:facts.lines}:null,
    richState:wantRich?(facts?"available":"unavailable"):"notRequested"};
  metadataCache.set(key,value,!facts);return value;
}

const previewConsumers = new Map();
async function getMetadata(url, wantRich=false, signal) {
  const key=String(wantRich)+":"+url;
  return HarmoNovaResourcePolicy.shared(key, controller=>getMetadataWork(url,wantRich,controller.signal), signal);
}






async function readResponseTextLimited(response, maxBytes) {
  return HarmoNovaResourcePolicy.readText(response, maxBytes);
}

async function fetchArticleText(url,signal) {
  if(HarmoNovaUrlPolicy.isHackerNewsUrl(url))throw new Error("Hacker News pages can't be summarized");
  const canonical=HarmoNovaUrlPolicy.canonicalRemoteUrl(url);
  if(!canonical)throw new Error("Unsupported article URL");
  if(!(githubRich(canonical)||wikipediaRich(canonical)||arxivRich(canonical)))throw remoteFetchBlocked();
  const facts=await getRichPreview(canonical,signal);
  const text=[facts?.title,...facts?.lines||[]].filter(Boolean).join("\n").slice(0,dependencies.MAX_ARTICLE_CHARACTERS);
  if(!text)throw new Error("Provider text unavailable. Summarize the public Hacker News discussion instead.");
  return text;
}



    return Object.freeze({imageTint,sanitizedImage,fetchPolicy,
verifiedStoryArticleUrl,
currentNetworkPolicy,
saveNetworkPolicy,
get previewConsumers(){return previewConsumers;},
getMetadata,
readResponseTextLimited,
fetchArticleText});
  }
  globalThis.HarmoNovaWorkerNetwork=Object.freeze({create});
})();
