# Harmonic HN Browser

A Chrome/Chromium extension that turns Hacker News into a desktop browser version of the **Harmonic** reading experience.

The project exists for a very specific reason: Hacker News is excellent to read, but its stock web UI is deliberately minimal. Harmonic provides a much richer, calmer, highly readable mobile experience. The goal here is to preserve normal browser behavior while making `news.ycombinator.com` look and behave as close to Harmonic as practical on a laptop.

## Product goal

This is **not** intended to be a generic "modern Hacker News redesign."

The target is a faithful browser adaptation of Harmonic:

- the same AMOLED-first dark reading surface
- the same colorful/tinted story cards
- preview images and favicons
- large comment-count affordances
- a two-pane story/discussion layout on laptops
- Harmonic-like discussion headers and action buttons
- readable outlined comments with colored nesting/depth indicators
- click-to-collapse comment threads
- feed selector, search, refresh, overflow menus, and display settings
- native browser behavior for external articles

On desktop, the extra screen width is used to keep the story feed visible on the left while the selected discussion remains readable on the right.

## Original request / design brief

The initial request was to make the Hacker News experience in Chrome feel like the Harmonic app on a phone, with a smaller first scope focused on **reading and scrolling** rather than account features.

The current priorities are:

1. Reading quality and visual fidelity to Harmonic.
2. Fast browsing through Top/New/Best/Ask/Show/Jobs.
3. Large, obvious comment buttons that open discussions in the Harmonic reader.
4. External article links open in a **new browser tab**.
5. Comment threads are comfortable to scan, nested, colored, and collapsible.
6. Settings mirror Harmonic's display controls where they make sense in a browser.
7. No login, voting, posting, or commenting is required for the MVP.

## Current MVP

### Feed

- Top Stories, New, Best, Ask HN, Show HN, and Jobs
- Harmonic-style tinted cards
- OpenGraph preview images when a page exposes one
- Site favicons
- story score, source domain, age, and large comment count
- local read-state dimming
- search across loaded stories
- refresh control
- configurable title size and card metadata
- article/title/preview opens the external article in a new tab
- comment button keeps the browser on Hacker News and loads the discussion pane

### Discussion reader

- Harmonic-style tinted header
- large preview/hero image
- title, domain, score, comment count, age, and author
- large action row
- nested comment cards
- colored depth rails
- click a comment card to collapse/expand its branch
- comment sorting controls
- collapse all / expand all
- sanitized Hacker News HTML
- links inside comments open in a new tab

### Settings

The extension currently exposes Harmonic-inspired settings for:

- preview image size
- image-based card tinting
- favicons
- points
- comment count
- story number
- read-story dimming
- story text size
- comment card style
- comment depth palette
- rounded depth indicators
- continuous depth rails
- comment text size
- discussion-header tint
- discussion-header preview image
- whether article clicks should also open the discussion

Settings and read state are stored locally in the Chrome profile.

## Intentionally out of scope for the MVP

These are not implemented yet:

- Hacker News login
- voting
- submitting stories
- posting/replying to comments
- account synchronization
- exact parity with every Harmonic mobile-only feature
- AI summary/reader features

Buttons for unavailable authenticated features make that limitation explicit rather than silently failing.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this repository folder, or an extracted release package.
6. Open `https://news.ycombinator.com/news`.

When replacing an older build, remove the old unpacked extension or select **Reload** on its extension card, then hard-refresh Hacker News.

## Build a release zip

```bash
npm install
npm run package
```

The packaged extension is written to `dist/`.

## Browser verification

The repository includes a Chromium end-to-end smoke test. It launches the unpacked extension at a **1919×872** laptop viewport and verifies the interactions that previously regressed:

- feed renders at least 30 cards
- left feed actually scrolls with a wheel event
- right discussion pane actually scrolls
- the large comment button changes the selected Hacker News discussion
- Settings opens and contains the expected controls
- clicking a comment collapses its branch
- clicking an article opens a separate tab
- the main Harmonic reader remains on `news.ycombinator.com`

Run:

```bash
npm install
npm run test:e2e
```

To test an extracted release rather than the working tree:

```bash
EXTENSION_PATH=/path/to/extracted-release npm run test:e2e
```

A screenshot from the tested viewport is written to `test-results/harmonic-1919x872.png`.

## Architecture

The MVP deliberately stays small:

- `manifest.json` — Manifest V3 configuration
- `content.js` — feed, reader, interactions, settings, HN/Algolia data loading
- `styles.css` — Harmonic desktop adaptation
- `background.js` — cross-origin article metadata, preview-image lookup, and palette extraction
- `tests/e2e.mjs` — Chromium interaction test
- `scripts/package.sh` — creates a clean release package

The Hacker News Firebase API supplies story feeds/items. The Algolia HN API is used for discussion trees so large threads can render without hundreds of serial item requests.

## Permissions

The extension runs only on `news.ycombinator.com`.

It asks for broad HTTP/HTTPS host access because Harmonic-style cards require fetching metadata and preview images from arbitrary story domains. That access is used by the extension background worker for link-preview metadata; it is not used for browsing history collection or analytics.

## Design source and attribution

The visual and interaction reference is:

- Harmonic-HN by Simon Halvdansson: https://github.com/SimonHalvdansson/Harmonic-HN/

Harmonic is licensed under Apache-2.0. This project studies its public implementation, screenshots, theme values, story-row behavior, comment-depth treatment, and settings model in order to create a browser adaptation.

This repository is not an official Harmonic release and is not affiliated with Hacker News/Y Combinator.

## Development rule

A build should not be handed off for manual testing unless **the exact packaged release** has first passed `npm run test:e2e` in Chromium at the target laptop viewport. This rule exists because testing only the development folder previously allowed a stale/broken package to be shared.

## Near-term roadmap

- closer typography matching to Harmonic's packaged font choices without redistributing font files
- better parity for every story-card layout mode
- mobile/narrow-browser back navigation polish
- more exact menu/settings organization
- keyboard navigation
- optional favorites/read-state tooling
- additional regression screenshots at common laptop widths

The north star remains the same: **Harmonic on the web, not merely prettier Hacker News.**
