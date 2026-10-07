# Harmonic HN for Chrome

A Chrome extension that turns Hacker News into a desktop/laptop version of the **Harmonic** reading experience.

This project exists because Harmonic is an excellent way to browse Hacker News on a phone/tablet, while the stock Hacker News website is intentionally minimal. The goal here is not to make a generic “modern HN skin.” The target is a browser-native reader that feels as close as practical to Harmonic: the same reading density, dark visual language, tinted story cards, preview imagery, large comment affordances, thread depth indicators, typography hierarchy, interaction patterns, and settings philosophy.

> This is an independent browser extension inspired by [SimonHalvdansson/Harmonic-HN](https://github.com/SimonHalvdansson/Harmonic-HN). It is not an official Harmonic release and is not affiliated with the upstream author.

## Product goal

The original product request is:

> Bring the Harmonic Hacker News UI/UX to a laptop browser. Keep Hacker News inside Chrome, preserve normal browser behavior, and make reading + scrolling feel like Harmonic. Start with the read-only experience; login, voting, posting, and commenting are not required for the MVP.

The intended end state is effectively **“Harmonic for the browser.”**

That means visual parity is only half of the goal. The extension should also behave like a serious reader:

- Story feeds must scroll smoothly and independently from the discussion pane.
- Story titles and article preview images open the external article in a new tab.
- The large comments control opens the story discussion.
- On wide screens, stories and comments can coexist in a two-pane layout.
- On narrow screens, the UI behaves like a single-pane Harmonic reader.
- Comment threads are readable, nested, colored by depth, and collapsible.
- Browser back/forward navigation continues to work.
- Read state and bookmarks are local.
- Settings change the live UI without requiring a rebuild.
- Hacker News URLs remain real/shareable URLs rather than extension-only routes.

## Current status

The extension is a functional work in progress. The current branch is focused on the **reading experience first** and deliberately does not implement Hacker News authentication.

Working now:

- Top, New, Best, Ask HN, Show HN, and Jobs feeds.
- Harmonic-style AMOLED/dark presentation.
- Tinted story cards derived from article preview images.
- Article preview images and favicons.
- Large story comment controls.
- Article/title links opening in new tabs.
- Wide-screen two-pane feed + discussion reader.
- Independent feed and discussion scrolling.
- Algolia-backed full comment trees.
- Colored nested thread indicators.
- Click-to-collapse / click-to-expand comment branches.
- Browser history/back behavior for story discussions.
- Local read-state persistence.
- Local bookmarks.
- Harmonic-style settings panel.
- Preview size, card tint, favicons, points, comment count, story index, read dimming, story text size, comment style, depth palette, rail behavior, comment size, and header display settings.
- Story search/filter within the currently loaded feed.
- Responsive narrow-window mode.

Not implemented yet:

- Hacker News login.
- Voting through an authenticated HN session.
- Writing/replying to comments.
- Submitting stories.
- Full parity with every Harmonic preference.
- Harmonic’s complete reader/article tooling.
- Every animation and transition from the native Compose app.
- Pixel-perfect font parity on systems that do not already have Google/Product Sans-family fonts.

## UX contract

The project should be evaluated against Harmonic itself, not against a generic desktop news reader.

### Story list

Story cards should preserve Harmonic’s visual hierarchy:

**title → points/source/age → preview → large comment affordance**

Cards may be tinted from the article image, with sensible dark fallbacks when preview metadata cannot be loaded. Read stories may be dimmed. The feed header contains the feed selector, search, overflow menu, last-updated status, and a floating **Tap to update** control.

### Discussion view

The discussion pane should feel like Harmonic’s comment screen:

- Optional/tinted preview header.
- Large story title and source metadata.
- Harmonic-style action row.
- Dark comment surfaces.
- Per-depth colored thread rails.
- Compact author + age metadata.
- Readable long-form text, code blocks, quotations, and links.
- Collapsible branches.
- Links inside comments open in new tabs.

### Desktop adaptation

Harmonic is a mobile/tablet app, so exact desktop parity does not mean stretching a phone screenshot to 1500 px.

On sufficiently wide browser windows, this extension adapts the same UI language into a two-pane layout:

```text
┌───────────────────────────┬───────────────────────────────────────┐
│ Harmonic story feed       │ Selected story + discussion           │
│                           │                                       │
│ tinted story card         │ preview/header                        │
│ tinted story card         │ title + metadata                      │
│ tinted story card         │ actions                               │
│ ...                       │ comments                              │
│                           │ ...                                   │
└───────────────────────────┴───────────────────────────────────────┘
```

Each pane scrolls independently.

On narrow windows, the layout becomes a single-pane reader closer to the original mobile app.

## Data sources

The extension uses public Hacker News data:

- **Official Hacker News Firebase API** for story feeds and item metadata.
- **HN Algolia API** for loading discussion trees efficiently.
- Public article HTML metadata for preview images.
- Google’s public favicon service as the default favicon source, matching Harmonic’s default preference.

No Hacker News credentials are required for the current read-only feature set.

## Permissions

The extension currently requests:

- `storage`: stores local settings, read-story IDs, and local bookmarks.
- `http://*/*` and `https://*/*`: retrieves public article metadata so cards can show Harmonic-style preview images/tints.

Article metadata is fetched by the extension background worker. It is not used for login/session access.

A future release should narrow or make broad article-host access optional where practical.

## Install from source

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder — the folder containing `manifest.json`.
6. Open `https://news.ycombinator.com/news`.

When updating the source locally, use the **Reload** button for the extension on `chrome://extensions`, then refresh Hacker News.

## Build/package

There is no framework or compilation step in the current MVP. The extension is intentionally plain Manifest V3 JavaScript + CSS while the interaction model is still being refined.

Create an installable source archive with:

```bash
./scripts/package.sh
```

The generated zip is placed in `dist/`.

## Development

The important files are:

```text
manifest.json   Chrome MV3 manifest and permissions
content.js      HN data loading, rendering, routing, interactions, settings
background.js   Cross-origin article metadata + image tint extraction
styles.css      Harmonic visual system and responsive layout
```

### Manual test checklist

Before calling a change working, test at minimum:

1. Open `/news` and confirm at least 30–40 story cards render.
2. Scroll the story list with the pointer over the left pane.
3. Scroll the comments with the pointer over the right pane.
4. Click a large comments control and confirm the selected discussion changes.
5. Click an article title and confirm the article opens in a new tab.
6. Open a comment link and confirm it opens in a new tab.
7. Collapse and re-expand a comment branch.
8. Use browser Back after selecting a discussion.
9. Change feed using the title dropdown.
10. Open Settings and change at least one story and one comment preference.
11. Reload HN and confirm persisted preferences/read state.
12. Test both a wide desktop viewport and a narrow viewport.

## Architecture

The MVP deliberately avoids React/WXT while the behavior is still changing quickly.

```text
news.ycombinator.com
        │
        ▼
  content script
        │
        ├── HN Firebase API ── story/feed data
        ├── HN Algolia API ─── discussion tree
        │
        └── extension background worker
                 │
                 └── public article page/image metadata
```

The content script replaces the stock Hacker News presentation only on supported HN feed/item routes. Unsupported HN pages continue to use the normal site.

Once the product behavior stabilizes, the UI can be split into modules or migrated to a component framework if that materially improves maintenance. Framework migration is not itself a product goal.

## Design reference

The primary design and behavior reference is:

- [Harmonic-HN](https://github.com/SimonHalvdansson/Harmonic-HN/)
- Harmonic’s checked-in screenshots under its Fastlane metadata.
- Harmonic’s Compose implementations of story rows, preview rails, comment rows, headers, theme catalog, depth palettes, and stored user settings.

The implementation here is written for the browser; it does not attempt to run the Compose UI inside Chrome.

## MVP boundaries

The first useful release is intentionally reading-first. The priority order is:

1. Reading and scrolling must be reliable.
2. Story → article and story → comments interactions must be obvious and correct.
3. Comments must remain readable even for very large/deep discussions.
4. Visual behavior should converge toward Harmonic.
5. Settings should expose the most important Harmonic presentation choices.
6. Authentication/writing features come later.

A feature that makes the UI more visually exact but breaks scrolling, navigation, or comment reading is considered a regression.

## Roadmap

Near-term work:

- Continue visual parity against Harmonic screenshots at laptop-scale.
- Tune card tint extraction and fallback colors.
- Improve preview-image loading/caching.
- Match more of Harmonic’s settings and menus.
- Add keyboard navigation appropriate for desktop without changing normal browser link semantics.
- Improve very large-thread performance.
- Add comment search.
- Add optional reader/article tooling.
- Add automated browser regression tests.

Later, if desired:

- HN authentication.
- Voting.
- Replying/commenting.
- Submission.
- User/profile screens.
- More complete Harmonic feature parity.

## Upstream attribution

Harmonic-HN is created by Simon Halvdansson and is licensed under Apache-2.0. This browser project uses Harmonic as its design/product reference. See the upstream repository for the original application, source, screenshots, and license.

## License

Apache-2.0. See `LICENSE`.
