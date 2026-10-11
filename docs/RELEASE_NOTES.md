# HarmoNova for Hacker News v0.13.9

**New canonical branding.** HarmoNova now uses the supplied cream monogram app icon and matching horizontal banner everywhere the project displays its identity.

Inspired by [Harmonic for Hacker News](https://github.com/SimonHalvdansson/Harmonic-HN) by Simon Halvdansson. This project is not affiliated with or endorsed by the original developer, Hacker News, or Y Combinator.

## What's changed

- Replaced hand-drawn logo SVGs with the supplied image assets and regenerated all four Chrome extension icon sizes from the exact source image.
- Updated the README banner and social preview to the supplied design.
- Moved the Chrome installation instructions before the project background story.
- Recaptured the current build’s Chrome installation, search, feeds, settings, appearance, story, and AI preview screenshots.

## Install in Chrome

1. Download **harmonova-0.13.9.zip** from the assets below and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted `harmonova` folder (containing `manifest.json`).
4. Open or refresh [Hacker News](https://news.ycombinator.com/).

You can also [clone the repository](https://github.com/chaosmanage/harmonova) and load its root folder directly. No build step is required for users.

**Known limitation:** editing or deleting existing comments currently uses an explicit handoff to Hacker News's original page.
