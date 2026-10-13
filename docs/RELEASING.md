# Release process

[← Development and verification](DEVELOPMENT.md) · [Release notes](RELEASE_NOTES.md)

HarmoNova releases are **automatically gated by GitHub Actions**. Submitting a version tag is the release-candidate request; it is **not** a published GitHub Release. The workflow at [`.github/workflows/release.yml`](../.github/workflows/release.yml) performs all checks on GitHub-hosted Ubuntu runners and publishes the verified ZIP only if every check succeeds.

## Submit a release candidate

1. On `main`, update the version consistently in `manifest.json`, `package.json`, and `package-lock.json` (for example, with `npm version 0.14.2 --no-git-tag-version`, then check the manifest separately).
2. Update `CHANGELOG.md` and `docs/RELEASE_NOTES.md` for that version. The first line of the release-notes file must be `# HarmoNova X.Y.Z` with the candidate version.
3. Commit those changes and push `main` to GitHub. **Pushing the branch does not start release tests or publish anything.**
4. Create and push the candidate version tag, pointing at a commit already on `main`:

   ```bash
   git tag -a vX.Y.Z -m "Release candidate vX.Y.Z"
   git push origin vX.Y.Z
   ```

Replace `X.Y.Z` with the version from the three version files. Do **not** first use GitHub's **Publish release** button; that immediately makes a release public and bypasses this gate. Creating a draft release does not submit a candidate to this workflow either. There is no need to run a workflow manually.

## What GitHub does automatically

Only a **newly pushed tag matching `v*`** triggers the release-candidate workflow. It does **not** run for ordinary branch pushes, pull requests, merges, manual workflow dispatch, or already-published releases. Tags that do not match the strict `vX.Y.Z` version format are rejected before any testing.

1. **Validate candidate:** Check that the tagged commit is on `main`, the tag version matches `manifest.json`, `package.json`, and `package-lock.json`, and the release-notes heading matches the version.
2. **Test source:** Check out the tagged commit, install Node 22.23.2 and locked npm dependencies (`npm ci`), install Chromium revision 1243, then run `npm test` (syntax, lint, unit and the default offline browser suites).
3. **Build and verify:** Run `npm run package`, `npm run check:package`, `npm audit`, and `git diff --check`. The package checker verifies the shipped file allowlist, runtime references, credential patterns, and byte-for-byte source/package/ZIP parity.
4. **Publish only on success:** Upload the exact tested `harmonova-X.Y.Z.zip` as a short-lived workflow artifact. A separate `publish` job depends on the successful `verify` job, downloads that same ZIP, and creates a **draft** GitHub Release named `HarmoNova for Hacker News vX.Y.Z`, attaching the verified ZIP and using `docs/RELEASE_NOTES.md` as the release description. Only after the asset upload is confirmed does it publish the draft. The release becomes eligible for the extension's update checks only after publication.

Any failed validation, test, packaging check, security audit or upload stops the workflow **before publication**. The failed tag remains in GitHub, but no public GitHub Release is created. If a late publication or upload step fails, a draft release may remain and must be removed before retrying. To retry the same version, fix the problem on `main`, then delete **only the failed candidate tag** locally and remotely, recreate it at the corrected commit, and push it again. Never move or delete a tag associated with a published release. Alternatively, use a fresh version number and tag.

## Permissions and limitations

The testing job uses read-only repository permissions and does not need release credentials. Only the dependent publication job receives `contents: write` through the GitHub Actions token. The workflow cannot stop a maintainer with write access from manually publishing a release through GitHub's interface, so maintainers must submit releases via version tags rather than the **Publish release** button.

Creating or merging ordinary commits, even commits that update versions or documentation, **does not initiate a release**. Publishing a release requires a *separate tag push*.
