# HarmoNova 0.14.1

## What's new

- **Settings → Account:** the same account actions as the toolbar, including New post, Profile, Threads, favorites, submissions, Hidden, and login/logout.
- **Settings → Updates:** a dedicated section with a manual Check for updates button and optional automatic release notifications.
- **Settings → Web and links:** manage external website preview permission in a separate secure extension panel, not inside AI Summarization.
- **Settings → Data:** confirmed actions to delete reading history, saved items/drafts, settings, or all local HarmoNova data including the OpenRouter key. These controls never delete Hacker News account data.
- Removed Nitter rewriting. Reorganized code and streamlined the offline security/UI test gate and release workflow.

**Not included:** the experimental Hide Seen Stories feature. That PR was closed due to an empty-feed-on-refresh issue.

## Install or update

1. Download `harmonova-0.14.1.zip` from this release's **Assets** and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Choose the extracted `harmonova` folder. If an earlier version is already loaded, remove or replace its unpacked directory first, then reload Hacker News.

External preview requests may contact public websites and their services without browser cookies. Read the [privacy and security details](https://github.com/chaosmanage/harmonova/blob/v0.14.1/docs/PRIVACY.md).
