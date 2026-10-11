# Harmonic HN Browser

A Chrome/Chromium extension that turns Hacker News into a desktop browser adaptation of the **Harmonic** reading experience.

The project is intentionally narrow: preserve normal browser behavior and Hacker News content while making `news.ycombinator.com` feel like Harmonic on a laptop. It is not intended to be a generic Hacker News redesign.

## Product goals

The extension targets the parts of Harmonic that matter most for reading:

- AMOLED-first dark surfaces
- Google Sans Flex Rounded when the upstream font is available
- tinted story cards, preview images, and favicons
- large, readable story metadata and comment affordances
- a two-pane feed/discussion layout on desktop
- Harmonic-like discussion headers and action buttons
- readable nested comments with colored depth indicators
- click-to-collapse comment branches
- feed selection, search, refresh, overflow menus, and display settings
- native new-tab behavior for external articles
- an explicit way to open untouched Hacker News when desired
- an extension-toolbar popup for enabling/disabling Harmonic without disabling the Chrome extension itself
- one-click OpenRouter article summaries using Harmonic's upstream summarization prompt and streaming behavior

## Current release

The current extension version is **0.13.4**.

Version 0.13.4 repairs **comment editing** against both HN edit-form variants (including one-time `fnid`/`fnop` forms without an explicit ID), verifies edits against the refreshed thread, and changes **story submission** to fetch the one-use HN form *after* checking the session and existing submissions. Unconfirmed posts retain the draft and offer native HN submission and history links.

Version 0.13.3 fixes form posting to Hacker News: comment, edit, delete and story-submit requests now use the actual `application/x-www-form-urlencoded` browser form encoding rather than `text/plain`, which HN cannot reliably parse. The mocked HN server now rejects wrongly encoded posts, with Chromium assertions for the actual outgoing `Content-Type`. The thread action bar now puts **Add reply**, **Upvote**, dedicated **Article** and **Discussion** summary buttons, and **More** up front. Profile remains available from the author name, while bookmarks and favorites remain in the More menu.

Version 0.13.2 improves Hacker News post and comment confirmation with bounded read-only follow-up checks (no repeated POSTs), preserves drafts when the outcome remains unverified, explains article HTTP 403 access restrictions, and offers an opt-in summary of public Hacker News discussion instead of pretending to have read the blocked article.

Version 0.13.1 tightens right-click menu sizing and icon colors, corrects HN login detection for posting and favorites, makes Hide jobs hide rendered cards across feeds, and improves AI summary retries and failure details. This is a follow-up to 0.13.0, which fixes real Hacker News account-action protocol mismatches, confirms comments against redirected item pages before clearing drafts, preserves locally confirmed comments during Algolia indexing delays, restores story/comment search, and returns the reading interface to compact Harmonic defaults. Account and post actions now live in More/context menus, Settings has a category index, and comment voting uses a contextual overlay. **Live authenticated verification remains pending** because Hacker News served a validation wall from the VPS. See [`CHANGELOG.md`](CHANGELOG.md) for details.

## Account actions and voting

- **Account chip.** Signed out, the chip reads *Log in* and hands off to Hacker News's own `/login` page in the same tab with an allowlisted `goto` (SEC-02); Harmonic never renders a password field (SEC-01). Signed in, it shows your username and karma with Profile, Threads, Upvoted, Favorites, Submissions, Hidden, and Log out entries.
- **Logout is a fetch, not a navigation** (SEC-04): the `logout?auth=…` URL never enters the address bar; the feed reloads signed out afterwards, and every draft is cleared with the session.
- **Vote state, on demand.** ~600 ms after a discussion opens, Harmonic fetches the story's Hacker News item page through the serial queue and applies the story's and every comment's vote state; tokens missing from the cache are fetched on demand when you act.
- **Voting UI.** Thread-header Upvote/Unvote with optimistic points and rollback; per-comment Upvote, Downvote (only where Hacker News offers it, remaining visible as the undown affordance), Reply, and a More menu (share link, copy text, open parent/top level, view user); poll options with their own vote tokens; feed cards show a ▲ badge for stories you already voted and a Story actions menu with a functional Upvote.
- **Reply composer (see [Replying, editing, and drafts](#replying-editing-and-drafts)).** Reply buttons open Harmonic's own composer and post through HN's exact reply form; the old hand-off remains as the verification-wall escape hatch.
- **Edit and delete your own comments.** Comment rows authored by the signed-in user gain Edit (prefilled from HN's current text, POSTed once to `/xedit`) and Delete (real confirmation dialog — Cancel sends nothing — then exactly one `/xdelete`).
- **Favorites.** The thread header's Favorite control reflects the fetched document (active when favorited, hidden when HN offers no link) and re-reads the item after acting to confirm the new state.
- **Hide with undo.** Hide from the thread header or a card's overflow menu; the card disappears and a 6-second toast offers Undo (which unhides with `un=t` and restores the card without a feed reload).
- **Flag, gated twice.** Flag story / Flag comment entries render only when the fetched document offers a flag link, and every flag runs behind an explicit confirmation dialog (Cancel sends nothing).
- **Bookmarks → favorites in bulk (SEC-37).** One menu entry favorites every bookmarked story serially through the rate-limited queue, with progress + Cancel and a per-run summary.
- **Story submission.** The New post modal validates locally (title, URL-or-text, `safeHref`), reads HN's `/submit` `fnid`, and POSTs `/r` once; already-submitted opens the existing discussion, verification walls keep your values and hand off to HN's stock form.
- **Safety rails.** One mutation in flight per item (SEC-32), exactly one fresh-token retry on expiry for votes (SEC-33) and never-retried POSTs for comments/edits/deletes/submits (SEC-34), account switches abort pending actions (SEC-35), scripted `element.click()` never acts — enforced on comment rows, the whole thread action row, the account chip, and every popup menu item (SEC-30), deletes and flags confirm first (SEC-36), and every failure rolls the optimistic UI back with a plain-language toast.

## Profiles and account lists

- **User panel.** Any author link (thread header, comment row) or the chip's Profile entry opens an in-Harmonic panel: karma, member-since, sanitized about text, up to eight recent items that open the discussion, and a link to the real profile page. Missing profiles say so; hostile about HTML (event handlers, scripts, `javascript:` links) renders inert.
- **Own lists.** Threads (your reply inbox, comment rows with their story context via Algolia), Upvoted, Favorites, Submissions, and Hidden open as list views with a back button, "Load more" pagination through HN's morelinks (relative `?p=2` and `x?fnid=…` both resolved against the requested path, never the host page), per-view dedupe, and an empty state.
- **Public lists for other users.** From another user's panel: Submissions, Comments, Favorites. Private lists (threads/upvoted/hidden of someone else) are refused with a toast.
- **SEC-05, structurally.** Profile pages are never fetched — user data comes from the public Firebase API; list paths must start with an allowlisted segment that excludes `user`. `tests/profile.mjs` serves `/user` behind a counting tripwire and every test asserts zero requests.

## Comment parity

- **Reading context.** The story author's comments carry an "OP" badge; every commenter gets a small deterministic avatar (a hash-tinted disc with the initial, generated entirely locally — no requests, no tracking, toggleable in Settings); comments posted since your last visit are highlighted with a "new" badge until the visit is recorded (about four seconds after the thread opens, never written in incognito); and HN's `[delayed]` placeholder comments are collapsed by default with a toggle to show them.
- **In-thread filter and navigation.** The comments heading gains a filter box with a live "N of M match" counter — a top-level branch stays visible when anything inside it matches, with all of its descendants — and ↑ Top / ‹ Prev / Next › buttons that jump between top-level comments with a brief target flash.
- **User tags.** "Set user tag" in a comment's More menu attaches a private note (≤ 40 characters) to any username; tagged authors show a chip beside their name in every thread. Tags live in page storage on your profile and never leave the machine.
- **User blocking.** "Block user" hides that person's comments in every thread behind a one-line note with an Unblock button — reversible from the note or the comment menu, invisible to Hacker News.
- **User-data export/import.** Settings gains a user-data section: Export downloads `harmonic-user-data.json` (schema version 1: bookmarks ≤ 2000, read-story ids ≤ 1500, tags and blocks ≤ 500 each); Import validates strictly (256 KB cap, JSON parse, exact version, integers-only id lists without coercion, `^[A-Za-z0-9_-]{1,32}$` usernames, tags ≤ 40 chars) and merges — never replaces — with a plain-language message for every refusal. Nothing is synced to Hacker News or any server.
- **Covered by `test:comment-parity`.** The 10-test UI suite drives OP badges, deterministic avatars, the new-marker lifecycle (seeded seen-times → highlight → auto-clear → gone after reload), the `[delayed]` toggle, the filter and its match count, navigation flashes, tag persistence across reloads, the block/unblock round-trip, export file schema, and import merge + bad-schema refusal (bookmarks asserted in `chrome.storage.local` through the worker).

## Links and appearance

- **Rich link previews.** Stories linking to GitHub repositories, Wikipedia articles, or arXiv papers get a compact preview box — provider chip, title, and up to four lines of text: stars/forks/issues/language/license for GitHub (`api.github.com`), the lead summary for any Wikipedia language edition (disambiguation pages skipped), and authors/abstract/date for arXiv. Previews are fetched by the background worker only (the page never touches these hosts), capped at 256 KB per response, sanitized like every other text, and cached so repeat visits are instant. Toggleable in Settings → Links.
- **View on archive.** The card menu and the thread's More menu offer "View on archive", opening the Wayback Machine's closest-capture form (`web.archive.org/web/2/<url>`) in a new tab — useful when a linked page has vanished or gone paywalled.
- **Nitter redirect (opt-in).** A Settings toggle rewrites Twitter/X and t.co anchors — story links and in-text links alike — to your chosen Nitter instance (default `nitter.net`). Custom instance names are validated (hostname form) with a toast and a fallback to the default instead of broken links, and the original URL is kept in `data-raw-href`.
- **Themes.** Settings → Appearance picks the palette: **AMOLED black** (the default true black), **Charcoal** (soft dark grays), or **Deep navy** (blue-tinted dark), applied via `data-theme` across every surface token.
- **Font choice.** Appearance also picks the reading font: Harmonic's custom stack, System UI, or Serif, wired through a `--harmonic-font-stack` variable.
- **Covered by `test:links`.** The 14-test UI suite drives the three providers' previews from mocked APIs (chips, count caps, the 256 KB response cap), cache reuse and refetch when the toggle turns on, Nitter rewriting for story and in-text anchors plus the invalid-instance fallback, "View on archive" from both menus, theme/font application through `data-theme`/`data-font`, and the new Links and Appearance settings sections.

## Replying, editing, and drafts

- **Composer basics.** The composer names the acting account, shows a live character counter against HN's 8000-character limit, auto-grows, and offers a Preview/Write toggle using the same safe renderer as AI summaries. Ctrl+Enter submits; Esc keeps the draft and toasts "Draft saved"; the close button does the same.
- **Exact-form posting.** Submitting fetches HN's own reply form through the rate-limited queue, reads its hidden `parent`/`goto`/`hmac` fields, and POSTs `/comment` exactly once with those values plus your text — no invented parameters, no retries (SEC-14/34). Success clears the draft, closes the composer, toasts, and reloads the discussion.
- **Drafts.** Typed text autosaves (500 ms debounce) to `chrome.storage.session` through the background worker — keyed by acting username + parent item, ≤20 KB per draft, ≤50 entries with oldest-first eviction, never on disk or in sync. Closing the composer or switching threads keeps the draft; reopening restores it with a "Draft restored." note. Every failure (too fast, rate limit, verification, login ended, network error) keeps the draft too; Discard wipes it; logout clears all of them.
- **Verification escape hatch.** When Hacker News asks for verification before a reply, the composer stays open with the draft and offers "Open this reply on Hacker News" — HN's own `/reply` form with an allowlisted goto.
- **Draft messages are origin-gated** (SEC-50): the background worker accepts draft get/set/clear messages only from Harmonic's own Hacker News content scripts, with integer parent ids and string text.
- **Covered by `test:comments`.** The 13-test UI suite asserts the exact POST payloads, no-retry discipline, draft lifecycle (verified directly against the background store), edit prefill and payload, delete confirmation both ways, scripted-click refusal, and signed-out behavior.

## Feed experience

Supported feeds:

- Top Stories
- New Stories
- Best Stories
- Ask HN
- Show HN
- Jobs

The feed includes:

- Harmonic-style tinted cards
- every public list as a feed: Pool, Active Discussions, Best Comments, Launch HN, Who is Hiring, Newcomer Stories, Classic, and Past Frontpages (date picker) — plus a Manage feeds dialog to hide and reorder them
- feed filters: hidden domains (also via a per-card menu entry), hidden title keywords, hide jobs, hide read stories
- hotness-colored and compact scores, optional domain line, favicon provider choice (Google, DuckDuckGo, or direct)
- OpenGraph preview images when a page exposes one
- source favicons
- score, source domain, age, and comment count
- local read-state dimming
- search across loaded stories
- **search across all of Hacker News** (see [Site-wide search](#site-wide-search))
- incremental feed loading while scrolling
- a refresh control
- an account chip with login/logout and profile destinations (see [Account actions and voting](#account-actions-and-voting))
- a New post button that opens the story-submission modal (logged in; see [Account actions and voting](#account-actions-and-voting))
- a More menu with settings, "Add bookmarks to HN favorites" (SEC-37 bulk), and open-original hand-offs
- a per-card Story actions menu (open discussion/article, upvote/unvote, hide, bookmark, open on Hacker News)
- a ▲ badge on cards for stories you already upvoted
- configurable story typography and zoom
- configurable preview image behavior
- article/title/preview links that can open the external article in a new tab
- a large comment affordance that keeps the reader on Hacker News and opens the discussion pane

## Site-wide search

The toolbar search box offers two modes:

- **Loaded stories** — filters the stories already in the feed (the original behavior).
- **All of Hacker News** — searches the entire Hacker News corpus through the public Algolia HN API.

In **All of Hacker News** mode you can:

- pick a content type with chips: Stories, Comments, Ask, Show, Polls, or Front page
- limit results to a date range (24 hours, week, month, year)
- require a minimum point count
- filter by author
- sort by relevance or by date

Story hits render as regular Harmonic story cards. Comment hits render as compact cards that show the story they belong to and the comment excerpt with the search terms highlighted; opening one jumps into the discussion and scrolls the comment into view. Results page through "Load more" until Algolia's page limit, stale requests are cancelled while you keep typing, and the most recent searches are offered as one-click suggestions.

**What is sent to Algolia, and when:** a search request leaves the browser only while you are actively using the All of Hacker News search — the trimmed query (at most 200 characters), the selected tag, optional `created_at_i`/`points` numeric filters, an optional `author_<name>` filter, and paging parameters, sent as a GET to `https://hn.algolia.com/api/v1/search` or `/search_by_date` without cookies. Nothing else is shared: no page content, no identifiers, no settings, and the request is never sent for the "Loaded stories" filter. Recent searches live in memory only — they are never written to any storage, never synced, and are gone when the tab closes (consistent with Harmonic's incognito rules). Highlight fragments returned by Algolia are rendered as plain text with literal `<em>` tokens highlighted, so hostile markup in a highlight can never execute or load anything.

## Discussion reader

The discussion pane includes:

- a Harmonic-style tinted header
- optional hero/preview image
- title, domain, score, comment count, age, and author
- action buttons for common reading workflows
- a functional Upvote/Unvote control for the story with optimistic points
- nested comment cards
- per-comment vote controls (Upvote, Downvote where Hacker News offers it) with a More menu (share link, copy text, open parent/top level, view user, flag where HN offers it)
- an in-Harmonic reply composer for the story and every comment (Ctrl+Enter posts, drafts kept), plus inline Edit and confirmed Delete on your own comments (see [Replying, editing, and drafts](#replying-editing-and-drafts))
- a Poll section with per-option voting on poll stories
- Favorite and Hide controls gated on the fetched document, with hide offering an undo toast (see [Account actions and voting](#account-actions-and-voting))
- an "OP" badge on the story author's comments, deterministic local avatars for every commenter (a Settings toggle turns them off), and highlighting for comments posted since your last visit
- an in-thread comment filter with a live "N of M match" counter that keeps matching branches, plus ↑ Top / ‹ Prev / Next › navigation between top-level comments
- private per-profile **user tags** (a chip beside tagged authors) and **user blocking** (their comments hide behind an Unblock note) from every comment's More menu
- user-data **export/import** in Settings: a portable JSON file merging bookmarks, read-story ids, tags, and blocks with strict schema validation (see [Comment parity](#comment-parity))
- colored depth rails
- configurable comment sorting
- collapse-all and expand-all controls
- click-to-collapse individual branches
- sanitized Hacker News HTML
- normalized quote rendering
- external links that open in a new tab
- one-click **Story tools** summarization for linked articles
- a streaming Harmonic-style summary card inside the discussion header

## Extension toolbar popup

Click the Harmonic icon in Chrome's extension toolbar to open a compact popup.

The popup provides:

- **Enable Harmonic** — turns the Harmonic UI on or off without disabling/removing the Chrome extension.
- **Settings** — opens the Harmonic settings panel on Hacker News. If Harmonic is currently disabled, this action enables it first.
- **Open original HN** — opens the current Hacker News location in a separate tab that is explicitly excluded from the Harmonic renderer.
- **Use Harmonic here** — shown when the active tab is one of those original-Hacker-News tabs; it removes the per-tab bypass and reloads that tab with Harmonic enabled.

Disabling Harmonic from the popup leaves the extension installed. Re-enable it at any time by clicking the extension icon and switching **Enable Harmonic** back on.

## In-page overflow menu

The feed overflow menu contains:

- **Settings**
- **Open original Hacker News**
- **Disable Harmonic**

The discussion overflow menu also includes a disable action, and **Open on Hacker News** now opens a genuine untouched Hacker News tab rather than immediately being transformed by the content script.

### Original Hacker News tabs

Original-Hacker-News tabs use a per-tab bypass tracked by the extension background worker in `chrome.storage.session`.

The background worker first creates an empty tab, marks its tab ID as original mode, and only then navigates it to Hacker News. Because every new Hacker News document checks that per-tab state before mounting Harmonic, navigation inside the original tab stays original for the lifetime of that tab.

Closing the tab removes the bypass entry. A tab can also be switched back to Harmonic from the extension popup with **Use Harmonic here**.

A `#harmonic-original` fallback is recognized by the content script if the background-worker tab handoff is unavailable.

## Settings

The extension currently exposes Harmonic-inspired controls for:

- preview image size
- image-based card tinting
- favicons
- points
- comment count
- story number
- read-story dimming
- story text size
- overall content zoom
- comment card style
- comment sorting
- new-comment highlighting
- `[delayed]` placeholder visibility
- comment avatars
- comment depth palette
- rounded depth indicators
- continuous depth rails
- comment text size
- discussion-header tint
- discussion-header preview image
- AI summarization enable/disable
- OpenRouter model ID, defaulting to `openrouter/free`
- Harmonic's article-summary system prompt
- streamed AI responses
- automatic article summarization
- secure API-key configuration through an extension-owned settings page
- card-click behavior
- whether article links should also open comments

## AI summarization

AI summarization intentionally starts with **OpenRouter only** to keep the extension small. No AI SDK, application framework, or project-owned backend is required.

After an OpenRouter API key is configured, clicking the existing sparkle **Story tools** action immediately starts summarizing the linked article. There is no intermediate tools menu. While generation is running the action shows a loading state; after completion it becomes a one-click regenerate action.

The default model is:

```text
openrouter/free
```

This uses OpenRouter's free-model router. You can replace it with any OpenRouter model ID in Harmonic settings.

The summary pipeline mirrors Harmonic's upstream implementation:

1. the background worker fetches the linked article
2. script/style/template markup is discarded and readable body text is normalized
3. input is capped at 15,000 characters, matching Harmonic's cloud-summary budget
4. the configured Harmonic system prompt and article text are posted to OpenRouter's OpenAI-compatible `/chat/completions` endpoint
5. streaming SSE chunks are accumulated in the background worker
6. progressive text is sent to the Hacker News content script over a long-lived extension port
7. the summary card updates in place until the request completes

The default system prompt is adapted directly from Harmonic's cloud summarizer and asks for a concise, information-dense Markdown summary focused on the article's key takeaways.

### API-key storage

The API key is deliberately **not** stored with normal Harmonic preferences.

- It is never placed in `chrome.storage.sync`.
- It is never written to Hacker News `localStorage`.
- It is never sent to the Hacker News page.
- It is never included in summary DOM, logs, URLs, or synced preference backups.
- The background worker restricts `chrome.storage.local` and `chrome.storage.session` to trusted extension contexts.
- Article requests and OpenRouter requests are made by the extension background worker.

The API-key editor is an extension-owned options page rather than an input injected into Hacker News. This prevents the Hacker News document from reading the key while it is being typed.

Two storage modes are available:

- **Remember in this Chrome profile** — persists the key in Harmonic's private `chrome.storage.local` namespace and never syncs it.
- **This browser session only** — stores the key in `chrome.storage.session`; it must be entered again after Chrome restarts.

Chrome does not expose a general OS-keychain API to extensions, so persistent mode is not equivalent to Harmonic Android's Android Keystore-backed credential store. If protection against local profile-file access is required, use session-only mode.

Summaries can be cancelled by clicking **Cancel summary** on the same sparkle action. Switching discussions also cancels the active request; return to the story and click **Story tools** to retry. Requests stop after two minutes if the provider does not finish.

### Summary data handling

When you request a summary, extracted article text and the configured system prompt are sent directly from the extension to OpenRouter. The project has no relay server and does not receive the article, key, prompt, or generated summary.

Generated summaries are kept only in the current extension page's memory. They are not written to Chrome Sync or Hacker News origin storage.

## Preference persistence and migration

Preference persistence has two layers so normal extension reloads and local development updates do not force a settings reset.

### Primary store: `chrome.storage.sync`

Harmonic settings and the global enabled/disabled flag are stored in `chrome.storage.sync`.

This means settings survive normal extension updates for the same extension ID and can follow the Chrome profile when browser sync makes extension storage available.

### Migration from older builds

Versions before 0.6.0 stored `harmonicSettings` in `chrome.storage.local`.

On first load after upgrading, 0.6.0 checks the old local setting object when no synchronized setting object exists. The resolved settings are then written to `chrome.storage.sync` automatically.

### Unpacked-extension safety backup

Unpacked Chrome extensions can receive a different extension ID when they are loaded from a different filesystem path. Storage owned by one extension ID cannot be read directly by another extension ID.

To protect UI preferences during local development, Harmonic also keeps a namespaced backup of only the settings object and enabled/disabled preference in Hacker News origin storage:

- `harmonic:settings:v1`
- `harmonic:enabled:v1`

When a build starts with an empty extension storage namespace, it can recover those preferences from `news.ycombinator.com` local storage and immediately copy them into `chrome.storage.sync` for the new installation.

Read history and bookmarks remain in `chrome.storage.local`; they are not copied into page-origin local storage. Because local extension storage is restricted to trusted extension contexts since 0.7.0, the content script reads and updates those non-secret values through the background worker.

### Packaging path stability

The release build now always creates the unpacked folder at:

```text
dist/harmonic-hn-browser/
```

The zip filename remains versioned:

```text
dist/harmonic-hn-browser-0.7.2.zip
```

The zip itself contains the stable top-level folder `harmonic-hn-browser/`. Keeping that extracted folder in the same filesystem location and replacing its contents for upgrades helps Chrome keep the same unpacked-extension identity.

## Harmonic icon

The Chrome extension icon uses Harmonic's upstream Android launcher artwork from the public Harmonic-HN repository.

Source snapshot:

```text
SimonHalvdansson/Harmonic-HN
commit 42aae5fa3c587b4554f1e53ce6d45c267e1aec2a
app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
```

The 192×192 upstream PNG is resized into 16, 32, 48, and 128 pixel PNGs for Chrome. See `icons/README.md` for provenance details.

Harmonic-HN is licensed under Apache-2.0. This repository retains the existing attribution to the upstream project and uses its icon only as part of this Harmonic browser adaptation.

## Font

Harmonic defaults to **Google Sans Flex Rounded**. The extension loads the same public font at runtime from Harmonic's upstream repository and does not bundle the font binary in this repository or release archive.

Since 0.7.3 the runtime font URL is pinned to the upstream commit `42aae5fa3c587b4554f1e53ce6d45c267e1aec2a` and the fetched bytes are verified against a SHA-256 digest before the font is used; any mismatch falls back to Google Sans, Product Sans, Segoe UI, and system sans-serif fonts.

If the runtime fetch fails, the UI falls back to Google Sans, Product Sans, Segoe UI, and system sans-serif fonts.

## Install locally

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository root, or the extracted `harmonic-hn-browser/` release folder.
6. Pin **Harmonic for Hacker News** from Chrome's extensions menu if you want one-click access to the enable/disable popup.
7. Open `https://news.ycombinator.com/news`.

## Updating a local unpacked installation

For the most reliable preference continuity:

1. Keep the unpacked extension at the same filesystem path between versions.
2. Replace the old files with the new release files, or rebuild the stable `dist/harmonic-hn-browser/` directory in place.
3. Open `chrome://extensions`.
4. Click **Reload** on **Harmonic for Hacker News**.
5. Refresh any already-open Hacker News tabs.

Do **not** disable the Chrome extension itself merely to view original Hacker News. Use **Disable Harmonic** in the in-page menu or the **Enable Harmonic** switch in the extension popup instead.

If a development workflow still results in a new unpacked extension ID, the settings backup on the Hacker News origin is used to recover the UI preferences when possible.

## Build a release zip

Install dependencies and package the release:

```bash
npm install
npm run package
```

Outputs:

```text
dist/harmonic-hn-browser/
dist/harmonic-hn-browser-<version>.zip
```

The package script copies only runtime files, documentation, the license, changelog, and browser icon sizes required by the extension.

## Browser verification

Run focused AI worker checks with `npm run test:ai` and browser-restart persistence checks with `npm run test:reload`. To include a real `openrouter/free` request in the browser suite, supply `OPENROUTER_TEST_KEY` through your environment; the test uses session-only key storage and prints only the result and summary length.

The repository includes a Chromium end-to-end smoke test at a **1919×872** viewport.

Run the development tree:

```bash
npm install
npm run test:e2e
```

Test the exact packaged folder:

```bash
EXTENSION_PATH="$PWD/dist/harmonic-hn-browser" \
TEST_OUTPUT_DIR="$PWD/test-results-packaged" \
npm run test:e2e
```

Run the Hacker News session and parser suites (redacted fixtures drive a real Chromium):

```bash
npm run test:hn-parser
npm run test:hn-auth
```

`test:hn-auth` serves the fixtures for every `news.ycombinator.com` request through Playwright routing and asserts the exact wire shape of every account action (vote, favorite, hide, logout, reply), the retry/backoff rules, account-switch safety, and that tokens never leave the session module — no Hacker News credentials are needed or used.

Run the site-wide search suite (unit tests plus mocked-Algolia browser tests):

```bash
npm run test:search
```

Run the account-chip and voting UI suite (stateful mocked HN server drives the real extension; vote actions mutate the served documents so post-vote UI states are assertable):

```bash
npm run test:voting
```

Run the composer suite (replies, edits, deletes, drafts — the same real-extension harness; POST bodies, draft storage, confirmation dialogs, and trusted-event gating are all asserted):

```bash
npm run test:comments
```

Run the favorites/hide/flag/submit suite (stateful mocks that reflect favorite/hide/flag state on served documents, including a 302 "already submitted" redirect and a submit `fnid` form):

```bash
npm run test:actions
```

Run the profiles-and-lists suite (Firebase-backed user panels with a hostile-about sanitization probe, own lists through the account chip with morelink pagination and dedupe, Algolia-driven Threads rows, public lists for other users, the SEC-05 `/user` tripwire, and the login-required outcome):

```bash
npm run test:profile
```

Run the feed-parity suite (parity list feeds from parsed public pages, Best Comments rows, the front date picker, manage-feeds hide/reorder, domain/keyword/job/read filters, compact + hotness scores, show-domain, and the favicon provider switch):

```bash
npm run test:parity
```

Run the comment-parity suite (OP badges, deterministic avatars, the new-comment marker lifecycle, the `[delayed]` toggle, the branch-keeping in-thread filter with its match counter, top-level navigation flashes, user tags persisting across reloads, the block/unblock round-trip, export-file schema, and import merge + bad-schema refusal):

```bash
npm run test:comment-parity
```

Run the links-and-appearance suite (GitHub/Wikipedia/arXiv rich previews from mocked provider APIs — chips, count caps, the 256 KB response cap — cache reuse and refetch when the toggle turns on, Nitter rewriting of story and in-text anchors plus the invalid-instance fallback, "View on archive" from the card and thread menus, theme and font application through `data-theme`/`data-font`, and the new Links/Appearance settings sections):

```bash
npm run test:links
```

Run the live smoke test against the real site (opt-in: set `HN_LIVE=1 HN_USER=… HN_PASS=…`; credentials are read from the environment only and never stored. Only reversible actions run — one upvote/unvote and one favorite/unfavorite pair — and Hacker News's own anti-automation wall is respected, so run it from your own machine rather than a datacenter):

```bash
HN_LIVE=1 HN_USER=you HN_PASS='…' npm run test:live
```

`test:voting` asserts the chip per session state, the allowlisted `goto` login hand-off (including a query-reflection probe), the full account menu, fetch-based logout with reload, exact `how=up`/`how=un`/`how=down` request shapes with the UI state they produce (active classes, point deltas, card badges), downvote availability gated on the served document, SEC-30 refusal of scripted clicks, double-expiry and rate-limit rollback with toasts, and poll-option voting — no Hacker News credentials are needed or used.

The suite verifies the areas that have historically regressed, including:

- at least 30 initial story cards render
- the feed and discussion panes both scroll
- infinite feed loading adds more stories
- the refresh control has the intended button geometry
- the Harmonic font loads when the upstream resource is reachable
- card and title click behavior matches the configured setting
- sort controls and settings are present
- settings update live
- settings persist through a reload and are backed up on the Hacker News origin
- OpenRouter credentials remain out of Chrome Sync and Hacker News origin storage
- the extension-owned credential page securely saves and clears the API key
- one-click Story tools sends the Harmonic prompt and extracted article text to OpenRouter
- streamed OpenRouter chunks render into the summary card
- cancellation and story switching discard stale output and allow retry
- provider errors and missing credentials show a recovery path
- auto-summary defaults off and runs when enabled
- the system prompt can be reset to Harmonic’s default
- quotes are normalized and visibly styled
- external articles open in a separate tab
- **Open original Hacker News** creates a tab without the Harmonic UI
- navigation inside that original tab remains unmodified
- **Disable Harmonic** reloads Hacker News in its stock form
- the browser-action popup can re-enable Harmonic without enabling/disabling the extension in `chrome://extensions`

A screenshot from the test viewport is written to the selected test output directory.

## Architecture

The project deliberately stays small and uses no application framework.

- `manifest.json` — Manifest V3 configuration, permissions, extension action, and icon declarations
- `content.js` — feed, reader, interactions, settings, streaming summary presentation, persistence migration, and Hacker News/Algolia loading
- `hn-session.js` — isolated-world Hacker News session and account-action client: session harvest, vote/favorite/hide/flag parsing and mutations, reply/edit/delete/submit form handles, serial rate-limited fetch queue, username-tagged token cache, and error-page classification (the module exposes safe state and outcomes only — tokens never leave its closure)
- `hn-search.js` — site-wide search client for the Algolia HN API: strict query/tag/numeric-filter validation, hit validation with malformed-hit dropping, paging, and SEC-40-safe highlight tokenization (literal `<em>` only; hostile markup stays text)
- `styles.css` — Harmonic desktop adaptation and summary/settings presentation scoped to `html.harmonic-hn`
- `background.js` — preview metadata, image palette extraction, font retrieval, private local state, article extraction, OpenRouter streaming, and per-tab original-HN state
- `url-policy.js` — shared remote-URL validation (public targets only, SSRF protection, redirect re-validation) used by the background worker and content script
- `popup.html` / `popup.css` / `popup.js` — toolbar popup for enable/disable, settings, and original-HN actions
- `ai-settings.html` / `ai-settings.css` / `ai-settings.js` — extension-owned OpenRouter credential editor
- `icons/` — Harmonic browser-action icon assets
- `tests/e2e.mjs` — Chromium interaction and regression test
- `tests/security.mjs` — security regression suite (URL policy, cookie omission, sender checks, SSRF, AI output rules)
- `tests/hn-parser.mjs` — fixture-driven parser and session-harvest tests run against the real extension in Chromium
- `tests/hn-auth.mjs` — fully mocked logged-in account-action suite: exact Hacker News request shapes, retry/backoff rules, account-switch safety, and token-leakage checks
- `tests/voting.mjs` — Phase 1+2 UI suite with a stateful mocked HN server (votes mutate the served documents): account chip flows, exact vote request shapes with post-success UI state, downvote gating, SEC-30 scripted-click refusal, rollback toasts, card-menu voting, and poll-option voting
- `tests/comments.mjs` — Phase 3 UI suite with the same harness extended to reply/edit/delete form fixtures: exact POST `/comment` and `/xedit` payloads from HN's own forms, no-retry discipline, the background draft store in `chrome.storage.session` (autosave, restore, discard, logout clear), delete confirmation both ways, validationRequired/tooFast keep-draft behavior, and signed-out/refusal rails
- `tests/actions.mjs` — Phase 4+5 UI suite: favorites with confirmation re-fetch, hide with undo toasts (`un=t` asserted), card-menu hide + restore, document-gated flagging with SEC-36 dialogs, SEC-37 bulk bookmark favorites (serial spacing measured, mid-run cancel), exact POST `/r` submission payload, already-submitted redirect handling, validationRequired stock-form hand-off, and scripted-click refusal
- `tests/search.mjs` — site-wide search suite: query-construction and highlight-tokenization units plus mocked-Algolia browser tests (paging, hostile highlights, malformed hits, empty/error states, cancellation, comment-hit deep links)
- `tests/profile.mjs` — Phase 6 UI suite (Firebase user panels, own/public account lists, the SEC-05 `/user` tripwire, allowlist refusals, login-page outcomes)
- `tests/parity.mjs` — Phase 7 part 1 UI suite (parity list feeds, Best Comments rows, front date picker, manage-feeds, feed filters, score display, favicon provider)
- `tests/comment-parity.mjs` — Phase 7 part 2 UI suite (OP badges, deterministic avatars, new-comment markers, `[delayed]` toggle, in-thread filter and navigation, user tags, blocking, user-data export/import)
- `tests/live.mjs` — opt-in real-site smoke test (`HN_LIVE=1 HN_USER=… HN_PASS=…`; credentials from the environment only, reversibles only, respects HN's anti-automation wall)
- `tests/fixtures/hn/` — redacted logged-out captures and derived logged-in synthetic documents (raw captures and any traces stay out of git)
- `scripts/capture-fixtures.mjs`, `scripts/redact-fixtures.mjs`, `scripts/build-synthetic-fixtures.mjs` — the offline fixture pipeline
- `scripts/package.sh` — creates the stable unpacked release folder and versioned zip
- `CHANGELOG.md` — release history following Keep a Changelog 1.1.0

The Hacker News Firebase API supplies story feeds/items. The Algolia HN API is used for discussion trees so larger threads can render without hundreds of serial item requests.

## Permissions

### `storage`

Used for:

- synchronized non-secret settings
- the global enabled/disabled preference
- local read state and bookmarks
- private OpenRouter API-key storage
- session-only original-tab IDs and optional session-only OpenRouter credentials

### `activeTab`

Used by the extension popup after the user clicks the toolbar icon so the popup can determine whether the active page is Hacker News and reload or navigate that active tab after an explicit popup action.

### Broad HTTP/HTTPS host access

The extension asks for broad HTTP/HTTPS host access because Harmonic-style cards fetch metadata, preview images, and favicons for arbitrary story domains from the background worker, and because one-click summaries fetch the selected linked article plus OpenRouter's API endpoint.

That host access is not used for browsing-history collection or analytics.

The content script itself runs only on:

```text
https://news.ycombinator.com/*
```

## Data handling

The extension has no analytics service and no project-owned backend.

Stored data is limited to UI preferences, read-story IDs, bookmarks, enabled/disabled state, the optional OpenRouter credential, its storage-mode preference, and temporary original-tab IDs. Preview metadata is held in memory by the background service worker and expires naturally with worker lifetime or cache timeout.

The page-origin backup is limited to non-secret UI preferences and the enabled/disabled flag; it does not contain credentials, Hacker News account information, comments, article contents, or generated summaries.

On an explicit summary request, the selected article text is sent directly to OpenRouter together with the configured system prompt. The API key is sent only as the OpenRouter authorization header.

### Security posture (0.7.3)

- **No cookies leave the background worker.** Every background fetch — preview metadata, image tinting, article extraction, the Harmonic font, and OpenRouter — runs with `credentials: "omit"`.
- **Hacker News pages are never previewed or summarized** by the background worker, and no background request is ever sent to a Hacker News host.
- **A shared URL policy (`url-policy.js`) gates every remote fetch.** Only public `http:`/`https:` targets on default ports are allowed. Localhost, link-local, private, CGNAT, and reserved IP ranges, IPv6 loopback/ULA/link-local, exotic literal-IP spellings, and non-default ports are refused, including through redirects; redirect hops are capped.
- **External links and image sources are validated** in the UI (`safeHref`, `safeImageSrc`): only `http:`/`https:` links are used, and images must be `https:` and never point at the Hacker News origin.
- **Message senders are verified.** Background handlers that read or write user data accept messages only from the extension's own top-frame content script on `https://news.ycombinator.com`. The manifest declares an empty `externally_connectable`, so other extensions and websites cannot message Harmonic.
- **Incognito windows keep activity in memory.** Read state, bookmarks, and page-origin settings backups are not persisted from incognito.
- **The runtime font is pinned and hash-verified** (see the Font section).
- **AI summaries cannot trigger actions or load images.** Generated Markdown never renders images, and the summary UI offers no HN actions.

Run the security regression suite with `npm run test:security` (Node) and `npm run test:security:browser` against the packaged folder (Chromium).

## Intentionally out of scope

The current reading-focused scope does not implement:

- Hacker News login
- voting
- submitting stories
- posting or replying to comments
- account synchronization
- exact parity with every Harmonic mobile-only feature
- local/on-device AI models
- direct OpenAI, Anthropic, or Google AI provider integrations
- Harmonic's follow-up "Ask" conversation tooling for generated summaries

Buttons for unavailable authenticated features state that limitation rather than silently failing.

## Design source and attribution

Visual and interaction reference:

- Harmonic-HN by Simon Halvdansson: https://github.com/SimonHalvdansson/Harmonic-HN/

Harmonic is licensed under Apache-2.0. This project studies its public implementation, screenshots, theme values, story-row behavior, comment-depth treatment, settings model, and launcher artwork to create a browser adaptation.

This repository is not an official Harmonic release and is not affiliated with Hacker News or Y Combinator.

## Development rules

A build should not be handed off for manual testing unless the **exact packaged extension folder** has passed `npm run test:e2e` in Chromium at the target laptop viewport.

When making a user-visible change:

1. update tests for the changed behavior
2. update `README.md` when installation, behavior, storage, permissions, or architecture changes
3. add the change under `[Unreleased]` while developing
4. move the final notes into a numbered release section when the extension version is bumped
5. run the source-tree test
6. run `npm run package`
7. run the exact packaged-folder test
8. inspect `git diff` and `git status` before committing

## Changelog policy

`CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and uses semantic version numbers.

Use these headings when applicable:

- Added
- Changed
- Deprecated
- Removed
- Fixed
- Security

User-visible behavior changes should be written for extension users rather than as raw commit messages.

## Near-term roadmap

- ~~Phase 3 (0.9.0): in-Harmonic commenting with drafts (reply composer, edit/delete own comments)~~ — shipped
- ~~Phase 4+5 (0.10.0): favorites, hide-with-undo, flag confirmation, and the story-submission flow~~ — shipped
- ~~Phase 6 (0.11.0): user profile panel and own-list browsing (threads/upvoted/favorites/submissions/hidden) plus public lists for other users~~ — shipped
- ~~Phase 7 part 1 (0.12.0): parity list feeds, frontpage management, feed filters, score display, favicon provider~~ — shipped
- ~~Phase 7 part 2 (0.12.1): comment parity — new-comment markers, OP highlight, in-thread search, avatars, user tags, blocked users, bookmark import/export~~ — shipped
- ~~Phase 7 part 3 (0.12.2): links and appearance — archive action, rich link previews, themes~~ — shipped
- ~~Phase 8 (0.13.0): reply notifications, collapse sync, opt-in keyboard shortcuts~~ — skipped by request
- closer parity for additional Harmonic story-card layout modes
- mobile/narrow-browser navigation polish
- additional regression screenshots at common laptop widths

The north star remains: **Harmonic on the web, not merely prettier Hacker News.**
