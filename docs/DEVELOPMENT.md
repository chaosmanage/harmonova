# Development and verification

[← README](../README.md) · [Architecture](ARCHITECTURE.md)

Load the repository folder unpacked for development. Runtime entry points, policies and styles live in `src/`; isolated content modules are in `src/content/`, and privileged background modules in `src/worker/`. The root contains the manifest, extension HTML entry points, project metadata and documentation; `scripts/`, `tests/`, `icons/`, and `fonts/` have separate ownership. Runtime has no npm dependencies or bundler. Classic modules are listed explicitly in the manifest/worker entry point and package allowlist. Never expose worker modules as web-accessible resources or place credential/test hooks in page-visible state.

## Repeatable offline gate

Use Node **22.23.2**, the locked `playwright-core` **1.64.0**, and its Chromium revision **1248 / 156.0.8078.4**. `npm ci` does not install browsers. Provision the matching full Chromium:

```bash
npm ci
npx playwright-core install --with-deps chromium
export CHROMIUM_PATH="$(node -p 'require("playwright-core").chromium.executablePath()')"
npm test                # fast: validation, unit tests, four browser suites
npm run package         # build the release ZIP
npm run check:package   # package allowlist, runtime references and exact ZIP byte parity
npm run test:extended   # optional manual compatibility diagnostics
npm audit
git diff --check
```

The full Chromium persistent profile supports extension loading; the helper explicitly checks the extension service worker and reports Node/browser versions. A compatible system Chromium can be selected with `CHROMIUM_PATH` (VPS verification also uses 154.0.8037.92). Browser provisioning follows the official [browser setup](https://playwright.dev/docs/browsers) and [extension testing](https://playwright.dev/docs/chrome-extensions) guidance.

The normal `npm test` gate runs syntax, lint, recursive fixture scanning, all Node tests and four focused browser suites: `security-browser`, `voting`, `links`, and `settings-sidebar-browser`. This is the default development gate; it avoids the former 26 sequential Chromium launches (about 20 minutes). The fast browser gate was measured at 81 seconds on the VPS, while 98 Node tests ran in under six seconds before the latest unread additions. `npm run test:unit` and `npm run test:browser` run just the corresponding tier.

`npm run test:extended` runs six additional suites for optional manual compatibility coverage (authentication, profile, migration, incognito, network boundaries, and other compatibility paths). `npm run test:full` remains an explicitly opt-in legacy 26-browser-suite diagnostic. Neither is necessary on every edit. Each suite has a ten-minute process-group timeout, isolated synthetic profile, sanitized diagnostic log, and no retries; failures are never ignored. `npm run test:security:browser` is also available for focused security checks.

`npm run test:package` builds `dist/harmonova` and its versioned ZIP, runs `check:package`, then runs exactly the same browser entry points with `EXTENSION_PATH` pointing to the release and `TEST_OUTPUT_DIR=test-results-packaged`. The checker verifies the explicit copy allowlist, every runtime reference, all source/release/ZIP bytes and credential patterns. Test fixtures, tooling, and node_modules are excluded. Run `npm run check:package` to inspect an existing package.

All default network access is synthetic: Playwright routes plus a denying proxy, including redirected requests. Real local TLS fixtures supply redirect hit counters, compressed/stalled bodies and credential/referrer checks. Unknown application destinations fail the gate. HN token fixtures contain deterministic placeholders. `node scripts/redact-fixtures.mjs --check` recursively scans every committed fixture format without printing suspected secrets. Raw capture storage is ignored and is not used by CI.

The incognito gate enables the extension in a synthetic profile, waits for Chrome’s permission-triggered extension reload, restarts Chromium and creates an actual Chrome private window. It verifies private imports, exact exported Blob bytes, drafts, logout, native handoffs and normal-store equality. Native handoff cases use Chrome-created windows because CDP contexts can report virtual window IDs. The harness preserves Chrome API results while waiting for Playwright to attach the initial blank tab, avoiding a paused-target navigation race. A browser unable to support that gate fails the release checks; there is no skip-based claim of private support.

## Live tests and account actions

Live suites are excluded from all offline automation. `npm run test:live` and `npm run test:live:e2e` explicitly set the live opt-in; direct execution requires `HARMONOVA_ALLOW_LIVE=1`. Use them only with separately authorized disposable accounts and provider budgets. Automated verification uses offline fixtures, not live account mutations or billable calls.

Do not commit raw HN captures, keys, cookies, form tokens or private drafts. Use forward migration fixes; keep source data until the target write is acknowledged. Refuse unknown newer schemas rather than deleting or downgrading them. Rollback should disable previews/AI while retaining HN reading; never restore redirect following or direct remote images. Export normal reader data before evaluating an older schema.

GitHub Actions runs **only when a candidate version tag (`vX.Y.Z`) is pushed**. Ordinary branch pushes, merges, pull requests, workflow dispatches, and published releases do not trigger any release tests. The [release process](RELEASING.md) describes the tag submission, version and release-notes checks, exact commands run on GitHub-hosted runners, failure handling, and automatic publication. The `verify` job runs the fast offline source gate and builds and checks the exact packaged ZIP, without repeating the browser smoke under a second profile. Pinned GitHub Actions dependencies and a job timeout protect the gate; `verify` has read-only repository permissions, and only the dependent `publish` job can create a release after every check passes.
