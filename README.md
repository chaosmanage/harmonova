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

The current extension version is **0.7.2**.

Version 0.7.2 compacts the discussion story header so more comments fit onscreen, while retaining one-click OpenRouter summaries and private API-key storage. See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

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
- OpenGraph preview images when a page exposes one
- source favicons
- score, source domain, age, and comment count
- local read-state dimming
- search across loaded stories
- incremental feed loading while scrolling
- a refresh control
- configurable story typography and zoom
- configurable preview image behavior
- article/title/preview links that can open the external article in a new tab
- a large comment affordance that keeps the reader on Hacker News and opens the discussion pane

## Discussion reader

The discussion pane includes:

- a Harmonic-style tinted header
- optional hero/preview image
- title, domain, score, comment count, age, and author
- action buttons for common reading workflows
- nested comment cards
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
- `styles.css` — Harmonic desktop adaptation and summary/settings presentation scoped to `html.harmonic-hn`
- `background.js` — preview metadata, image palette extraction, font retrieval, private local state, article extraction, OpenRouter streaming, and per-tab original-HN state
- `popup.html` / `popup.css` / `popup.js` — toolbar popup for enable/disable, settings, and original-HN actions
- `ai-settings.html` / `ai-settings.css` / `ai-settings.js` — extension-owned OpenRouter credential editor
- `icons/` — Harmonic browser-action icon assets
- `tests/e2e.mjs` — Chromium interaction and regression test
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

- closer parity for additional Harmonic story-card layout modes
- mobile/narrow-browser navigation polish
- keyboard navigation
- optional favorites/read-state tooling
- additional regression screenshots at common laptop widths

The north star remains: **Harmonic on the web, not merely prettier Hacker News.**
