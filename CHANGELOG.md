# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet.

## [0.7.4] - 2026-10-10

### Added

- **Site-wide search (All of Hacker News).** The toolbar search box now offers two modes: **Loaded stories** (the original filter) and **All of Hacker News**, which searches the entire corpus through the public Algolia HN API (`/search` for relevance, `/search_by_date` for newest).
- **Search filters.** Content-type chips (Stories, Comments, Ask, Show, Polls, Front page), a date-range picker (24 hours/week/month/year), a minimum-points field, an author filter, and relevance/newest sorting. Filters translate into validated `tags` and integer-only `numericFilters` (`created_at_i`, `points`); an invalid author name is skipped with an on-page hint rather than sent.
- **Safe result rendering.** Story hits render as regular Harmonic story cards; comment hits render as compact cards with the story title and a highlighted excerpt. Highlight fragments are tokenized on literal `<em>`/`</em>` only (SEC-40) — hostile markup such as `<img onerror=…>` or `<script>` in a highlight renders as inert text and is never parsed as HTML.
- **Comment deep links.** Opening a comment hit loads the discussion and scrolls that comment into view with a brief flash highlight.
- **Paging and request hygiene.** Results page through "Load more" up to Algolia's `nbPages` limit with `hitsPerPage` capped at 50; queries are trimmed and capped at 200 characters; typing cancels stale in-flight requests with `AbortController` (300 ms debounce, minimum two characters, Enter for immediate search).
- **Recent searches, memory only.** The last eight searches are offered as one-click suggestions and a clear button. They are never persisted to any storage — including in normal windows — so nothing search-related can leak through sync or disk (SEC-51).
- **`hn-search.js` — the search client.** Query construction with a strict tag allowlist (`story`, `comment`, `ask_hn`, `show_hn`, `poll`, `front_page`, `author_<name>` with `^[A-Za-z0-9_-]{1,32}$` names), integer-only numeric filters, hit validation that drops malformed hits (bad `objectID`, wrong-typed numbers/strings, comments without a numeric thread id), and `nbPages`-aware paging. Requests are cookie-less GETs to the public API.
- **`hn-session.js` — the Hacker News session and account-action client.** A new content-script module that runs in the isolated world and implements the plan's Hacker News protocol rules: top-bar session parsing (username, karma, logout), vote-link parsing (`up_`/`down_`/`un_` anchors with direction from the arrow title), favorite/hide/flag link parsing with active-state detection, comment/reply/edit/delete/submit form harvesting, and list parsing with more-link resolution. All actions return structured outcomes (`success`, `failure`, `indeterminate`, `accountChanged`, `rateLimited`, `loginRequired`, `validationRequired`) instead of throwing.
- **A serial, rate-limit-aware HN fetch queue** (SEC-25). Every `news.ycombinator.com` HTML fetch runs through one queue with at least 750 ms spacing and exponential back-off (2 s/4 s/8 s) when HN rate-limits or returns 503; GETs retry up to four times, while POSTs are never retried (SEC-34).
- **A username-tagged token cache** (SEC-12). Vote, favorite, hide, flag, and logout tokens are cached only under the username that was signed in when the page was served; the cache and all form handles are dropped whenever the signed-in account changes or the page unloads (SEC-10/11). Tokens never leave the module closure.
- **Hacker News error-page classification.** Pages are classified as expired-link, bad-login, too-fast, rate-limited, validation-required, login, blank, or OK — using only page-chrome regions, with user-contributed comment and story text stripped first so comment contents cannot spoof an error (the same trick upstream Harmonic uses).
- **Token-based mutations with exactly one fresh-token retry** (SEC-33) and **one in-flight mutation per item** (SEC-32). Stale cached tokens (older than 60 s) are re-verified against a fresh page fetch before use, so an account switch in another tab can never mutate under the old identity (SEC-35). Blank or unreadable responses are `indeterminate` and can never clear the session or count as success.
- **Fetch-based logout** (SEC-04): `HarmonicHN.logout()` POSTs nothing and never navigates; the `logout?auth=…` URL never enters the address bar or history.
- **Reply, edit, delete, and submit form handles.** Forms are fetched through the queue, validated (40-hex `hmac`, `fnid` shape), tagged with the acting username, and POSTed exactly once with `URLSearchParams`-built bodies (SEC-14/20).
- **Fixture pipeline for offline, credential-free testing.** `scripts/capture-fixtures.mjs` saves real logged-out Hacker News pages, `scripts/redact-fixtures.mjs` redacts every live auth token and email into deterministic placeholders (with a leak guard that fails on any live-looking 40-hex token or personal email), and `scripts/build-synthetic-fixtures.mjs` derives logged-in synthetic documents (feed, item with vote/favorite/flag state, reply/edit/delete/submit forms, and all error pages) from them. Raw captures stay out of git.
- **`tests/hn-parser.mjs`** — 12 tests that run the real extension in Chromium against the fixtures and verify session harvest rules (no session or tokens when logged out; correct session when signed in), all parsers, error classification, comment-spoof protection, redaction determinism, and the fixture leak guard.
- **`tests/hn-auth.mjs`** — a fully mocked logged-in end-to-end suite (14 tests). A routed Chromium session serves the fixtures for `news.ycombinator.com` and records every request, then drives `HarmonicHN` inside the content script's isolated world: exact vote/favorite/hide/logout/comment request shapes (method, path, every parameter), expired-token retry counting, rate-limit backoff outcomes, logged-out refusal with zero mutating requests, stale-token account-switch aborts with zero vote requests, concurrent-duplicate refusal, fetch-based logout, single-POST reply flow, and token-leakage checks across the rendered UI, page storage, extension storage, and the console.
- **`tests/search.mjs`** — the site-wide search suite (21 tests): unit tests for query construction, tag/numeric-filter validation, hit validation, and SEC-40 highlight tokenization, plus mocked-Algolia browser tests for rendering, filters, paging, hostile highlights, malformed-hit dropping, empty and error states with retry, request cancellation, comment-hit deep links, and memory-only recent searches.

### Changed

- The content script now harvests the session (and the logout token) from the live document before mounting, so the account state is ready before any account UI is shown.
- `npm run test:hn-parser`, `npm run test:hn-auth`, and `npm run test:search` run the new suites.

### Fixed

- The logout token was cached under a different key than it was read from, so `HarmonicHN.logout()` silently skipped the network request and cleared the session locally only. The keys now match and the logout request is sent exactly once with the page's `auth` token (covered by `tests/hn-auth.mjs`).

## [0.7.3] - 2026-10-10

### Security

- **Background requests no longer send cookies** (SEC-22). Every fetch in the background service worker — preview metadata, image tinting, article extraction, the Harmonic font, and OpenRouter — now uses `credentials: "omit"`.
- **Hacker News pages are refused for previews and summaries** (SEC-23). The background worker no longer fetches `news.ycombinator.com` or `ycombinator.com` for metadata, image tinting, or article extraction.
- **A shared URL policy guards every remote background fetch** (SEC-24). New `url-policy.js` allows only public `http:`/`https:` URLs on default ports and blocks localhost, `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, IPv4 loopback/private/link-local/CGNAT/benchmark/multicast ranges, IPv6 loopback/ULA/link-local/Teredo/6to4, and decimal/hex/octal literal-IP spellings such as `2130706433`, `0x7f000001`, and `0177.0.0.1`. Redirects are followed hop by hop with a five-hop cap and every hop target is re-validated before use.
- **All external links pass through `safeHref`** (SEC-41). Story and discussion article links, preview links, and `window.open` calls fall back to the Hacker News item page for `javascript:`, `data:`, and other unsafe URLs.
- **Image sources are validated** (SEC-42). Preview, hero, and favicon images must be `https:` and must never point at the Hacker News origin; the background metadata worker applies the same rule before returning results.
- **The runtime font is pinned and hash-verified** (SEC-60). The Google Sans Flex Rounded font is fetched from the pinned upstream commit `42aae5fa3c587b4554f1e53ce6d45c267e1aec2a` and its SHA-256 digest is verified before use; any mismatch falls back to system fonts.
- **Incognito keeps activity in memory** (SEC-51). Read state, bookmarks, and page-origin settings backups are no longer written to extension or page storage while browsing in an incognito window.
- **Message senders are verified** (SEC-52). Background handlers that read or write user data (read state, bookmarks, previews, font) require the extension's own top-frame content script on `https://news.ycombinator.com`.
- **The extension can no longer be messaged by other origins** (SEC-53). The manifest declares an empty `externally_connectable`, so websites and other extensions cannot call the extension.
- **AI summaries cannot render Markdown images** (SEC-44). Image syntax in generated summaries is demoted to plain text, so a prompt-injected summary can never make the browser fetch a remote image.
- Added `tests/security.mjs`, a Chromium regression suite covering the cookie-omission, SSRF-policy, sanitizer, image, messaging, and AI-output rules above.

### Changed

- The content script now loads `url-policy.js` before the main renderer so the URL rules are shared across contexts.
- Background preview responses include an explicit `refused` flag so the UI can explain why a Hacker News link cannot be previewed or summarized.

## [0.7.2] - 2026-10-07

### Changed

- Compacted the discussion story header with a shorter preview image, smaller title, tighter spacing, and 44px action buttons so more comments fit onscreen.

## [0.7.1] - 2026-10-07

### Added

- Cancel an in-progress summary with the same Story tools button, and reset the system prompt to Harmonic's default in Settings.
- Added worker and browser coverage for cancellation, story switching, provider errors, automatic summaries, missing keys, credential storage modes, malformed article responses, and fragmented SSE data.
- Added an optional live OpenRouter browser check using a session-only test credential.

### Fixed

- Cancelled summaries no longer leave Story tools stuck in a loading state when returning to a discussion.
- Disconnected summary workers now show a retryable error, and stale requests cannot update a newer summary.
- Streaming accepts CRLF event separators split across network chunks and bounds response sizes. Requests time out after two minutes.
- Credential changes are accepted only from the extension-owned API-key settings page.

## [0.7.0] - 2026-10-07

### Added

- Added one-click OpenRouter article summarization to the existing **Story tools** action, with no intermediate tools menu.
- Added streamed Harmonic-style summary cards in the discussion header and one-click regeneration after a successful summary.
- Added OpenRouter AI settings for enable/disable, model selection, the upstream Harmonic system prompt, streaming, and optional automatic summaries. The default model is `openrouter/free`.
- Added an extension-owned API-key settings page with persistent profile-local and session-only storage modes.
- Added regression coverage for OpenRouter request payloads, SSE streaming, the 15,000-character article budget, private credential storage, and summary rendering.

### Changed

- Article extraction and OpenRouter requests now run in the Manifest V3 background worker, while streaming progress is delivered to the Hacker News UI over a long-lived extension port.
- `chrome.storage.local` and `chrome.storage.session` are restricted to trusted extension contexts; read-state and bookmark access from the content script now goes through the background worker.
- Release packaging now includes the AI credential settings page.

### Security

- OpenRouter API keys are kept out of Chrome Sync, Hacker News origin storage, page DOM, URLs, and normal synced settings. Session-only mode avoids persistent key storage entirely.

## [0.6.0] - 2026-10-07

### Added

- Added a Chrome browser-action popup with an **Enable Harmonic** switch so the Harmonic UI can be disabled and re-enabled without disabling the extension in `chrome://extensions`.
- Added popup shortcuts for opening Harmonic settings and opening an untouched Hacker News tab.
- Added a per-tab original-Hacker-News mode managed by the background worker. Tabs opened through **Open original Hacker News** remain unmodified while navigating within Hacker News until the tab is closed or explicitly switched back to Harmonic.
- Added **Disable Harmonic** to the feed and discussion overflow menus.
- Added the Harmonic launcher artwork as the extension/browser-action icon at 16, 32, 48, and 128 pixel sizes.
- Added settings migration from the pre-0.6.0 `chrome.storage.local` format into `chrome.storage.sync`.
- Added a Hacker News origin backup for the settings object and enabled/disabled preference so local unpacked builds can recover preferences if a development update is loaded under a different extension ID.
- Added regression coverage for original-Hacker-News tabs, preference persistence, disabling the UI, and re-enabling through the extension popup.

### Changed

- Settings now use `chrome.storage.sync` as their primary extension store instead of `chrome.storage.local`.
- The release package now uses a stable unpacked folder name, `dist/harmonic-hn-browser/`, while keeping the zip filename versioned. This reduces accidental extension-ID churn during local updates.
- The content stylesheet is scoped to `html.harmonic-hn` so installing or disabling Harmonic does not leak its dark color-scheme styling into untouched Hacker News.
- **Open on Hacker News** in the discussion menu now uses the same original-tab mechanism as the feed overflow menu.
- Updated release packaging to include the popup, icon assets, changelog, README, and license.
- Expanded the README with detailed installation, update, persistence, permissions, popup, original-tab, packaging, testing, and data-handling documentation.

### Fixed

- Replaced the malformed refresh SVG path that rendered as a broken/partial shape in the feed toolbar.
- Fixed **Open original Hacker News** opening another Harmonic-rendered page instead of stock Hacker News.
- Fixed settings appearing to reset after extension reload/update workflows that changed the unpacked extension storage namespace.

## [0.5.0] - 2026-06-08

### Added

- Harmonic-style desktop feed and two-pane discussion reader.
- Top, New, Best, Ask, Show, and Jobs feed support.
- Story preview metadata, favicons, image-derived card tinting, and lazy feed loading.
- Nested comments with colored depth rails, collapse/expand behavior, sorting, and quote normalization.
- Harmonic-inspired settings for feed, comments, typography, zoom, and behavior.
- Chromium end-to-end regression tests and release packaging.

### Changed

- Refined laptop-scale spacing, typography, story-card behavior, and discussion layout for closer Harmonic fidelity.

### Fixed

- Feed and discussion scrolling regressions.
- Story-card clipping and inconsistent card gaps.
- External article/tab interactions and card-click behavior.
