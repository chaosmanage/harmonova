## v0.13.10 — Google Sans Flex Rounded default font

- Made Google's official **Google Sans Flex Rounded** the default for new installations, while retaining System UI and Serif as options.
- Bundled variable upright and italic font files locally, together with their SIL Open Font License 1.1; no remote font service is needed.
- Preserved saved font preferences and updated packaging and documentation.

## v0.13.9 — Supplied artwork and refreshed documentation

- Replaced hand-drawn logo SVGs and extension icons with raster artwork derived from the supplied HarmoNova monogram image.
- Updated README branding to the supplied cream banner, and moved the Chrome installation guide above the background story.
- Refreshed extension screenshots against the latest build and repackaged the Chrome extension.

## v0.13.8 — HarmoNova rebrand

- Renamed the independent browser extension to **HarmoNova for Hacker News**.
- Replaced the upstream launcher icon with an original minimal flat icon and README wordmark.
- Removed the runtime download of the upstream rounded font and defaulted to system UI typography.
- Renamed the GitHub project, release folder, package, documentation and public-facing UI strings.
- Preserved attribution to Simon Halvdansson and the original [Harmonic Android project](https://github.com/SimonHalvdansson/Harmonic-HN).

> Earlier changelog entries describe past releases and may refer to the original project branding.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Nothing yet.

## [0.13.7] - 2026-10-11

### Documentation
- Replaced the long README with a simpler first-person introduction: why I enjoy HarmoNova Android, why ordinary desktop HN felt less intuitive to me, the Android emulator experiment, and why I chose a Chrome extension.
- Added clear no-build installation instructions and a screenshot showing Chrome's Developer mode and Load unpacked controls.
- Added authentic screenshots of feed options, site-wide search, appearance, story settings, and AI settings, plus a clearly labeled mocked AI summary preview.
- Organized feature, troubleshooting, privacy, architecture, and contributor documentation, kept prominent credit to Simon Halvdansson, and removed obsolete plans.
- Kept this project under Apache License 2.0, matching the upstream Harmonic Android project. Expanded release packages to include the guides and screenshots.

### Tests
- Updated the browser security test to select the distinct Article summary button after the Article/Discussion toolbar split.

## [0.13.6] - 2026-10-11

### Changed
- **Comment Edit/Delete temporarily handed off to Hacker News.** Both actions on an eligible own comment now explain that HarmoNova editing/deletion is unavailable. After explicitly choosing Continue on Hacker News, open the corresponding stock `/edit?id=` or `/delete-confirm?id=` page in an original-HN tab. Cancel never navigates and HarmoNova sends no edit/delete POSTs.

### Tested
- Chromium verifies both menu handoffs, cancellation, correct native form URLs, original-HN tab bypass, and that no edit/delete mutation requests occur.


## [0.13.5] - 2026-10-11

### Fixed
- **Deleting comments:** Accept HN's one-use `r`/`fnid`/`fnop` confirmation forms as well as older `xdelete` forms, while requiring a valid authorization token and enforcing any explicit comment ID. Read back the comment's permalink and thread up to three times, only confirming deletion when HN visibly marks it deleted.
- **Editing comments:** Check the individual comment permalink first when the parent thread is paginated or the edit response is stale. Never retry mutation requests automatically.
- **Action recovery:** Preserve ambiguous results and offer a direct link to the original HN comment so users can check the result before retrying.

### Tested
- Added browser-mocked token-based delete confirmation, mismatched-ID rejection, delayed delete confirmation, and unconfirmed deletion safety cases. Existing edit and delete interaction tests remain covered.

## [0.13.4] - 2026-10-11

### Fixed
- **Editing comments:** Accept both authenticated legacy xedit/hmac and token-based r/fnid forms. Verify the acting account and any explicitly supplied comment ID, retain drafts on ambiguous results, and perform bounded, read-only refreshes to confirm the edited text.
- **Submitting stories:** Verify the acting account and snapshot submitted IDs before requesting the ephemeral /submit form, then POST with its fresh fnid. Preserve drafts on unsuccessful or filtered submissions and provide explicit links to HN's submit form and submitted history.
- **Verification UI:** Explain ambiguous submissions and expired HN forms more clearly, and provide a direct HN handoff when edit forms cannot be read.

### Tested
- Added mocked modern edit form support and mismatched-ID rejection, fresh submit-token request-order checks, and refreshed browser checks for unconfirmed native-HN submission handoffs.

## [0.13.3] - 2026-10-11

### Fixed
- **Hacker News comment and post submission:** Send `URLSearchParams` as the native `fetch` request body, so the browser sets `application/x-www-form-urlencoded;charset=UTF-8`. The previous serialized-string body was sent as `text/plain`, causing HN to receive unparseable form fields and leave posts unconfirmed.
- **Thread action bar:** Replace the redundant profile and comment-jump buttons with a direct reply action, preserve Upvote, move Bookmark into More alongside Favorite, and remove Share. Present Article and Discussion AI summaries as a compact labeled pair with independent loading, cancellation, regeneration, and source-specific states, including discussion-only stories.

### Tested
- The mocked Hacker News server now rejects a POST with the wrong form content type, and Chromium tests assert the correct outgoing header for comments and new story submissions. Browser checks cover direct reply, bookmark in More, dedicated summary source actions, and source switching.

## [0.13.2] - 2026-10-11

### Fixed
- **Comment confirmation:** Read back a newly posted comment on its actual HN item page up to three times when the POST result is stale or ambiguous. Never resend a comment POST, and preserve drafts when no confirmation appears.
- **Story submission:** Snapshot the user's submitted story IDs before posting; verify new entries by exact title and URL where applicable. Handle HN's nonstandard POST replies without mistaking older same-title posts for new submissions. Keep unverified drafts.
- **403 article summaries:** Explain when article sites deny automatic reading. Offer a user-initiated, explicitly labeled *discussion summary* using public HN comments, without bypassing the site's access controls or claiming to have summarized the article.

### Tested
- Added mocked successful and unconfirmed posting cases, HTTP 403 and discussion-mode summary tests, and refreshed Chromium comment-confirmation coverage.

## [0.13.1] - 2026-10-11

### Fixed
- **Context menus:** Keep comment and story right-click actions compact, viewport-bounded, scrollable, and readable even for very long comment excerpts; tint icons subtly to match the HarmoNova themes.
- **HN account actions:** Do not mistake partial HN navigation bars or submit-only login gates for an actual sign-out. Verify the active account before issuing submission forms, preserve draft contents, and offer an original-HN handoff when submission requires verification.
- **Hide jobs:** Honor the setting in every feed, correctly hide grid-layout cards, and detect YC hiring announcements that the HN API classifies as regular stories.
- **AI summaries:** Explain empty or filtered model responses using provider finish reasons, increase the output budget, and retry a reasoning-only empty stream once without streaming.

### Tested
- Added mock HN session/favorite/submit regression cases, AI streaming recovery coverage, and Chromium popup/job-visibility checks.

## [0.13.0] - 2026-10-11

### Fixed
- **HN vote protocol:** Accept successful empty `js=t` responses, parse `unv_ID` and `undown` correctly, keep per-item vote tokens for 30 minutes, confirm ambiguous votes via a read-only item fetch, and preserve already-voted feed/thread states.
- **Comment integrity:** Preload real HN reply forms; post once; find the submitted comment in the redirected item document before clearing the draft; insert confirmed replies immediately; keep edits and deletes locally while Algolia catches up. Ambiguous results retain drafts and never claim success.
- **Search:** Classify Algolia results by `_tags`, decode highlights in an inert document, use a local filter until Enter triggers a site-wide search, support keyboard navigation, prevent duplicate preview storms, and restore feed scroll position.
- **HarmoNova reading interface:** Restore compact toolbar and seven thread actions, contextual story/comment menus, avatars and hotness colors off by default, categorized settings, floating comment navigation, account side sheet, and safe SVG click propagation.

### Added
- Sanitized headed-browser HN capture workflow (`scripts/capture-hn-fixtures.mjs`); credentials are never entered by this script or written into fixtures.
- Realistic synthetic `unv_ID` markup, blank vote-response tests, delayed-index comment regression coverage, and Chromium regression suite (`npm run test:fix-regressions`).

### Verification notes
- Authenticated tests run in Chromium against local HN and Algolia mocks. A live sign-in smoke test from this VPS hit Hacker News's "Validation required" anti-automation page, so a browser test using a permitted interactive session is still required before claiming live-account verification.
- The optional structural split of `content.js` (fix plan F6) is deferred to a separate no-behavior-change change.

## [0.12.2] - 2026-10-10

The links-and-appearance release, part three of Phase 7: HarmoNova now makes offsite links smarter and the reading surface yours. GitHub repositories, Wikipedia articles, and arXiv papers get rich inline previews fetched directly from their public APIs; every external story link can redirect to a Nitter instance for a lighter Twitter/X experience; every story offers a one-click "View on archive" shortcut through the Wayback Machine; and the whole UI follows three new themes (AMOLED black, charcoal, deep navy) plus a choice of font stack.

### Added

- **Rich link previews.** Story and discussion pages render a compact preview box for three providers, with a provider chip, title, and up to four lines of plain text:
  - **GitHub:** `owner/repo` pages show stars, forks, open issues, primary language, and license via `api.github.com`.
  - **Wikipedia:** any language edition's article shows its lead summary via the REST summary API (disambiguation pages are skipped).
  - **arXiv:** `abs`/`pdf` links show authors, abstract, and publication date via the export API.
  Previews are fetched from the background worker only (the page never touches these hosts), capped at 256 KB per response, text-sanitized like everything else, and cached in the metadata cache so repeat visits are instant. A Settings toggle (Links section) turns them off.
- **View on archive.** The card menu and the thread's More menu gain a "View on archive" entry that opens `web.archive.org/web/2/<url>` — the Wayback Machine's "closest capture to now" form — in a new tab, for stories whose pages have vanished or paywalled.
- **Nitter redirect (opt-in).** A Links-section toggle rewrites Twitter/X and t.co links (story links, in-text anchors) to a configurable Nitter instance; the default is `nitter.net`, and any custom instance is validated (hostname form, 3–80 chars) with a toast if invalid — falling back to the default rather than breaking links.
- **Themes.** The Appearance section adds three themes alongside the default AMOLED black: **Charcoal** (soft dark gray surfaces) and **Deep navy** (blue-tinted dark), applied via `data-theme` with palettes for every surface token.
- **Font choice.** Appearance also adds a font selector — HarmoNova's custom stack, System UI, or Serif — wired through a `--harmonic-font-stack` variable used by the reader surface.

### Changed

- Story, thread, and in-text external anchors are set through a single helper that applies the Nitter rewrite consistently (and records the original URL in `data-raw-href`).
- The metadata cache now stores rich-preview payloads alongside titles/summaries; requests that ask for rich data but hit a cache entry without one trigger a background refresh so toggling the feature on fills previews without stale gaps.

### Tests

- **`tests/links.mjs` — the 0.12.2 suite (14 tests),** `npm run test:links`: GitHub/Wikipedia/arXiv preview rendering from mocked provider APIs with provider chips and count limits; the 262 KB response cap; preview cache reuse and refetch when the toggle turns on; Nitter rewriting of story links and in-text anchors with a valid custom instance; invalid-instance fallback to `nitter.net`; "View on archive" from the card menu and thread menu; theme and font application through `data-theme`/`data-font`; and the new Links/Appearance settings sections. Provider mocks are installed once and dispatched through mutable fixtures so per-test hit counters stay honest.

## [0.12.1] - 2026-10-10

The comment-parity release, part two: HarmoNova now understands who you're reading — the thread author gets an OP badge, every commenter gets a deterministic local avatar, comments posted since your last visit are highlighted, HN's `[delayed]` placeholders can be hidden, long discussions gain an in-thread filter and top-level navigation, and you can tag or block any commenter. Your tags, blocks, bookmarks, and read history can be exported and re-imported as a portable JSON file.

### Added

- **OP badges.** The story author's own comments are marked with a row class and an "OP" badge, so scanning a long discussion instantly shows which comments come from the person who asked or posted.
- **Deterministic comment avatars.** Every commenter gets a small local avatar: a colored disc tinted by a hash of the username with the first letter on top. No requests, no tracking — the same name always produces the same avatar. A Settings toggle turns them off.
- **New-comment highlighting.** When you open a discussion, comments newer than your previous visit are highlighted with a subtle marker and a "new" badge; after roughly four seconds the visit is recorded and the highlights are gone the next time you open the thread. The visit bookkeeping never writes in incognito windows.
- **`[delayed]` handling.** HN's `[delayed]` placeholder comments are collapsed by default (matching the web experience), with a Settings toggle to show them.
- **In-thread comment filter.** The comments heading gains a search box with a live "N of M match" counter. Filtering keeps any top-level branch with a match (including all of its descendants) and hides the rest, so context is never lost. Clearing the box restores everything.
- **Top-level navigation.** The comments heading also gains ↑ Top / ‹ Prev / Next › buttons that jump between top-level comments, scrolling the target into view with a brief flash so you can see where you landed.
- **User tags.** "Set user tag" in a comment's More menu attaches a private note (up to 40 characters) to any username; tagged authors show a small chip next to their name in every thread. Tags are edited from the same menu.
- **User blocking.** "Block user" hides that person's comments in every thread behind a one-line note with an Unblock button; the block is per-profile, invisible to Hacker News, and reversible both from the note and the comment menu.
- **User-data export/import.** Settings gains a user-data section: Export downloads `harmonic-user-data.json` (schema version 1: bookmarks capped at 2000, read-story ids at 1500, user tags and blocked users at 500 each); Import accepts a previously exported file with strict validation — 256 KB cap, JSON parse, exact schema version, integers-only id lists (no string coercion), `^[A-Za-z0-9_-]{1,32}$` usernames, tags ≤ 40 chars — and merges (never replaces) on success. Every refusal says exactly which rule failed. Nothing is synced to Hacker News or any server.

### Changed

- The comments heading (comment count, filter, navigation) is now rendered as part of the thread pane; the settings Comments section and a new user-data section were added to the settings panel.
- Toggling a comment-affecting setting (new markers, `[delayed]`, avatars) re-renders the open thread immediately instead of waiting for the next visit.

### Tests

- **`tests/comment-parity.mjs` — the 0.12.1 UI suite (10 tests),** `npm run test:comment-parity`: OP badge presence and absence; deterministic avatars; the new-comment marker lifecycle (seeded seen-times → marker → auto-clear → gone after reload); the `[delayed]` toggle; branch-keeping filter with match count; prev/next navigation flashing the first top-level comment; tag set + render + reload persistence; block → note → unblock round-trip; export file schema; and import merge semantics (bookmarks in `chrome.storage.local` asserted through the worker) plus a bad-schema refusal that changes nothing. The suite wipes shared `localStorage` keys once per page so tests never leak into each other.

## [0.12.0] - 2026-10-10

The reading-parity release, part one: every public Hacker News list becomes a feed — plus frontpage management, real feed filtering, and smarter score display — all without login.

### Added

- **Parity lists as feeds.** The feed menu gains Pool, Active Discussions, Best Comments, Launch HN, Who is Hiring, Newcomer Stories, Classic, and Past Frontpages. Lists without Firebase endpoints are parsed from public Hacker News list pages through the rate-limited queue (`fetchListFeedIds`, two pages, deduped; SEC-05 allowlist still applies). Best Comments renders the threads-style comment rows with story context (Algolia), and a row click opens its discussion.
- **Past Frontpages with a date picker.** The front feed shows a date input in the toolbar (defaulted to yesterday, capped at today); picking a day refetches `front?day=YYYY-MM-DD` through the queue.
- **Manage frontpages.** The feed menu gains a "Manage feeds" dialog: every list can be hidden from the menu and reordered with arrow buttons; order and visibility persist in synced settings and the menu rebuilds live.
- **Feed filtering.** Hidden-domain and hidden-keyword filters (comma-separated, case-insensitive, edited in Settings), a per-card "Hide this domain" menu entry, Hide jobs (job stories filtered from every feed except the Jobs feed itself), and Hide read stories (opened stories filtered until the toggle is off). All filters compose with the existing search filter and re-apply live as settings change.
- **Points display.** Hotness coloring (score-per-hour heuristic: hot/warm/cool classes), a Compact points toggle (abbreviated score without the unit), and a Show domain toggle for the card metadata line.
- **Favicon provider choice.** Google (default), DuckDuckGo, or direct from the site — with a Settings privacy note explaining exactly what each provider receives (the hostname only; nothing else about you is sent).

### Changed

- `filterStories` now composes search, domains, keywords, job and read filtering over per-card `data-domain`/`data-type` attributes and re-runs whenever display settings change.
- `refreshFeed` understands `listPath` feeds and a comments-kind feed, suspends the Firebase batch pipeline for them, and marks them non-paginating (everything fetched is shown).
- The parity-list segments were already on `hn-session.js`'s SEC-05 allowlist; this release is the first to use them.

### Tests

- **`tests/parity.mjs` — the 0.12.0 UI suite (12 tests),** `npm run test:parity`: active/pool/… list feeds rendering cards from parsed list pages; Best Comments rows opening discussions; the front date picker requesting the picked day; manage-feeds hiding and reordering the menu; domain filter + card-menu domain hiding; keyword filter; hide-jobs everywhere except the Jobs feed; hide-read; compact points + hotness classes; show-domain; and the favicon provider switch. The suite clears synced settings between tests so they never leak into each other.

## [0.11.0] - 2026-10-10

The profiles-and-lists release: your Hacker News account data lives inside HarmoNova — a Firebase-backed user panel for anyone, your own Threads/Upvoted/Favorites/Submissions/Hidden lists from the account chip, and public lists for other users — with the profile page itself strictly off-limits (SEC-05).

### Added

- **User profile panel.** Clicking any author — in a feed card's thread header, a comment row, or the account chip's Profile entry — opens an in-HarmoNova overlay with the user's karma, a "member since" date (derived from the Firebase `created` field), their sanitized `about` text, up to eight recent items (clickable, open the discussion), and an "Open profile on Hacker News" link. A missing profile says "This profile is not available" instead of rendering a broken panel.
- **Own lists from the account chip (Phase 6).** The chip menu gains Threads (your reply inbox), Upvoted, Favorites, Submissions, and Hidden. A list view replaces the feed pane with a back button; stories render as feed cards, Threads rows carry the comment text plus the story they belong to (via Algolia's `items` API) and clicking a row opens that discussion. "Load more" pages through HN's morelinks with per-view dedupe, hiding itself when HN offers no next page; empty lists show "Nothing here yet."
- **Public lists for other users.** Another user's panel offers Submissions, Comments, and Favorites, opening that user's public list in the same list view (titled "alice's submissions" and so on). Lists that are private on Hacker News (another user's threads/upvoted/hidden) are refused with a plain-language toast.
- **`fetchListPage` in `hn-session.js`.** List pages are fetched through the rate-limited queue and parsed for `tr.athing` ids plus the morelink; outcomes are `ok` / `loginRequired` (which clears the session) / `rateLimited` / `indeterminate` / `failure`. SEC-05 is enforced structurally: the first path segment must be on a fixed allowlist that does not include `user`, so no code path — not even a bug — can fetch the profile HTML page. Relative morelinks (`?p=2`, `x?fnid=…`) are resolved against the requested list path with query merging, never against the host page's URL.
- **Scripted-click guards extended (SEC-30).** The account chip and every popup menu item now ignore untrusted clicks, alongside the existing thread-action and list-view guards.

### Changed

- `parseList` returns the morelink href verbatim. DOMParser documents inherit the host page's `baseURI`, so resolving there could point a `/upvoted` continuation at `/news`; the queue layer resolves it against the actually requested path instead.
- A manual feed refresh closes an open list view; the incremental scroll loader is suspended while a list view is open, so the two never fight over the feed pane.
- The account list allowlist covers all Phase 7 reading-parity lists (front, pool, active, bestcomments, launches, whoishiring, noobstories, classic, ask, show, jobs) so upcoming feeds reuse the same guard.

### Security

- **SEC-05 test tripwire.** `tests/profile.mjs` serves `/user` from a counting tripwire and every test asserts it was never requested — profile panels, author-link clicks, and list fetches alike; `fetchListPage("/user?id=…")` (and any off-allowlist path) is directly asserted to refuse without firing a request.
- **About-text sanitization.** The panel's `about` goes through the existing allowlist sanitizer: hostile fixtures with `<img onerror>`, inline `<script>`, and `javascript:` links render inert — asserted by window-side probes that no handler ran.

### Tests

- **`tests/profile.mjs` — the Phase 6 UI suite (12 tests),** `npm run test:profile`. Own-profile panel with karma/member-since/safe link; another user's panel with hostile-about sanitization (SEC-05 tripwire, no `onerror`/script/img execution, `javascript:` link neutered); missing profile message; upvoted list pagination through relative morelinks with dedupe and a hidden Load more at the end; submissions via `fetchItems`; Threads via Algolia with row click opening the discussion; hidden list empty state; back-to-feed restore; public lists for another user (submissions/comments/favorites paths asserted); `fetchListPage` allowlist refusals; login-page list outcome clearing the session; and scripted-click refusal across chip, popup, list-view back, and Load more.

## [0.10.0] - 2026-10-10

The favorites-and-submission release: HarmoNova covers the rest of Hacker News's account actions — favorites, hide (with undo), flag (behind a confirmation), bulk-favoriting your bookmarks, and full story submission from a modal.

### Added

- **Favorites.** The thread header gains a Favorite control: it reflects the fetched item document's state (active "Unfavorite" when already favorited, hidden when Hacker News offers no favorite link), toggles with optimistic state, and — like upstream — re-reads the item document after the action to confirm the new state (`confirmRefetch`). Success toasts "Favorited" / "Removed from favorites".
- **Hide with undo.** Hide is available from the thread header and from every feed card's overflow menu. The mutation goes through HN's `hide` token (`un=t` to unhide); the feed card disappears from the list and a 6-second toast offers **Undo**, which unhides (restoring the card) without reloading the feed. The control hides itself when the item document offers no hide link.
- **Flag, only when HN offers it, only behind confirmation (SEC-36).** The thread's More menu gains "Flag story" and comment rows' More menus gain "Flag comment" — both rendered only when the fetched Hacker News document actually contains a flag link for that item. Flagging opens a dialog that explains what flagging does and who sees it; Cancel sends nothing, Confirm sends exactly one `flag?…` request. When an item is already flagged, the menu offers "Unflag story".
- **Bookmarks → favorites, in bulk (SEC-37).** The feed More menu gains "Add bookmarks to HN favorites": after a dialog stating exactly how many bookmarks will be touched and roughly how long it takes, it favorites each bookmarked story **serially** through the rate-limited queue (the queue's own spacing enforces the serial pacing), shows live progress ("Adding to favorites… 3 of 12") with a **Cancel** button that stops the run at the next item boundary, reports "N of M added to favorites · K failed", and stops cleanly if the Hacker News session ends mid-run.
- **Story submission (Phase 5).** The feed toolbar gains a **New post** button (logged in only): a modal with Title (80-character limit with a live counter), URL, and Text fields, a "Posting as <username>" line, and a link to Hacker News's guidelines. HarmoNova validates locally (a title is required, a URL *or* text is required, URLs pass `safeHref` — `javascript:` and friends are refused before any request), then fetches HN's own `/submit` form, reads its `fnid`, and POSTs `/r` with `fnop=submit-page` exactly once (SEC-34).
- **Submit outcomes.** Success closes the modal, toasts, and refreshes the feed. An "already submitted" redirect (302 to an existing item) opens that discussion in HarmoNova with a "Hacker News already has this story" toast. A validation-required response keeps the entered values in the modal and offers a button that opens HN's own stock `/submit` form in an original-mode tab — HarmoNova never auto-fills a form on Hacker News itself. Too-fast, rate-limited, login-ended, and indeterminate outcomes keep the values and show a plain-language message; the modal stays open so the user decides what happens next.
- **Toast actions.** Toasts can now carry one button (Undo/Cancel) — the toast itself becomes clickable while shown.
- **Card menu bookmark toggle.** The feed card overflow menu gains Bookmark/Remove bookmark (the same local bookmark store the thread header uses).
- **`tests/actions.mjs` — the Phase 4+5 UI suite (14 tests).** Favorite toggling with the exact token request and confirmation re-fetch; favorite/hide controls hidden when the item document offers no link; thread hide with the undo toast asserting `un=t` on the undo request; card-menu hide removing the card and undo restoring it; flag story — cancel sends nothing, confirm sends one request; comment flag absent without a document link, present (and cancel-safe) with one; bookmarks bulk favorite — the dialog counts the bookmarks, requests are serially spaced (measured ≥600 ms apart), and mid-run cancellation stops the run early; exact POST `/r` payload from HN's `fnid` form posted once with feed refresh; local validation of empty posts and unsafe URLs with zero HN traffic; already-submitted opening the existing discussion; validationRequired keeping values and opening the stock form in a new original-mode tab; too-fast keeping the modal; and scripted-click refusal across favorite/hide/new-post (SEC-30).

### Changed

- A direct thread switch (`loadThread` with a different id — e.g. opening the existing story after an "already submitted" response) now retargets `selectedId` at the start, so the fetched discussion renders instead of being dropped by the stale-selection guard.
- `hn-session.js` item state now reports each comment's `flagAvailable` alongside its vote state, so comment flagging can be gated on the document.
- The feed toolbar's More menu carries New post and the bookmarks-bulk action; the voting suite targets the More button by label instead of index.
- `.harmonic-toast` becomes pointer-interactive while shown (the undo/cancel buttons need clicks); a comments-fixture flag anchor is injected by the test mock when a comment flag must exist.

## [0.9.0] - 2026-10-10

The commenting release: HarmoNova's composer closes the last big write-action gap — replies, edits, and deletes all happen inside HarmoNova, backed by per-account, session-scoped drafts and the module's exact-form, no-retry POST discipline.

### Added

- **In-HarmoNova reply composer.** The thread header's "Reply to post" button and every comment row's Reply button now open an inline composer instead of handing off to Hacker News: it names the acting account ("Commenting on… / Replying to… as <user>"), shows a live character counter (HN's own 8000-character limit), auto-grows, offers a Preview/Write toggle (the same safe inline renderer used for summaries), and explains its shortcuts (Ctrl+Enter posts, Esc keeps the draft).
- **Exact-form posting.** Submitting opens HN's own reply form through the queued fetch, reads the hidden `parent`/`goto`/`hmac` fields, and POSTs `/comment` exactly once with precisely the values HN's form dictated — HarmoNova never invents or reuses form parameters (SEC-14/34). Success clears the draft, closes the composer, toasts "Reply posted", and reloads the discussion; the thread re-render also fires when the composer isn't the source (delete success).
- **Inline edit for your own comments.** Comment rows authored by the signed-in user gain Edit and Delete buttons (hidden for everyone else's). Edit fetches HN's `/edit` form, prefills the composer with HN's current text, and POSTs `/xedit` once with the form's own `id`/`hmac` fields plus the new text.
- **Delete with explicit confirmation (SEC-36).** Delete opens a real confirmation dialog (title, message, Cancel/Delete buttons, red accent). Cancel sends nothing — no `/delete-confirm` fetch, no `/xdelete` POST. Confirm fetches HN's delete-confirmation form and POSTs `/xdelete` exactly once, then toasts "Comment deleted" and reloads the thread.
- **Drafts that survive everything except success.** Typed text autosaves (500 ms debounce) to a new background draft store in `chrome.storage.session`, keyed by acting username + parent item, capped at 20 KB per draft and 50 entries with oldest-first eviction. Closing the composer (X button, Esc, thread switch) keeps the draft and toasts "Draft saved"; reopening the composer restores it with a "Draft restored." note. Every non-success outcome (too fast, rate limit, validation required, login ended, network error) keeps the draft too, and a Discard draft button wipes it on demand with a toast.
- **HN escape hatch for verification walls.** When Hacker News asks for verification before a reply (`validationRequired`), the composer stays open, keeps the draft, explains the situation, and offers an "Open this reply on Hacker News" button that hands off to HN's own `/reply` form with the allowlisted goto.
- **Logout clears drafts.** Signing out runs `HARMONIC_DRAFT_CLEAR_ALL` — with no signed-in account there is no draft, and drafts never cross accounts (they are keyed by username).
- **Draft store hardening in the background worker.** All four message types (`HARMONIC_DRAFT_GET/SET/CLEAR/CLEAR_ALL`) are accepted only from trusted Hacker News content scripts (SEC-50), parent ids must be positive integers, text must be a string, and oversize text is rejected before it reaches storage.
- **`tests/comments.mjs` — the Phase 3 UI suite (13 tests).** Drives the real extension against mocked HN documents: the exact POST `/comment` payload (fixture-dictated `parent`/`goto`/`hmac` + typed text) posted exactly once with a thread reload; local empty-submit blocking with zero HN traffic; preview toggle round-trip; draft autosave verified directly against `chrome.storage.session` through the background worker, restore on reopen, and discard wiping storage; Esc close-and-keep; logout clearing the store; inline reply under the comment row; validationRequired keeping composer + draft and showing the HN button; tooFast keeping composer + draft with exactly one POST and no retry; edit visible only on own comments with prefill from HN's text and the exact `/xedit` payload; delete Cancel sending nothing vs Confirm sending exactly one `/delete-confirm` + `/xdelete`; scripted-click refusal across reply/edit/delete (SEC-30); and signed-out reply asking for sign-in without any HN form fetch.

### Changed

- Thread actions (reply, vote, More, and the rest of the header row) now refuse untrusted clicks at the shared handler level, closing the same SEC-30 gap the comment rows already had.
- Composer textareas carry HN's 8000-character maxlength so oversize text is rejected locally instead of surfacing as a server-side failure.

## [0.8.0] - 2026-10-10

The first account-actions release: HarmoNova can now act on Hacker News on your behalf — the toolbar gains an account chip (login hand-off, profile destinations, fetch-based logout) and stories, comments, and poll options can be voted from inside HarmoNova using Hacker News's own one-time tokens.

### Added

- **Account chip in the toolbar.** Signed out, the chip reads **Log in** and offers *Log in* and *Create account*; signing in happens on Hacker News's own `/login` page in the same tab (SEC-01 — HarmoNova renders no password field anywhere), with an allowlisted `goto` value (`news`, or `item?id=<id>` on a discussion) so user-supplied query input is never reflected (SEC-02). Signed in, the chip shows your username and karma and opens a menu with Profile, Threads, Upvoted, Favorites, Submissions, and Log out.
- **Fetch-based logout from the chip** (SEC-04). Logging out sends the signed-out fetch through `HarmonicHN.logout()` — the `logout?auth=…` URL never enters the address bar — then reloads the feed so the page reflects the signed-out state, clears vote affordances, and toasts "Signed out".
- **Session-change reactions** (SEC-35). When a fetched page reveals a different account, the chip re-renders, vote state resets, the open thread's vote UI refreshes, and a "Signed in as <name>" toast confirms the switch. The startup harvest never toasts.
- **Settings → Account section.** Explains that HarmoNova never sees or stores your password, that the session lives in Hacker News's own cookie, and that actions are sent through the same signed-in browser session with tokens held in memory for the tab only.
- **Story voting in the thread header.** The Upvote button is now functional: it reflects the story's vote state from the fetched HN item document (active/filled when voted, "Unvote" title), votes or unvotes on click with optimistic point updates (+1/−1) that roll back on failure, and locks while a vote is in flight (SEC-32 at the UI layer).
- **Comment voting.** Every comment row gains a hover/focus action row: Upvote/Unvote (active state synced from item state), Downvote — shown only when Hacker News actually offers a `down_` link for that comment, and staying visible as the filled undown affordance while a downvote is active — plus a Reply hand-off to HN's reply form, and a **More** menu with Share link (copies the `item?id=` link), Copy text, Open parent / Open top level (when applicable), and View user.
- **On-demand item state.** Once a discussion has been open for ~600 ms, HarmoNova fetches its Hacker News item page through the rate-limited queue (`HarmonicHN.ensureItemState`) and applies the story's and every comment's vote state to the UI. Vote affordances light up without any user action; missing tokens are fetched on demand when you act.
- **Feed-level voting.** Stories already voted on the harvested feed document show a small ▲ badge on their card. Every card's meta line gains a **Story actions** menu with Open discussion, Open article, Upvote/Unvote (using the token harvested from the feed document, or an on-demand fetch for stories outside it), and Open on Hacker News.
- **Poll voting.** Poll stories load their options from the Firebase `parts` list and render a Poll section above the comments; each option can be voted through its own item-document token, with active-state sync after success.
- **SEC-30 trusted-event enforcement in the UI.** Every vote (and popup-driven action) requires `event.isTrusted`; scripted `element.click()` from page code is refused with a toast and never sends a request. `openPopup` now forwards the click event to menu actions so they can enforce this.
- **Failure UX for votes.** Expired tokens retry exactly once with a fresh token (SEC-33); double expiry, rate limits, and other failures roll back the optimistic UI and toast a human-readable message (rate limits mention the throttle and keep the thread's "Open on Hacker News" escape hatch in the More menu).
- **`tests/voting.mjs` — the Phase 1+2 UI suite (18 tests).** A stateful mocked HN server (vote actions mutate the served documents; redirect targets are served directly) drives the real extension through Chromium: chip rendering per session, allowlisted goto with a query-reflection probe, the full account menu, logout-via-chip with request-shape and reload assertions, the SEC-01 password-field scan, account-switch chip/toast updates, exact `how=up`/`how=un`/`how=down` request shapes with post-success UI state (active classes, points, badges), downvote availability gated on the document, undown via the same button, SEC-30 scripted-click refusal, double-expiry rollback with toast, rate-limit rollback, card-menu voting with badge flipping, poll-option rendering and voting, and token-leakage checks.
- **`HarmonicHN.documentVoteState()`** — a safe view (ids and directions only) of the vote state seen on the harvested feed document, used to seed the UI; the harvest also caches feed-story vote tokens under the acting username (SEC-12/35).

### Changed

- Thread "Reply to post" now hands off to Hacker News's reply form for signed-in users instead of showing a placeholder toast (in-HarmoNova composers arrive in Phase 3).
- Comment rows build their action row at render time from any already-known item state, so re-renders (sorting, collapse toggles) never flash stale vote state; poll buttons re-render idempotently so an in-flight vote is never stomped by a background refresh.
- The e2e suite targets the thread's More menu explicitly now that comment rows carry their own More buttons; `npm run test:voting` runs the new suite.

### Fixed

- A rendered story card could end up empty when the feed auto-selected a story whose discussion payload was malformed (`itemState.itemId === item.id` matched `undefined === undefined`); the guard is now strict, and card assembly appends its main/preview/comment sections exactly once.
- The packaged UI leaked a `[hidden]` comment action through `display:inline-flex` (buttons marked hidden stayed clickable-visible); `[hidden]` now forces `display:none`.

## [0.7.4] - 2026-10-10

### Added

- **Site-wide search (All of Hacker News).** The toolbar search box now offers two modes: **Loaded stories** (the original filter) and **All of Hacker News**, which searches the entire corpus through the public Algolia HN API (`/search` for relevance, `/search_by_date` for newest).
- **Search filters.** Content-type chips (Stories, Comments, Ask, Show, Polls, Front page), a date-range picker (24 hours/week/month/year), a minimum-points field, an author filter, and relevance/newest sorting. Filters translate into validated `tags` and integer-only `numericFilters` (`created_at_i`, `points`); an invalid author name is skipped with an on-page hint rather than sent.
- **Safe result rendering.** Story hits render as regular HarmoNova story cards; comment hits render as compact cards with the story title and a highlighted excerpt. Highlight fragments are tokenized on literal `<em>`/`</em>` only (SEC-40) — hostile markup such as `<img onerror=…>` or `<script>` in a highlight renders as inert text and is never parsed as HTML.
- **Comment deep links.** Opening a comment hit loads the discussion and scrolls that comment into view with a brief flash highlight.
- **Paging and request hygiene.** Results page through "Load more" up to Algolia's `nbPages` limit with `hitsPerPage` capped at 50; queries are trimmed and capped at 200 characters; typing cancels stale in-flight requests with `AbortController` (300 ms debounce, minimum two characters, Enter for immediate search).
- **Recent searches, memory only.** The last eight searches are offered as one-click suggestions and a clear button. They are never persisted to any storage — including in normal windows — so nothing search-related can leak through sync or disk (SEC-51).
- **`hn-search.js` — the search client.** Query construction with a strict tag allowlist (`story`, `comment`, `ask_hn`, `show_hn`, `poll`, `front_page`, `author_<name>` with `^[A-Za-z0-9_-]{1,32}$` names), integer-only numeric filters, hit validation that drops malformed hits (bad `objectID`, wrong-typed numbers/strings, comments without a numeric thread id), and `nbPages`-aware paging. Requests are cookie-less GETs to the public API.
- **`hn-session.js` — the Hacker News session and account-action client.** A new content-script module that runs in the isolated world and implements the plan's Hacker News protocol rules: top-bar session parsing (username, karma, logout), vote-link parsing (`up_`/`down_`/`un_` anchors with direction from the arrow title), favorite/hide/flag link parsing with active-state detection, comment/reply/edit/delete/submit form harvesting, and list parsing with more-link resolution. All actions return structured outcomes (`success`, `failure`, `indeterminate`, `accountChanged`, `rateLimited`, `loginRequired`, `validationRequired`) instead of throwing.
- **A serial, rate-limit-aware HN fetch queue** (SEC-25). Every `news.ycombinator.com` HTML fetch runs through one queue with at least 750 ms spacing and exponential back-off (2 s/4 s/8 s) when HN rate-limits or returns 503; GETs retry up to four times, while POSTs are never retried (SEC-34).
- **A username-tagged token cache** (SEC-12). Vote, favorite, hide, flag, and logout tokens are cached only under the username that was signed in when the page was served; the cache and all form handles are dropped whenever the signed-in account changes or the page unloads (SEC-10/11). Tokens never leave the module closure.
- **Hacker News error-page classification.** Pages are classified as expired-link, bad-login, too-fast, rate-limited, validation-required, login, blank, or OK — using only page-chrome regions, with user-contributed comment and story text stripped first so comment contents cannot spoof an error (the same trick upstream HarmoNova uses).
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

- **Background requests no longer send cookies** (SEC-22). Every fetch in the background service worker — preview metadata, image tinting, article extraction, the HarmoNova font, and OpenRouter — now uses `credentials: "omit"`.
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

- Cancel an in-progress summary with the same Story tools button, and reset the system prompt to HarmoNova's default in Settings.
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
- Added streamed HarmoNova-style summary cards in the discussion header and one-click regeneration after a successful summary.
- Added OpenRouter AI settings for enable/disable, model selection, the upstream HarmoNova system prompt, streaming, and optional automatic summaries. The default model is `openrouter/free`.
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

- Added a Chrome browser-action popup with an **Enable HarmoNova** switch so the HarmoNova UI can be disabled and re-enabled without disabling the extension in `chrome://extensions`.
- Added popup shortcuts for opening HarmoNova settings and opening an untouched Hacker News tab.
- Added a per-tab original-Hacker-News mode managed by the background worker. Tabs opened through **Open original Hacker News** remain unmodified while navigating within Hacker News until the tab is closed or explicitly switched back to HarmoNova.
- Added **Disable HarmoNova** to the feed and discussion overflow menus.
- Added the Harmonic launcher artwork as the extension/browser-action icon at 16, 32, 48, and 128 pixel sizes.
- Added settings migration from the pre-0.6.0 `chrome.storage.local` format into `chrome.storage.sync`.
- Added a Hacker News origin backup for the settings object and enabled/disabled preference so local unpacked builds can recover preferences if a development update is loaded under a different extension ID.
- Added regression coverage for original-Hacker-News tabs, preference persistence, disabling the UI, and re-enabling through the extension popup.

### Changed

- Settings now use `chrome.storage.sync` as their primary extension store instead of `chrome.storage.local`.
- The release package now uses a stable unpacked folder name, `dist/harmonova/`, while keeping the zip filename versioned. This reduces accidental extension-ID churn during local updates.
- The content stylesheet is scoped to `html.harmonic-hn` so installing or disabling HarmoNova does not leak its dark color-scheme styling into untouched Hacker News.
- **Open on Hacker News** in the discussion menu now uses the same original-tab mechanism as the feed overflow menu.
- Updated release packaging to include the popup, icon assets, changelog, README, and license.
- Expanded the README with detailed installation, update, persistence, permissions, popup, original-tab, packaging, testing, and data-handling documentation.

### Fixed

- Replaced the malformed refresh SVG path that rendered as a broken/partial shape in the feed toolbar.
- Fixed **Open original Hacker News** opening another HarmoNova-rendered page instead of stock Hacker News.
- Fixed settings appearing to reset after extension reload/update workflows that changed the unpacked extension storage namespace.

## [0.5.0] - 2026-06-08

### Added

- HarmoNova-style desktop feed and two-pane discussion reader.
- Top, New, Best, Ask, Show, and Jobs feed support.
- Story preview metadata, favicons, image-derived card tinting, and lazy feed loading.
- Nested comments with colored depth rails, collapse/expand behavior, sorting, and quote normalization.
- HarmoNova-inspired settings for feed, comments, typography, zoom, and behavior.
- Chromium end-to-end regression tests and release packaging.

### Changed

- Refined laptop-scale spacing, typography, story-card behavior, and discussion layout for closer HarmoNova fidelity.

### Fixed

- Feed and discussion scrolling regressions.
- Story-card clipping and inconsistent card gaps.
- External article/tab interactions and card-click behavior.
