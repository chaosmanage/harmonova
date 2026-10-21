# Hide seen stories: implementation and validation plan

Branch: `feature/hide-seen-stories` (isolated worktree, branched from `e195e35`). This feature changes no existing user preference without consent.

## Product contract

Exactly one global Stories preference: `scrolledStoryBehavior` with values `off`, `track`, `dim`, `future`, `immediate`. Default is `off`; keep existing preferences through upgrades.

| Mode | Record crossed story IDs? | Immediate appearance | Newly reconstructed feed |
| --- | --- | --- | --- |
| Off (default) | No | Unchanged | Unchanged |
| Track only | Yes | Unchanged | Do not exclude skipped IDs |
| Grey out | Yes | Dim crossed cards | Render skipped IDs dimmed |
| Hide on next load (recommended) | Yes | Dim crossed cards, do not remove them | Exclude skipped IDs, refill batch |
| Hide immediately | Yes | Remove fully crossed cards and restore scroll anchor | Exclude skipped IDs, refill batch |

All modes respect the independent legacy Hide read preference. Disabling tracking does not delete earlier skipped history; Delete history does. Opened/read IDs and scrolled-past IDs retain different meanings.

## Recording model

- Each story is identified by the exact positive safe-integer Hacker News item ID. IDs are shared across Top/New/Best/Ask/Show/parity lists; never key by feed, title or display rank.
- User-initiated downward scrolls within the story list record cards whose lower edge crosses the list's top viewport edge; initial rendering, programmatic scroll restoration and search display do not mark skips. Fast scrolls may cross multiple cards in one event.
- In future mode, retain the currently rendered DOM nodes and their ordering even after they become skipped. Class `.is-skipped` applies immediate dimming; a later feed construction excludes saved skip IDs.
- In immediate mode, remove only fully crossed cards above the viewport. Compensate `scrollTop` by removed scroll height, disable overflow anchoring briefly, and remove the stories from the in-memory rendered-feed collection.
- Skipped IDs persist via a dedicated bounded bulk `HARMONOVA_MARK_SKIPPED_BATCH` worker operation and the serialized reader repository. Flush on a timer or pagehide; preserve unsaved IDs for retry on failed writes. User context menus can unmark an individual skipped item.

## Storage and privacy

- Extend reader state v1 with optional `skippedIds` (up to 10,000 recent IDs). Older records without the field normalize to an empty list; avoid a destructive schema migration.
- Keep incognito in memory, separate from regular profile storage. Synchronize committed IDs to other regular tabs via the existing revisioned reader snapshots.
- Add the validated import/export field `skippedStoryIds`, with old exports remaining valid. Respect the existing JSON import size limit. History reset removes opened/read history, skipped IDs and comment visit markers.
- Validate every message sender, message field, item ID, and bounded batch at the worker message boundary.

## Source traversal and pagination

- Single `fillStoryBatch(target)` algorithm, target 20 on initial load and 32 on Load more. Scan ordered source IDs using `feedCursor` as the number of source IDs consumed, not the number of cards displayed.
- Filter by known hidden read/skip IDs **before** per-item Firebase fetches. After metadata arrives, apply hide-jobs, domain and keyword filters. Continue scanning for replacements until target, source exhaustion, or a finite per-invocation safety limit.
- Firebase feeds use existing ordered ID arrays. HTML-based parity feeds preserve `nextPagePath` and request the next allowlisted HN list page on demand. Deduplicate repeated IDs and next-page URLs, and preserve original source ordering.
- Both initial and appended cards are eligible by active settings; never synthesize unrelated recommendations or claim to have exhausted a feed because of a scan limit. Offer a retry/continue control if additional source candidates remain.
- Abort/ignore stale responses on feed switch or refresh using existing lifecycle scope and generation guards. A single failed story-detail request should not blank the rest of the feed. Best Comments retains its specialized comment-row semantics.

## UX details

- Radio-style Stories fieldset follows screenshot wording; label the future mode `(recommended)` without enabling it by default. All five values form one exclusive setting.
- The first story is not silently marked read merely because it was preselected by the UI.
- After true exhaustion, show an honest caught-up empty state. Newly enabled visibility filters reconstruct the feed so eligible cards are replenished.
- Immediate hiding can make upward scrolling impossible to removed cards; this is intentional and explained in Settings. Recommended deferred hiding avoids that effect.

## Testing checklist

1. Defaults: Off is normalized, no new tracking when disabled; existing saved preferences remain intact.
2. Storage: bounded batch validation, idempotence, import/export, migration, preservation of read IDs, history reset, cross-tab synchronization, incognito isolation.
3. Initial feed: 19 of first 20 IDs skipped -> 20 eligible rendered; do not fetch details for known hidden IDs.
4. Load more: 31 of next candidates skipped -> 32 additional eligible stories; preserve rank and ordering, do not duplicate items.
5. Deferred mode: scroll past -> immediately dim, retain DOM cards when scrolling back, hide them after reload and fetch replacements.
6. Immediate mode: remove fully crossed cards while keeping remaining cards visible; never remove unpassed cards due to an initial load.
7. HTML parity: a completely skipped first page continues to a second page and fills the initial batch.
8. Errors: missing items, network failures, stale feed generation, sparse/exhausted source, bounded resource use, explicit continuation.
9. Run static checks, unit tests, browser smoke/regression, packaged-extension checks and package the test zip.

## Release procedure

- Work only on isolated branch/worktree; preserve unrelated modified files in main.
- After checks, commit feature and documentation, create the extension zip through the repository packaging script, and provide the exact artifact location and test results.
