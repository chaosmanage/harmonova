# Privacy, permissions, and security

[← README](../README.md) · [Architecture](ARCHITECTURE.md)

HarmoNova has no project server, analytics, or account. Normal reading uses public Hacker News Firebase and Algolia APIs. Account actions use Hacker News's own authenticated pages and forms. Optional previews and AI contact the providers described below; those providers can retain requests under their own policies.

## Data locations

| Data | Location and lifetime |
| --- | --- |
| Cosmetic and feed preferences, enabled state | Worker-owned `chrome.storage.local` with a validated `chrome.storage.sync` mirror. Sync may share these preferences with your browser account. Failed sync leaves a local recovery copy and shows a warning. |
| Theme, font, text sizes and zoom recovery | Six cosmetic fields in HN-origin localStorage; the website can read/change these. They grant no network or AI permission. |
| Normal bookmarks, read IDs, locally seen-story IDs, tags, blocked users, seen times | Versioned worker-owned local storage; shared between normal tabs. |
| Normal composer drafts | Worker-owned session storage, at most 50 drafts of 20,000 UTF-8 bytes each, bound to account/item and composer revision. Browser-session end removes them. |
| Original-HN bypass tab IDs | Session storage; removed when tabs close. |
| OpenRouter key | Local storage if you choose profile persistence, or session storage if you choose browser-session-only storage. Never Chrome Sync, HN page storage, or exported reader data. The HN UI receives only whether a key exists. |
| AI consent/model/prompt and preview permission | Local storage, edited inside the extension-owned AI settings embedded in the HarmoNova sidebar (also available as an extension options page). Existing keys and old page/sync AI preferences grant no consent. |
| Summaries, searches, preview caches | Bounded tab/worker memory; no persistent summary history. |
| Release update state | Local extension storage keeps the latest checked tag and ignored version. The notification preference is included in normal cosmetic preferences. |

Chrome storage areas are restricted to trusted extension contexts. Normal content scripts use typed worker messages. Versioned repositories serialize writes and preserve unrelated tab changes; conflicting writers to the same draft receive a conflict instead of overwriting it. Scroll-seen story IDs (maximum 1,500, stored independently from opened-story read IDs) are kept on this device only, are not sent to HN as hide requests, and are not included in JSON exports. The switch for tracking them is off by default. Export/import covers bounded reader data (including optional v1 seen times) only, never keys, AI consent, drafts, or tab IDs. Existing valid keys and reader data survive upgrades. Legacy page data is deleted only after an acknowledged migration; newer unknown store versions are refused without deletion.

## Private windows

If you allow this extension in incognito, reader state and drafts exist only in the current document's memory. They disappear on reload, navigation or tab closure, and are not shared with another private tab. Imports and exports use that document's private reader state. Private reading, draft cleanup and logout do not modify normal reader stores. Private tabs may read a sanitized cosmetic snapshot but do not migrate or save normal preferences. AI and external previews are disabled privately. Original-HN handoffs stay in the originating private window. Exporting a private file still saves a file to your chosen download location.

## Requests and permission boundaries

The extension checks `https://api.github.com/repos/chaosmanage/harmonova/releases/latest` about once daily for newer versions (starting around ten minutes after installation). The request contains no HN cookies, account data, or reader content. If a newer release is found, an optional non-modal in-page notice links to the official GitHub releases page. Dismissing a version persists locally; turning off notifications in Appearance stops release-check requests. The `alarms` permission schedules these checks; Chrome's notifications permission is not used.

The content scripts run only on `https://news.ycombinator.com/*`. `storage` supports the stores above; `activeTab` supports the popup's explicit tab controls. Required host permissions include wildcard HTTP and HTTPS sites to restore general previews and full-article summaries. Algolia's public reading/search API is accessed by the content client. There are no `cookies` or `webRequest` permissions.

External previews start **enabled**, including upgrades with no saved preview preference. A previously saved disabled preference remains off. You can switch previews off inside Settings → AI. HarmoNova fetches public metadata from linked HTTP(S) websites and HTTPS raster images for previews, without website cookies; it also uses specialized provider APIs for GitHub, Wikipedia and arXiv. Some websites block automated requests or return unsuitable images, so placeholders remain necessary. External favicon services are not used.

Restoring arbitrary public-web previews and article extraction requires broad HTTP(S) host permissions. The worker rejects local/private literal IPs, localhost and other reserved hostnames, credentialed URLs, nonstandard ports and Hacker News hosts, and cannot use arbitrary redirect destinations. **This is not DNS-resolution-based SSRF protection**: a public-looking hostname might resolve to a private address, which this browser extension cannot inspect or enforce at connection time. Never use this API as a proxy for untrusted client-supplied destination URLs; preview requests are bounded and article source URLs are derived from the public story record.

External worker requests omit browser cookies and referrers and reject every redirect before another request. Host, path, method and response type checks are enforced in the worker. Bodies are streamed under byte and time budgets, with bounded queues and caches. Images accept only bounded, nonanimated PNG/JPEG/WebP with validated dimensions, then decode and re-encode as small PNG data images. The page never fetches provider image URLs itself; image errors and restrictive page CSP yield placeholders without a remote fallback.

This is a **validated-destination policy**, not a DNS firewall. Browser DNS, TLS and remote websites remain trusted. Private and reserved literal IP addresses and unsafe hostnames are rejected, but public website hostnames are accepted for previews and the code cannot inspect the browser's resolved address. Authenticated HN requests use native HN redirects and verify the final origin; this trusts HN and does not claim to prevent every intermediate redirect side effect.

## AI consent and billing

Saving a key alone enables nothing. In the extension-owned AI settings embedded in the sidebar, explicitly save permission for summaries, a model and a prompt. Automatic summaries require separate saved consent and a real user selection; opening/reloading a thread or changing HN page storage does not authorize a billable request. The worker fixes model/prompt/stream policy from its own store and derives article URLs from the public story record. It accepts no arbitrary privileged proxy request from the page.

The Article button fetches and extracts readable **full article HTML/text** from the story URL when the site permits it, up to the bounded input limit. Discussion summaries use public HN discussion text. The selected text, configured prompt/model and key authorization are sent to OpenRouter. Summary output can be inaccurate. At most one request per tab is active; cancellation, disconnect, ambiguous failures and worker restart do not automatically replay it. A single empty-stream recovery request is allowed only if you separately enable that option, which may incur another charge. Cancellation cannot guarantee a provider reverses charges for an already received request.

HN mutations require real user events, bind the account/form/text at dispatch, and are not blindly retried after an ambiguous outcome. Logout success requires a definitive signed-out read-back; uncertainty retains drafts and offers an ordinary HN handoff. The isolated-world code and browser are trusted boundaries. A shared web-page DOM can still deceive users about what they see; it is not a general defense against all UI deception.
