# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Nothing yet.

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
