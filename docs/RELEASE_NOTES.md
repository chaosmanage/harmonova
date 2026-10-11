# HarmoNova for Hacker News v0.13.8

**New name, new identity.** The independent Chrome extension previously called Harmonic for Hacker News is now **HarmoNova**.

Inspired by [Harmonic for Hacker News](https://github.com/SimonHalvdansson/Harmonic-HN) by Simon Halvdansson. This project is not affiliated with or endorsed by the original developer, Hacker News, or Y Combinator.

## What's changed

- New HarmoNova name throughout the extension, guides, and download package.
- A new original HarmoNova icon and wordmark replace the reused Harmonic launcher artwork.
- No longer downloads the Harmonic Android project's rounded font at runtime; system UI and serif fonts remain available.
- Updated GitHub repository and documentation links.

## Install in Chrome

1. Download **harmonova-0.13.8.zip** from the assets below and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted `harmonova` folder (containing `manifest.json`).
4. Open or refresh [Hacker News](https://news.ycombinator.com/).

You can also [clone the repository](https://github.com/chaosmanage/harmonova) and load its root folder directly. No build step is required for users.

**Known limitation:** editing or deleting existing comments currently uses an explicit handoff to Hacker News's original page.
