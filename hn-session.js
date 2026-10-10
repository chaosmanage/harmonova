// Harmonic HN session and account-action client (isolated content-script world).
//
// Implements the Hacker News protocol rules from docs/implementation-plan.md §7:
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
// The public surface is globalThis.HarmonicHN; it exposes actions and safe
// state only — never tokens.
(() => {
  "use strict";

  const HN_ORIGIN = "https://news.ycombinator.com";
  const MIN_SPACING_MS = 750;
  const MAX_QUEUE_ATTEMPTS = 4;

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

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
      // SEC-12: username changed (or logged out) — drop every token and handle.
      tokenCache.clear();
      formHandles.clear();
      inFlight.clear();
    }
    currentSession = next;
    if (changed) notifySession();
  }

  // ---------------------------------------------------------------------------
  // Serial HN fetch queue (SEC-25)
  // ---------------------------------------------------------------------------

  const queue = [];
  let queueRunning = false;
  let lastHnRequestAt = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function enqueue(path, options = {}) {
    return new Promise((resolve, reject) => {
      queue.push({ path, options, resolve, reject });
      if (!queueRunning) runQueue();
    });
  }

  async function runQueue() {
    queueRunning = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        job.resolve(await performHnRequest(job.path, job.options));
      } catch (error) {
        job.reject(error);
      }
    }
    queueRunning = false;
  }

  function parseDocument(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  // Removes user-contributed regions so page-level error strings cannot be
  // spoofed by comment text (upstream Harmonic does the same).
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

  const RATE_LIMIT_MESSAGES = [
    "Sorry, we're not able to serve your requests this quickly.",
    "Please slow down",
    "You're posting too fast",
  ];

  async function performHnRequest(path, options) {
    const method = options.method || "GET";
    const isMutation = method !== "GET";
    let attempt = 0;
    while (true) {
      const wait = Math.max(0, MIN_SPACING_MS - (Date.now() - lastHnRequestAt));
      if (wait) await sleep(wait);
      lastHnRequestAt = Date.now();
      let response;
      try {
        response = await fetch(HN_ORIGIN + path, {
          method,
          credentials: "same-origin", // SEC-20
          redirect: "follow",
          headers: { Accept: "text/html,application/xhtml+xml" },
          ...(options.body ? { body: new URLSearchParams(options.body).toString() } : {}),
        });
      } catch (error) {
        if (!isMutation && attempt < MAX_QUEUE_ATTEMPTS - 1) { attempt++; await sleep(1000 * attempt); continue; }
        throw { status: "failure", message: "Network request to Hacker News failed", detail: String(error?.message || "") };
      }
      // SEC-21: the response must come from the HN origin.
      let responseUrl = "";
      try { responseUrl = new URL(response.url).href; } catch {}
      if (!responseUrl || new URL(responseUrl).origin !== HN_ORIGIN) {
        throw { status: "indeterminate", message: "Hacker News response came from an unexpected origin", detail: "mutation outcome unknown" };
      }
      const html = await response.text();
      const doc = parseDocument(html);
      const classification = classifyDoc(doc);
      if (classification === "rateLimited" || response.status === 503) {
        if (!isMutation && attempt < MAX_QUEUE_ATTEMPTS - 1) {
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
  }

  function accountChangedOutcome(message) {
    clearCaches();
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
    if (!logoutLink) return { username: null, karma: null, definitive: true };
    const meLink = right.querySelector('a#me, a[href^="user?id="]');
    const username = (meLink?.textContent || "").replace(/\(\d+\)/g, "").trim();
    if (!username) return { username: null, karma: null, definitive: true };
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

  // All vote links on the page: up_ID / down_ID / un_ID anchors.
  function parseVoteLinks(doc) {
    const result = new Map(); // id -> entry (may contain tokens; callers must strip)
    for (const a of doc.querySelectorAll("a[id]")) {
      const match = a.id.match(/^(up|down|un)_(\d+)$/);
      if (!match) continue;
      const [, kind, rawId] = match;
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      const href = a.getAttribute("href") || "";
      const params = new URLSearchParams(href.replace(/^vote\??/, ""));
      const arrowTitle = a.querySelector(".votearrow")?.getAttribute("title") || "";
      const entry = result.get(id) || { canUp: false, canDown: false, voted: null, votedDirection: null };
      if (kind === "up") entry.canUp = true;
      if (kind === "down") entry.canDown = true;
      if (kind === "un") {
        entry.voted = true;
        // The filled arrow keeps its semantic title even after voting.
        entry.votedDirection = arrowTitle === "downvote" ? "down" : "up";
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
    // Resolve the morelink against the page URL when possible.
    try {
      const resolved = new URL(moreHref, doc.baseURI && /^https?:/.test(doc.baseURI) ? doc.baseURI : undefined);
      return { ids, morePath: resolved.pathname + resolved.search };
    } catch {
      return { ids, morePath: moreHref.startsWith("/") ? moreHref : "/" + moreHref };
    }
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

  async function fetchItemDoc(itemId) {
    if (!Number.isInteger(itemId) || itemId <= 0) throw { status: "failure", message: "Invalid item id" };
    return enqueue("/item?id=" + itemId);
  }

  function harvest(doc) {
    // Read the live HN page before Harmonic mounts. No tokens are retained
    // from the initial document except the logout token, which stays here.
    const top = parseTopBar(doc);
    if (top.username) {
      setSession(top.username, top.karma); // clears caches when the account changed
      const logout = parseLogoutToken(top.logoutHref);
      if (logout) tokenCache.set("logout:", { auth: logout.auth, goto: logout.goto, username: top.username, fetchedAt: Date.now() });
    }
    // Feed documents also carry vote links for every visible story. Cache
    // their tokens in memory (SEC-35) and record which stories are already
    // voted so the UI can light up voted states without extra fetches.
    documentVotes.clear();
    for (const [id, entry] of parseVoteLinks(doc)) {
      if (entry.voted) documentVotes.set(id, entry.votedDirection === "down" ? "down" : "up");
      if (!currentSession?.username) continue;
      if (entry.upHrefParams?.auth) cacheToken("vote:up", id, entry.upHrefParams.auth, entry.upHrefParams.goto);
      if (entry.downHrefParams?.auth) cacheToken("vote:down", id, entry.downHrefParams.auth, entry.downHrefParams.goto);
      if (entry.unHrefParams?.auth) cacheToken("vote:un", id, entry.unHrefParams.auth, entry.unHrefParams.goto);
    }
    return currentSession ? { ...currentSession } : null;
  }

  async function ensureItemState(itemId) {
    const page = await fetchItemDoc(itemId);
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
          if (params?.auth) cacheToken("vote:" + kind, id, params.auth, params.goto);
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
    const comments = {};
    for (const [id, entry] of votes) {
      if (id === itemId) continue;
      comments[id] = safeVoteState(entry);
    }
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
      if (token && !(Date.now() - token.fetchedAt <= TOKEN_MAX_AGE)) token = null; // stale: re-verify below (SEC-35)
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
      if (classified) return classified;
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
    return withMutationToken(
      "vote:" + how,
      itemId,
      labels,
      (token) => {
        const params = new URLSearchParams({
          id: String(itemId),
          how,
          auth: token.auth,
          goto: token.goto || ("item?id=" + itemId),
          js: "t",
        }); // SEC-14
        return enqueue("/vote?" + params.toString());
      },
      async (page, token) => {
        // js=t responses contain the refreshed vote links for this item.
        refreshSessionFromDoc(page.doc);
        if (!currentSession || token.username !== currentSession.username) return accountChangedOutcome();
        const refreshed = parseVoteLinks(page.doc);
        if (currentSession?.username) {
          const entry = refreshed.get(itemId);
          if (entry) {
            for (const voteKind of ["up", "down", "un"]) {
              const p = entry[voteKind + "HrefParams"];
              if (p?.auth) cacheToken("vote:" + voteKind, itemId, p.auth, p.goto);
            }
          }
        }
        return { status: "success", message: "", state: safeVoteState(refreshed.get(itemId)) };
      }
    );
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

  async function logout() {
    const token = getToken("logout", "");
    if (!token) {
      setSession(null, null);
      return { status: "success", message: "Signed out" };
    }
    // SEC-04: fetch, never navigate — the token URL must not enter history.
    try {
      const page = await enqueue("/logout?" + new URLSearchParams({ auth: token.auth, goto: token.goto || "news" }).toString());
      refreshSessionFromDoc(page.doc);
      if (currentSession) {
        return { status: "indeterminate", message: "Hacker News did not confirm sign-out. Try again.", detail: "" };
      }
    } catch {
      setSession(null, null);
    }
    clearCaches();
    return { status: "success", message: "Signed out" };
  }

  // ---------------------------------------------------------------------------
  // Comment / reply / edit / delete / submit forms (SEC-34: never auto-retry)
  // ---------------------------------------------------------------------------

  function gotoForItem(itemId) {
    return Number.isInteger(itemId) && itemId > 0 ? "item?id=" + itemId : "news";
  }

  async function openReplyForm(parentId, options = {}) {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to reply" };
    const goto = options.goto || gotoForItem(options.storyId) || gotoForItem(parentId);
    const page = await enqueue("/reply?" + new URLSearchParams({ id: String(parentId), goto }).toString());
    if (page.classification === "loginPage") { setSession(null, null); return { status: "loginRequired", message: "Sign in to reply" }; }
    if (page.classification === "validationRequired") return { status: "validationRequired", message: "Hacker News asks for verification before this reply. Open the reply on Hacker News to continue.", detail: "draft kept" };
    if (page.classification === "expiredLink") return { status: "failure", message: "Hacker News reported an expired reply link. Refresh the discussion and try again.", detail: "" };
    if (page.classification !== "ok") return { status: "failure", message: "Could not open a reply form on Hacker News.", detail: page.classification };
    const form = parseCommentForm(page.doc);
    if (!form || !HEX40.test(form.fields.hmac || "")) {
      return { status: "failure", message: "Hacker News reply form could not be read. Open it on Hacker News instead.", detail: "" };
    }
    refreshSessionFromDoc(page.doc);
    if (!currentSession) return { status: "loginRequired", message: "Sign in to reply" };
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "comment", action: form.action, fields: { ...form.fields }, username: currentSession.username, parentId, createdAt: Date.now() });
    return { status: "ok", handle };
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

  function formOutcome(page, successPathTest, labels) {
    if (page.classification === "badLogin") return { status: "loginRequired", message: "Your Hacker News session ended. Sign in again.", detail: "draft kept" };
    if (page.classification === "tooFast") return { status: "failure", message: "Hacker News says you're posting too fast. Wait a moment before trying again.", detail: "draft kept" };
    if (page.classification === "validationRequired") return { status: "validationRequired", message: "Hacker News asks for verification. Open the form on Hacker News to continue.", detail: "draft kept" };
    if (page.classification === "rateLimited") return { status: "rateLimited", message: "Hacker News is rate-limiting requests. Wait a moment and check whether the post went through before retrying.", detail: "draft kept" };
    if (page.classification === "blank") return { status: "indeterminate", message: "Hacker News's response was unreadable. Check whether the post went through before retrying.", detail: "draft kept" };
    let path = "";
    try { path = new URL(page.url).pathname + "?" + (new URL(page.url).search || ""); } catch {}
    // A successful POST usually redirects to the item page; when redirects are
    // not visible to the fetch (proxied environments), the returned item
    // document itself is an equally strong success signal.
    const itemLike = Boolean(page.doc.querySelector(".comment-tree, .toptext, .titleline, td.title"));
    if (successPathTest(path, page) || itemLike) return { status: "success", message: "" };
    return { status: "indeterminate", message: labels.indeterminate || "Hacker News did not confirm the action. Check on Hacker News before retrying.", detail: "" };
  }

  async function postComment(handle, text) {
    const entry = getHandle(handle, "comment");
    if (entry === null) return { status: "failure", message: "This reply form is no longer valid. Refresh and try again." };
    if (entry === "changed") return accountChangedOutcome();
    const body = { parent: entry.fields.parent, goto: entry.fields.goto, hmac: entry.fields.hmac, text };
    const page = await enqueue("/" + (entry.action || "comment"), { method: "POST", body }); // SEC-14
    const outcome = formOutcome(page, (path) => path.startsWith("/item"), { indeterminate: "Hacker News did not confirm the comment. Check the thread before posting again." });
    if (outcome.status === "success") formHandles.delete(handle);
    return outcome;
  }

  async function openEditForm(commentId, options = {}) {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to edit" };
    const page = await enqueue("/edit?" + new URLSearchParams({ id: String(commentId), ...(options.goto ? { goto: options.goto } : {}) }).toString());
    if (page.classification === "loginPage") { setSession(null, null); return { status: "loginRequired", message: "Sign in to edit" }; }
    if (page.classification !== "ok") return { status: "failure", message: "Hacker News did not offer an edit form for this comment.", detail: page.classification };
    const form = parseFormByPredicate(page.doc, (f) => ["xedit", "comment"].includes(f.getAttribute("action")));
    if (!form || !HEX40.test(form.fields.hmac || "")) {
      return { status: "failure", message: "Hacker News edit form could not be read. Edit on Hacker News instead.", detail: "" };
    }
    refreshSessionFromDoc(page.doc);
    if (!currentSession) return { status: "loginRequired", message: "Sign in to edit" };
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "edit", action: form.action || "xedit", fields: { ...form.fields }, username: currentSession.username, commentId, createdAt: Date.now() });
    return { status: "ok", handle, currentText: form.fields.text || "" };
  }

  async function saveEdit(handle, text) {
    const entry = getHandle(handle, "edit");
    if (entry === null) return { status: "failure", message: "This edit form is no longer valid. Refresh and try again." };
    if (entry === "changed") return accountChangedOutcome();
    const body = { ...entry.fields, text };
    const page = await enqueue("/" + (entry.action || "xedit"), { method: "POST", body });
    const outcome = formOutcome(page, (path) => path.startsWith("/item"), { indeterminate: "Hacker News did not confirm the edit. Check the comment before retrying." });
    if (outcome.status === "success") formHandles.delete(handle);
    return outcome;
  }

  async function openDeleteForm(commentId, options = {}) {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to delete" };
    const goto = options.goto || gotoForItem(options.storyId);
    const page = await enqueue("/delete-confirm?" + new URLSearchParams({ id: String(commentId), ...(goto ? { goto } : {}) }).toString());
    if (page.classification === "loginPage") { setSession(null, null); return { status: "loginRequired", message: "Sign in to delete" }; }
    if (page.classification !== "ok") return { status: "failure", message: "Hacker News did not offer a delete form for this comment.", detail: page.classification };
    const form = parseFormByPredicate(page.doc, (f) => true) // the page hosts exactly one form
      || parseFormByPredicate(page.doc, (f) => f.querySelector('input[type="submit"]'));
    if (!form) return { status: "failure", message: "Hacker News delete form could not be read. Delete on Hacker News instead.", detail: "" };
    refreshSessionFromDoc(page.doc);
    if (!currentSession) return { status: "loginRequired", message: "Sign in to delete" };
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "delete", action: form.action || "xdelete", fields: { ...form.fields }, username: currentSession.username, commentId, createdAt: Date.now() });
    return { status: "ok", handle };
  }

  async function deleteComment(handle) {
    const entry = getHandle(handle, "delete");
    if (entry === null) return { status: "failure", message: "This delete form is no longer valid. Refresh and try again." };
    if (entry === "changed") return accountChangedOutcome();
    const page = await enqueue("/" + (entry.action || "xdelete"), { method: "POST", body: { ...entry.fields } });
    const outcome = formOutcome(page, (path) => path.startsWith("/item") || path.startsWith("/news"), { indeterminate: "Hacker News did not confirm the delete. Check the comment before retrying." });
    if (outcome.status === "success") formHandles.delete(handle);
    return outcome;
  }

  async function openSubmitForm() {
    if (!currentSession) return { status: "loginRequired", message: "Sign in to submit" };
    const page = await enqueue("/submit");
    if (page.classification === "loginPage") { setSession(null, null); return { status: "loginRequired", message: "Sign in to submit" }; }
    if (page.classification !== "ok") return { status: "failure", message: "Could not open the Hacker News submit form.", detail: page.classification };
    const form = parseFnidForm(page.doc);
    if (!form || !FNID.test(form.fields.fnid || "")) {
      return { status: "failure", message: "Hacker News submit form could not be read. Submit on Hacker News instead.", detail: "" };
    }
    refreshSessionFromDoc(page.doc);
    if (!currentSession) return { status: "loginRequired", message: "Sign in to submit" };
    handleCounterSalt += 1;
    const handle = "f" + (nextHandleId++) + "x" + handleCounterSalt;
    formHandles.set(handle, { kind: "submit", action: form.action || "r", fields: { ...form.fields }, username: currentSession.username, createdAt: Date.now() });
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
    const page = await enqueue("/" + (entry.action || "r"), { method: "POST", body });
    let path = "";
    try { path = new URL(page.url).pathname; } catch {}
    if (path === "/item") {
      const id = Number(new URL(page.url).searchParams.get("id"));
      return { status: "alreadySubmitted", message: "Hacker News already has this story.", detail: String(Number.isInteger(id) ? id : ""), existingId: Number.isInteger(id) ? id : null };
    }
    const outcome = formOutcome(page, (p) => p.startsWith("/newest") || p.startsWith("/item"), { indeterminate: "Hacker News did not confirm the submission. Check /newest before posting again." });
    if (outcome.status === "success") formHandles.delete(handle);
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  globalThis.HarmonicHN = {
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
      queueDepth: () => queue.length,
      clearCaches,
      // Test hook (SEC-35 staleness verification): force every cached token to
      // look stale so the next mutation must re-verify against a fresh page.
      expireCachedTokens: () => {
        for (const entry of tokenCache.values()) entry.fetchedAt = 0;
      },
    },
  };

  // SEC-12: clear everything when the page goes away.
  window.addEventListener("pagehide", clearCaches, { once: true });
  window.addEventListener("beforeunload", clearCaches, { once: true });
})();