// HarmoNova HN session and account-action client (isolated content-script world).
//
// Implements the Hacker News account-action protocol with these constraints:
//   SEC-04 logout via fetch, never navigation
//   SEC-10/11 tokens live only in this closure; nothing outside can read them
//   SEC-12 every cached token is tagged with the username it was fetched under
//   SEC-13 tokens and ids are validated before use
//   SEC-14 request URLs and bodies are always built here with URLSearchParams
//   SEC-20 all authenticated requests are same-origin relative fetches
//   SEC-21 every response must originate from https://news.ycombinator.com
//   SEC-25 HN HTML fetches run through one serial queue with >=750 ms spacing
//          and exponential back-off when HN rate-limits
//   SEC-30..37 mutation rules (trusted events are enforced by callers; this
//          module enforces one in-flight mutation per item, idempotent single
//          retry for votes/favorites/hides/flags, never auto-retrying posts)
//   SEC-35 every action verifies the acting username before mutating
//
// The public surface is globalThis.HarmoNovaHN; it exposes actions and safe
// state only — never tokens.
(() => {
  "use strict";

  const HN_ORIGIN = "https://news.ycombinator.com";
  const MIN_SPACING_MS = 750;
  let lastHnRequestAt=0;
  const MAX_QUEUE_ATTEMPTS = 4;

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  let sessionGeneration=0;
  let currentSession = null; // { username, karma } | null
  const sessionListeners = new Set();

  function notifySession() {
    const snapshot = currentSession ? { ...currentSession } : null;
    for (const listener of [...sessionListeners]) {
      try { listener(snapshot); } catch {}
    }
  }

  function setSession(username, karma) {
    const next = username ? { username, karma: Number.isFinite(karma) ? karma : null } : null;
    const changed = (next?.username || null) !== (currentSession?.username || null);
    if (changed) {
      sessionGeneration++;
      // SEC-12: username changed (or logged out) — drop every token and handle.
      tokenCache.clear();
      formHandles.clear();
      inFlight.clear();
      rememberedVoteStates.clear();
      storyCommentForms.clear();
    itemKnownComments.clear();
      documentVotes.clear();
    }
    currentSession = next;
    if (changed) notifySession();
  }

  // ---------------------------------------------------------------------------
  // Serial HN fetch queue (SEC-25)
  // ---------------------------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const mutations=new Set(["/vote","/fave","/hide","/flag","/logout"]);
  function validRequestPath(path) {
    if(typeof path!=="string" || path.length>4096 || !path.startsWith("/") || path.startsWith("//") || /[\\\r\n\x00]/.test(path))return false;
    try {const u=new URL(path,HN_ORIGIN);return u.origin===HN_ORIGIN&&!u.hash&&!u.username&&!u.password&&/^\/[a-z-]*$/.test(u.pathname);}catch{return false;}
  }
  const identity=()=> (currentSession?.username || "")+":"+sessionGeneration;
  const requestQueue=HarmoNovaHnQueue.create({execute:performHnRequest,identity,
    validCredential:(path,options)=> {
      if(options.handle && formHandles.get(options.handle)!==options.handleEntry)return false;
      const u=new URL(path,HN_ORIGIN);
      if(mutations.has(u.pathname) && u.pathname!=="/logout") {
        const token=getToken(u.pathname.slice(1),Number(u.searchParams.get("id")));
        if(!token || token.auth!==u.searchParams.get("auth"))return false;
      }
      return true;
    },
  });
  function enqueue(path,options={}) {
    if(!validRequestPath(path))return Promise.reject({status:"failure",message:"Invalid Hacker News path"});
    const kind=(options.method && options.method!=="GET" || options.mutation || mutations.has(path.split("?")[0]))?"mutation":"read";
    if(options.operationKind && options.operationKind!==kind)return Promise.reject({status:"failure",message:"Invalid operation kind"});
    return requestQueue.add(path,{...options,operationKind:kind,expectedUsername:currentSession?.username||null,expectedIdentity:identity()});
  }

  function parseDocument(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  // Removes user-contributed regions so page-level error strings cannot be
  // spoofed by comment text (upstream HarmoNova does the same).
  function pageSignalText(doc) {
    const clone = doc.body ? doc.body.cloneNode(true) : doc.createElement("body");
    clone.querySelectorAll(".commtext, .toptext, .c00, .comment, .titleline, .hnuser").forEach((node) => node.remove());
    return (clone.textContent || "") + "\n" + (doc.title || "");
  }

  function classifyDoc(doc) {
    // Blank or non-HN payloads (empty bodies, binary responses) must never be
    // treated as success or as a session change.
    const bodyText = (doc.body?.textContent || "").trim();
    const hasHnMarkers = Boolean(doc.querySelector("span.pagetop, table#hnmain, .titleline, .comment-tree, form, a[id]"));
    if (!hasHnMarkers && !bodyText) return "blank";
    const text = pageSignalText(doc);
    if (/Validation required/i.test(text) || doc.querySelector(".g-recaptcha")) return "validationRequired";
    if (/Unknown or expired link\./i.test(text)) return "expiredLink";
    if (/Bad login\./i.test(text)) return "badLogin";
    if (/You're posting too fast|Please slow down/i.test(text)) return "tooFast";
    if (/Sorry, we're not able to serve your requests this quickly\./i.test(text)) return "rateLimited";
    // HN's login page hosts a password field (its forms carry no action attribute).
    if (doc.querySelector('input[type="password"][name="pw"], form[action="login"]')) return "loginPage";
    return "ok";
  }



  async function performHnRequest(path, options) {
    const method = options.method || "GET";
    if(!validRequestPath(path))throw {status:"failure",message:"Invalid Hacker News path"};
    const isMutation = options.operationKind === "mutation";
    let attempt = 0;
    const maxAttempts = options.singleAttempt ? 1 : MAX_QUEUE_ATTEMPTS;
    while (true) {
      if(options.signal?.aborted)throw {status:isMutation?"indeterminate":"failure",message:"Request cancelled"};
      const wait = Math.max(0, MIN_SPACING_MS - (Date.now() - lastHnRequestAt));
      if (wait) await sleep(wait);
      lastHnRequestAt = Date.now();
      let response;
      const controller = {signal:options.signal};
      const timeout = null;
      try {
        response = await fetch(HN_ORIGIN + path, {
          method,
          signal: controller.signal,
          ...(options.cache ? { cache: options.cache } : {}),
          credentials: "same-origin", // SEC-20
          redirect: "follow",
          headers: { Accept: "text/html,application/xhtml+xml" },
          // Pass URLSearchParams as the request body, NOT its serialized string.
          // Fetch sets application/x-www-form-urlencoded;charset=UTF-8 for
          // URLSearchParams. A string is sent as text/plain, so HN does not
          // parse parent/hmac/text and may silently discard the POST.
          ...(options.body ? { body: new URLSearchParams(options.body) } : {}),
        });
      } catch (error) {
        clearTimeout(timeout);
        if (!isMutation && !options.signal?.aborted && attempt < maxAttempts - 1) { attempt++; await sleep(1000 * attempt); continue; }
        throw { status: isMutation?"indeterminate":"failure", message: "Network request to Hacker News failed", detail: "" };
      }
      // SEC-21: the response must come from the HN origin.
      let responseUrl = "";
      try { responseUrl = new URL(response.url).href; } catch {}
      if (!responseUrl || new URL(responseUrl).origin !== HN_ORIGIN) {
        clearTimeout(timeout);
        throw { status: "indeterminate", message: "Hacker News response came from an unexpected origin", detail: "mutation outcome unknown" };
      }
      let html;
      try { html = await HarmoNovaResourcePolicy.readText(response,4*1024*1024,options.signal); } finally { clearTimeout(timeout); }
      const doc = parseDocument(html);
      const classification = classifyDoc(doc);
      if (classification === "rateLimited" || response.status === 503) {
        if (!isMutation && !options.signal?.aborted && attempt < maxAttempts - 1) {
          attempt++;
          await sleep(1000 * Math.pow(2, attempt)); // 2s, 4s, 8s
          continue;
        }
        return { doc, url: responseUrl, status: response.status, classification, response };
      }
      return { doc, url: responseUrl, status: response.status, classification, response };
    }
  }

  // ---------------------------------------------------------------------------
  // Token cache (SEC-10/11/12/13)
  // ---------------------------------------------------------------------------

  const tokenCache = new Map(); // key -> { auth, goto, username }
  const formHandles = new Map(); // handle -> { kind, action, fields, username, ... }
  const inFlight = new Map(); // SEC-32: one in-flight mutation per item
  const rememberedVoteStates = new Map(); // safe item states, never tokens
  const storyCommentForms = new Map();
  const itemKnownComments = new Map(); // private top-level HN forms
  const documentVotes = new Map(); // id -> "up" | "down" (as seen on the harvested feed document)
  let nextHandleId = 1;
  let handleCounterSalt = 0;

  const HEX40 = /^[0-9a-f]{40}$/; // SEC-13
  const FNID = /^[A-Za-z0-9_-]{1,64}$/;

  function cacheToken(kind, id, auth, goto) {
    if (!auth || !HEX40.test(auth)) return false;
    if (!currentSession?.username) return false;
    tokenCache.set(kind + ":" + id, { auth, goto: goto || "", username: currentSession.username, fetchedAt: Date.now() });
    return true;
  }

  // SEC-35: a cached token may only be used while the acting username matches.
  function getToken(kind, id) {
    const entry = tokenCache.get(kind + ":" + id);
    if (!entry) return null;
    if (!currentSession || entry.username !== currentSession.username) {
      tokenCache.clear();
      formHandles.clear();
      return null;
    }
    return entry;
  }

  function clearCaches() {
    tokenCache.clear();
    formHandles.clear();
    documentVotes.clear();
    rememberedVoteStates.clear();
    storyCommentForms.clear();
    itemKnownComments.clear();
  }

  function accountChangedOutcome(message) {
    sessionGeneration++;clearCaches();
    return { status: "accountChanged", message: message || "You're now signed in as a different account.", detail: "" };
  }

  // ---------------------------------------------------------------------------
  // Parsers
  // ---------------------------------------------------------------------------

  function parseTopBar(doc) {
    // Logged in: <span class="pagetop"><a id="me" href="user?id=X">X</a> (123) | <a id="logout" href="logout?auth=…&goto=news">logout</a></span>
    // Logged out: <span class="pagetop"><a href="login?goto=news">login</a></span>
    const pagetops = [...doc.querySelectorAll("span.pagetop")];
    const right = pagetops[pagetops.length - 1];
    if (!right) return { username: null, karma: null, definitive: false };
    const logoutLink = right.querySelector('a#logout, a[href^="logout?"]');
    // Some HN action/form pages have a navigation bar but no account links.
    // Absence of a logout link is NOT evidence of sign-out: only an explicit
    // login link (or a verified login form) proves the server is logged out.
    if (!logoutLink) {
      const loginLink = right.querySelector('a[href^="login?"], a[href="login"], a[href^="/login?"]');
      return { username: null, karma: null, definitive: Boolean(loginLink) };
    }
    const meLink = right.querySelector('a#me, a[href^="user?id="]');
    const username = (meLink?.textContent || "").replace(/\(\d+\)/g, "").trim();
    if (!username) return { username: null, karma: null, definitive: false };
    const karmaText = doc.querySelector("#karma")?.textContent
      || right.textContent.match(/\((\d+)\)/)?.[1]
      || "";
    const karma = Number.parseInt(karmaText, 10);
    return { username, karma: Number.isFinite(karma) ? karma : null, logoutHref: logoutLink.getAttribute("href") || "", definitive: true };
  }

  function parseLogoutToken(href) {
    if (!href) return null;
    const params = new URLSearchParams(href.replace(/^logout\??/, ""));
    const auth = params.get("auth") || "";
    return HEX40.test(auth) ? { auth, goto: params.get("goto") || "news" } : null;
  }

  // HN's voted markup has an unv_ID span and an un_ID text link; the
  // arrow is a sibling, never a descendant of the unvote anchor.
  function parseVoteLinks(doc) {
    const result = new Map();
    for (const a of doc.querySelectorAll("a[id]")) {
      const match = a.id.match(/^(up|down|un)_(\d+)$/);
      if (!match) continue;
      const [, kind, rawId] = match;
      const id = Number(rawId);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const href = a.getAttribute("href") || "";
      const params = new URLSearchParams(href.replace(/^\/?vote\??/, ""));
      const entry = result.get(id) || { canUp: false, canDown: false, voted: false, votedDirection: null };
      const visible = !a.classList.contains("nosee") && !a.closest(".nosee");
      if (kind === "up") entry.canUp = visible;
      if (kind === "down") entry.canDown = visible;
      if (kind === "un") {
        const unv = doc.getElementById("unv_" + id);
        const label = (a.textContent || "").trim().toLowerCase();
        // Old synthetic fixtures incorrectly put an arrow in an un_ anchor.
        // Keep the fixture fallback only for those malformed documents.
        const legacy = a.querySelector(".votearrow")?.getAttribute("title");
        entry.voted = visible && (Boolean(unv?.textContent?.trim()) || !unv || unv.contains(a));
        if (entry.voted) entry.votedDirection = label.includes("undown") || legacy === "downvote" ? "down" : "up";
      }
      entry[kind + "HrefParams"] = {
        how: params.get("how") || (kind === "un" ? "un" : kind),
        auth: params.get("auth") || null,
        goto: params.get("goto") || "",
      };
      result.set(id, entry);
    }
    return result;
  }

  // fave / hide / flag links. Works for the story subtext and comment navs.
  function parseItemActions(doc) {
    const actions = new Map(); // id -> { favorite, hide, flag }
    const consume = (id, kind, link) => {
      const href = link.getAttribute("href") || "";
      const params = new URLSearchParams(href.replace(/^(fave|hide|flag)\??/, ""));
      const targetId = Number(params.get("id"));
      if (!Number.isInteger(targetId) || targetId <= 0) return;
      const entry = actions.get(targetId) || {};
      entry[kind] = {
        auth: params.get("auth") || null,
        un: params.get("un") === "t",
        goto: params.get("goto") || "",
      };
      actions.set(targetId, entry);
    };
    for (const link of doc.querySelectorAll('a[href^="fave?"]')) consume(0, "favorite", link);
    for (const link of doc.querySelectorAll('a[href^="hide?"]')) consume(0, "hide", link);
    for (const link of doc.querySelectorAll('a[href^="flag?"]')) consume(0, "flag", link);
    for (const link of doc.querySelectorAll('a[href^="reply?"]')) {
      const id = Number(new URLSearchParams((link.getAttribute("href") || "").slice(6)).get("id"));
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const entry = actions.get(id) || {};
      entry.replyAvailable = true;
      actions.set(id, entry);
    }
    return actions;
  }

  function parseFormByPredicate(doc, predicate) {
    for (const form of doc.querySelectorAll("form")) {
      if (!predicate(form)) continue;
      const fields = {};
      for (const input of form.querySelectorAll("input, textarea, select")) {
        const name = input.getAttribute("name");
        if (!name) continue;
        const type = (input.getAttribute("type") || "").toLowerCase();
        if (type === "checkbox") {
          if (input.checked) fields[name] = input.value || "on";
          continue;
        }
        if (type === "radio") {
          if (input.checked) fields[name] = input.value;
          continue;
        }
        fields[name] = input.value || "";
      }
      return { action: form.getAttribute("action") || "", method: (form.getAttribute("method") || "GET").toUpperCase(), fields };
    }
    return null;
  }

  function parseCommentForm(doc) {
    return parseFormByPredicate(doc, (form) => form.getAttribute("action") === "comment");
  }

  function parseList(doc) {
    const ids = [];
    for (const row of doc.querySelectorAll("tr.athing[id]")) {
      const id = Number(row.id);
      if (Number.isInteger(id) && id > 0) ids.push(id);
    }
    const moreHref = doc.querySelector("a.morelink")?.getAttribute("href") || null;
    if (!moreHref) return { ids, morePath: null };
    // Do NOT resolve with new URL(): DOMParser docs inherit the host page's
    // baseURI, which is not the fetched list path. Return the href as-is and
    // let fetchListPage resolve it against the requested path.
    if (moreHref.startsWith("/") || moreHref.startsWith("?")) return { ids, morePath: moreHref };
    return { ids, morePath: "/" + moreHref };
  }

  // Phase 6: fetch a Hacker News list page (own or public) through the queue
  // and return its item ids plus the next-page path. SEC-05: list pages only —
  // profile HTML is never fetched; user data comes from the public Firebase
  // API. The first path segment must be on a fixed allowlist (no /user).
  async function fetchListPage(path,{signal}={}) {
    const safePath = validateListPath(path);
    if (!safePath) {
      return { status: "failure", message: "That Hacker News list is not available in HarmoNova." };
    }
    const page = await enqueue(safePath,{signal});
    if (page.classification === "loginPage") {
      setSession(null, null);
      return { status: "loginRequired", message: "Sign in to see this list" };
    }
    if (page.classification === "rateLimited") {
      return { status: "rateLimited", message: "Hacker News is rate-limiting requests. Try again shortly." };
    }
    if (page.classification === "blank") {
      return { status: "indeterminate", message: "Hacker News returned an unreadable list page." };
    }
    if (page.classification !== "ok") {
      return { status: "failure", message: "Hacker News did not return a readable list page.", detail: page.classification };
    }
    refreshSessionFromDoc(page.doc);
    const parsed = parseList(page.doc);
    let morePath = parsed.morePath;
    // DOMParser docs have no reliable baseURI of their own, so relative
    // morelinks ("?p=2") arrive as-is. Resolve them against the requested
    // list path, merging query params so "id=u" survives "p=2".
    if (morePath && morePath.startsWith("?")) {
      const question = safePath.indexOf("?");
      const base = question === -1 ? safePath : safePath.slice(0, question);
      const merged = new URLSearchParams(question === -1 ? "" : safePath.slice(question + 1));
      for (const [key, value] of new URLSearchParams(morePath.slice(1))) merged.set(key, value);
      morePath = base + "?" + merged.toString();
    }
    const votes = {};
    if (currentSession) for (const [id, entry] of parseVoteLinks(page.doc)) {
      if (entry.voted) votes[id] = entry.votedDirection;
    }
    return { status: "ok", ids: parsed.ids, morePath, votes };
  }

  function parseFnidForm(doc) {
    return parseFormByPredicate(doc, (form) => form.querySelector('input[name="fnid"]'));
  }

  // ---------------------------------------------------------------------------
  // Safe state builders (never include tokens)
  // ---------------------------------------------------------------------------

  function safeVoteState(entry) {
    if (!entry) return { voted: false, votedDirection: null, canUp: false, canDown: false };
    return { voted: Boolean(entry.voted), votedDirection: entry.votedDirection || null, canUp: Boolean(entry.canUp), canDown: Boolean(entry.canDown) };
  }

  // ---------------------------------------------------------------------------
  // Item state (Phase 2)
  // ---------------------------------------------------------------------------

  async function fetchItemDoc(itemId,{signal}={}) {
    if (!Number.isInteger(itemId) || itemId <= 0) throw { status: "failure", message: "Invalid item id" };
    return enqueue("/item?id=" + itemId,{signal});
  }

  function harvest(doc) {
    // Read the live HN page before HarmoNova mounts. No tokens are retained
    // from the initial document except the logout token, which stays here.
    const top = parseTopBar(doc);
    if (top.username) {
      setSession(top.username, top.karma); // clears caches when the account changed
      const logout = parseLogoutToken(top.logoutHref);
      if (logout) tokenCache.set("logout:", { auth: logout.auth, goto: logout.goto, username: top.username, fetchedAt: Date.now() });
      else tokenCache.delete("logout:");
    }
    // Feed documents also carry vote links for every visible story. Cache
    // their tokens in memory (SEC-35) and record which stories are already
    // voted so the UI can light up voted states without extra fetches.
    documentVotes.clear();
    for (const [id, entry] of parseVoteLinks(doc)) {
      if (entry.voted) documentVotes.set(id, entry.votedDirection === "down" ? "down" : "up");
      if (!currentSession?.username) continue;
      if (entry.upHrefParams?.auth) cacheToken("vote", id, entry.upHrefParams.auth, entry.upHrefParams.goto);
      if (entry.downHrefParams?.auth) cacheToken("vote", id, entry.downHrefParams.auth, entry.downHrefParams.goto);
      if (entry.unHrefParams?.auth) cacheToken("vote", id, entry.unHrefParams.auth, entry.unHrefParams.goto);
    }
    return currentSession ? { ...currentSession } : null;
  }

  async function ensureItemState(itemId,{signal}={}) {
    const page = await fetchItemDoc(itemId,{signal});
    if(signal?.aborted)throw {status:"failure",message:"Request cancelled"};
    if (page.classification === "loginPage") {
      setSession(null, null);
      return { status: "loginRequired", session: null };
    }
    if (page.classification === "blank") {
      return { status: "indeterminate", message: "Hacker News returned an unreadable item page.", detail: "blank" };
    }
    if (page.classification === "rateLimited") {
      return { status: "rateLimited", message: "Hacker News is rate-limiting requests. Try again shortly.", detail: "" };
    }
    if (page.classification !== "ok") {
      return { status: "failure", message: "Hacker News did not return a readable item page.", detail: page.classification };
    }
    refreshSessionFromDoc(page.doc);
    return buildItemState(page.doc, itemId);
  }

  function refreshSessionFromDoc(doc) {
    const top = parseTopBar(doc);
    // A document without a definitive top bar (fragments, blank payloads) must
    // never change the session.
    if (!top.definitive) return;
    if (top.username) {
      setSession(top.username, top.karma ?? null); // clears caches when the account changed
      const logout = parseLogoutToken(top.logoutHref);
      if (logout) tokenCache.set("logout:", { auth: logout.auth, goto: logout.goto, username: top.username, fetchedAt: Date.now() });
      else tokenCache.delete("logout:");
    } else {
      setSession(null, null);
    }
  }

  function buildItemState(doc, itemId) {
    const votes = parseVoteLinks(doc);
    const actions = parseItemActions(doc);
    // Cache tokens under the acting username.
    if (currentSession?.username) {
      for (const [id, entry] of votes) {
        for (const kind of ["up", "down", "un"]) {
          const params = entry[kind + "HrefParams"];
          if (params?.auth) cacheToken("vote", id, params.auth, params.goto);
        }
      }
      for (const [id, entry] of actions) {
        if (entry.favorite?.auth) cacheToken("fave", id, entry.favorite.auth, entry.favorite.goto);
        if (entry.hide?.auth) cacheToken("hide", id, entry.hide.auth, entry.hide.goto);
        if (entry.flag?.auth) cacheToken("flag", id, entry.flag.auth, entry.flag.goto);
      }
    }
    const storyEntry = votes.get(itemId);
    const storyActions = actions.get(itemId) || {};
    const commentForm = parseCommentForm(doc);
    if (commentForm && currentSession) storyCommentForms.set(itemId, { form: commentForm, username: currentSession.username });
    itemKnownComments.set(itemId, new Set([...doc.querySelectorAll("tr.comtr[id]")].map((row) => Number(row.id))));
    const replyIds = new Set([...doc.querySelectorAll('a[href^="reply?"]')].map((link) => {
      const params = new URLSearchParams((link.getAttribute("href") || "").slice("reply?".length));
      return Number(params.get("id"));
    }));
    const comments = {};
    const commentIds = new Set([...votes.keys(), ...replyIds, ...actions.keys()]);
    for (const id of commentIds) {
      if (id === itemId || !Number.isSafeInteger(id) || id <= 0) continue;
      const entry = votes.get(id);
      comments[id] = { ...safeVoteState(entry), flagAvailable: Boolean(actions.get(id)?.flag), replyAvailable: replyIds.has(id) };
      if (entry) rememberedVoteStates.set(id, safeVoteState(entry));
    }
    rememberedVoteStates.set(itemId, safeVoteState(storyEntry));
    return {
      status: "ok",
      itemId,
      session: currentSession ? { ...currentSession } : null,
      story: {
        ...safeVoteState(storyEntry),
        favorited: Boolean(storyActions.favorite?.un),
        favoriteAvailable: Boolean(storyActions.favorite?.auth) || Boolean(storyActions.favorite),
        hideAvailable: Boolean(storyActions.hide),
        hidden: Boolean(storyActions.hide?.un),
        flagAvailable: Boolean(storyActions.flag),
        flagged: Boolean(storyActions.flag?.un),
      },
      comments,
      commentFormAvailable: Boolean(commentForm),
      morePath: parseList(doc).morePath,
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  function beginInFlight(key) {
    if (inFlight.has(key)) return false; // SEC-32
    inFlight.set(key, true);
    return true;
  }

  function endInFlight(key) {
    inFlight.delete(key);
  }

  function requireTrusted() {
    return null; // Trusted-event enforcement lives in the UI layer (SEC-30).
  }

  // ---------------------------------------------------------------------------
  // Shared token-mutation flow (SEC-32/33/35)
  //   - one in-flight action per item
  //   - tokens older than TOKEN_MAX_AGE are re-verified against a fresh page
  //     before use (the acting account may have changed since caching)
  //   - when HN reports the token expired, refetch state and retry exactly once
  // ---------------------------------------------------------------------------
  const TOKEN_MAX_AGE = 60_000;
  const VOTE_TOKEN_MAX_AGE = 30 * 60_000;

  async function refreshToken(kind, itemId, username, labels) {
    const state = await ensureItemState(itemId);
    if (state.status === "loginRequired") return { failure: { status: "loginRequired", message: labels.loginRequired } };
    if (state.status !== "ok") return { failure: { status: "failure", message: labels.unavailable, detail: state.status } };
    if (!currentSession || currentSession.username !== username) return { accountChanged: true };
    return { token: getToken(kind, itemId) };
  }

  function classificationOutcome(page, labels) {
    if (page.classification === "badLogin") return { status: "loginRequired", message: labels.loginRequired };
    if (page.classification === "rateLimited") return { status: "rateLimited", message: "Hacker News is rate-limiting requests. Open it on Hacker News and try again shortly.", detail: "" };
    if (page.classification === "validationRequired") return { status: "validationRequired", message: "Hacker News asks for verification. Open it on Hacker News to continue.", detail: "" };
    if (page.classification !== "ok") return { status: "indeterminate", message: "Hacker News did not confirm the action. Check on Hacker News before retrying.", detail: "" };
    return null;
  }

  async function withMutationToken(kind, itemId, labels, send, onSuccess) {
    const session = currentSession;
    if (!session?.username) return { status: "loginRequired", message: labels.loginRequired };
    const key = kind + ":" + itemId;
    if (!beginInFlight(key)) return { status: "failure", message: "An action for this item is already in progress" };
    try {
      let token = getToken(kind, itemId);
      if (token && !(Date.now() - token.fetchedAt <= (kind === "vote" ? VOTE_TOKEN_MAX_AGE : TOKEN_MAX_AGE))) token = null; // stale: re-verify below (SEC-35)
      if (!token) {
        const refreshed = await refreshToken(kind, itemId, session.username, labels);
        if (refreshed.accountChanged) return accountChangedOutcome();
        if (refreshed.failure) return refreshed.failure;
        if (!refreshed.token) return { status: "failure", message: labels.unavailable };
        token = refreshed.token;
      }
      let page = await send(token);
      if (page.classification === "expiredLink") {
        if (!currentSession || token.username !== currentSession.username) return accountChangedOutcome();
        const refreshed = await refreshToken(kind, itemId, session.username, labels);
        if (refreshed.accountChanged) return accountChangedOutcome();
        if (refreshed.failure) return refreshed.failure;
        if (!refreshed.token) return { status: "failure", message: labels.unavailable };
        page = await send(refreshed.token); // SEC-33: exactly one retry, freshly fetched token
        if (page.classification === "expiredLink") {
          return { status: "failure", message: "Hacker News rejected this twice with an expired token. Refresh the page and try again.", detail: "" };
        }
      }
      const classified = classificationOutcome(page, labels);
      if (classified && !(kind === "vote" && page.classification === "blank" && page.status >= 200 && page.status < 300)) return classified;
      if (kind === "vote" && (page.status < 200 || page.status >= 300)) return { status: "indeterminate", message: "Hacker News returned an unexpected vote response." };
      return await onSuccess(page, token);
    } finally {
      endInFlight(key);
    }
  }

  async function vote(itemId, how) {
    requireTrusted();
    if (!["up", "down", "un"].includes(how)) return { status: "failure", message: "Unknown vote direction" };
    const labels = {
      loginRequired: "Sign in to vote",
      unavailable: how === "un" ? "Nothing to unvote" : "Voting is not available for this item",
    };
    const prior = rememberedVoteStates.get(itemId) || {};
    let outcome;
    try {
      outcome = await withMutationToken(
        "vote", itemId, labels,
        (token) => {
          const params = new URLSearchParams({
            id: String(itemId), how, auth: token.auth,
            goto: token.goto || ("item?id=" + itemId), js: "t",
          }); // SEC-14: no extra parameters
          return enqueue("/vote?" + params.toString());
        },
        async (_page, token) => {
          if (!currentSession || token.username !== currentSession.username) return accountChangedOutcome();
          // HN's hn.js discards the js=t response. A 2xx blank body IS success.
          const before = rememberedVoteStates.get(itemId) || prior;
          const state = {
            ...before, voted: how !== "un", votedDirection: how === "un" ? null : how,
            canUp: how === "un" ? true : Boolean(before.canUp),
            canDown: Boolean(before.canDown),
          };
          rememberedVoteStates.set(itemId, state);
          return { status: "success", message: "", state };
        }
      );
    } catch {
      outcome = { status: "indeterminate", message: "Could not confirm the vote." };
    }
    if (outcome.status !== "indeterminate") return outcome;
    // One read-only confirmation after an uncertain mutation; never resend it.
    try {
      const refreshed = await ensureItemState(itemId);
      if (refreshed.status === "ok") {
        const state = itemId === refreshed.itemId ? refreshed.story : refreshed.comments?.[itemId];
        if (state && state.voted === (how !== "un") && (how === "un" || state.votedDirection === how)) {
          return { status: "success", message: "", state };
        }
      }
    } catch {}
    return outcome;
  }

  async function tokenAction(kind, itemId, { un = false, confirmRefetch = false, labels = {} } = {}) {
    const fullLabels = {
      loginRequired: labels.loginRequired || "Sign in first",
      unavailable: labels.unavailable || "This action is not available for this item",
    };
    return withMutationToken(
      kind,
      itemId,
      fullLabels,
      (token) => {
        const params = new URLSearchParams({ id: String(itemId), auth: token.auth }); // SEC-14
        if (un) params.set("un", "t");
        if (token.goto) params.set("goto", token.goto);
        return enqueue("/" + kind + "?" + params.toString());
      },
      async (page, token) => {
        refreshSessionFromDoc(page.doc);
        if (!currentSession || token.username !== currentSession.username) return accountChangedOutcome();
        if (confirmRefetch) {
          const state = await ensureItemState(itemId);
          return { status: "success", message: "", state: state.story || null };
        }
        // Cache refreshed tokens from the returned page (goto target).
        const refreshedActions = parseItemActions(page.doc);
        if (currentSession?.username) {
          const entry = refreshedActions.get(itemId);
          if (entry?.[kind]?.auth) cacheToken(kind, itemId, entry[kind].auth, entry[kind].goto);
        }
        return { status: "success", message: "" };
      }
    );
  }

  const setFavorite = (itemId, favorite) => tokenAction("fave", itemId, {
    un: !favorite,
    confirmRefetch: true,
    labels: { loginRequired: "Sign in to favorite", unavailable: "Favoriting is not available for this item" },
  });
  const setHidden = (itemId, hidden) => tokenAction("hide", itemId, {
    un: !hidden,
    confirmRefetch: true,
    labels: { loginRequired: "Sign in to hide", unavailable: "Hiding is not available for this item" },
  });
  const setFlagged = (itemId, flagged) => tokenAction("flag", itemId, {
    un: !flagged,
    labels: { loginRequired: "Sign in to flag", unavailable: "Flagging is not available for this item" },
  });

  let logoutPending = false;
  async function logout() {
    if (logoutPending) return { status: "pending", message: "Sign-out already in progress" };
    logoutPending = true;
    let username = currentSession?.username || null;
    const unknown = () => ({ status: "indeterminate", message: "Could not confirm sign-out", username });
    const readSession = async () => {
      const page = await enqueue("/news", { cache: "no-store", singleAttempt: true, timeoutMs: 10000 });
      if (page.classification === "validationRequired" || page.classification === "loginPage")
        return { status: page.classification === "loginPage" ? "loginRequired" : "validationRequired", message: "Could not confirm sign-out", username };
      if (page.classification !== "ok" || page.status !== 200) return unknown();
      const top = parseTopBar(page.doc);
      if (!top.definitive) return unknown();
      refreshSessionFromDoc(page.doc);
      return top.username ? { status: "signedIn", username: top.username, message: "Still signed in to Hacker News" }
        : { status: "success", username, message: "Signed out" };
    };
    try {
      let token = getToken("logout", "");
      if (!token) {
        const initial = await readSession();
        if (initial.status !== "signedIn") return initial;
        if (username && initial.username !== username) return accountChangedOutcome();
        username = initial.username;
        token = getToken("logout", "");
        if (!token) return unknown();
      }
      // GET is a mutation here: never replay an ambiguous logout.
      try {
        await enqueue("/logout?" + new URLSearchParams({ auth: token.auth, goto: "news" }),
          { mutation: true, singleAttempt: true, timeoutMs: 10000 });
      } catch { /* Only a fresh read-back can establish the outcome. */ }
      return await readSession();
    } catch {
      return unknown();
    } finally {
      logoutPending = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Comment / reply / edit / delete / submit forms (SEC-34: never auto-retry)
  // ---------------------------------------------------------------------------

  function gotoForItem(itemId) {
    return Number.isInteger(itemId) && itemId > 0 ? "item?id=" + itemId : "news";
  }

  function makeCommentHandle(form, parentId, storyId) {
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, {
      kind: "comment", action: form.action, fields: { ...form.fields },
      username: currentSession.username, parentId, storyId,
      knownIds: new Set(itemKnownComments.get(storyId) || []), createdAt: Date.now(),
    });
    return { status: "ok", handle };
  }

  async function openReplyForm(parentId, options = {}) {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to reply" };
    const storyId = options.storyId || parentId;
    if (storyId === parentId) {
      const cached = storyCommentForms.get(storyId);
      if (cached?.username === currentSession.username) return makeCommentHandle(cached.form, parentId, storyId);
      // Top-level replies use the form already present on /item, not /reply.
      const state = await ensureItemState(storyId,{signal:options.signal});
      if (state.status === "ok") {
        const form = storyCommentForms.get(storyId);
        if (form?.username === currentSession.username) return makeCommentHandle(form.form, parentId, storyId);
      }
    }
    const goto = options.goto || gotoForItem(storyId);
    const page = await enqueue("/reply?" + new URLSearchParams({ id: String(parentId), goto }).toString(),{signal:options.signal});
    if (page.classification === "loginPage") { setSession(null, null); return { status: "loginRequired", message: "Sign in to reply" }; }
    if (page.classification === "validationRequired") return { status: "validationRequired", message: "Hacker News asks for verification before this reply. Open the reply on Hacker News to continue.", detail: "draft kept" };
    if (page.classification !== "ok") return { status: "failure", message: "Could not open a reply form on Hacker News.", detail: page.classification };
    const form = parseCommentForm(page.doc);
    if (!form || !HEX40.test(form.fields.hmac || "")) {
      return { status: "failure", message: "Hacker News reply form could not be read. Open it on Hacker News instead.", detail: "" };
    }
    refreshSessionFromDoc(page.doc);
    if (!currentSession) return { status: "loginRequired", message: "Sign in to reply" };
    return makeCommentHandle(form, parentId, storyId);
  }

  function getHandle(handle, kind) {
    const entry = formHandles.get(handle);
    if (!entry || entry.kind !== kind) return null;
    if (!currentSession || entry.username !== currentSession.username) {
      clearCaches();
      return "changed";
    }
    return entry;
  }

  function formOutcome(page, matches, labels) {
    if (page.classification === "badLogin" || page.classification === "loginPage") return { status: "loginRequired", message: "Your Hacker News session ended. Sign in again.", detail: "draft kept" };
    if (page.classification === "tooFast") return { status: "failure", message: "Hacker News says you're posting too fast. Your draft is kept.", detail: "draft kept" };
    if (page.classification === "validationRequired") return { status: "validationRequired", message: "Hacker News asks for verification. Open the form on Hacker News to continue.", detail: "draft kept" };
    if (page.classification === "rateLimited") return { status: "rateLimited", message: "Hacker News is rate-limiting requests. Check whether the post went through before retrying.", detail: "draft kept" };
    if (page.classification === "ok" && page.status >= 200 && page.status < 300 && matches(page)) return { status: "success", message: "" };
    return { status: "indeterminate", message: labels.indeterminate || "Hacker News did not confirm the action. Check on Hacker News before retrying.", detail: "draft kept" };
  }

  function redirectedToItem(page) {
    try { return new URL(page.url).pathname === "/item"; } catch { return false; }
  }

  function findOwnComment(doc, username, knownIds, text, id = null) {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    for (const row of doc.querySelectorAll("tr.comtr[id]")) {
      const rowId = Number(row.id);
      if (!Number.isSafeInteger(rowId) || rowId <= 0) continue;
      if (id !== null ? rowId !== id : knownIds?.has(rowId)) continue;
      if (row.querySelector(".comhead .hnuser, .hnuser")?.textContent?.trim() !== username) continue;
      const body = row.querySelector(".commtext");
      // HN strips Markdown-like emphasis markers and collapses whitespace.
      // Require substantial visible text overlap, not byte-for-byte source HTML.
      const rendered = normalize(body?.textContent);
      const submitted = normalize(text).replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/(^|\n)\s*>\s*/g, "$1").replace(/\s+/g, " ").trim();
      if (!body || !submitted || !rendered.includes(submitted.slice(0, Math.min(80, submitted.length)))) continue;
      // The returned HTML is sanitized before it can leave this closure.
      return { id: rowId, html: sanitizeCommentHtml(body) };
    }
    return null;
  }

  function sanitizeCommentHtml(source) {
    const doc = document.implementation.createHTMLDocument("");
    const target = doc.createElement("div");
    const allowed = new Set(["p", "br", "a", "i", "em", "b", "strong", "pre", "code", "blockquote", "ul", "ol", "li"]);
    const copy = (node, into) => {
      if (node.nodeType === 3) { into.appendChild(doc.createTextNode(node.nodeValue || "")); return; }
      if (node.nodeType !== 1) return;
      const tag = node.localName.toLowerCase();
      if (["script", "style", "iframe", "object", "svg", "form"].includes(tag)) return;
      const next = allowed.has(tag) ? doc.createElement(tag) : into;
      if (tag === "a" && next !== into) {
        try {
          const url = new URL(node.getAttribute("href") || "", "https://news.ycombinator.com");
          if (["https:", "http:"].includes(url.protocol)) { next.setAttribute("href", url.href); next.setAttribute("rel", "noopener noreferrer"); }
        } catch {}
      }
      for (const child of node.childNodes) copy(child, next);
      if (next !== into) into.appendChild(next);
    };
    for (const child of source.childNodes) copy(child, target);
    return target.innerHTML; // inert, sanitized document; never live innerHTML
  }

  async function postComment(handle, text) {
    const entry = getHandle(handle, "comment");
    if (entry === null) return { status: "failure", message: "This reply form is no longer valid. Refresh and try again." };
    if (entry === "changed") return accountChangedOutcome();
    const body = { parent: entry.fields.parent, goto: entry.fields.goto, hmac: entry.fields.hmac, text };
    const page = await enqueue("/" + (entry.action || "comment"), { method: "POST", body, handle,handleEntry:entry }); // SEC-34: never retry a POST
    // A redirect can contain a cached item page. Read back the result safely
    // instead of re-POSTing the comment or claiming it failed immediately.
    let verified = page;
    let found = page.classification === "ok" && redirectedToItem(page)
      ? findOwnComment(page.doc, entry.username, entry.knownIds, text) : null;
    if (page.classification === "ok" && !found) {
      for (let attempt = 0; attempt < 3 && !found; attempt++) {
        try {
          const refreshed = await enqueue("/item?id=" + entry.storyId);
          if (refreshed.classification !== "ok" || !redirectedToItem(refreshed)) break;
          verified = refreshed;
          found = findOwnComment(refreshed.doc, entry.username, entry.knownIds, text);
        } catch { break; }
      }
    }
    const outcome = formOutcome(page, () => redirectedToItem(verified) && Boolean(found), {
      indeterminate: "Hacker News has not shown your comment after a read-only verification check. Your draft is kept; check the thread before posting again.",
    });
    if (outcome.status === "success") {
      formHandles.delete(handle);
      outcome.newComment = { id: found.id, parentId: entry.parentId, html: found.html };
    }
    return outcome;
  }

  // HN has served both direct xedit/hmac and one-time r/fnid edit forms.
  // One-time fnids bind the edited item on the server, so the hidden id may be
  // absent; if an id is present, it must still match the requested comment.
  function parseEditForm(doc, commentId) {
    return parseFormByPredicate(doc, (element) => {
      const action = (element.getAttribute("action") || "").replace(/^\//, "");
      if (!["xedit", "comment", "r"].includes(action) ||
          (element.getAttribute("method") || "GET").toUpperCase() !== "POST" ||
          !element.querySelector('textarea[name="text"]')) return false;
      if (action === "r") {
        const operation = element.querySelector('input[name="fnop"]')?.value || "";
        if (!/edit/i.test(operation)) return false;
      }
      return true;
    });
  }

  async function openEditForm(commentId, options = {}) {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to edit" };
    if (!Number.isSafeInteger(commentId) || commentId <= 0) return { status: "failure", message: "Invalid comment ID" };
    const username = currentSession.username;
    const page = await enqueue("/edit?" + new URLSearchParams({ id: String(commentId), ...(options.goto ? { goto: options.goto } : {}) }).toString());
    if (page.classification === "loginPage") {
      return { status: "loginRequired", message: "Hacker News asks you to sign in before editing. Open the comment on Hacker News.", detail: "" };
    }
    if (page.classification !== "ok") return { status: "failure", message: "Hacker News did not offer an edit form for this comment.", detail: page.classification };
    const form = parseEditForm(page.doc, commentId);
    const hasHmac = Boolean(form && HEX40.test(form.fields.hmac || ""));
    const hasFnid = Boolean(form && FNID.test(form.fields.fnid || "") && form.fields.fnop);
    if (!form || (!hasHmac && !hasFnid) ||
        (form.fields.id !== undefined && Number(form.fields.id) !== commentId)) {
      return { status: "failure", message: "Hacker News did not provide a usable edit form. The editing window may have expired. Open the comment on Hacker News to check.", detail: "editFormUnavailable" };
    }
    refreshSessionFromDoc(page.doc);
    if (currentSession?.username !== username) return accountChangedOutcome();
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "edit", action: form.action || "xedit", fields: { ...form.fields }, username, commentId, storyId: options.storyId || commentId, createdAt: Date.now() });
    return { status: "ok", handle, currentText: form.fields.text || "" };
  }

  async function saveEdit(handle, text) {
    const entry = getHandle(handle, "edit");
    if (entry === null) return { status: "failure", message: "This edit form is no longer valid. Refresh and try again." };
    if (entry === "changed") return accountChangedOutcome();
    const body = { ...entry.fields, text };
    const page = await enqueue("/" + (entry.action || "xedit"), { method: "POST", body, handle,handleEntry:entry });
    let verified = page;
    let edited = page.classification === "ok" && redirectedToItem(page)
      ? findOwnComment(page.doc, entry.username, null, text, entry.commentId) : null;
    // HN can return the edit handler itself, or a stale redirected item page.
    // Verify with GETs only; never resend the edit POST.
    if (page.classification === "ok" && !edited) {
      for (let attempt = 0; attempt < 3 && !edited; attempt++) {
        try {
          // A comment may be absent from the story's first page because HN
          // paginates large threads; check its permalink before the thread.
          const path = attempt === 0 ? "/item?id=" + entry.commentId : "/item?id=" + entry.storyId;
          const fresh = await enqueue(path);
          if (fresh.classification !== "ok" || !redirectedToItem(fresh)) break;
          verified = fresh;
          edited = findOwnComment(fresh.doc, entry.username, null, text, entry.commentId);
        } catch { break; }
      }
    }
    const outcome = formOutcome(page, () => redirectedToItem(verified) && Boolean(edited), { indeterminate: "Hacker News has not shown the updated comment. Your draft is kept; check the comment before editing again." });
    if (outcome.status === "success") formHandles.delete(handle);
    return outcome;
  }

  function parseDeleteForm(doc) {
    return parseFormByPredicate(doc, (element) => {
      const action = (element.getAttribute("action") || "").replace(/^\//, "");
      if (!["xdelete", "r"].includes(action) ||
          (element.getAttribute("method") || "GET").toUpperCase() !== "POST") return false;
      if (action === "r" && !/delete/i.test(element.querySelector('input[name="fnop"]')?.value || "")) return false;
      return true;
    });
  }

  async function openDeleteForm(commentId, options = {}) {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to delete" };
    if (!Number.isSafeInteger(commentId) || commentId <= 0) return { status: "failure", message: "Invalid comment ID" };
    const username = currentSession.username;
    const goto = options.goto || gotoForItem(options.storyId);
    const page = await enqueue("/delete-confirm?" + new URLSearchParams({ id: String(commentId), ...(goto ? { goto } : {}) }).toString());
    if (page.classification === "loginPage") {
      return { status: "loginRequired", message: "Hacker News requires you to sign in before deleting. Open the comment on Hacker News." };
    }
    if (page.classification !== "ok") return { status: "failure", message: "Hacker News did not offer a delete form for this comment.", detail: page.classification };
    const form = parseDeleteForm(page.doc);
    const hasHmac = Boolean(form && HEX40.test(form.fields.hmac || "") && Number(form.fields.id) === commentId);
    const hasFnid = Boolean(form && FNID.test(form.fields.fnid || "") &&
      /delete/i.test(form.fields.fnop || "") &&
      (form.fields.id === undefined || Number(form.fields.id) === commentId));
    // The modern one-time fnid already identifies the comment on HN's server.
    // Old-style hmac requests still require an explicit matching item ID.
    if (!form || (!hasHmac && !hasFnid) ||
        (form.fields.id !== undefined && Number(form.fields.id) !== commentId)) {
      return { status: "failure", message: "Hacker News did not provide a matching delete confirmation form. Open the comment on Hacker News to check whether deletion is still available.", detail: "deleteFormUnavailable" };
    }
    refreshSessionFromDoc(page.doc);
    if (currentSession?.username !== username) return accountChangedOutcome();
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "delete", action: form.action.replace(/^\//, ""), fields: { ...form.fields }, username, commentId, storyId: options.storyId || commentId, createdAt: Date.now() });
    return { status: "ok", handle };
  }

  function isDeletedComment(doc, commentId) {
    const row = doc.querySelector('tr.comtr[id="' + commentId + '"]');
    if (!row) return false; // Absence can be pagination, never proof of deletion.
    const body = row.querySelector(".commtext");
    const text = (body?.textContent || "").replace(/\s+/g, " ").trim();
    const wholeRow = (row.textContent || "").replace(/\s+/g, " ").trim();
    return /^\[deleted\]$/i.test(text) ||
      (!row.querySelector(".hnuser") && /\[deleted\]/i.test(wholeRow));
  }

  async function deleteComment(handle) {
    const entry = getHandle(handle, "delete");
    if (entry === null) return { status: "failure", message: "This delete form is no longer valid. Refresh and try again." };
    if (entry === "changed") return accountChangedOutcome();
    const page = await enqueue("/" + entry.action, { method: "POST", body: { ...entry.fields },handle,handleEntry:entry });
    let verified = page;
    let deleted = page.classification === "ok" && redirectedToItem(page)
      ? isDeletedComment(page.doc, entry.commentId) : false;
    // HN may redirect through /r, serve a stale thread, or paginate comments.
    // Only independent GET reads can confirm deletion; never retry the POST.
    if (page.classification === "ok" && !deleted) {
      for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
        try {
          const path = attempt === 0 ? "/item?id=" + entry.commentId : "/item?id=" + entry.storyId;
          const fresh = await enqueue(path);
          if (fresh.classification !== "ok" || !redirectedToItem(fresh)) break;
          verified = fresh;
          deleted = isDeletedComment(fresh.doc, entry.commentId);
        } catch { break; }
      }
    }
    const outcome = formOutcome(page, () => redirectedToItem(verified) && deleted, {
      indeterminate: "Hacker News has not confirmed the deletion. The action was sent only once; check the original comment before trying again.",
    });
    if (outcome.status === "success") formHandles.delete(handle);
    return outcome;
  }

  async function openSubmitForm() {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to submit" };
    const username = currentSession.username;
    // Check the acting account and snapshot recent submissions *before*
    // requesting HN's short-lived fnid, rather than opening more HN pages
    // between obtaining the form closure and posting it.
    const verification = await enqueue("/news");
    if (verification.classification !== "ok" || !parseTopBar(verification.doc).definitive) {
      return { status: "failure", message: "Could not verify your Hacker News session. Nothing was posted; retry shortly." };
    }
    refreshSessionFromDoc(verification.doc);
    if (!currentSession) return { status: "loginRequired", message: "Hacker News requires you to sign in again before submitting." };
    if (currentSession.username !== username) return accountChangedOutcome();
    let previousIds = null;
    try {
      const list = await enqueue("/submitted?id=" + encodeURIComponent(username));
      if (list.classification === "ok" && list.status === 200) previousIds = new Set(parseList(list.doc).ids);
    } catch {} // A missing baseline cannot be treated as proof of publication.

    // This must be the final GET before the user submits; its fnid is bound
    // to HN's one-use form handler and may expire when delayed.
    const page = await enqueue("/submit");
    if (page.classification === "loginPage") {
      const check = await enqueue("/news");
      if (check.classification === "ok") refreshSessionFromDoc(check.doc);
      if (currentSession?.username === username && parseTopBar(check.doc).username === username) {
        return { status: "failure", message: "Hacker News is requesting sign-in for submissions despite your active session. Open its own submit page to complete verification." };
      }
      return currentSession?.username && currentSession.username !== username
        ? accountChangedOutcome()
        : { status: "loginRequired", message: "Hacker News requires you to sign in again before submitting." };
    }
    if (page.classification !== "ok") return { status: "failure", message: "Could not open the Hacker News submit form.", detail: page.classification };
    const form = parseFnidForm(page.doc);
    if (!form || !FNID.test(form.fields.fnid || "") ||
        (form.action !== "r" && form.action !== "/r") || form.method !== "POST") {
      return { status: "failure", message: "Hacker News did not return a usable submit form. Open the original HN submit page instead.", detail: "submitFormUnavailable" };
    }
    refreshSessionFromDoc(page.doc);
    if (!currentSession) return { status: "loginRequired", message: "Hacker News requires you to sign in again before submitting." };
    if (currentSession.username !== username) return accountChangedOutcome();
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "submit", action: "r", fields: { ...form.fields }, username, previousIds, createdAt: Date.now() });
    return { status: "ok", handle };
  }

  async function submitStory(handle, { title, url: urlText, text }) {
    const entry = getHandle(handle, "submit");
    if (entry === null) return { status: "failure", message: "This submit form is no longer valid. Try again." };
    if (entry === "changed") return accountChangedOutcome();
    const cleanTitle = String(title || "").trim().slice(0, 80);
    if (!cleanTitle) return { status: "failure", message: "A title is required" };
    const body = { ...entry.fields, title: cleanTitle };
    if (urlText) body.url = String(urlText).trim();
    if (text) body.text = String(text);
    const page = await enqueue("/" + (entry.action || "r"), { method: "POST", body, handle,handleEntry:entry });
    let path = "";
    try { path = new URL(page.url).pathname; } catch {}
    if (path === "/item") {
      const id = Number(new URL(page.url).searchParams.get("id"));
      return { status: "alreadySubmitted", message: "Hacker News already has this story.", detail: String(Number.isInteger(id) ? id : ""), existingId: Number.isInteger(id) ? id : null };
    }
    let confirmedId = null;
    if (page.classification === "ok" && page.status >= 200 && page.status < 300 && entry.previousIds) {
      // POST /r may return a 200 or a nonstandard redirect; check the user's
      // submitted list for a matching *new* ID. This is GET-only confirmation.
      const expectedTitle = cleanTitle.replace(/\s+/g, " ").trim();
      for (let attempt = 0; attempt < 3 && !confirmedId; attempt++) {
        try {
          const list = await enqueue("/submitted?id=" + encodeURIComponent(entry.username));
          if (list.classification !== "ok" || list.status !== 200) break;
          for (const row of list.doc.querySelectorAll("tr.athing[id]")) {
            const id = Number(row.id);
            const titleNode = row.querySelector(".titleline > a, .titleline a");
            if (!Number.isSafeInteger(id) || id <= 0 || entry.previousIds.has(id)) continue;
            if ((titleNode?.textContent || "").replace(/\s+/g, " ").trim() !== expectedTitle) continue;
            if (urlText) {
              try {
                if (new URL(titleNode.href, HN_ORIGIN).href !== new URL(String(urlText)).href) continue;
              } catch { continue; }
            }
            confirmedId = id;
            break;
          }
        } catch { break; }
      }
    }
    const outcome = page.classification === "expiredLink"
      ? { status: "failure", message: "Hacker News rejected the expired submission form. Your draft is kept. Open HN's own submit page to retry with a fresh form." }
      : formOutcome(page, (response) => {
        try { return confirmedId !== null || new URL(response.url).pathname === "/newest"; } catch { return false; }
      }, { indeterminate: "Hacker News has not confirmed this story in your submitted list. It may have rejected or filtered the submission (especially a short test post). Your draft is kept; check HN submissions before trying again." });
    if (outcome.status === "success") {
      formHandles.delete(handle);
      if (confirmedId) outcome.newStoryId = confirmedId;
    }
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Account lists (Phase 6). SEC-05: profiles and account data come from the
  // public Firebase API — these list paths never include the /user page.
  // ---------------------------------------------------------------------------
  const LIST_PATH_SEGMENTS = new Set([
    "upvoted", "favorites", "submitted", "hidden", "threads", "comments",
    "newest", "shownewest", "front", "noobstories", "bestcomments", "active",
    "pool", "launches", "whoishiring", "classic", "ask", "show", "jobs",
    "x", // HN's session-continuation endpoint used by fnid morelinks
  ]);

  function validateListPath(path) {
    if (typeof path !== "string" || path.charAt(0) !== "/") return null;
    const question = path.indexOf("?");
    const segment = question === -1 ? path.slice(1) : path.slice(1, question);
    if (!/^[a-z]+$/.test(segment) || !LIST_PATH_SEGMENTS.has(segment)) return null;
    return path;
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  globalThis.HarmoNovaHN = {
    harvest,
    session: () => (currentSession ? { ...currentSession } : null),
    onSessionChange: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    // id -> "up" | "down" for stories that showed as voted on the last
    // harvested feed document (safe view: ids and directions only).
    documentVoteState: () => Object.fromEntries(documentVotes),
    ensureItemState,
    vote,
    setFavorite,
    setHidden,
    setFlagged,
    openReplyForm,
    postComment,
    openEditForm,
    saveEdit,
    openDeleteForm,
    deleteComment,
    openSubmitForm,
    submitStory,
    fetchListPage,
    logout,
    // Test/inspection hooks (never expose tokens).
    _internal: {
      classifyDoc,
      parseTopBar: (doc) => {
        const top = parseTopBar(doc);
        return { username: top.username, karma: top.karma, hasLogout: Boolean(top.logoutHref) };
      },
      parseVoteLinks: (doc) => {
        const map = parseVoteLinks(doc);
        const out = {};
        for (const [id, entry] of map) out[id] = safeVoteState(entry);
        return out;
      },
      parseItemActions: (doc) => {
        const map = parseItemActions(doc);
        const out = {};
        for (const [id, entry] of map) {
          out[id] = {
            favorite: Boolean(entry.favorite),
            favoriteActive: Boolean(entry.favorite?.un),
            favoriteHasAuth: Boolean(entry.favorite?.auth),
            hide: Boolean(entry.hide),
            hideActive: Boolean(entry.hide?.un),
            hideHasAuth: Boolean(entry.hide?.auth),
            flag: Boolean(entry.flag),
            flagActive: Boolean(entry.flag?.un),
            flagHasAuth: Boolean(entry.flag?.auth),
          };
        }
        return out;
      },
      parseCommentForm: (doc) => {
        const form = parseCommentForm(doc);
        if (!form) return null;
        return {
          available: true,
          fields: Object.fromEntries(Object.keys(form.fields).map((key) => [key, form.fields[key] ? "<set>" : ""])),
        };
      },
      parseList,
      parseFnidForm: (doc) => {
        const form = parseFnidForm(doc);
        return form ? { action: form.action, hasFnid: FNID.test(form.fields.fnid || ""), fields: Object.keys(form.fields) } : null;
      },
      cachedTokenCount: () => tokenCache.size,
      pendingHandles: () => formHandles.size,
      queueDepth: () => requestQueue.depth,
      clearCaches,
      // Test hook (SEC-35 staleness verification): force every cached token to
      // look stale so the next mutation must re-verify against a fresh page.
      expireCachedTokens: () => {
        for (const entry of tokenCache.values()) entry.fetchedAt = 0;
      },
    },
  };

  // SEC-12: clear everything when the page goes away.
  window.addEventListener("pagehide", ()=>{requestQueue.dispose();clearCaches();}, { once: true });
  window.addEventListener("beforeunload", clearCaches, { once: true });
})();
