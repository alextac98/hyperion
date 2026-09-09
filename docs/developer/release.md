# Releasing Hyperion

Two manual workflows: **Version** prepares a version; **Release** publishes it.
Pushing or merging code never publishes a release.

## 1. Decide on a version number

A version number can be set manually by editing the `package.json` with the next version number.

If you'd like to do it automatically using a UI / GitHub Actions, go to **GitHub → Actions → Version → Run workflow**, select **main** branch and choose **patch**, **minor**, or **major**. The workflow updates `package.json`, tests the version commit, and pushes it to `main`. It creates no tag, release, or release PR. For example, `0.1.0` becomes `0.1.1`, `0.2.0`, or `1.0.0`, respectively.

## 2. Publish

In **Actions → Release → Run workflow**, select **main**. The workflow captures that exact commit and reads its committed version. It runs checks (including checking that the release number is not duplicate), builds installers, generates release notes and checksums, then publishes `vX.Y.Z` with automatic-update metadata. It never changes version files, and later pushes to `main` are not included. The run summary identifies the commit.

Download the published installers and smoke-test them. Current targets are **macOS arm64**, **Windows x64**, and **Linux x64/arm64**. Windows builds unsigned without signing-key checks. macOS signs and notarizes when all credentials below are present; otherwise it logs a warning and uses an ad-hoc signature (no Apple certificate) without notarization. For unsigned Mac builds, on first launch, users may need **System Settings → Privacy & Security → Open Anyway**. See [Apple's instructions](https://support.apple.com/en-us/102445).

In **Settings → Environments**, create an environment named **release** and restrict deployment branches to **main**. Required reviewers are optional; leave them off to avoid an extra approval step.

Add these optional macOS **environment secrets**: `MACOS_CERTIFICATE` (base64 `.p12` or certificate URL), `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. The build job uses the `release` environment. Missing or incomplete credentials warn but do not block publication. With all credentials present, signing and notarization must succeed; invalid credentials fail the build. Windows and Linux need no signing secrets.

## If something fails

- **Version push rejected:** if `main` moved, rerun Version. Branch rules must
  allow the workflow's version commit; it never force-pushes or bypasses rules.
- **Checks or builds fail:** fix the problem on `main` and run Release again.
  No release is published before all checks and builds pass.
- **Version already exists or is older:** run Version before releasing again.
- **Upload/publication fails:** inspect the unpublished draft and any tag before
  retrying; remove only the failed, unpublished release/tag if a fresh run needs it.
