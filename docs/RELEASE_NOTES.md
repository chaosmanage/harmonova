# HarmoNova 0.14.0

## What's new

- Stronger security for HN actions, AI consent, drafts, redirects, and external requests. Private windows keep reader data and drafts in memory and disable AI and previews.
- Faster feeds show the first 20 stories promptly. Story and comment zoom now scale their full layouts independently; defaults are 70% and 85%.
- Public website previews and bounded article summaries return, with AI and preview controls in the in-page Settings sidebar. GitHub, Wikipedia, and arXiv retain enriched previews. AI requires explicit consent and your own OpenRouter key.
- Quiet notices for new releases, better handling of extension reloads, and broader offline browser and package checks.

Public website previews and article extraction require broad HTTP(S) host permissions. See [Privacy](PRIVACY.md) for the request safeguards and DNS limitation.

## Install or update

1. Download `harmonova-0.14.0.zip` from this release's **Assets** and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Choose the inner `harmonova` folder containing `manifest.json`, then open or refresh Hacker News.

For an existing unpacked installation, replace the contents of the same folder, click **Reload** on `chrome://extensions`, and refresh your HN tabs. Keeping the folder path preserves the extension's storage identity. See [Troubleshooting](TROUBLESHOOTING.md) if Chrome does not load the folder.
