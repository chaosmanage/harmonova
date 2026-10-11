# Harmonic for Hacker News v0.13.7

**Documentation and onboarding update.** Harmonic is a Chrome extension that brings a Harmonic-inspired reading experience to Hacker News on desktop. A huge thank-you to [Simon Halvdansson and the original Harmonic Android app](https://github.com/SimonHalvdansson/Harmonic-HN), which inspired this project.

## Install in Chrome — no build needed

1. Download **`harmonic-hn-browser-0.13.7.zip`** from the Assets section below.
2. Unzip it. You'll find a folder named **`harmonic-hn-browser`** inside.
3. Open **`chrome://extensions`**, turn on **Developer mode**, and click **Load unpacked**.
4. Select that inner **`harmonic-hn-browser`** folder (the one containing `manifest.json`).
5. Open [Hacker News](https://news.ycombinator.com/) or refresh an existing tab.

You can also [clone or download the repository](https://github.com/chaosmanage/harmonic-hn-browser) and load its root folder directly. No Node.js or build step is necessary for either route.

## What's new

- A shorter README explaining why I brought the Harmonic Android experience to my desktop, including trying the app in an emulator before making a Chrome extension.
- Much simpler installation instructions, with a picture of the Chrome **Load unpacked** button. No terminal or build required.
- Screenshots of feeds, search, appearance, story settings, and the optional AI summarization interface. The summary example is clearly marked as a demo.
- More focused feature, privacy, troubleshooting, and architecture guides. The extension itself works the same as v0.13.6.

**Known limitation:** editing and deleting existing comments is handled through Hacker News' original pages after confirmation.

See the [README](https://github.com/chaosmanage/harmonic-hn-browser#readme), [feature guide](https://github.com/chaosmanage/harmonic-hn-browser/blob/main/docs/FEATURES.md), and [changelog](https://github.com/chaosmanage/harmonic-hn-browser/blob/main/CHANGELOG.md) for details.

**Independent community extension; not affiliated with Harmonic Android, Hacker News, or Y Combinator.**
