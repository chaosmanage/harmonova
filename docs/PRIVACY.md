# Privacy, permissions, and security

[← Back to README](../README.md) · [Architecture](ARCHITECTURE.md)

Harmonic is a browser extension, not a hosted reading service. There is no Harmonic account, project-owned server, or analytics pipeline. It uses Hacker News and public metadata services to build the reading view. Optional AI summaries contact OpenRouter using your own key.

This page explains **what the extension can access**, **what gets stored**, and **what leaves your browser**. It is a description of the implementation, not a guarantee that third-party services never retain information.

## Permissions explained

| Manifest permission | Why Harmonic requests it |
| --- | --- |
| `storage` | Remember appearance/feed preferences, enable state, read/bookmark history, temporary session data, and an optional OpenRouter credential. |
| `activeTab` | Let the extension popup inspect and act on the tab you explicitly open it from, such as opening Settings or switching HN modes. |
| HTTP/HTTPS host permissions | Load link previews, favicons, preview images, external article text (only for requested summaries), provider APIs, and the font. Stories can link to almost any public domain. |

The content script is restricted to **`https://news.ycombinator.com/*`**. Host permissions are broader because HN stories link to arbitrary sites, but that does **not** mean Harmonic replaces other sites or reads their contents as you browse them. Background requests have URL validation and redirect restrictions.

## What is stored where?

| Data | Storage | Notes |
| --- | --- | --- |
| Appearance, feed, and reader preferences; enabled/disabled state | `chrome.storage.sync` | May sync with your browser account when Chrome Sync is available. |
| Non-secret preference recovery copy | HN origin `localStorage` | Helps recover interface settings if loading from a different unpacked path changes the extension ID. Only preferences and enabled state. |
| Bookmarks, read-story history, author tags/blocks | Local browser/extension storage | Used for your reading experience; not posted to HN or a Harmonic server. Export/import is manual. |
| Saved reply drafts | `chrome.storage.session` | Temporary, account- and parent-specific. Clears with the extension's session lifecycle; account logout also clears drafts. |
| Optional OpenRouter API key (remember mode) | Extension-owned `chrome.storage.local` | Not in Chrome Sync or HN page storage. |
| Optional OpenRouter API key (session mode) | `chrome.storage.session` | Must be re-entered when the browser session ends. |
| AI summary output | Current page memory | Not stored in synced preferences or sent to a Harmonic backend. |
| Original-HN tab bypass information | `chrome.storage.session` | Holds tab IDs so a requested original HN tab doesn't immediately get replaced by Harmonic. |

A remembered API key is **not** OS-keychain encrypted by the extension. Someone with access to local browser profile files may be able to access it. Use session-only mode if you prefer not to keep a key on disk.

Chrome can retain extension data beyond an individual tab's lifetime. Browser sync, profile backup, and the behavior of third-party service accounts are outside this project's control. Private/incognito-mode activity is handled in memory rather than intentionally persisted to normal read/bookmark storage.

## Network requests

| When | Service | What is involved |
| --- | --- | --- |
| Reading feeds | HN Firebase API | Story IDs, titles, scores, and other public item data. |
| Opening discussions or running site-wide search | Algolia HN API | Public discussion trees; for site-wide search, your query and selected filters. |
| Using your HN account | `news.ycombinator.com` | HN's own pages, session, action tokens, and forms. The extension doesn't collect a password. |
| Displaying cards with enabled image/metadata features | Linked public sites and favicon/preview providers | Page metadata, favicons, or images for the stories on screen. |
| Opening a supported rich link preview | GitHub, Wikipedia, or arXiv public APIs | Public URL-derived data for those links. |
| Loading the Harmonic font | Pinned upstream GitHub content URL | An upstream font file with an integrity check; system fonts are used if unavailable. |
| **You click Article summary** | Selected article site, then OpenRouter | Extracted readable article text and the configured prompt are sent to OpenRouter with your API key. |
| **You click Discussion summary** | Public HN discussion, then OpenRouter | Public comment text and the prompt are sent to OpenRouter with your API key. |

Algolia search is not contacted merely because you type into the **Loaded stories** filter. Site-wide search uses a separate explicit search mode. Preview services and external sites may have their own logging and retention policies.

**No project-owned proxy sits between the extension and OpenRouter.** Your configured provider/model may process or retain inputs according to OpenRouter and model-provider policies; check those policies before summarizing sensitive material. Article summarization is not a private offline operation.

## Account actions and safeguards

Harmonic does not implement its own login page. It hands sign-in to HN, and authenticated votes/replies/submissions use HN's own session and one-time form fields. Actions are guarded against accidental scripted clicks, mutations are not blindly retried, and ambiguous post outcomes keep drafts where possible.

Editing and deleting existing comments currently use **an explicit handoff** to HN's original form rather than pretending to complete the action in Harmonic. This is a deliberate limitation while native handling is unavailable.

Remote background fetches omit browser credentials, validate public HTTP(S) destinations, reject private/loopback hosts, and re-check redirects. The background message handlers validate who sent a request. Rendered external links and AI text are sanitized; AI-rendered Markdown cannot inject active image requests or execute HN actions.

The tests in `tests/security.mjs` cover the key security boundaries. For developers, commands and release checks are listed in [Development](DEVELOPMENT.md).

## What this project does not do

It doesn't operate a private copy of HN, ask for your HN password in its UI, run analytics, add a tracker, sell personal data, or send AI summary requests unless you initiate them. Standard visits to external articles and third-party features still follow those websites' own privacy policies.

For a problem report, **never upload a key, HN cookie, authentication URL, or draft containing private information**. Use [GitHub Issues](https://github.com/chaosmanage/harmonic-hn-browser/issues) for reproducible issues without secrets.
