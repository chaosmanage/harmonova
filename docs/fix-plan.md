# Harmonic for HN — Audit Findings and Fix Plan (v0.12.2 → v0.13.x)

Branch audited: `feature/hn-account-actions` at manifest version 0.12.2.
Baseline for visual comparison: `main` (0.7.2, the last build that matched Harmonic's look).
Plan this fixes: `docs/implementation-plan.md` (all SEC-xx rules remain in force).

---

## 1. TL;DR

The account features fail in real use while every test passes, because the tests run against a
made-up imitation of Hacker News that behaves differently from the real site.
There are four root causes:

1. **Votes are judged by a response HN never sends.** HN's own `hn.js` fires the vote request
   and ignores the reply. Our code parses that reply as a page, finds nothing, and either rolls
   the vote back ("Hacker News did not confirm the action") or marks the item as un-voted.
   Replaying the existing voting suite with HN's real empty reply makes 5 of its tests fail.
2. **Posted comments vanish.** After a successful post we reload the thread from Algolia, which
   has not indexed the new comment yet. The user sees "Reply posted", the thread jumps back to
   the top, and their comment is missing.
3. **Search misclassifies every story as a comment.** Algolia now returns `story_id` on story hits
   too, and `hn-search.js` uses that field to detect comments. A "sqlite" search under
   **Stories** reports "0 stories · 30 comments" and renders each story as a comment card with an
   "Open comment" button. Comment results also print raw HTML (`<p>`, `<a href=…>`) as text.
4. **The UI drifted away from Harmonic.** Features were bolted on as always-visible buttons:
   a 9-button thread header that wraps onto two rows, an icon row under every comment, "new"
   badges on every comment, avatars, orange scores, a cluttered toolbar, a dense search panel,
   and a 41-row settings page.

The fix order is: make the test doubles faithful to real HN first, then fix voting, commenting
and search against them, and then restore the Harmonic visual language.

---

## 2. How the audit was done

- All ten suites (`test:hn-parser`, `hn-auth`, `voting`, `comments`, `actions`, `search`,
  `profile`, `parity`, `comment-parity`, `links`) were run; all exit 0.
- The extension was driven in Chromium with Playwright against the live site (logged out),
  with screenshots of the feed, thread, comment interactions, search, settings, the user
  overlay and the feed menu.
- A `main` worktree was loaded on the same story (item 49991852), and both builds were
  screenshotted with the same viewport.
- HN's live `hn.js` and vote endpoint were read (logged out, no tokens).
- Live Algolia responses were inspected for story and comment hits.
- The voting suite was replayed with one change: `/vote?…&js=t` returns HN's real empty body.
- Upstream sources were checked: `CommentActionOverlay.kt`, `CommentsScreen.kt`
  (tap and long-press handling), `StoriesSearchHeader.kt`, and the `ref/*.png` screenshots.

What was **not** possible: exercising a real logged-in session. No credentials were used, by
design (SEC-01). Phase F0 below closes that gap safely.

---

## 3. Findings

Each finding lists the evidence, the root cause, and the fix. IDs (V-, C-, S-, U-, Q-) are
referenced by the phases in section 4.

### 3.1 Voting

**V-1 — A successful vote is reported as failed or as un-voted.**
- Evidence: HN's `hn.js` does `send(vurl(...))` (an `XMLHttpRequest` whose reply is discarded)
  and updates the DOM itself. Our `vote()` in `hn-session.js` (around line 588) parses the
  `js=t` reply with `parseVoteLinks(page.doc)` and returns `safeVoteState(refreshed.get(itemId))`.
  With an empty reply, `classifyDoc` returns `"blank"`, and `classificationOutcome` turns it into
  `indeterminate`. If the reply is non-empty but has no vote links, the result is `voted:false`.
  Either way, `handleStoryVote` in `content.js` (around line 1031) rolls back or flips the button off.
- Proof: the voting suite with a realistic empty reply fails 5 tests (story upvote/unvote,
  comment vote, downvote, feed-card vote, poll vote).
- Fix: treat the vote request as fire-and-confirm. A 2xx reply that is not a login page,
  rate-limit page, validation page or "Unknown or expired link." counts as success. The new
  state is computed locally (`up` → voted up, `down` → voted down, `un` → not voted). Never parse
  vote links out of a `js=t` reply. When the reply is indeterminate (network error, unexpected
  status), refetch the item state once to confirm before rolling back.

**V-2 — Downvotes are read back as upvotes.**
- Evidence: `parseVoteLinks` (`hn-session.js` around line 245) infers direction from a
  `.votearrow` title *inside* the `un_` anchor. Real HN markup has no arrow there; it is
  `<span id='unv_ID'> | <a id='un_ID' class='clicky' href='vote?…how=un…'>unvote|undown</a></span>`.
  The synthetic fixture generator (`scripts/build-synthetic-fixtures.mjs`, `markVoted`) invented
  the arrow-inside-`un` markup, so tests agree with the bug.
- Fix: direction comes from the `un_ID` link text (`undown` means down, `unvote` means up).
  `canUp` and `canDown` come from the `up_ID` and `down_ID` anchors *without* the `nosee` class.
  The voted state comes from a non-empty `unv_ID` span.

**V-3 — Every vote after one minute triggers a full item-page download.**
- Evidence: `TOKEN_MAX_AGE = 60_000` in `withMutationToken`. Any token older than 60 seconds
  refetches `/item?id=` first. That page can be megabytes for a large thread, and requests are
  serialized 750 ms apart, so votes feel stuck and HN's rate limiter becomes likely.
- Fix: HN's `auth` value is per (user, item) and is the same for up, down and un, so cache one
  `vote` token per item. Raise the age limit for vote tokens to 30 minutes. Rely on the existing
  "expired link → refetch → retry exactly once" path (SEC-33) for real expiry. Account-switch
  safety (SEC-35) is kept: `setSession` already clears all tokens when the username changes, and
  any fetched page with a different user clears them too.

**V-4 — Clicking vote before item state loads ignores an existing vote.**
- Evidence: `handleStoryVote` reads `state.itemState?.story?.voted`, which is `null` for about
  600 ms after a thread opens (`scheduleItemState`). On an already-upvoted story a fast click sends
  `how=up` again instead of `how=un`.
- Fix: until item state arrives, the vote button shows a neutral "loading" state. A click is
  queued and resolved once state lands (or times out with "Couldn't load your vote state").

**V-5 — Feed vote badges are lost or wrong after a reload.**
- Evidence: `state.feedVotes` is filled only from item pages the user opens and from local
  actions, and HN list pages are never parsed for it.
- Fix: when signed in, the feed fetch that already happens for `/news` (or the matching HN list)
  is parsed for `unv_` spans, which gives vote state for the whole page in one request.
  Only do this when the HN list matches the visible feed. Otherwise show no badge, never a guess.

### 3.2 Commenting

**C-1 — New comments disappear after posting.**
- Evidence: `handleComposerOutcome` (`content.js` around line 2033) calls `loadThread()` on
  success. That replaces the pane with a spinner, refetches `ALGOLIA_API/items/:id` (indexed with
  a lag of seconds to minutes), resets scroll and closes everything.
- Fix: HN answers a successful `POST /comment` by redirecting to the form's `goto` item page,
  which already contains the new comment (to be confirmed by the F0 capture). Parse it with `parseCommentTree`-style logic: find the
  comment by the signed-in user under the expected parent with an id not in the current tree.
  Insert it locally under its parent with a subtle "Posted" marker, keep the scroll position, and
  scroll the new comment into view. Algolia data merges later without duplicating it (dedupe by id).
  If the new comment cannot be located, show "Posted — it may take a minute to appear" and keep
  a local placeholder built from the submitted text, marked as unconfirmed.

**C-2 — Edits and deletes force a full reload.**
- Fix: same approach as C-1. After `xedit` succeeds, update the local node's body from the
  returned page (or from the submitted text if not found). After `xdelete`, mark the node
  `[deleted]` locally.

**C-3 — A top-level comment uses the reply page instead of the story's own form.**
- Evidence: `submitComposer` always calls `openReplyForm(parentId)`, which GETs `/reply?id=` even
  when the parent is the story. The item page fetched by `ensureItemState` already holds the
  story's `form[action=comment]` with `parent`, `goto` and `hmac`.
- Fix: for top-level comments, use the form harvested from the item state. Fall back to
  `/reply?id=` only when that form is absent.

**C-4 — The reply form is fetched only at submit time.**
- Evidence: `submitComposer` first shows "Opening the Hacker News reply form…" and then posts.
  Locked threads, comments too old to reply to, and verification prompts are only discovered
  after the user has written the reply.
- Fix: fetch the form when the composer opens (in the background, with an "unavailable" banner on
  failure) and refresh `hmac` only on "Unknown or expired link." (one retry, SEC-33). Disable
  Post until the form is ready.

**C-5 — Reply is offered where HN does not allow it.**
- Fix: hide Reply for comments older than 14 days (HN's limit, matching upstream's
  `Reply only if logged in and comment < 2 weeks old`), for dead or deleted comments, and when the
  item page has no reply link.

**C-6 — The preview is not HN's formatting.**
- Evidence: the preview runs through `appendSummaryInline`, the AI-summary formatter.
- Fix: add `formatHnPreview(text)` mirroring HN's rules. Blank lines separate paragraphs, lines
  indented by two or more spaces become code blocks, `*text*` becomes italics, and bare URLs are
  autolinked (inert, `rel=noopener`). Build it with `createElement` and `textContent` only, never
  `innerHTML` (SEC-40 style).

**C-7 — A heuristic can mark failure as success and clear the draft.**
- Evidence: `formOutcome` treats any page matching
  `.comment-tree, .toptext, .titleline, td.title` as success. Any item page matches, including
  one HN shows when it bounces the user back without posting, so the check cannot tell success
  from a silent rejection.
- Fix: success requires that the final URL is `/item?id=` **and** that C-1 finds the new comment
  (or, for edits, the edited id with matching text). Anything else is `indeterminate`, the draft
  is kept, and an "Open on Hacker News" link is shown. Drafts are only cleared on confirmed
  success.

**C-8 — The composer does not look or behave like Harmonic.**
- Fix: match upstream's editor. Quote the parent comment above the editor (author, first lines,
  collapsible), add a single multiline field with a "Formatting help" link to HN's
  `formatdoc`, and keep Post and Cancel at the bottom right, with "Posting as <user>" in
  secondary text. On desktop it opens inline beneath the comment being replied to. For a
  top-level reply it opens at the top of the comments section. Esc cancels (draft kept).
  Ctrl/Cmd+Enter posts.

### 3.3 Search

**S-1 — Story hits are classified as comments.**
- Evidence: `validateHit` in `hn-search.js` (around line 98) says "story hits never [carry
  story_id]". Live Algolia returns `story_id: 27016630` and `_tags: ["story", …]` for story
  27016630. The synthetic search fixtures omit `story_id` on stories, so tests pass.
- Fix: classify by `_tags` (`"comment"` vs `"story"`/`"poll"`/`"job"`) with `comment_text !== null`
  as a cross-check. Reject only true contradictions. Regenerate the search fixtures from captured
  live responses (F0).

**S-2 — Comment results print raw HTML.**
- Evidence: comment highlight values contain `<p>`, `<a href="…" rel="nofollow">`, `<i>`, `<pre>`
  and HTML entities, while `buildHighlightSegments` only understands `<em>`.
- Fix: parse highlight strings in an inert `DOMParser` document and walk text nodes only. Keep
  `<em>` as highlight spans, turn `<p>` into a paragraph break, and render `<a>` as its text. Every
  other element contributes only its text. Entities are decoded by the parser. Add hostile-input
  tests for `<img onerror>`, `<script>`, and nested `<em>` (SEC-40 still holds: nothing is ever
  inserted as HTML).

**S-3 — The search model is confusing and loses focus.**
- Evidence: the panel opens on "Loaded stories". Clicking "All of Hacker News" moves focus to the
  tab, so typing goes nowhere. A query of four or more characters fires a request every 300 ms,
  replaces results with a spinner each time, and stores partial queries ("s", "sq", "sql") in
  recents.
- Fix (upstream `StoriesSearchHeader` behaviour): one search field. Typing filters the loaded feed
  instantly and locally. The first result row reads "Search Hacker News for "…" ↵". Enter (or
  that row) runs the Algolia search. Recents are stored only on submit. Filter chips never take
  focus from the field (`mousedown` → `preventDefault`). Changing a filter re-runs the last
  *submitted* query.

**S-4 — There is a blank gap and the layout jumps.**
- Evidence: `syncSearchPanelSpace` sets `storyList.style.paddingTop = 108 + height + 12 + "px"`
  (`content.js` around line 2120), which leaves about 165 px of blank space and jumps whenever
  the panel height changes.
- Fix: put the search panel in normal document flow inside the sticky list header, and drop the
  padding hack.

**S-5 — Results look and behave unlike the feed.**
- Evidence: results are small text rows with an "Open comment" button, plus a "Load more results"
  button. Every result card requests a link preview at once, which creates a request storm and
  404 or `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` image errors.
- Fix: story results reuse the feed card component (title, domain, points, comment count, age,
  thumbnail). Comment results use a compact card: story title on top, author and age, then a
  highlighted snippet. Clicking anywhere on the card opens it. Use infinite scroll, as in the feed.
  Load previews lazily with `IntersectionObserver`, at most 3 in flight, using the shared cache,
  and on image error remove the image without retrying.

**S-6 — Opening a comment hit does not land on the comment.**
- Evidence: `openThreadAtComment` polls for 8 seconds for the row. Collapsed ancestors and lazy
  rendering mean it often never appears, and there is no highlight.
- Fix: `renderThread` resolves a promise once the comment rows exist. The opener expands every
  collapsed ancestor of the target, scrolls it to centre, and plays a short highlight flash.
  If the comment is missing (deleted or not indexed), say "That comment is no longer in the
  thread".

**S-7 — Results flash and arrive out of order.**
- Fix: one `AbortController` per submitted query, and responses older than the latest request
  are ignored. Old results stay visible with a thin progress bar while the new query runs
  (no full-pane spinner).

**S-8 — Leaving search breaks the feed.**
- Evidence: `restoreFeedList` re-renders the feed and loses its scroll position. Feed refresh and
  `loadMoreStories` may still be running when search starts.
- Fix: snapshot the feed scroll position and selection when entering search, and restore both on
  Esc or clear. Pause feed refresh and pagination while search is active, and cancel in-flight
  feed requests on entry.

**S-9 — Old ages read as "283w".**
- Fix: the age formatter (`content.js` around line 211) moves to `m`, `h`, `d`, `mo`, `y` past
  8 weeks, as upstream does (`5y`).

**S-10 — Keyboard support is missing.**
- Fix: `/` focuses search, Esc clears and then closes, ↑ and ↓ move through results, and Enter
  opens the selected one.

### 3.4 Visual and Harmonic guidelines

Upstream rule of thumb: actions live in **one** compact row or in an overlay, never as extra rows
of tiny icons. Secondary actions go into "More".

**U-1 — The thread header wraps onto two rows.**
- Evidence: `.thread-actions` is `grid-template-columns: repeat(7, 1fr)` (`styles.css` around
  line 448), but the branch puts 9 buttons in it (user, comments, upvote, favorite, hide,
  bookmark, summarize, share, more), so Share and More wrap onto a second row.
- Fix: restore `main`'s seven: **user, comments, upvote, bookmark, summarize, share, more**.
  Favorite, Hide, Flag, "Reply to story" and "Open on Hacker News" move into **More**. The
  upvote icon fills and takes the accent colour when active.

**U-2 — Every comment carries an icon row.**
- Evidence: `renderComment` (`content.js` around line 2950) appends `comment-actions` (vote,
  down, reply, edit, delete, more) to every card, even when logged out. That adds about 24 px to
  each comment and floods the thread with tiny unlabeled icons.
- Fix: remove the row. Follow upstream `CommentsScreen.kt`: **click toggles collapse**, while
  **long-press, right-click, or the `a` key** on a focused comment opens the comment action overlay.
  Keep a "swap tap and long-press" setting, as upstream does. The overlay contains: author
  button (with "(OP)"), the comment body, a divider, then *Vote up / Vote down / Unvote* (only
  when signed in, and *Vote down* only when HN offers it), *Bookmark*, *Favorite* (signed in),
  *Copy text*, *Share link*, *Edit / Delete* (own comments, within HN's window), and a full-width
  *Reply* (signed in and less than 14 days old). For discoverability, a single faint `⋯`
  appears on hover only, at the right of the comment meta line.
- A voted comment shows a small accent-coloured arrow before the age in the meta line; that is
  the only persistent vote indicator.

**U-3 — "new" badges appear on every comment on first visit.**
- Evidence: `seenTimes.get(storyId) || 0` makes every comment newer than "never".
- Fix: mark comments new only when a previous visit time exists. Show it as upstream does, with a
  thin accent bar or dot instead of a pill badge.

**U-4 — Avatars, OP pills and tag chips crowd the meta line.**
- Fix: avatars are off by default (opt-in setting). OP becomes "(OP)" in accent text, as
  upstream does. User tags stay, but as plain secondary text.

**U-5 — The comments heading is cluttered.**
- Evidence: tiny "Top / Prev / Next" pills and a "Filter comments" input sit next to the
  "98 comments" heading.
- Fix: upstream uses a floating bottom-right pill with previous and next buttons (long-press
  jumps to first or last). Reproduce that as a small floating control. Move "Filter comments"
  into More → "Search in comments", which opens an inline find bar.

**U-6 — The list toolbar is crowded.**
- Evidence: the top bar now holds search, refresh, "+" (new post), "⋮", and a "Log in" chip, and
  the title shrinks.
- Fix: keep search, refresh and "⋮". "New post" and the account entry (Log in or the username
  with karma) move into the "⋮" menu, matching upstream where account and submit live in the
  overflow menu.

**U-7 — Story cards grew and got noisier.**
- Evidence: an extra `⋮` button wraps onto its own line under the meta text (card 1 in the
  screenshot), and points are now orange via hotness colours. Card tints are more saturated than
  `main`'s.
- Fix: remove the per-card `⋮`; card actions move to right-click or long-press on the card, as
  upstream does. Hotness colours are off by default. Bring tint opacity back to `main`'s values.

**U-8 — Settings is one long panel.**
- Evidence: one scrolling panel of about 41 rows with toggles.
- Fix: use upstream's categorised navigation: a top list (Appearance, Stories, Comments, Web and
  links, Filters and tags, Account, Data, About), where each entry opens its own sub-page with a
  back arrow. Keep the same storage keys so no migration is needed.

**U-9 — The feed menu has 15 entries.**
- Fix: match upstream's feed picker. It shows the core feeds (Top, New, Best, Ask, Show, Jobs)
  plus whichever extra feeds the user enabled in Settings → Stories → "Feeds". The order is
  editable there.

**U-10 — The user overlay is cramped and blocks the page.**
- Fix: upstream's user sheet shows the name, karma, created date and about text, then tabs
  (Submissions / Comments / Favorites) styled as segmented chips. Make it a side sheet in the
  thread pane instead of a centred modal. Esc and a click outside close it, and links open
  inside Harmonic.

**U-11 — `hn.js` crashes on clicks over our SVG icons.**
- Evidence: page error `el.className.split is not a function`. HN's `classes()` assumes
  `className` is a string, but SVG elements have `SVGAnimatedString`.
- Fix: stop propagation of `click` events at the Harmonic root container (`hn.js` handlers are
  not needed inside our UI), and set `pointer-events: none` on icon SVGs so the event target is
  always the button.

**U-12 — Images fail to load.**
- Fix: never set `crossorigin` on thumbnails. On `error`, remove the image and remember the
  failure in the preview cache for 24 hours so it is not retried on every render.

### 3.5 Tests and code quality

**Q-1 — The tests are tautological.**
- Root cause: logged-in fixtures were generated synthetically from guessed markup. The mocks
  answer `js=t` votes with full documents, model Algolia hits without `story_id`, and serve the
  item page immediately after a post with Algolia already updated.
- Fix: phase F0.

**Q-2 — `content.js` grew from 1,430 to 4,219 lines, with mixed indentation.**
- Fix (phase F6, after behaviour is correct): split into ordered content scripts with no bundler,
  each wrapped in the same IIFE namespace, for example `ui-core.js`, `feed.js`, `thread.js`,
  `comments.js`, `composer.js`, `search-ui.js`, `settings-ui.js` and `account-ui.js`. Run Prettier
  once in its own commit.

---

## 4. Fix phases

Each phase ships as its own PR with a version bump. A phase may not start until the previous
phase's gates pass.

### Phase F0 — Make the test doubles faithful (0.12.3)

1. **Capture real logged-in pages without exposing credentials.**
   - Add `scripts/capture-hn-fixtures.mjs`. It launches a *headed* Chromium with a fresh profile
     and opens `https://news.ycombinator.com/login`; **the user** signs in themselves (the script
     never sees or types a password, per SEC-01). It then visits a fixed list of pages: a story,
     an upvoted story, a downvotable comment, an own comment within the edit window, a locked
     thread, `/reply?id=`, `/submit`, `/favorites`, `/upvoted`, and a list page with votes. It
     also performs **one** vote → unvote on a story the user chooses and records the raw `js=t`
     reply bytes.
   - Before writing anything to disk, the script redacts: every `auth=`, `hmac`, `fnid` and
     `acct`/`pw` value, plus the `user` cookie (never read). The username becomes
     `harmonic_test`, and karma becomes a fixed number. A post-capture check fails the run if
     any 40-hex-character token or the original username remains.
   - Output goes to `tests/fixtures/real/`. A short README records the capture date and what was
     redacted.
   - **This step needs the user to sign in during the capture.**
2. **Make the mocks faithful.**
   - `/vote?…&js=t` returns the captured reply (expected: empty or near-empty 200). Non-`js`
     votes 302 to `goto`.
   - `POST /comment` 302s to the item page **with the new comment present**, while the Algolia
     mock keeps returning the *old* tree for a configurable delay.
   - Algolia search fixtures are captured live (`tags=story`, `tags=comment`, `tags=ask_hn`, and a
     query with `&`, quotes and code) and include `story_id`, `_tags` and HTML highlights.
3. **Turn the audit cases into regression tests first, so they fail before the fixes:** the empty
   `js=t` reply, downvote read-back, a vote before state loads, a comment missing from Algolia
   after posting, story hits with `story_id`, HTML in comment highlights, and the hn.js SVG page
   error (assert no `pageerror` events).
4. **Add a visual regression harness:** fixed viewport screenshots of the feed, thread header,
   comments, comment overlay, search (empty, typing, results) and settings, compared against
   reviewed baselines in `tests/visual/`. The `main` 0.7.2 shots are the initial reference for
   the header and comments.

Gate: the new regression tests fail on 0.12.2 for the reasons listed in section 3.

### Phase F1 — Voting (0.12.4)

Fixes V-1 to V-5.
- `hn-session.js`: in `vote()`, compute the result locally and drop the vote-link parsing on the
  reply. Classify with `classifyDoc` only to detect login, rate-limit, validation and expired
  replies. On indeterminate, run one confirming `ensureItemState(itemId, { force: true })`.
- `parseVoteLinks`: read direction from the `unv_` span and `un_` link text, and visibility from
  `nosee`. Delete the `.votearrow` heuristic.
- One `vote` token per item. Vote-token max age becomes 30 minutes; other mutation tokens keep
  60 seconds.
- `content.js`: add a pending-state queue for votes clicked before item state arrives. Keep the
  optimistic UI; roll back only on a definitive failure.
- Feed vote badges come from list pages when signed in (V-5).
- Security re-check: SEC-14 (exact params), SEC-30 (trusted clicks), SEC-32 (one in flight),
  SEC-33 (single retry) and SEC-35 (account change clears tokens).

Gate: the realistic voting suite passes, and a manual live check with the user's account (one
story upvote, unvote, comment upvote and unvote, downvote and undown if the account has the karma)
behaves exactly like HN's own UI.

### Phase F2 — Commenting (0.12.5)

Fixes C-1 to C-8.
- `hn-session.js`: `postComment` returns `{ status, newComment: { id, parentId, html } }`, parsed
  from the redirected item page. `html` goes through the same sanitizer as all comment bodies.
  Success requires the new comment to be found (C-7). Top-level comments use the item-state
  form (C-3). `openReplyForm` is called when the composer opens (C-4).
- `content.js`: insert the comment locally and merge it with later Algolia data (C-1, C-2). Add
  the reply eligibility rules (C-5), `formatHnPreview` (C-6) and the Harmonic composer layout (C-8).
- Security re-check: SEC-34 (POST never retried), draft-handling rules, and sanitizer coverage for
  the parsed new-comment HTML.

Gate: post, edit and delete against the realistic mock with Algolia delayed by 120 seconds; the
comment appears immediately, in the right place, without a scroll jump. Then a live check posts
and deletes one test reply in a thread the user picks.

### Phase F3 — Search (0.12.6)

Fixes S-1 to S-10.
- `hn-search.js`: classify by `_tags` (S-1). Add `buildHighlightSegments` v2 based on an inert
  `DOMParser` document (S-2). `runSearch` accepts a request sequence number (S-7).
- `content.js`: one field with a local live filter and global search on Enter (S-3), the panel in
  normal flow (S-4), feed card reuse with lazy previews and infinite scroll (S-5), a reliable jump
  to the comment (S-6), feed snapshot and restore (S-8), the age format (S-9) and keyboard
  support (S-10).

Gate: live Algolia smoke tests (`test:live`) for story, comment and Ask queries, plus a
hostile-highlight unit test. No layout shift above 0.01 CLS while typing (Playwright
`PerformanceObserver`).

### Phase F4 — Harmonic visual parity (0.12.7)

Fixes U-1 to U-12, using the screenshots in `ref/` and upstream sources as the spec.
- Thread header (U-1), comment overlay with tap and long-press (U-2), new markers (U-3), the meta
  line (U-4), floating comment navigation (U-5), toolbar (U-6), cards (U-7), categorised settings
  (U-8), feed picker (U-9), user sheet (U-10), the hn.js crash (U-11) and image errors (U-12).
- Defaults return to `main`'s look: avatars off, hotness off, tint values from 0.7.2. Every new
  feature stays reachable, through More, the overlay, or Settings.

Gate: the visual regression set has been reviewed side by side with `main` and `ref/`. A reviewer
sign-off is recorded in the PR, and no `pageerror` events occur in any e2e run.

### Phase F5 — Hardening and release (0.13.0)

- Full suite, `test:security`, `test:security:browser` and `test:links`.
- Live manual checklist with the user's account, run by the user: sign in, vote and unvote story
  and comment, downvote (if eligible), comment, edit, delete, favorite and unfavorite, hide and
  unhide, submit a test post (optional), log out. Then verify that no token, `hmac` or `fnid`
  appears in `chrome.storage`, the DOM, console output or extension messages (SEC-xx audit
  script from `implementation-plan.md`).
- Update `CHANGELOG.md` and the store listing screenshots.

### Phase F6 — Structure cleanup (0.13.1, optional)

- Split `content.js` as described in Q-2, with no behaviour change. The visual and e2e suites
  must be byte-for-byte green before and after. Prettier runs in a separate commit.

---

## 5. Security rules that the fixes must not weaken

- No password fields, ever. Sign-in is HN's own page (SEC-01). The capture script relies on the
  user signing in by hand.
- `auth`, `hmac` and `fnid` stay inside the `hn-session.js` closure, and are never written to the
  DOM, storage, logs or messages. The new `newComment` result carries no tokens.
- Mutations require trusted user events (SEC-30), one in flight per item (SEC-32), at most one
  retry for votes and token actions (SEC-33), and no retry for POSTs (SEC-34).
- An account change clears every token and in-flight action (SEC-35).
- All HN and Algolia HTML is sanitized or text-only (SEC-40). The new highlight parser and
  composer preview never use `innerHTML` on live documents.
- Fixture capture redacts tokens before disk and fails closed if any remain.

---

## 6. Open decisions

1. **Real fixture capture (F0.1)** needs the user to sign in once in a headed browser launched by
   the capture script, and to choose a story for the vote round-trip and a thread for one test
   reply. Without it, F1 and F2 can still be built against the documented HN behaviour, but the
   final confirmation has to come from the live checklist.
2. **Comment click behaviour:** whether to use upstream's default (click collapses, long-press or
   right-click opens actions) or start with the swapped mode (click opens actions). The plan
   assumes upstream's default, with the swap setting available.
3. **Phase F6** (splitting `content.js`): do it now, or defer until after release.
