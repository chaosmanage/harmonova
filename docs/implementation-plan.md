# Harmonic for Hacker News — Production Implementation Plan

Branch: `feature/hn-account-actions`
Baseline: version 0.7.2 (`main` at `6daf588`)
Reference: [SimonHalvdansson/Harmonic-HN](https://github.com/SimonHalvdansson/Harmonic-HN) at commit `42aae5fa3c587b4554f1e53ce6d45c267e1aec2a`

This document describes how to extend the extension from a read-only reader into a full Harmonic-style Hacker News client — account login, voting, commenting, favorites, hiding, flagging, submitting, profiles, site-wide search, and the remaining Harmonic reading features — without weakening the security of the user's Hacker News account or other credentials.

---

## Table of contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Verified facts this plan depends on](#2-verified-facts-this-plan-depends-on)
3. [Core design decision: no passwords](#3-core-design-decision-no-passwords)
4. [Threat model](#4-threat-model)
5. [Security rules (apply to every phase)](#5-security-rules-apply-to-every-phase)
6. [Architecture changes](#6-architecture-changes)
7. [Hacker News protocol reference](#7-hacker-news-protocol-reference)
8. [Phase plan](#8-phase-plan)
   - [Phase H — 0.7.3 Hardening of existing code](#phase-h--073-hardening-of-existing-code)
   - [Phase 0 — Scaffolding and test infrastructure](#phase-0--scaffolding-and-test-infrastructure)
   - [Phase S — Site-wide search](#phase-s--site-wide-search)
   - [Phase 1 — Session and account UI](#phase-1--session-and-account-ui)
   - [Phase 2 — Voting](#phase-2--voting)
   - [Phase 3 — Commenting](#phase-3--commenting)
   - [Phase 4 — Favorites, hide, flag](#phase-4--favorites-hide-flag)
   - [Phase 5 — Submit](#phase-5--submit)
   - [Phase 6 — Profiles and account lists](#phase-6--profiles-and-account-lists)
   - [Phase 7 — Harmonic reading parity (no login)](#phase-7--harmonic-reading-parity-no-login)
   - [Phase 8 — Optional extras](#phase-8--optional-extras)
9. [Testing strategy](#9-testing-strategy)
10. [Release process and gates](#10-release-process-and-gates)
11. [Harmonic feature inventory](#11-harmonic-feature-inventory)
12. [Out of scope](#12-out-of-scope)
13. [Residual risks](#13-residual-risks)
14. [Inputs needed before account work](#14-inputs-needed-before-account-work)

---

## 1. Goals and non-goals

### Goals

- Let a signed-in Hacker News user vote, comment, reply, edit/delete their comments, favorite, hide, flag, and submit — from inside the Harmonic UI.
- Add site-wide search across stories and comments.
- Add the Harmonic reading features that make sense on a desktop browser.
- Keep the project's existing principles: no framework, no project-owned backend, no analytics, small permission surface, every change covered by Chromium tests at 1919×872.

### Non-goals

- Storing, typing, or transmitting the user's Hacker News password anywhere inside the extension.
- Changing account settings (password, email, profile, `noprocrast`, etc.).
- Automating actions on Hacker News (bulk voting, scheduled posting, AI-generated replies).

---

## 2. Verified facts this plan depends on

Verified on 2026-10-10 against live Hacker News (logged out) and a local Chromium run.

| Fact | Evidence |
| --- | --- |
| Vote links are `<a id='up_ID' href='vote?id=ID&how=up&goto=…'>`; logged-in pages add `&auth=<token>`. | Live `/news` and `/item` markup |
| HN's own `hn.js` votes with `GET vote?id&how=up\|down\|un&auth&goto&js=t`. | Live `hn.js` |
| `hn.js` installs a document-wide click listener keyed on `.clicky`, `.togg`, `#logout`, `up_*`/`down_*`/`un_*`/`unv_*` IDs, and sends `collapse?id=` when logged in. It keeps running after Harmonic replaces the body. | Live `hn.js` |
| The item page has `<form action="comment" method="post">` with hidden `parent`, `goto`, `hmac` inputs. `hmac` is 40 lowercase hex characters. | Live item page |
| Comments link to `reply?id=CID&goto=…`; stories link to `fave?id=…&auth=…` and `hide?id=…`. Logged out, the top bar has `login?goto=…`. | Live item page |
| Large threads are paginated by HN (`a.morelink`). | Live item page |
| HN response headers: `content-security-policy` with `script-src 'self' 'unsafe-inline' …`, `x-frame-options: DENY`, `frame-ancestors 'self'`, `referrer-policy: origin`, HSTS. | Live response headers |
| The Harmonic body is hidden until `html.harmonic-ready` (`styles.css`), so the original HN DOM can be read before mounting without a visible flash. | `styles.css` line 32 |
| **Background-worker `fetch()` sends cookies by default.** With test cookies on `news.ycombinator.com`, `SameSite=None` cookies were sent with default and `credentials: "include"`; `SameSite=Lax` cookies were withheld; `credentials: "omit"` sent none. | Local Chromium probe with the extension loaded |
| `story.url` (Firebase) and `item.url` (Algolia) are assigned to `href`/`window.open` without `safeHref`. | `content.js` `createStoryCard`, `renderThread` |
| The Harmonic font is fetched at runtime from upstream's `main` branch, unpinned. | `background.js` `HARMONIC_FONT_URL` |
| Algolia search works without auth: `/api/v1/search`, `/api/v1/search_by_date`, `tags=(story,show_hn)`, `numericFilters=created_at_i>…,points>…`. | Live Algolia queries |
| Git history contains only placeholder test keys. | `git log -p --all` scan |

**Not yet verified (requires a logged-in capture):** exact logged-in markup (`#me`, `#karma`, `#logout`, `un_ID`, `nosee`), the response to `vote … &js=t`, `edit`/`delete-confirm` form field names, and HN's `user` cookie flags (`HttpOnly`, `SameSite`). Phase 0 captures these before any account code is written.

---

## 3. Core design decision: no passwords

Upstream Harmonic (Android) stores the username and password in the OS keystore and sends `acct`/`pw` in the body of every vote, comment, favorite, and submit POST (`HackerNewsActionRepository.kt`). A native app has no other option.

This extension does. `content.js` runs on `https://news.ycombinator.com/*`, so its `fetch("/vote?…")` is **same-origin**: Chrome attaches HN's own session cookie automatically. Therefore:

- **Login** = navigate to HN's stock `/login?goto=<current Harmonic route>`. Harmonic does not mount on `/login`, so HN renders its own form, handles reCAPTCHA, account creation, and password-manager autofill.
- **Actions** = same-origin requests from the content script using CSRF tokens (`auth`, `hmac`, `fnid`) parsed from HN pages.
- **The extension never sees, stores, or transmits a password, and never reads the session cookie.**
- **The background worker never makes authenticated Hacker News requests.**

---

## 4. Threat model

### Assets

1. The user's HN session (cookie) and the ability to act as the user.
2. HN CSRF tokens (`auth`, `hmac`, `fnid`, logout `auth`).
3. The OpenRouter API key.
4. Cookies/sessions the user has on *other* sites.
5. Unpublished drafts, read history, bookmarks, search queries.
6. The user's local network (routers, intranet services).

### Adversaries

| Adversary | Capability |
| --- | --- |
| Malicious HN submitter / commenter | Controls story URLs, titles, comment HTML, OpenGraph tags of linked pages. |
| Malicious linked website | Controls article HTML/text (→ AI prompt injection), redirects, OG image/favicon URLs. |
| Compromised or misbehaving third party | Algolia, Firebase, Google favicon service, OpenRouter, raw.githubusercontent.com. |
| Other extensions | May run content scripts on HN; may call `.click()` on our DOM; may message our extension. |
| Script running in HN's main world | HN's own `hn.js`, or an XSS. Shares the DOM, not our isolated-world JS. |
| Account switch in another tab | Changes the cookie under an open Harmonic tab. |
| Local attacker with profile access | Can read `chrome.storage.local` on disk. |
| Shared/incognito browsing | Incognito activity leaking into the normal profile. |

### Key observations

- **Any script execution on `news.ycombinator.com` = full account action capability.** HN's CSP allows inline scripts, so Harmonic's HTML sanitizer is the only barrier for content we render.
- **CSRF tokens are only half a credential**, but a leaked token plus a top-level navigation (where `Lax` cookies are sent) is a working CSRF. Tokens must stay secret.
- **The background worker has broad host permissions and sends cookies by default.** It must be treated as a confused-deputy risk.

---

## 5. Security rules (apply to every phase)

Each rule has an ID referenced by tests and phase gates.

### Credentials and session

- **SEC-01** Never render an `input[type=password]` in Harmonic UI. Never build a lookalike login form.
- **SEC-02** Login only by navigating to `https://news.ycombinator.com/login?goto=<path>`, where `<path>` is built from Harmonic's own route allowlist (`/news`, `/newest`, `/best`, `/ask`, `/show`, `/jobs`, `/item?id=<int>`), never from page content or query strings.
- **SEC-03** Never read `document.cookie`, never request the `cookies` permission.
- **SEC-04** Logout via same-origin `fetch("/logout?auth=…&goto=news")` followed by a reload — never by navigating to the token URL (keeps the token out of history).
- **SEC-05** Never fetch or parse the signed-in user's own `/user?id=<me>` HTML (contains email and the profile-update form). Profiles use the Firebase API.
- **SEC-06** Harmonic must not mount, harvest, or attach listeners on: `/login`, `/logout`, `/changepw`, `/forgot`, `/user`, `/xuser`, `/r`, `/x`, `/submit` (stock page), `/reply`, `/edit`, `/delete-confirm`. Keep the existing route allowlist approach.

### Tokens

- **SEC-10** Tokens live only in a module-private closure inside `hn-session.js`. The shared `globalThis.HarmonicHN` object exposes action functions only — no getters, no token-returning methods.
- **SEC-11** Tokens never appear in DOM attributes or text, `chrome.storage.*`, `localStorage`/`sessionStorage`, runtime messages, ports, console output, URLs shown to the user, error messages, or test artifacts.
- **SEC-12** Every token cache entry is tagged with the username it was fetched under. Cache is cleared on logout, on username change, and on page unload.
- **SEC-13** Validate before use: `auth`/`hmac` match `^[0-9a-f]{40}$`; `fnid` matches `^[A-Za-z0-9]{1,64}$` (confirm length from capture); item IDs are positive safe integers; `how ∈ {up, down, un}`; form actions ∈ `{comment, xedit, xdelete, r}`.
- **SEC-14** Build every request URL/body ourselves with `URLSearchParams`. Never follow or replay an `href`/`action` scraped from HN.

### Requests

- **SEC-20** All authenticated requests are relative-URL `fetch` calls from the content script (`credentials: "same-origin"`).
- **SEC-21** Every authenticated response must have `new URL(response.url).origin === "https://news.ycombinator.com"`; otherwise treat as failure (indeterminate if the request was a mutation).
- **SEC-22** Every background-worker `fetch` uses `credentials: "omit"`.
- **SEC-23** The background worker refuses to fetch any URL whose host is `news.ycombinator.com`, `ycombinator.com`, or a subdomain, for previews and summaries.
- **SEC-24** Background fetches allow only `http:`/`https:` on default ports; block `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, IPv4 loopback/private/link-local/CGNAT/`0.0.0.0/8`, IPv6 loopback/ULA/link-local, and literal IPs in decimal/hex/octal forms. Use `redirect: "manual"` and re-validate every hop (max 5).
- **SEC-25** HTML page fetches to HN go through a single serial queue with ≥ 750 ms spacing and exponential back-off when HN returns its rate-limit page or HTTP 503.

### Mutations

- **SEC-30** Mutating handlers require `event.isTrusted === true`.
- **SEC-31** No action is triggered by page load, hover, URL fragment/query, keyboard shortcut (unless explicitly opted into), AI output, or a timer.
- **SEC-32** One in-flight mutation per item; controls disabled while pending.
- **SEC-33** Votes, favorites, hides, flags set a *target state* (idempotent). They may auto-retry **once** after "Unknown or expired link." with a freshly fetched token — only if the username is unchanged.
- **SEC-34** Comment, reply, edit, delete, and submit **never auto-retry**. Indeterminate outcomes keep the draft and tell the user to check before trying again.
- **SEC-35** Before every mutation, the page fetched to obtain the token/form must show the same username the UI is acting as. On mismatch: abort, clear caches, show "You're now signed in as *B*".
- **SEC-36** Destructive or reputation-affecting actions (delete, flag) require an explicit confirmation step; hide offers undo.
- **SEC-37** No bulk voting. Bulk "bookmarks → favorites" runs serially with delay, shows the count first, and can be cancelled.

### Rendering

- **SEC-40** Never assign untrusted strings to `innerHTML`/`outerHTML`/`insertAdjacentHTML`. Untrusted HTML (comments, story text, profile "about", Algolia highlights) is parsed with `DOMParser` and rebuilt via the existing allowlist sanitizer (`appendSanitizedHtml`) or a dedicated highlight builder.
- **SEC-41** All external URLs pass `safeHref` (`http:`/`https:` only) before use in `href` or `window.open`.
- **SEC-42** Image `src` values (preview, hero, favicon) must be `https:` and must not be on the HN origin.
- **SEC-43** Harmonic DOM must never use names `hn.js` reacts to: classes `clicky`, `togg`, `nosee`, `noshow`, `coll`, `comtr`, `athing`, `votelinks`; IDs `me`, `logout`, `karma`, and any `up_*`, `down_*`, `un_*`, `unv_*`. The sanitizer strips `class` and `id` from untrusted HTML.
- **SEC-44** AI summaries: never render Markdown images, never give the model tools or HN actions, never pre-fill a composer from AI output.

### Storage and privacy

- **SEC-50** Drafts are stored in `chrome.storage.session` via the background worker, keyed by `username + parentId`, ≤ 20 KB each, ≤ 50 drafts, purged on logout/account change and on successful post.
- **SEC-51** In incognito (`chrome.extension.inIncognitoContext`), read state, drafts, search history, and new bookmarks stay in memory only.
- **SEC-52** Background message handlers that accept user data verify `sender.id === chrome.runtime.id`, `sender.frameId === 0`, and `new URL(sender.tab.url).origin === "https://news.ycombinator.com"`.
- **SEC-53** Declare an empty `externally_connectable` so other extensions and websites cannot message the extension (confirm Chrome accepts the empty declaration; otherwise list a non-matching pattern).
- **SEC-54** Do not add `web_accessible_resources`; extension pages (`ai-settings.html`) must not be frameable by HN.
- **SEC-55** Search queries are sent to Algolia only; never written into the HN page URL.

### Supply chain and test hygiene

- **SEC-60** Pin the runtime font URL to a commit SHA and verify its SHA-256 before use.
- **SEC-61** No runtime dependencies. Dev dependencies remain `playwright-core` only unless justified.
- **SEC-62** Raw logged-in captures live in a gitignored folder (`tests/fixtures/hn/raw/`). Committed fixtures contain placeholder tokens (`0000…`, `1111…`), placeholder usernames (`harmonic_test`), no emails.
- **SEC-63** Never record Playwright traces/HAR files or commit screenshots from a real account session.

---

## 6. Architecture changes

### New files

| File | Purpose |
| --- | --- |
| `hn-session.js` | Content script loaded before `content.js`. Module-private token cache, HN HTML parsers, serial fetch queue, action client, outcome classification. Exposes `globalThis.HarmonicHN` (isolated world only). |
| `hn-search.js` | Algolia search client: query builder, response validation, highlight builder. |
| `url-policy.js` | Shared URL validation used by background (`importScripts`) — scheme/port/host/IP checks, HN-host denylist. |
| `tests/hn-auth.mjs` | Mocked end-to-end suite for account features. |
| `tests/hn-parser.mjs` | In-browser parser/sanitizer tests against fixtures. |
| `tests/security.mjs` | Security regression suite (cookies, SSRF, sanitizer, token leakage). |
| `tests/hn-markup-live.mjs` | Live, logged-out markup drift check. |
| `tests/fixtures/hn/*.html` | Redacted HN page fixtures. |
| `tests/fixtures/algolia/*.json` | Search fixtures including hostile highlights. |

### Changed files

| File | Change |
| --- | --- |
| `manifest.json` | Content script order `["hn-session.js", "hn-search.js", "content.js"]`; empty `externally_connectable`; version bumps. No new permissions through Phase 7. |
| `content.js` | Mount at `DOMContentLoaded` after harvesting; account UI; action buttons; composer; search mode; parity features. |
| `background.js` | `credentials: "omit"`; URL policy; redirect re-validation; pinned/hashed font; draft storage handlers with sender checks; incognito awareness. |
| `styles.css` | Account chip, vote states, comment action row, composer, search UI. Avoid SEC-43 names. |
| `scripts/package.sh` | Copy the new runtime files. |
| `package.json` | New test scripts. |
| `.gitignore` | `tests/fixtures/hn/raw/`, `*.har`, `trace*.zip`. |
| `README.md`, `CHANGELOG.md` | Per the project's development rules. |

### `hn-session.js` public surface (isolated world)

```js
HarmonicHN = {
  harvest(document),                    // read the original HN DOM before mount
  session(),                            // { username, karma } | null  (no tokens)
  onSessionChange(listener),
  ensureItemState(itemId),              // fetch /item?id= if needed; returns vote/fave/hide state (no tokens)
  vote(itemId, how),                    // "up" | "down" | "un"
  setFavorite(itemId, favorite),
  setHidden(itemId, hidden),
  setFlagged(itemId, flagged),
  openReplyForm(parentId),              // returns an opaque handle; tokens stay inside
  postComment(handle, text),
  openEditForm(commentId), saveEdit(handle, text),
  deleteComment(commentId),
  submit({ title, url, text }),
  logout(),
}
```

Outcome type for every action:

```js
{ status: "success" | "failure" | "indeterminate" | "accountChanged" | "rateLimited" | "loginRequired",
  message: string,      // user-facing, text only, ≤ 160 chars
  detail?: string }     // text only, never includes URLs with tokens
```

---

## 7. Hacker News protocol reference

Confirm every row against logged-in captures in Phase 0. Request URLs are always built by Harmonic (SEC-14).

| Action | Token source | Request | Success signal |
| --- | --- | --- | --- |
| Session detect | Any HN page top bar | — | `#me` text = username, `#karma`, `#logout` href `auth` |
| Login | — | Navigate `/login?goto=<allowlisted path>` | HN redirects to `goto` |
| Logout | `#logout` href | `GET /logout?auth=T&goto=news` then reload | Next page has no `#me` |
| Vote | `a#up_ID` / `a#down_ID` / `a#un_ID` href `auth` | `GET /vote?id=ID&how=H&auth=T&goto=G&js=t` | Confirm from capture; re-fetch state if ambiguous |
| Voted state | Item page | — | `up_ID` has `nosee`; `unv_ID` contains `un_ID` link |
| Downvote availability | Item page | — | Presence of `a#down_ID` (karma-gated by HN) |
| Top-level comment | Item page `form[action=comment]` | `POST /comment` `parent`, `goto`, `hmac`, `text` | Redirect to `/item?id=…` |
| Reply | `GET /reply?id=CID&goto=…` form | `POST /comment` same fields | Redirect to `/item?id=…` |
| Edit | `GET /edit?id=CID` form | `POST /xedit` with form's hidden fields + `text` | Redirect to item |
| Delete | `GET /delete-confirm?id=CID&goto=…` form | `POST /xdelete` with form's hidden fields + confirm field | Redirect to `goto` |
| Favorite | Item page `fave?id&auth` link | `GET /fave?id=ID&auth=T` (`&un=t` to remove) | Re-fetch item; link shows desired state |
| Hide | Item/feed `hide?id&auth` link | `GET /hide?id=ID&auth=T&goto=G` (`&un=t`) | Re-fetch or list confirmation |
| Flag | Item `flag?id&auth` link (karma-gated) | `GET /flag?id=ID&auth=T` (`&un=t`) | Re-fetch item |
| Submit | `GET /submit` → `input[name=fnid]` | `POST /r` `fnid`, `fnop=submit-page`, `title`, `url`, `text` | Redirect to `/newest`; duplicate URL redirects to existing item |
| Poll vote | Item page `up_<pollopt id>` | Same as vote | Same as vote |
| Lists | Public / own pages | `GET /upvoted?id=me`, `/favorites?id=U`, `/submitted?id=U`, `/threads?id=U`, `/hidden` (`&comments=t` for comments) | Parse `tr.athing[id]`, `a.morelink` |

Known HN error pages to classify (text match on `document.body.textContent` after removing user-content regions, as upstream does):

- `Unknown or expired link.` → token refresh (idempotent actions only)
- `Bad login.` → `loginRequired`
- `You're posting too fast` / `Please slow down` → failure with HN's message
- `Sorry, we're not able to serve your requests this quickly.` → `rateLimited`
- `Validation required` + `g-recaptcha` → open the same page on stock HN (see Phase 3)

---

## 8. Phase plan

Every phase ends with the release checklist in [§10](#10-release-process-and-gates). Versions are proposals.

---

### Phase H — 0.7.3 Hardening of existing code

Must ship before any account feature. These issues exist in 0.7.2 and become more dangerous once a user is logged in.

**H1. Stop sending cookies from the background worker (SEC-22, SEC-23)**
1. Add `credentials: "omit"` to every `fetch` in `background.js`: `getHarmonicFontDataUrl`, `imageTint`, `getMetadata`, `fetchArticleText`, `summarizeWithOpenRouter`.
2. In `getMetadata` and `fetchArticleText`, reject HN/YC hosts with a clear error ("Hacker News pages can't be previewed/summarized").
3. Test: route a fixture on a test host with a `SameSite=None` cookie set; assert the request has no `cookie` header for preview, image, article, and font fetches.

**H2. Block local-network and unexpected targets (SEC-24)**
1. Create `url-policy.js` with `isAllowedRemoteUrl(url)` and load it in the worker via `importScripts`.
2. Apply to preview, image tint, and article fetches.
3. Switch to `redirect: "manual"`; follow up to 5 hops, re-validating each `Location`.
4. Tests: `http://127.0.0.1`, `http://localhost:8080`, `http://192.168.1.1`, `http://10.0.0.1`, `http://169.254.169.254`, `http://[::1]`, `http://0x7f000001`, `http://2130706433`, `http://router.local`, `https://example.com:8443`, and a redirect from an allowed host to `http://127.0.0.1` — all refused without a network request.

**H3. Sanitize all external URLs (SEC-41, SEC-42)**
1. Apply `safeHref` to `story.url` and `item.url` everywhere (`createStoryCard`, `renderThread`, `window.open` calls). Fallback to the HN item URL.
2. Add `safeImageSrc` — `https:` only, not the HN origin — for preview, hero, and favicon images; validate in the background before returning metadata as well.
3. Tests: fixtures with `javascript:alert(1)`, `data:text/html,…`, `vbscript:`, and an `og:image` of `https://news.ycombinator.com/collapse?id=1` → link falls back to the HN item; image is not set.

**H4. Pin and verify the font (SEC-60)**
1. Replace `main` in `HARMONIC_FONT_URL` with commit `42aae5fa3c587b4554f1e53ce6d45c267e1aec2a`.
2. Hash with `crypto.subtle.digest("SHA-256", …)`; reject mismatches; fall back to system fonts.
3. Test: routed font with altered bytes is rejected; UI still renders.

**H5. Incognito safety (SEC-51)**
1. In `content.js`, detect `chrome.extension.inIncognitoContext`; keep read state and bookmark changes in memory only; do not write page-origin settings backups from incognito.
2. Document in README.

**H6. Messaging surface (SEC-52, SEC-53, SEC-54)**
1. Add an empty `externally_connectable` to the manifest; verify Chrome loads it.
2. Add sender checks to all background handlers that write data (`HARMONIC_READ_IDS_SET`, `HARMONIC_BOOKMARKS_SET`).
3. Tests: a second test extension's `chrome.runtime.sendMessage(<harmonic id>, …)` fails.

**H7. AI output rules (SEC-44)**
1. Confirm `renderSummaryMarkdown` ignores `![…](…)`; add a test.
2. Document in README that summaries cannot trigger any action.

**Gate H:** `tests/security.mjs` passes; all existing suites pass; packaged-folder test passes.

---

### Phase 0 — Scaffolding and test infrastructure

**0.1 Capture logged-in fixtures**
1. With a real (preferably secondary) HN account, save: `/news`, `/news?p=2`, a story `/item?id=` (with own comment, other comments, a paginated large thread), `/reply?id=`, `/edit?id=`, `/delete-confirm?id=`, `/submit`, `/threads?id=`, `/upvoted?id=`, `/favorites?id=`, a poll item, plus logged-out versions.
2. Save error pages: posting too fast, unknown/expired link, rate-limited, bad login, validation-required.
3. Store raw files in `tests/fixtures/hn/raw/` (gitignored).
4. Write `scripts/redact-fixtures.mjs`: replace every 40-hex token with deterministic placeholders, `fnid` values, usernames, karma, and any email; write to `tests/fixtures/hn/`.
5. Record the observed `user` cookie attributes in this document.

**0.2 Fixture leak guard (SEC-62)**
- Test fails if any committed fixture contains a 40-hex string not in the placeholder set, an email address pattern, or the real username (provided via env at redaction time, never committed).

**0.3 `hn-session.js` skeleton**
1. Parsers: `parseTopBar`, `parseVoteLinks`, `parseItemActions` (fave/hide/flag), `parseForm(doc, action)`, `parseList`, `classifyPage`.
2. Serial HTML fetch queue (SEC-25).
3. Token cache with username tagging (SEC-10, SEC-12).
4. No UI wiring yet.

**0.4 Mount timing**
- Change startup so `mount()` runs at `DOMContentLoaded`, after `HarmonicHN.harvest(document)`, only on allowlisted routes (SEC-06). Verify no visible flash and that infinite-scroll and thread tests still pass.

**0.5 Test harness**
1. `tests/hn-parser.mjs`: load fixtures into Chromium (`page.setContent`), inject `hn-session.js`, assert parser output.
2. `tests/hn-auth.mjs`: `context.route("https://news.ycombinator.com/**", …)` serving fixtures for documents and actions; Firebase and Algolia routed to JSON fixtures; record every HN request for assertions.
3. Sanitizer hostile-HTML corpus: `onerror`, `onclick`, `javascript:` links, `<svg onload>`, `<style>`, `<iframe>`, `<form>`, `class="clicky"`, `id="logout"`, nested entities, unterminated tags.
4. `tests/hn-markup-live.mjs`: logged-out live check that `a[id^=up_]`, `form[action=comment] input[name=hmac]`, `a[href^="login?goto="]`, `tr.athing[id]` still exist.

**Gate 0:** parser tests green against fixtures; leak guard green; no user-visible change.

---

### Phase S — Site-wide search

Independent of login; may ship any time after Phase H (proposed **0.7.4**).

**S1. Search client (`hn-search.js`)**
1. Endpoints: `https://hn.algolia.com/api/v1/search` (relevance) and `/search_by_date` (newest).
2. Parameters via `URLSearchParams`: `query` (trimmed, ≤ 200 chars), `tags` (`story`, `comment`, `ask_hn`, `show_hn`, `poll`, `front_page`, `author_<name>` with name validated `^[A-Za-z0-9_-]{1,32}$`), `numericFilters` (`created_at_i`, `points`, `num_comments` with integer values only), `page`, `hitsPerPage` (≤ 50).
3. Validate response: `hits` is an array; each hit's `objectID` parses to a positive integer; numbers are numbers; strings are strings; drop malformed hits.
4. Respect `nbPages`; stop paging at Algolia's limit.

**S2. Highlight rendering (SEC-40)**
- Build highlights by tokenizing `_highlightResult.*.value` on literal `<em>`/`</em>` only; everything else is text. Comment text uses `appendSanitizedHtml`.

**S3. UI**
1. Feed toolbar search box offers "Filter loaded stories" (current behavior) and "Search all of Hacker News".
2. Search mode: filter chips (Stories, Comments, Ask, Show, Polls, Front page), date range (24 h, week, month, year, custom), minimum points, author, sort (Relevance/Newest).
3. Story hits render as Harmonic story cards; comment hits render as compact cards showing story title and comment excerpt; selecting a comment opens the thread and scrolls to the comment.
4. Debounce 300 ms, minimum 2 characters, or on Enter. Cancel stale requests with `AbortController`.
5. Optional recent searches: local only, memory only in incognito (SEC-51), clearable.

**S4. Tests**
- Mocked Algolia: query construction, paging, hostile highlights (`<img onerror>`, `<script>`), malformed hits, empty results, network error, cancellation.

**S5. Docs**
- README: what is sent to Algolia, and when.

---

### Phase 1 — Session and account UI

Proposed **0.8.0** (together with Phase 2).

1. **Session detection.** `harvest(document)` reads `#me`, `#karma`, `#logout`. Subsequent item-page fetches refresh session state. No dedicated probe requests.
2. **Account chip** in the feed toolbar.
   - Logged out: "Log in" → `/login?goto=<allowlisted path>` (SEC-02). Secondary link "Create account" → same page.
   - Logged in: menu with username, karma, *Profile*, *Threads*, *Upvoted*, *Favorites*, *Submissions*, *Log out*.
3. **Logout** per SEC-04; clear token cache and drafts (SEC-12, SEC-50).
4. **Account change handling** (SEC-35): on username change, clear caches, update UI, toast "Signed in as *B*".
5. **Explainer** in Settings → Account: how login works (HN's own page, no password stored, cookie-based), and that actions are sent directly to HN.
6. **Tests**
   - Logged-out and logged-in fixtures render the correct chip.
   - Login link `goto` matches the current route and never reflects query input.
   - No `input[type=password]` in Harmonic DOM (SEC-01).
   - After all flows: fixture tokens absent from `document.documentElement.outerHTML`, from `chrome.storage.{sync,local,session}`, from `localStorage`, from console messages (SEC-11).
   - Logout issues a `fetch` (not a navigation) and history contains no `logout?auth=`.

---

### Phase 2 — Voting

Proposed **0.8.0**.

1. **Item state loading.** When a story stays open ≥ 600 ms (or on first action intent) and the user is logged in, `ensureItemState(storyId)` fetches `/item?id=` through the queue. Parse vote state and tokens for the story and all comments on that page.
2. **Story vote** — header Upvote button becomes functional: states *not voted*, *upvoted*, *pending*; Unvote via the same button or menu.
3. **Comment actions row** (hover/focus, keyboard reachable): Reply, Upvote, Downvote (only when `down_ID` exists), Unvote/Undown, More (Share link, Copy text, Open parent, Open top level, View user). Card click-to-collapse ignores buttons (already true).
4. **Missing tokens** (paginated threads, feed cards beyond page 1): fetch `/item?id=<that id>` on demand.
5. **Optimistic UI** with rollback; points adjust ±1 optimistically.
6. **Polls**: render `parts` (Firebase `pollopt` items) under the story; vote with each option's token.
7. **Feed cards**: show voted state when known; "Upvote" in the card overflow menu.
8. **Rules applied:** SEC-30 (trusted events), SEC-32 (one in flight), SEC-33 (idempotent single retry), SEC-35 (account match), SEC-31 (no default keyboard shortcut).
9. **Tests**
   - Exact request: path `/vote`, params `id`, `how`, `auth`, `goto`, `js=t`, no others.
   - Unvote and undown.
   - Expired token → one refetch → retry; second failure → error toast, state rolled back.
   - Account switched between token fetch and click → no vote request sent; `accountChanged` shown.
   - `element.click()` from `page.evaluate` (untrusted) does not send a request.
   - Downvote button only present when fixture has `down_ID`.
   - Rate-limit fixture → queue backs off; UI offers "Open on Hacker News".

---

### Phase 3 — Commenting

Proposed **0.9.0**.

1. **Top-level composer** in the thread header ("Reply to post"), using the item page's comment form.
2. **Inline reply** under any comment: `openReplyForm(cid)` fetches `/reply?id=cid&goto=item?id=<story>`, parses the form, returns an opaque handle.
3. **Composer UX**
   - Header: "Replying as **username** to **author**" (or "to the post").
   - Auto-growing textarea, character count.
   - Formatting help (HN rules: blank-line paragraphs, `*italic*`, two-space-indented code, auto-linked URLs).
   - Live preview built with text nodes and the sanitizer (SEC-40).
   - Ctrl/Cmd+Enter submits; Esc cancels with a discard confirmation when text is present.
   - Drafts autosave per SEC-50 / SEC-51.
4. **Posting** — `postComment(handle, text)`: verify account match (SEC-35); `POST /comment`; success only on redirect to `/item`. No auto-retry (SEC-34).
5. **After success** insert a local, clearly marked comment ("Posted · may take a minute to appear"), rendered from the user's text with the safe formatter; clear the draft; refresh from Algolia later and de-duplicate by ID when it appears.
6. **Captcha / validation-required** → keep the draft, explain, offer "Open this reply on Hacker News" (stock page in an original tab).
7. **Edit / delete own comments** when HN offers the links: `/edit` → `xedit`; `/delete-confirm` → `xdelete` with confirmation (SEC-36). Parse forms generically; post back only hidden fields plus our text/confirm field.
8. **Tests**
   - Exact POST body field set for comment, reply, edit, delete.
   - 200 without redirect → `indeterminate`, draft retained, no second POST.
   - "Posting too fast" → HN's message shown, draft retained.
   - Account change before posting → no POST.
   - Draft restored after reload, cleared after success and on logout; not persisted in incognito.
   - Hostile text in the preview (`<img onerror>`, `javascript:` URL) renders inert.

---

### Phase 4 — Favorites, hide, flag

Proposed **0.10.0**.

1. **Favorite** (`setFavorite`): GET `fave` with token; re-fetch item to confirm (as upstream does).
2. **Bookmarks ↔ favorites**: keep local bookmarks; add "Add bookmarks to HN favorites" (SEC-37).
3. **Hide** from the feed card overflow and thread menu; remove card; undo toast (`un=t`).
4. **Flag** stories/comments only when HN offers the link; confirmation dialog explaining what flagging does (SEC-36).
5. **Tests:** request shapes, confirmation re-fetch, undo, flag absent when no link, bulk operation spacing/cancel.

---

### Phase 5 — Submit

Proposed **0.10.x**.

1. "New post" in the feed toolbar (logged in only) → modal: Title (≤ 80 chars), URL *or* Text, HN guideline link.
2. Validate URL with `safeHref`; trim title; show "Posting as **username**".
3. `GET /submit` → `fnid`; `POST /r` with `fnop=submit-page`.
4. Outcomes: redirect to `/newest` → success; redirect to an existing item → "Already submitted" and open it; validation-required → keep the entered values in the modal and open stock `/submit` in an original tab so the user completes it there (Harmonic never auto-fills HN's own form).
5. No auto-retry (SEC-34). Tests mirror Phase 3.

---

### Phase 6 — Profiles and account lists

Proposed **0.11.0**.

1. **User panel** from any author link: Firebase `/v0/user/<id>.json` — karma, created, `about` (sanitized), recent submissions/comments via Firebase items. Never fetch own `/user` HTML (SEC-05). "Open profile on HN" link for settings.
2. **Own lists** (logged in): Threads (reply inbox), Upvoted (stories/comments — private), Favorites, Submissions, Hidden. Parse `tr.athing[id]` and `a.morelink`; render with existing card components; paginate through the queue.
3. **Public lists** for other users: Submissions, Comments, Favorites.
4. **Tests:** list parsing incl. pagination, empty lists, about-text sanitization.

---

### Phase 7 — Harmonic reading parity (no login)

Proposed **0.12.0**; items are independent and can be split into smaller releases.

**Frontpages**
- Manage frontpages: choose default, reorder, hide.
- Additional lists: `front?day=YYYY-MM-DD`, `pool`, `active`, `bestcomments`, `launches`, `whoishiring`, `noobstories`, `classic` (parsed from public HN list pages — no cookies needed beyond normal same-origin browsing).
- Unslop feed (`https://www.unslop.news/rss.xml`) via the background worker with SEC-22/SEC-24; parse item IDs only.

**Feed filtering and display**
- Filter by domain and title keyword; hide jobs; hide read stories.
- Points "hotness" coloring; compact points; show top-level domain.
- Compact view; left-align option; resizable split ratio.
- Palette tint strength/tone/colorfulness controls.
- Favicon provider choice (Google, DuckDuckGo, direct) — privacy note in Settings.

**Comments**
- Mark new comments since last visit (local, per story, memory-only in incognito).
- Highlight comments by OP.
- Comment search within a thread.
- Collapse top-level by default; collapse parent on reply open.
- Hide `[delayed]` placeholders.
- Previous/next top-level navigation and an up button; optional keyboard navigation (`j`/`k`, read-only actions only).
- Comment dividers, scrollbar, top-level thread indicators, indicator thickness.
- Collect links in a thread into a list.
- Per-comment: copy text, open parent, open top-level, share link.
- Generated user avatars (deterministic, local).
- User tags and blocked users (local, exportable).
- Comments provider choice (Algolia or Firebase).

**Links and data**
- Rich link previews for GitHub, arXiv, Wikipedia, Reddit, Stack Exchange, Bluesky, Mastodon, Hugging Face, Substack, npm, PyPI — public APIs only, background worker with SEC-22/SEC-24, strict JSON validation, text-only rendering.
- "View on archive" action; optional Nitter redirect for X/Twitter links.
- Bookmark import/export (JSON; integers only, size cap, schema validation on import).

**Appearance**
- Additional themes beyond AMOLED; font choice; changelog dialog after updates.

---

### Phase 8 — Optional extras

1. **Reply notifications**: `optional_permissions: ["alarms", "notifications"]`, requested only when the user enables the feature. Background polls public `/threads?id=<user>` or Firebase with `credentials: "omit"`; stores only the last-seen item ID; never touches HN tokens.
2. **Collapse sync**: send `collapse?id=…` like `hn.js` when logged in (opt-in).
3. **Keyboard shortcuts for actions** (opt-in, clearly listed, still SEC-30-compliant via trusted key events).

---

## 9. Testing strategy

| Suite | Script | Network | Covers |
| --- | --- | --- | --- |
| Existing e2e | `npm run test:e2e` | Live HN (read-only) | Feed, thread, settings, AI, original tabs |
| Reload | `npm run test:reload` | Live | Settings persistence |
| AI worker | `npm run test:ai` | Mocked | OpenRouter pipeline |
| Security | `npm run test:security` | Mocked | SEC-22/23/24/41/42/43/44/53, cookie headers, SSRF list, hostile HTML |
| Parser | `npm run test:hn-parser` | Fixtures | Token/state/form parsing, error classification |
| Account e2e | `npm run test:hn-auth` | Fully mocked HN | Phases 1–6 flows, SEC-01/04/11/30/32–37 |
| Search | `npm run test:search` | Mocked Algolia | Phase S |
| Markup drift | `npm run test:hn-markup` | Live, logged out | Selectors still exist |

### Mandatory assertions in `test:hn-auth`

- No placeholder token string appears in: page HTML, any `chrome.storage` area, `localStorage`, `sessionStorage`, console messages, history entries, or toast text.
- No `input[type=password]` in Harmonic DOM.
- Untrusted `.click()` produces zero mutating requests.
- Account switch mid-flow produces zero mutating requests.
- Every mutating request matches the exact expected method, path, and parameter set.
- Comment/submit never issues a second POST after an indeterminate response.

### Manual verification (each release with account features)

Use a secondary HN account; do not post in active discussions.

1. Log in through the chip; confirm HN's own login page and URL bar.
2. Upvote and unvote a story; confirm on stock HN in an original tab.
3. Reply to your own comment in an old test thread; edit; delete.
4. Favorite and unfavorite; hide and unhide.
5. Switch accounts in another tab; confirm Harmonic refuses the next action.
6. Log out from the chip; confirm `/news` shows "login".
7. Repeat steps 1–2 in incognito; confirm nothing persists after closing the window.

---

## 10. Release process and gates

Per the README's development rules, for every phase:

1. Update tests for changed behavior.
2. Update `README.md` (behavior, storage, permissions, data handling, architecture).
3. Add notes under `[Unreleased]` in `CHANGELOG.md`; move them into the numbered section on version bump. Use the **Security** heading for SEC changes.
4. Run all source-tree suites.
5. `npm run package`.
6. Run `test:e2e`, `test:security`, and `test:hn-auth` against `dist/harmonic-hn-browser`.
7. Inspect `git diff` and `git status`; confirm no raw fixtures, traces, HARs, or screenshots are staged.

### Security gate (must pass before merging any account phase)

- [ ] SEC-01 no password inputs
- [ ] SEC-11 no token leakage (automated)
- [ ] SEC-22 background requests carry no cookies (automated)
- [ ] SEC-30 untrusted events ignored (automated)
- [ ] SEC-34 no auto-retry for posts (automated)
- [ ] SEC-35 account switch aborts (automated)
- [ ] SEC-43 no `hn.js`-reserved names in Harmonic DOM (automated)
- [ ] Fixture leak guard green
- [ ] Manual verification checklist completed
- [ ] README data-handling section updated

### Version map (proposed)

| Version | Contents |
| --- | --- |
| 0.7.3 | Phase H hardening |
| 0.7.4 | Phase S search (Phase 0 scaffolding lands alongside, no UI) |
| 0.8.0 | Phases 1–2: session, account chip, voting, polls |
| 0.9.0 | Phase 3: commenting, replies, edit/delete, drafts |
| 0.10.0 | Phases 4–5: favorites, hide, flag, submit |
| 0.11.0 | Phase 6: profiles and lists |
| 0.12.x | Phase 7 parity features (may split) |
| 0.13.0 | Phase 8 optional extras |

---

## 11. Harmonic feature inventory

Derived from upstream settings keys, UI strings, and network code.

### Already shipped (0.7.2)

Top/New/Best/Ask/Show/Jobs feeds; preview images; image tint; favicons; points; comment count; story index; dim read stories; story and comment text size; content zoom; comment styles; depth indicators (colors, rounded, continuous); comment sorting; header tint and image; card-click behavior; always open comments; local bookmarks; OpenRouter summaries.

### Planned without login

Site-wide search (Phase S); manage frontpages and extra lists; Unslop feed; domain/title filters; hide jobs; hide read; hotness/compact points; top-level domain; compact view; split ratio; tint tuning; favicon provider; mark new comments; OP highlight; comment search; collapse defaults; hide delayed; top-level navigation and up button; dividers/scrollbar; collect links; per-comment copy/parent/top-level/share; generated avatars; user tags; blocked users; comments provider; rich link previews; archive link; Nitter redirect; bookmark import/export; themes; font choice; changelog dialog.

### Planned with login

Vote up/down/unvote; polls; comment, reply, edit, delete; drafts; HN favorites and bookmarks-to-favorites; hide; flag; submit; profile panel; threads/replies inbox; upvoted; favorites; submissions; hidden; reply notifications (optional permissions); collapse sync.

### Possible but not recommended

- **In-pane reader mode / web view.** Renders arbitrary article HTML inside the logged-in HN origin — a large script-injection surface. If built, it must be a separate extension page in its own tab, never on HN.
- **"Ask" follow-up AI chat.** Acceptable only on an extension page, with no access to HN actions or the composer.

### Not applicable to a browser extension

Home-screen widgets; built-in web view and its ad blocking; volume-key navigation; status-bar/nighttime options; battery-based preloading; external browser selection; on-device AI runtime.

---

## 12. Out of scope

- An in-extension username/password dialog or any credential storage for HN.
- Custom captcha handling (HN's stock pages handle it).
- Account creation, password reset, email/profile/settings changes.
- Automated or bulk voting, AI-written comments, scheduled posting.
- Any project-owned backend or analytics.

---

## 13. Residual risks

| Risk | Mitigation | Remaining exposure |
| --- | --- | --- |
| Script injection on the HN origin (ours or HN's) can act as the user | Allowlist sanitizer, SEC-40–43, hostile-HTML corpus | HN's CSP allows inline scripts; a sanitizer bug is high impact |
| Other extensions with HN access | None possible | Can perform the same actions independently |
| DNS rebinding against the background URL policy | Literal-IP and hostname blocking | A public hostname resolving to a private IP is not detectable from an extension |
| HN markup changes | Live drift test, generic form parsing, graceful "Open on HN" fallback | Features degrade until parsers are updated |
| HN rate limiting | Serial queue, spacing, back-off, lazy fetches | Heavy use may hit limits; fallback to stock HN |
| OpenRouter key on disk (persistent mode) | Session-only mode available; documented | Local profile access reveals the key |
| HN cookie flags unknown | Design does not read or depend on them | Determined after Phase 0 capture |
| Third-party data (Algolia, Firebase) | URL and HTML sanitization, schema validation | Wrong/misleading content can still be displayed as text |

---

## 14. Inputs needed before account work

1. Logged-in HTML captures from a secondary HN account (list in Phase 0.1), saved locally — they are redacted before anything is committed.
2. Confirmation of the proposed version map, or a preferred grouping.
3. Decision on whether Phase 8 reply notifications are wanted (adds optional permissions).
