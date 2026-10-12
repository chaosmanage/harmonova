# Account, link, verification, and feed cleanup plan

Implemented on a feature branch only. Keep `main` untouched; commit and push coherent milestones.

1. **Account parity:** expose the same account destinations in Settings > Account as the toolbar account menu, using one action provider and preserving signed-in/out restrictions. Verify navigation from settings with the browser suite.
2. **Remove Nitter:** delete redirect code, settings, stored preference schema, and related tests; retain regular X/Twitter links and existing link previews. Verify there are no active Nitter runtime references.
3. **Lean release-only verification:** trigger GitHub Actions only on published releases or manual dispatch (never on pushes/PRs); retain security unit/browser tests and critical UI flows. Run a focused source gate and package-parity validation without repeating the same browser suites. Keep a manual full diagnostic path, out of the release gate. Record measured timings and avoid silently skipping security checks.
4. **Organize repository:** group runtime implementation in `src/` (including `src/content` and `src/worker`), retain manifest and HTML entry points at extension root for extension compatibility. Update all paths, packaging allowlist, tests and documentation; verify produced ZIP references.
5. **Opt-in scroll-seen filtering:** add `Hide seen stories` preference, default `false`, independent of `Hide read stories`. A story only qualifies after sufficient on-screen dwell following a real feed scroll; hide it once out of view to avoid layout jumps. Store seen-story IDs separately from clicked/read IDs, cap stored history, and keep incognito memory-only. Never call HN's remote hide endpoint. Verify default/off behavior, scrolling behavior, and persistence.

## Acceptance checks

- Toolbar account actions remain, and Settings renders/executes their signed-in and signed-out equivalents.
- No active Nitter option, rewrite, or backend code; ordinary links remain intact.
- `on` in the CI workflow has only `release.published` and `workflow_dispatch`; no push trigger.
- No repeated smoke browser run over the same source/package unless explicitly requested.
- `npm run check`, unit/security suites, focused browser tests, package validation and audit report clear pass/fail results; failures are not suppressed.
- Published ZIP includes correct runtime paths and excludes tests/developer artifacts.
- Default scroll-seen setting preserves existing UI; only sustained viewing plus scrolling adds a hidden-from-feed story. Users may turn it off to show those cards again.
