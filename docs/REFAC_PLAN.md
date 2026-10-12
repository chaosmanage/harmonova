# Harmonova cleanup, release verification, and optional seen-story filtering

## Branch and change isolation

- Work exclusively on `feat/account-settings-nitter-cleanup-20261013`, branched from the existing feature work at `a6f08bc`. Do not check out, reset, or push `main`.
- Maintain a clearly named cleanup milestone and **a separate final commit for scroll-seen filtering**. Push the cleanup milestone first; push the feature commit after validation. To omit the latter from a merge, merge the cleanup milestone SHA rather than the final branch tip or revert the feature commit.
- Do not rewrite branch history or silently remove existing tests. Use atomic, meaningful commits, verify `git status` and remote tracking after pushes.

## Milestone A: UI account actions and Nitter removal

1. Inventory toolbar shortcuts, account chip menu, and Settings > Account, signed in and signed out. Build both account lists from one shared `accountActions()` provider. Preserve login/logout trusted-click protections, settings write flush before navigation, and all existing toolbar entry points.
2. Include the signed-in `New post` action from the toolbar, plus Profile, Threads, Upvoted, Favorites, Submissions, Hidden, Log out; signed-out users keep Log in / Create account. Ensure the new-post action opens the existing submission modal, not an independent submission path.
3. Remove active Nitter URL rewrite, site-host validation, UI toggle, instance field, persisted preference schema, module dependencies and tests. External X/Twitter links should remain ordinary links. Historical changelog entries can describe historical releases, but no live UI or runtime should reference Nitter.
4. Add browser assertions for signed-in parity, signed-out options, and new-post flow; verify existing link safety, authorization and site previews.

## Milestone B: lean, release-only CI with security preserved

1. Confirm `.github/workflows/test.yml` has **only** `release: published` and `workflow_dispatch`; no push/PR/scheduled CI triggers. Keep pinned actions, Node and browser, minimal read permissions, synthetic/offline network, and vulnerability audit.
2. Retain all test source files for investigations. Run **all security/policy/storage/AI unit suites** in the default gate, plus the real-browser `security-browser`, `voting`, `links` and `settings-sidebar-browser` smoke suites. These cover privileged boundaries, dangerous inputs, account actions, links and real Settings UI.
3. Keep extended functional compatibility suites and the old 26-suite battery accessible as **manual diagnostics**. Do not run both fast and extended automatically in published-release CI. Avoid rerunning the four smoke browser suites against a second browser profile solely for package parity; instead build the package and validate exact allowlisted files, runtime references, ZIP/source bytes, and credentials.
4. Measure smoke/unit timings on the VPS; never make checks pass by suppressing errors or allowing silent skips. Document the reduced CI matrix and commands for manually escalating diagnostics.

## Milestone C: tidy the project root and repair references

1. Preserve root-only extension entry points (`manifest.json`, `popup.html`, `ai-settings.html`), npm metadata, README, changelog, license and ESLint config. Group implementation in `src/`, UI components under `src/content/`, worker code under `src/worker/`, tools under `scripts/`, regression tests/fixtures under `tests/`, docs and screenshots under `docs/`, and public icons/fonts under their named asset directories.
2. Update manifest URLs, HTML/CSS/JS references, test fixtures, imported scripts, README/development docs, release packaging and the package allowlist; run the package reference validator. Do not move files merely for appearances if Chrome requires stable root paths.
3. Ensure ignored generated dirs (`node_modules/`, `dist/`, `test-results*/`, capture data) never enter Git. Verify the tracked root count and eliminate any dangling old references.

## Milestone D: separately revertible `Hide seen stories` feature

1. Add a `hideSeen` boolean, default **false**, in Settings > Stories, explicitly separate from `hideRead`. Clarify in description that seen means scrolled past, not clicked/opened. Turning it off immediately restores local feed visibility without deleting history.
2. Collect **viewport-qualified** story impressions with an observer on the `storyList` scroll container. Require a sustained interval with a substantial visible portion (and an actual trusted/normal user scroll before qualification); avoid treating all initially loaded stories as seen, hiding on feed refresh, or hiding a card while someone is still viewing it. Hide previously qualified cards only once they have left the viewport, preventing scrolling layout jumps.
3. Store bounded `seenStoryIds` separately from `readStoryIds` in the worker-owned reader state, synchronize them across normal tabs and keep incognito storage memory-only. Do not send `hide` actions to Hacker News, do not alter existing read/dim semantics or user data export shape, and validate IDs through the existing privileged message boundary.
4. Test default-off, enable behavior, viewport dwell, no initial mass hiding, persistence/reload, disabling restore, independence from hide-read, and security/storage validation. Run targeted tests, fast gate and package integrity; commit this feature as the **last, single feature commit**.

## Verification / acceptance checklist

- [x] No `main` changes; new branch exists and has pushed cleanup and feature milestones.
- [x] Both account menus share actions; signed-in new-post and signed-out login work.
- [x] Active Nitter code and settings gone, existing links correct.
- [x] Release workflow never runs on ordinary pushes, and avoids duplicate browser gate.
- [x] All security units retained; essential UI smoke is green; optional diagnostics remain usable.
- [x] Packaged ZIP byte parity and references are verified, and root layout documented.
- [x] Opt-in seen filtering is safe, bounded, persisted, default-off and independently revertible.

## Measured outcome

The focused release source gate (`npm test`) passed 101 Node tests and four Chromium suites in **91 seconds** on the VPS. The subsequent package allowlist/reference/source/ZIP byte-parity checks passed for 76 release files, and `npm audit` reported zero vulnerabilities. The optional scroll-seen UI flow also passed independently after observer lifecycle hardening, and two-tab reader mutations retained distinct seen IDs. The full legacy diagnostics remain manual rather than release-triggered.

The cleanup milestone is `bec2fa6` (including `acaf44b` and the earlier organized-source commit). The scroll-seen feature is the single final feature commit after that milestone, so the cleanup can be merged without it.
