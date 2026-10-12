# Installation and troubleshooting

[← Back to README](../README.md) · [Feature guide](FEATURES.md)

Most setup issues come down to selecting the wrong folder in Chrome's **Load unpacked** dialog. You can install from a GitHub release or the repository itself without running any build commands.

## Which folder should I select?

The one that contains `manifest.json` **directly inside it**.

| You have… | Select… |
| --- | --- |
| A release ZIP | Extract it; select the **inner** `harmonova/` folder |
| GitHub's “Code → Download ZIP” | Extract it; select the top-level repository folder |
| A `git clone` checkout | Select the clone's root folder |
| A development package made with `npm run package` | Select `dist/harmonova/` |

Chrome cannot load a compressed ZIP through **Load unpacked**. Extract it first. You should not need `npm install`, `npm run build`, or a Chrome Web Store account.

![Chrome extensions page with Developer mode enabled and the Load unpacked button visible](assets/install-chrome.png)

## Chrome says “Manifest file is missing or unreadable”

You're probably selecting the parent of the extension folder. Open the folder in your file manager first and verify that you can see `manifest.json` beside `content.js` and `background.js`. Then select that folder itself.

## It installed, but Hacker News still looks the same

1. Confirm that **HarmoNova for Hacker News** is enabled at `chrome://extensions`.
2. Refresh your `news.ycombinator.com` tab (or open a new HN tab).
3. Click the HarmoNova extension icon and check whether **Enable HarmoNova** is switched on.
4. If you chose **Open original Hacker News**, that specific tab intentionally keeps the old interface. Use **Use HarmoNova here** in the extension popup or open a fresh HN tab.
5. If none of this works, click **Reload** under the extension card, then refresh HN.

The extension's interface is injected only on `https://news.ycombinator.com/*`, not on arbitrary websites or external articles.

## How do I update it?

For a **release download**, extract the new archive and replace the *contents* of the existing extension folder, keeping its path unchanged. For a **Git clone**, update that same checkout with `git pull`. Then visit `chrome://extensions`, click **Reload**, and refresh your HN tabs.

Loading a second unpacked copy from a different directory can create a second extension ID. Chrome stores extension data by extension identity, so this may make your existing local data appear missing. Before a larger move or reinstall, consider exporting your user data in Settings → Data.

## Stories stay on Loading or show RESOURCE_TIMEOUT

Update to the latest remediation-branch version, reload HarmoNova at `chrome://extensions`, and refresh the Hacker News tab. Story details now arrive in smaller batches to avoid exhausting the network queue; later stories load when you scroll. If the feed still cannot connect, use the refresh button and check whether `hacker-news.firebaseio.com` is reachable on your network. External previews and AI do not need to be disabled for normal reading.

## Posts, replies, votes, or account controls aren't working

You must first sign in on Hacker News. HarmoNova uses the HN session and its own action forms; it never asks for a password inside the extension. HN can also require validation or apply rate limits. When a post can't be confirmed, HarmoNova attempts to keep your draft and offers a way back to HN's original form.

Editing and deleting comments are a special case: they currently **open HN's original edit/delete pages**, after an explanation and your confirmation. They are not implemented as in-extension actions.

## An AI summary fails

Check Settings → AI in the HarmoNova sidebar to confirm you saved AI consent and an OpenRouter key, and that your chosen model is available. Article summaries read public article HTML/text when the website permits automated access; paywalls, redirects, unsupported document types and inaccessible sites may prevent extraction. Try Discussion for public HN comments instead. Private tabs have no AI summaries.

An API key is optional for normal reading and HN account features. See [Privacy & security](PRIVACY.md) before enabling summaries.

## What about Brave, Edge, or other Chromium browsers?

Browsers that support loading unpacked Chromium extensions may work, but Chrome/Chromium is the primary target and test environment. The exact Extensions page or Developer mode label may differ. Firefox and Safari are not supported releases.

## Reporting a problem

[Open an issue](https://github.com/chaosmanage/harmonova/issues) with your browser version, extension version (shown at `chrome://extensions`), which HN page you were on, what you clicked, and what happened. A screenshot is useful when reporting a visual problem.

**Do not include API keys, login credentials, browser cookies, authorization tokens, or private drafts** in issue descriptions, screenshots, or logs.

## Preview or article summary is unavailable

External previews start enabled for public websites. You can toggle them in Settings → AI. Websites with missing metadata, unsuitable image types, blocked requests or redirects show placeholders instead. Full article summaries depend on the article being publicly readable and may fail if the website rejects background requests. Supported provider API previews (GitHub, Wikipedia and arXiv) remain available as enhancements. Private tabs do not use AI or external previews.

## Draft or sign-out outcome is uncertain

A failed/ambiguous post is not retried automatically. Keep the draft and inspect the ordinary HN page before submitting again. Sign-out is reported as confirmed only after a signed-out page is read back; “Could not confirm sign-out” keeps drafts. After a worker restart, reopen the composer to obtain a new draft token. Same-draft conflicts preserve the other writer instead of silently overwriting it.

## Preferences could not be saved

Local storage is authoritative and sync is a mirror. A sync warning can leave a local recovery copy. Reload after recovery; legacy page data is retained after a failed migration. Unknown newer store versions are refused safely. Private cosmetic changes are temporary and do not change normal settings.
