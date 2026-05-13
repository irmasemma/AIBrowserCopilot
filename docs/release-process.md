# Release Process

How to cut a new release of Pilotwave.

## TL;DR

```powershell
# 1. Make sure your branch is up to date and the working tree is clean
git checkout multi-client-architecture
git pull
git status   # should be clean

# 2. Bump version in package.json files (only ones that actually ship)
#    - packages/native-host/package.json
#    - packages/native-host-helper/package.json
#    - packages/installer/package.json (if installer code changed)

# 3. Commit the version bump
git add packages/native-host/package.json packages/native-host-helper/package.json
git commit -m "chore: bump versions to vX.Y.Z"
git push

# 4. Tag the commit and push the tag — this triggers CI
git tag -a vX.Y.Z -m "vX.Y.Z — short summary

Highlights:
  - …
"
git push origin vX.Y.Z

# 5. Watch the workflow
gh run watch --workflow=release.yml --repo irmasemma/AIBrowserCopilot

# 6. Once green, the GitHub release is published automatically.
gh release view vX.Y.Z
```

---

## What gets shipped in a release

The release workflow builds and publishes **two binaries per platform** plus the
extension build:

| Asset | Source | Purpose |
|---|---|---|
| `pilotwave-{platform}-{arch}` (or `.exe`) | `packages/native-host` | The bridge — long-lived process, owns the WS to the extension |
| `pilotwave-helper-{platform}-{arch}` (or `.exe`) | `packages/native-host-helper` | Native-messaging endpoint Chrome calls for diagnostics, MCP registration check, and native-host spawn |
| `extension-build.zip` | `packages/extension/.output/chrome-mv3/` | Built extension for Chrome Web Store submission |

**Both bridge and helper are required.** If only the bridge ships (as happened
before v0.4.0), the installer can't refresh the helper and the extension's side
panel reports "Setup incomplete" even on a successful install. The release
workflow's matrix builds both — do not remove that.

Per platform, the matrix produces:

| Platform | Bridge asset | Helper asset |
|---|---|---|
| Windows x64 | `pilotwave-win-x64.exe` | `pilotwave-helper-win-x64.exe` |
| macOS x64 | `pilotwave-macos-x64` | `pilotwave-helper-macos-x64` |
| macOS arm64 | `pilotwave-macos-arm64` | `pilotwave-helper-macos-arm64` |
| Linux x64 | `pilotwave-linux-x64` | `pilotwave-helper-linux-x64` |
| Linux arm64 | `pilotwave-linux-arm64` | `pilotwave-helper-linux-arm64` |

---

## Pre-release checklist

Run these locally before tagging:

```powershell
# Compile both binaries on the platform you're on (sanity check)
npm run compile:win -w packages/native-host
npm run compile:win -w packages/native-host-helper

# Confirm both .exe exist with the right names
ls packages/native-host/bin/
ls packages/native-host-helper/bin/

# --version on each — should match the version you're about to tag
.\packages\native-host\bin\pilotwave-win-x64.exe --version
.\packages\native-host-helper\bin\pilotwave-helper-win-x64.exe --version

# Run unit tests (optional — release CI marks these non-blocking)
npm test --workspaces --if-present
```

If anything fails locally, fix it on the branch before tagging — the CI will
otherwise produce binaries with incorrect versions or skip helper steps.

---

## How the release workflow actually runs

`.github/workflows/release.yml` is triggered by `push` of any tag matching `v*`.
It runs four jobs:

1. **`test`** — typecheck + unit tests. Currently `continue-on-error: true`
   because of pre-existing extension TypeScript errors; tracked as a separate
   cleanup task. Doesn't block the release.
2. **`build-extension`** — `npm run build:extension`, uploads
   `packages/extension/.output/chrome-mv3/` as artifact `extension-build`.
3. **`build-native-host`** (matrix, 5 platforms) — runs both
   `compile:{platform}` scripts (one for `native-host`, one for
   `native-host-helper`) and uploads BOTH binaries as artifact
   `native-host-{target}`.
4. **`create-release`** — downloads all `native-host-*` artifacts and uploads
   them to the GitHub release with auto-generated release notes.

Total runtime: ~2–3 minutes for the whole pipeline.

---

## Troubleshooting

### "Side panel says Setup incomplete after a successful install"

Almost always: the release didn't ship the helper binary, so the installer
couldn't refresh it. Fix:

1. Verify the release page lists `pilotwave-helper-*` assets:
   `gh release view vX.Y.Z`
2. If they're missing, the matrix in `release.yml` has been narrowed —
   compare against the version of `release.yml` documented above and
   re-add the helper steps.

### "Release workflow ran but failed"

```powershell
gh run list --workflow=release.yml --repo irmasemma/AIBrowserCopilot --limit 3
gh run view <run-id> --log-failed | tail -40
```

The `test` job has `continue-on-error: true` so it shouldn't block. If
`build-native-host` or `create-release` fail, that's a real problem —
typically a `pkg` issue on a specific platform. Check the failed step.

### "Tag pushed but no workflow ran"

GitHub Actions only triggers on tags pushed via `git push origin vX.Y.Z`,
not on tags created in the GitHub UI. Make sure you ran the push command.

### "Need to retag after fixing something"

```powershell
git tag -d vX.Y.Z                       # delete locally
git push origin :refs/tags/vX.Y.Z       # delete on origin
git tag -a vX.Y.Z <commit-sha> -m "…"   # retag at the right commit
git push origin vX.Y.Z                  # triggers CI again
```

If a release was already published at the old tag, delete it first:
`gh release delete vX.Y.Z --yes`.

---

## What is NOT in this release process (yet)

- **`npm publish` for `pilotwave-setup`** — the installer code on
  this branch is more recent than what's on npm (v0.1.2). If you want
  `npx pilotwave-setup` to pull the latest installer, run
  `npm publish` from `packages/installer/` separately. Tag-based CI does
  NOT do this automatically.
- **Code signing** — placeholders exist in `release.yml` for macOS notarization
  and Windows Authenticode signing. They're commented out until certificates
  and secrets are configured. Until then, both `.exe` files trigger
  SmartScreen warnings on Windows.
- **Chrome Web Store auto-publish** — the `publish-extension` job is
  commented out until CWS credentials are configured as secrets.
