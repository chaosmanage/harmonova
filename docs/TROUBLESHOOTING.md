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

## Posts, replies, votes, or account controls aren't working

You must first sign in on Hacker News. HarmoNova uses the HN session and its own action forms; it never asks for a password inside the extension. HN can also require validation or apply rate limits. When a post can't be confirmed, HarmoNova attempts to keep your draft and offers a way back to HN's original form.

Editing and deleting comments are a special case: they currently **open HN's original edit/delete pages**, after an explanation and your confirmation. They are not implemented as in-extension actions.

## An AI summary fails

Check that your OpenRouter API key is configured, that the model ID is available to your account, and that OpenRouter is responding. Article websites sometimes reject automated requests or provide no readable article content. Try **Discussion** if you want a summary of public comments instead, but note that it summarizes different material.

An API key is optional for normal reading and HN account features. See [Privacy & security](PRIVACY.md) before enabling summaries.

## What about Brave, Edge, or other Chromium browsers?

Browsers that support loading unpacked Chromium extensions may work, but Chrome/Chromium is the primary target and test environment. The exact Extensions page or Developer mode label may differ. Firefox and Safari are not supported releases.

## Reporting a problem

[Open an issue](https://github.com/chaosmanage/harmonova/issues) with your browser version, extension version (shown at `chrome://extensions`), which HN page you were on, what you clicked, and what happened. A screenshot is useful when reporting a visual problem.

**Do not include API keys, login credentials, browser cookies, authorization tokens, or private drafts** in issue descriptions, screenshots, or logs.

## Preview or article summary is unavailable

External previews start disabled. Open the extension's AI and preview settings
page and save the preview preference if you want supported GitHub, Wikipedia and
arXiv previews. Ordinary article URLs, unsupported images/favicons, redirected
provider responses and denied provider permissions use placeholders. You can
always open the article normally, or summarize the public HN discussion after
saving fresh AI consent. Private tabs do not use AI or external previews.
