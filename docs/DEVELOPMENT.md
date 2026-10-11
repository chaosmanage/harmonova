# Development and releases

[← Back to README](../README.md) · [Architecture](ARCHITECTURE.md) · [Changelog](../CHANGELOG.md)

You don't need to compile anything to run HarmoNova. Chrome can load the repository root directly. Development tooling exists for **testing**, **capturing sanitized fixtures**, and **packing a release**, not for transforming the application into runnable code.

## Requirements

- Node.js (a current maintained version) and npm for tests and packaging.
- Chromium available at `/usr/bin/chromium`, or set `CHROMIUM_PATH` for Playwright.
- Git for source changes. GitHub CLI (`gh`) is optional and used by maintainers to publish releases.

```bash
git clone https://github.com/chaosmanage/harmonova.git
cd harmonova
npm ci
```

Load the repository root in `chrome://extensions` → **Developer mode** → **Load unpacked**. After changing source, click **Reload** on the extension card and refresh an HN tab. The code runs directly; there is no watcher or build process.

## Project layout

```text
harmonova/
├── manifest.json            Chrome Manifest V3 entry point
├── content.js               feed, reader and interactive UI
├── styles.css               browser-reader visuals
├── hn-session.js            HN session and authenticated forms
├── hn-search.js             site-wide search
├── background.js            extension worker and privileged fetches
├── url-policy.js            shared URL validation
├── popup.*                  extension toolbar control
├── ai-settings.*            extension-owned credential settings
├── icons/                   browser icons and provenance
├── fonts/                   locally bundled Google Sans Flex Rounded and OFL
├── docs/                    maintained guides and screenshots
├── scripts/                 packaging and fixture tools
├── tests/                   Node/Chromium suites and safe fixtures
├── CHANGELOG.md             versioned history
└── README.md                introduction and installation
```

Generated material such as `dist/`, `node_modules/`, and `test-results/` is ignored by Git. Captured raw HN fixture data, traces, and any credentials must remain untracked. Documentation screenshots in `docs/assets/` are an intentional exception.

To refresh the screenshots in the README and feature guide, run `node scripts/capture-doc-screenshots.mjs`. This runs the actual extension in Chromium and captures its UI. The AI summary screenshot shows a deterministic **prepared summary of the linked Nanolathe article**, rather than calling OpenRouter with a real API key. The article and response are stubbed locally for repeatability. Never pass secrets to the screenshot tool. The main reader screenshot in `docs/assets/overview.png` is captured from the same live session.

## Test commands

The commands below run from the repository root. The browser tests launch Chromium with the extension loaded; most tests use local mocks or sanitized HTML fixtures.

| Command | Covers |
| --- | --- |
| `npm run test:e2e` | Main visual/interaction browser flow; uses the live HN site and can be affected by network restrictions. |
| `npm run test:security` | URL policy, sender checks, escaping, credential handling, and related Node-level regressions. |
| `npm run test:security:browser` | Chromium security tests against the **packaged** extension folder; run `npm run package` first. |
| `npm run test:ai` | OpenRouter worker and streaming behavior with mocks. |
| `npm run test:hn-parser` / `npm run test:hn-auth` | HN document parsing and authenticated interaction contract. |
| `npm run test:voting` / `npm run test:comments` / `npm run test:actions` | Votes, replies/drafts, submit, favorites, hide, and account-action protections. |
| `npm run test:search` / `npm run test:profile` | Algolia search, account profiles, and lists. |
| `npm run test:parity` / `npm run test:comment-parity` | Feed and comment reader features. |
| `npm run test:links` | Rich previews, archive actions, themes, and link settings. |
| `npm run test:fix-regressions` | Protocol behavior and known visual/interaction regressions. |
| `npm run test:reload` | Persistence across reloads. |

`npm run test:live` is a separate, opt-in real-HN test for authorized accounts only; it requires explicit environment configuration documented inside the test. Never paste credentials into source, fixtures, logs, issue reports, or pull requests. HN may present verification walls; a mocked-browser pass is **not** proof that an authenticated live session succeeded.

When testing an actual release archive, first create it, then point the Chromium suite at the **packaged** folder rather than the source root:

```bash
npm run package
EXTENSION_PATH="$PWD/dist/harmonova" \
  TEST_OUTPUT_DIR="$PWD/test-results-packaged" \
  npm run test:e2e
npm run test:security:browser
```

This catches missing files and differences between the checkout and what people install.

## Package a download

```bash
npm run package
```

The script reads the version from `manifest.json` and creates:

```text
dist/
├── harmonova/                 ready for Load unpacked
└── harmonova-0.13.10.zip      ZIP containing that folder
```

The folder name inside the ZIP is deliberately **stable**, even though the ZIP filename contains the version. When updating an unpacked installation, keeping the extracted path stable reduces the chance of Chrome treating it as a different extension.

The archive includes runtime files, icons, license, README, changelog, and user documentation. It excludes tests, tooling, node_modules, references, debug images, and other development-only material. There is no need for an end user to run this command: downloadable release assets and a source checkout can already be installed as unpacked extensions.

## Making changes

1. Take inspiration from the original [Harmonic Android project](https://github.com/SimonHalvdansson/Harmonic-HN), while respecting the constraints of a desktop browser.
2. Update the test that covers the behavior you changed. Don't assume a fake HN form behaves exactly like the real one.
3. Preserve strict HN request handling, safe URLs, sanitized HTML, and protected credential storage. See [Privacy & security](PRIVACY.md).
4. Update the relevant guide when behavior, permissions, installation, or architecture changes. Add a user-facing entry to `CHANGELOG.md`.
5. Run focused suites, then the appropriate Chromium checks, and test the **packaged folder** when shipping.
6. Before committing, inspect `git status`, `git diff --check`, and the ZIP contents.

Please don't add screenshot dumps, raw response captures, API credentials, or temporary debugging plans to version control. Reference material that remains useful should live in the maintained guides instead of dated implementation notes.

## Publishing a GitHub release (maintainers)

1. Ensure the `version` values in `manifest.json` and `package.json` match, and write an entry in `CHANGELOG.md`.
2. Run the applicable tests, package, and verify the ZIP contains one `harmonova/` directory with `manifest.json` immediately inside it.
3. Commit and push the release-ready files. Tag the commit as `v<version>`.
4. Attach `dist/harmonova-<version>.zip` to a GitHub Release. The release description should repeat the simple **extract → Load unpacked** installation path and clearly note important limitations.
5. Test the downloaded archive in Chrome: extract it, select the inner folder, open HN, and confirm the interface loads. A GitHub source archive also remains installable without a build.

Example maintainer command, **after** preparing and pushing the intended commit:

```bash
gh release create v0.13.10 dist/harmonova-0.13.10.zip \
  --title "HarmoNova for Hacker News v0.13.10" \
  --notes-file docs/RELEASE_NOTES.md
```

Version and tag in the example are illustrative; use the version you're actually publishing. This document and the release notes are not a substitute for testing the archive.
