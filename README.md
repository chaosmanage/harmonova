# Harmonic for Hacker News - Chrome Browser Extension

**A better place to read Hacker News on your desktop.**

Harmonic for Hacker News is a free, open-source Chrome extension that gives [Hacker News](https://news.ycombinator.com/) a more comfortable reading interface: colorful story cards, a two-column layout, thoughtful comment threads, and controls that stay out of the way until you need them.

It runs **on the real Hacker News website**. Your links, discussions, votes, and account still belong to Hacker News. You don't need a Hacker News account to browse, and **you don't need Node.js, a terminal, or a build step to install it**.

[**Get the latest release**](https://github.com/chaosmanage/harmonic-hn-browser/releases/latest) · [**Install from source**](#option-b-download-or-clone-the-repository) · [**See what it can do**](#what-you-get)

## With thanks to the original Harmonic

**This project exists because of [Harmonic for Hacker News by Simon Halvdansson](https://github.com/SimonHalvdansson/Harmonic-HN). Thank you, Simon, for building it and releasing it as open source.**

Harmonic is a beautifully considered **Android app for reading Hacker News**. Its dark reading surfaces, colorful story cards, relaxed typography, and clear treatment of deeply nested conversations make HN feel like something you can settle into instead of a page you have to decipher.

We wanted that same approach at a desktop keyboard, with a wide monitor and ordinary browser tabs. **This extension is a browser adaptation inspired by Harmonic's design philosophy**, not a copy of the Android app and not an official desktop edition. You do **not** need to have seen or used the Android app to understand or use this project.

We also use Harmonic's original launcher artwork (with attribution) and load a pinned copy of its rounded font at runtime. The upstream project is licensed under [Apache-2.0](https://github.com/SimonHalvdansson/Harmonic-HN/blob/main/LICENSE); details of the icon source are recorded in [icons/README.md](icons/README.md).

## A look at Harmonic on the web

![The Harmonic extension displaying a Hacker News story feed on the left and an expanded discussion on the right](docs/assets/overview.png)

*Harmonic running on news.ycombinator.com. The left pane is your feed; the right pane is the selected discussion. Screenshot from the actual extension; story content changes over time.*

## Install in Chrome — no build required

The extension isn't installed through the Chrome Web Store. Chrome's **Load unpacked** option takes about a minute and works with either a release download or the source repository.

### Option A: Download a release (recommended)

1. Open the [**GitHub Releases page**](https://github.com/chaosmanage/harmonic-hn-browser/releases/latest).
2. Under **Assets**, download `harmonic-hn-browser-<version>.zip` (for example, `harmonic-hn-browser-0.13.6.zip`). **Do not download the “Source code” archive if you specifically want the packaged release.** Both can work, but their folder layouts differ.
3. Extract the ZIP to a location you'll keep, such as your Documents folder. Inside it is a folder named `harmonic-hn-browser`.
4. Follow the [Load unpacked steps](#load-the-extension) below, and select that inner `harmonic-hn-browser` folder.

### Option B: Download or clone the repository

**No build is necessary:** the repository root already contains everything Chrome needs, including `manifest.json`.

- **Without Git:** open the [repository](https://github.com/chaosmanage/harmonic-hn-browser), click **Code → Download ZIP**, then extract the archive.
- **With Git:** run:

  ```bash
  git clone https://github.com/chaosmanage/harmonic-hn-browser.git
  ```

Follow the next steps, selecting the **repository's root directory**, the folder containing `manifest.json`. You can ignore `npm`, `node_modules`, and `dist` entirely as a reader.

### Load the extension

1. Open **`chrome://extensions`** in Chrome (or the browser's equivalent Extensions page).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the folder containing **`manifest.json`**: the extracted `harmonic-hn-browser` release folder **or** the repository root. Select a folder, **not the ZIP file itself**.
5. Visit [news.ycombinator.com](https://news.ycombinator.com/). Harmonic should appear automatically. Refresh an already-open HN tab if necessary.
6. Optionally pin **Harmonic for Hacker News** from the browser's Extensions menu to access the on/off switch.

```text
Release download                         Source download / git clone
harmonic-hn-browser-0.13.6.zip            harmonic-hn-browser/
└── harmonic-hn-browser/                 ├── manifest.json   ← select this folder
    ├── manifest.json                   ├── content.js
    ├── content.js                       └── ...
    └── ...
    ↑ select this inner folder
```

**Updating:** Keep the extracted extension **in the same location**, replace its contents with the new release (or `git pull` in your cloned repository), click **Reload** at `chrome://extensions`, then refresh HN. Moving the folder can cause Chrome to treat it as a different unpacked extension and may affect stored settings. See [installation troubleshooting](docs/TROUBLESHOOTING.md) if anything looks wrong.

## What you get

| | |
| --- | --- |
| **A proper desktop reader** | A scrollable feed beside the active discussion, with room for nested comments and long titles. |
| **Readable stories** | Tinted cards, source favicons, optional preview images, score and comment counts, and read-state indicators. |
| **Comments worth reading** | Depth-colored threads, collapsing branches, in-thread search, jump navigation, sorting, and optional author tags or blocks. |
| **More ways to find things** | Top, New, Best, Ask, Show, Jobs, extra curated feeds, and site-wide search powered by Algolia's HN index. |
| **Your own look** | AMOLED black, charcoal, or deep navy themes; font, card, image, feed, and comment preferences. |
| **Your HN account, if you want it** | Sign in through Hacker News itself to vote, reply, submit stories, manage favorites, and browse account lists. |
| **Optional AI summaries** | Separate **Article** and **Discussion** summaries via your own OpenRouter API key; you choose when to request one. |
| **An escape hatch** | Open untouched Hacker News whenever you want, or disable Harmonic from its toolbar popup without removing the extension. |

See the [feature guide](docs/FEATURES.md) for screenshots, settings, and the full explanation of how these work.

### A few things to know

- **You can read without signing in.** For account actions, Harmonic uses your existing Hacker News session and Hacker News's own login page; it doesn't collect your password.
- **Editing and deleting comments are currently handed off to original Hacker News.** Harmonic explains the limitation and asks before opening HN's edit or delete page. Replying and new story submissions are available inside the extension, subject to HN's own validation and rate limits.
- **AI is optional and off until configured.** Article text or public discussion content is sent to OpenRouter only when you explicitly request a summary. Some websites prevent automated article reading; a discussion summary is a separate choice, not a substitute silently presented as an article summary.
- **This is an independent extension.** It is not affiliated with Simon Halvdansson, Hacker News, Y Combinator, or OpenRouter.

## Privacy and permissions, in plain English

Harmonic runs on `news.ycombinator.com`; it does not replace HN or route your browsing through a project-owned server. It has no project-owned analytics service or backend. Preferences, bookmarks, read-state markers, and optional user tags are stored locally and/or in Chrome storage. Non-secret display preferences can sync via Chrome Sync.

The extension requests broad website access because previews, favicons, linked-article reading, and optional summaries involve links to many different domains; the **Harmonic interface itself is only injected on Hacker News**. Optional OpenRouter keys stay in extension-owned storage, not HN page storage, and are sent to OpenRouter when you ask for a summary.

The exact storage modes, external requests, limitations, and safety measures are documented in [**Privacy & security**](docs/PRIVACY.md).

## For contributors and the curious

The extension uses **Chrome Manifest V3 and plain JavaScript/CSS**. There's no frontend framework and no build step for ordinary use. To develop or create a distributable ZIP:

```bash
npm ci
npm run package
```

That produces `dist/harmonic-hn-browser/` (loadable unpacked) and `dist/harmonic-hn-browser-<version>.zip` (shareable). The release ZIP is the one attached to GitHub Releases.

| Document | What it's for |
| --- | --- |
| [Feature guide](docs/FEATURES.md) | Using the reader, accounts, search, summaries, and settings |
| [Installation help](docs/TROUBLESHOOTING.md) | Setup, updates, common problems, and how to report an issue |
| [Privacy & security](docs/PRIVACY.md) | Permissions, storage, network requests, and AI data handling |
| [Architecture](docs/ARCHITECTURE.md) | Runtime pieces, APIs, and the path from a page to a rendered thread |
| [Development & releases](docs/DEVELOPMENT.md) | Local setup, test commands, packaging, and release checklist |
| [Changelog](CHANGELOG.md) | The detailed record of changes, fixes, and versions |

## Credits and license

**The largest credit goes to [Simon Halvdansson's Harmonic Android app](https://github.com/SimonHalvdansson/Harmonic-HN).** If you like this reading experience, please look at the original project. Its open-source work gave this desktop adaptation both its starting point and its visual direction.

The extension's icon is derived from the original Harmonic launcher artwork. See [icon provenance](icons/README.md) for the exact upstream commit and source path. Both projects use the **Apache License 2.0**; see [LICENSE](LICENSE) for this repository's license.

This browser extension is an independent community project, not an official Harmonic Android release or an official Hacker News product.
