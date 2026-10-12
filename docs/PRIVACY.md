# Privacy, permissions, and security

[← README](../README.md) · [Architecture](ARCHITECTURE.md)

HarmoNova has no project server, analytics, or account. Normal reading uses public Hacker News Firebase and Algolia APIs. Account actions use Hacker News's own authenticated pages and forms. Optional previews and AI contact the providers described below; those providers can retain requests under their own policies.

## Data locations

| Data | Location and lifetime |
| --- | --- |
| Cosmetic and feed preferences, enabled state | Worker-owned `chrome.storage.local` with a validated `chrome.storage.sync` mirror. Sync may share these preferences with your browser account. Failed sync leaves a local recovery copy and shows a warning. |
| Theme, font, text sizes and zoom recovery | Six cosmetic fields in HN-origin localStorage; the website can read/change these. They grant no network or AI permission. |
| Normal bookmarks, read IDs, tags, blocked users, seen times | Versioned worker-owned local storage; shared between normal tabs. |
| Normal composer drafts | Worker-owned session storage, at most 50 drafts of 20,000 UTF-8 bytes each, bound to account/item and composer revision. Browser-session end removes them. |
| Original-HN bypass tab IDs | Session storage; removed when tabs close. |
| OpenRouter key | Local storage if you choose profile persistence, or session storage if you choose browser-session-only storage. Never Chrome Sync, HN page storage, or exported reader data. The HN UI receives only whether a key exists. |
| AI consent/model/prompt and preview permission | Local storage, edited only through the extension's own settings page. Existing keys and old page/sync AI preferences grant no consent. |
| Summaries, searches, preview caches | Bounded tab/worker memory; no persistent summary history. |

Chrome storage areas are restricted to trusted extension contexts. Normal content scripts use typed worker messages. Versioned repositories serialize writes and preserve unrelated tab changes; conflicting writers to the same draft receive a conflict instead of overwriting it. Export/import covers bounded reader data (including optional v1 seen times) only, never keys, AI consent, drafts, or tab IDs. Existing valid keys and reader data survive upgrades. Legacy page data is deleted only after an acknowledged migration; newer unknown store versions are refused without deletion.

## Private windows

If you allow this extension in incognito, reader state and drafts exist only in the current document's memory. They disappear on reload, navigation or tab closure, and are not shared with another private tab. Imports and exports use that document's private reader state. Private reading, draft cleanup and logout do not modify normal reader stores. Private tabs may read a sanitized cosmetic snapshot but do not migrate or save normal preferences. AI and external previews are disabled privately. Original-HN handoffs stay in the originating private window. Exporting a private file still saves a file to your chosen download location.

## Requests and permission boundaries

The content scripts run only on `https://news.ycombinator.com/*`. `storage` supports the stores above; `activeTab` supports the popup's explicit tab controls. Required host permissions are exact HTTPS origins: HN, Firebase, OpenRouter, GitHub API, arXiv export, GitHub avatars, Wikimedia uploads, and Wikipedia in English, German, French, Spanish, Japanese and Chinese. Algolia's public reading/search API is accessed by the content client. There are no wildcard HTTP/HTTPS host permissions, optional arbitrary-origin permissions, cookies permission, or webRequest permission.

External previews start **disabled**, including upgrades. Separately authorized Article summaries may fetch supported provider text even when previews are off; they do not request images. Enable them on the extension's AI and external previews page. Supported sources are GitHub repository metadata, Wikipedia summaries in those six languages, and arXiv abstracts. Only corresponding API operations and vetted GitHub-avatar/Wikimedia raster paths are fetched. Arbitrary article HTML, arbitrary metadata URLs and external favicon services are unsupported. Local domain markers and placeholders keep reading usable when previews are off, denied, redirected, oversized or unsupported.

External worker requests omit browser cookies and referrers and reject every redirect before another request. Host, path, method and response type checks are enforced in the worker. Bodies are streamed under byte and time budgets, with bounded queues and caches. Images accept only bounded, nonanimated PNG/JPEG/WebP with validated dimensions, then decode and re-encode as small PNG data images. The page never fetches provider image URLs itself; image errors and restrictive page CSP yield placeholders without a remote fallback.

This is a **fixed-provider trust policy**, not a DNS firewall. Browser DNS, TLS and those providers remain trusted. Literal private/public IP addresses and arbitrary hostnames are rejected, but the code cannot inspect the browser's resolved address. Restoring arbitrary-origin fetches would require separate transport enforcement. Authenticated HN requests use native HN redirects and verify the final origin; this trusts HN and does not claim to prevent every intermediate redirect side effect.

## AI consent and billing

Saving a key alone enables nothing. On the extension settings page, explicitly save permission for summaries, a model and a prompt. Automatic summaries require separate saved consent and a real user selection; opening/reloading a thread or changing HN page storage does not authorize a billable request. The worker fixes model/prompt/stream policy from its own store and derives article URLs from the public story record. It accepts no arbitrary privileged proxy request from the page.

The Article button summarizes supported **provider text**, such as a Wikipedia excerpt or arXiv abstract, rather than the full arbitrary linked article. Discussion summaries use public HN discussion text. The selected text, configured prompt/model and key authorization are sent to OpenRouter. Summary output can be inaccurate. At most one request per tab is active; cancellation, disconnect, ambiguous failures and worker restart do not automatically replay it. A single empty-stream recovery request is allowed only if you separately enable that option, which may incur another charge. Cancellation cannot guarantee a provider reverses charges for an already received request.

HN mutations require real user events, bind the account/form/text at dispatch, and are not blindly retried after an ambiguous outcome. Logout success requires a definitive signed-out read-back; uncertainty retains drafts and offers an ordinary HN handoff. The isolated-world code and browser are trusted boundaries. A shared web-page DOM can still deceive users about what they see; it is not a general defense against all UI deception.
