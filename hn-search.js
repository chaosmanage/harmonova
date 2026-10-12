// HarmoNova site-wide search client (isolated content-script world).
//
// Wraps the public Algolia Hacker News API (https://hn.algolia.com/api/v1):
//   /search          — relevance-sorted results
//   /search_by_date  — newest-first results
//
// Rules from docs/implementation-plan.md §Phase S:
//   - queries are trimmed and capped at 200 characters
//   - tags are validated against a strict allowlist; author_* names must match
//     ^[A-Za-z0-9_-]{1,32}$
//   - numericFilters accept integers only (created_at_i, points, num_comments)
//   - hitsPerPage is capped at 50; paging respects nbPages
//   - every hit is validated (objectID parses to a positive integer, numbers
//     are numbers, strings are strings) and malformed hits are dropped
//   - SEC-40: highlights are built by tokenizing literal <em>/</em> only;
//     everything else — including hostile markup such as <img onerror=…> or
//     <script> — stays plain text and is never parsed as HTML
(() => {
  "use strict";

  const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";
  const SEARCH_PATH = "/search";
  const SEARCH_BY_DATE_PATH = "/search_by_date";
  const MAX_QUERY = 200;
  const MAX_HITS_PER_PAGE = 50;
  const TAGS = new Set(["story", "comment", "ask_hn", "show_hn", "poll", "front_page"]);
  const AUTHOR_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;


  // ---------------------------------------------------------------------------
  // Query construction
  // ---------------------------------------------------------------------------

  // Builds the full request URL from UI options. Returns { url } or { error }.
  // options: { query, tags?, author?, since?, minPoints?, sort?, page?, hitsPerPage? }
  function buildSearchUrl(options) {
    const opts = options || {};
    const query = String(opts.query ?? "").trim();
    if (!query) return { error: "A search query is required" };
    const params = new URLSearchParams();
    params.set("query", query.slice(0, MAX_QUERY));

    const tags = [];
    for (const tag of Array.isArray(opts.tags) ? opts.tags : []) {
      if (typeof tag !== "string") return { error: "Invalid search tag" };
      if (tag.startsWith("author_")) {
        const name = tag.slice("author_".length);
        if (!AUTHOR_PATTERN.test(name)) return { error: "Invalid author name" };
        tags.push("author_" + name);
        continue;
      }
      if (!TAGS.has(tag)) return { error: "Invalid search tag: " + tag };
      tags.push(tag);
    }
    if (tags.length) params.set("tags", tags.join(","));

    const numericFilters = [];
    if (opts.since !== undefined && opts.since !== null) {
      if (typeof opts.since !== "number" || !Number.isInteger(opts.since) || opts.since < 0) {
        return { error: "Invalid date range" };
      }
      numericFilters.push("created_at_i>" + opts.since);
    }
    if (opts.minPoints !== undefined && opts.minPoints !== null && opts.minPoints !== "") {
      if (typeof opts.minPoints !== "number" || !Number.isInteger(opts.minPoints) || opts.minPoints < 0) {
        return { error: "Minimum points must be a whole number" };
      }
      numericFilters.push("points>=" + opts.minPoints);
    }
    if (numericFilters.length) params.set("numericFilters", numericFilters.join(","));

    const page = opts.page ?? 0;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0 || page > 1000) return { error: "Invalid page" };
    params.set("page", String(page));

    const hitsPerPage = opts.hitsPerPage ?? 30;
    if (typeof hitsPerPage !== "number" || !Number.isInteger(hitsPerPage) || hitsPerPage <= 0) {
      return { error: "Invalid hitsPerPage" };
    }
    params.set("hitsPerPage", String(Math.min(hitsPerPage, MAX_HITS_PER_PAGE)));

    const base = opts.sort === "newest" ? SEARCH_BY_DATE_PATH : SEARCH_PATH;
    return { url: ALGOLIA_BASE + base + "?" + params.toString() };
  }

  // ---------------------------------------------------------------------------
  // Hit validation (drop malformed, keep the rest)
  // ---------------------------------------------------------------------------

  const isMissing = (value) => value === undefined || value === null;

  function validateHit(hit) {
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) return null;
    const id = Number(hit.objectID);
    if (!Number.isInteger(id) || id <= 0) return null;
    const out = { id };

    // Algolia includes story_id on stories as well as comments.
    const tags = Array.isArray(hit._tags) ? hit._tags : [];
    const taggedComment = tags.includes("comment");
    const taggedStory = tags.some((tag) => ["story", "poll", "job"].includes(tag));
    if (taggedComment && taggedStory) return null;
    const hasCommentText = !isMissing(hit.comment_text);
    if (taggedStory && hasCommentText) return null;
    if (taggedComment && !hasCommentText) return null;
    const isComment = taggedComment || (!taggedStory && hasCommentText);
    if (isComment && !(Number.isInteger(hit.story_id) && hit.story_id > 0)) return null;
    out.kind = isComment ? "comment" : "story";

    for (const [key, type] of [
      ["title", "string"], ["url", "string"], ["author", "string"],
      ["points", "number"], ["num_comments", "number"], ["created_at_i", "number"],
      ["comment_text", "string"], ["story_title", "string"], ["story_id", "number"],
    ]) {
      const value = hit[key];
      if (isMissing(value)) continue; // absent fields become null
      if (type === "number" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "string") {
        return null; // wrong type: the whole hit is malformed
      }
      out[key === "num_comments" ? "numComments" : key] = value;
    }

    if (out.kind === "comment") {
      if (out.story_id === undefined) return null; // a comment must name its thread
      out.points = out.points ?? null;
      out.commentText = out.comment_text ?? "";
      delete out.comment_text;
    } else {
      out.title = out.title ?? null;
      out.url = out.url ?? null;
    }
    out.author = out.author ?? null;
    out.created_at_i = out.created_at_i ?? null;

    // SEC-40: highlight strings are kept verbatim and tokenized on literal
    // <em>/</em> only by buildHighlightSegments; they are never parsed as HTML.
    const commentHighlight = hit._highlightResult?.comment_text?.value;
    if (typeof commentHighlight === "string") out.highlight = commentHighlight;
    const titleHighlight = hit._highlightResult?.title?.value ?? hit._highlightResult?.story_title?.value;
    if (typeof titleHighlight === "string") out.titleHighlight = titleHighlight;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Search execution
  // ---------------------------------------------------------------------------

  async function runSearch(options, { signal } = {}) {
    const built = buildSearchUrl(options);
    if (built.error) return { hits: [], page: 0, nbPages: 1, error: built.error };
    let response;
    try {
      response = await HarmoNovaResourcePolicy.request(fetch,built.url,{signal,headers:{Accept:"application/json"}},HarmoNovaResourcePolicy.Limits.publicJson,["application/json"]);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return { hits: [], aborted: true };
      return { hits: [], page: 0, nbPages: 1, error: "Search request failed: " + String(error?.message || error) };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { hits: [], page: 0, nbPages: 1, error: "Search failed (HTTP " + response.status + ")" };
    }
    let payload;
    try {
      payload = HarmoNovaLifecycle.validateTree(JSON.parse(await HarmoNovaResourcePolicy.readText(response,4*1024*1024,signal)));
    } catch {
      return { hits: [], page: 0, nbPages: 1, error: "Search response was not valid JSON" };
    }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.hits)) {
      return { hits: [], page: 0, nbPages: 1, error: "Search response was malformed" };
    }
    const page = Number.isInteger(payload.page) && payload.page >= 0 ? payload.page : 0;
    const nbPages = Number.isInteger(payload.nbPages) && payload.nbPages >= page + 1 ? payload.nbPages : page + 1;
    const hits = [];
    if(payload.hits.length>1000)return {hits:[],page:0,nbPages:1,error:"Too many search results"};
    for (const hit of payload.hits) {
      const safe = validateHit(hit);
      if (safe) hits.push(safe);
    }
    return { hits, page, nbPages, query: built.url };
  }

  // ---------------------------------------------------------------------------
  // SEC-40 highlight tokenization: literal <em>/</em> only, everything else is
  // plain text. Hostile markup is never interpreted.
  // ---------------------------------------------------------------------------

  function buildHighlightSegments(value) {
    const text = typeof value === "string" ? value.slice(0,32768) : "";
    // Algolia highlights contain paragraph, link and emphasis markup.
    // Parse in an inert document and copy text nodes, never live HTML.
    {
      const doc = new DOMParser().parseFromString(text, "text/html");
      const segments = [];
      const add = (value, highlighted) => {
        if (!value) return;
        const last = segments[segments.length - 1];
        if (last && last.highlighted === highlighted) last.text += value;
        else segments.push({ text: value, highlighted });
      };
      let visited = 0;
      const walk = (node, marked = false, depth = 0) => {
        if (++visited > 5000 || depth > 64) return;
        if (node.nodeType === 3) return add(node.nodeValue || "", marked);
        if (node.nodeType !== 1) return;
        const tag = node.localName.toLowerCase();
        if (["script", "style", "template", "svg", "iframe"].includes(tag)) return;
        if (tag === "br" || tag === "p" && segments.length) add("\n", false);
        for (const child of node.childNodes) walk(child, marked || tag === "em", depth + 1);
        if (tag === "p") add("\n", false);
      };
      for (const child of doc.body.childNodes) walk(child);
      if (segments[0]?.text === "\n") segments.shift();
      if (segments[segments.length - 1]?.text === "\n") segments.pop();
      return segments;
    }
  }

  globalThis.HarmoNovaSearch = {
    ALGOLIA_BASE,
    buildSearchUrl,
    validateHit,
    runSearch,
    buildHighlightSegments,
  };
})();
