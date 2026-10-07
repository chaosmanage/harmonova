# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Nothing yet.

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
