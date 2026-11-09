# Releasing

Two routes, both end with the installer attached to a GitHub release. Pick one.

## Route A - local publish (no `gh`, no extra tools)

The machine needs `git`, PowerShell, and a fine-grained token once. The token is passed to git as
a one-shot HTTP header; it is never written to `.git/config`, the remote URL, or a file.

1. Create a classic token with `repo` and `workflow` scopes:
   <https://github.com/settings/tokens/new?scopes=repo,workflow&description=Oliviacode-release>
   - `repo` covers contents, releases, and the About box.
   - `workflow` is required to push changes under `.github/workflows/*` and to dispatch the
     release workflow.
   - Fine-grained tokens work too: **Contents: Read and write**, **Administration: Read and
     write**, **Actions: Read and write**.
2. Build:

   ```powershell
   cd packages/desktop
   $env:OPENCODE_CHANNEL = "prod"
   $env:OLIVIACODE_CLI_VERSION = "2.2.6"
   bun run build
   bun run pack
   $env:OPENCODE_DESKTOP_APP = (Resolve-Path "../../dist/desktop/app").Path
   bun run pack
   ```

   `OPENCODE_CHANNEL=prod` is what makes the installer say **Oliviacode** instead of
   **oliviacode Dev**, and installs under appId `ai.oliviacode.desktop`. The engine pin is
   independent of the shell version: only raise it when the bundled CLI is meant to change.

3. Publish:

   ```powershell
   $env:GH_TOKEN = "github_pat_..."
   powershell -File scripts/publish-release.ps1 -Version 2.2.7
   ```

The script commits the tree, pushes `main`, creates (or reuses) the release, uploads the installer,
`SHA256SUMS.txt`, `latest.yml` and the blockmap, then dispatches the publish workflow for the other
platforms. Re-running it replaces same-named assets instead of failing.

The release API creates the `v<version>` tag on the commit it just pushed. The script does not push
the tag itself: a tag push would start the workflow before the Windows asset exists, and its Windows
job would rebuild and replace the binary verified here. Because the tag already points at that
commit, a later `git push origin v<version>` would be a no-op and would raise no event, so the
script dispatches `publish.yml` with the version instead. The workflow's Windows job sees the
uploaded installer and skips; the Linux and macOS jobs build and attach their packages.

Verify the installer before publishing, on a disposable profile:

```powershell
powershell -File scripts/verify-installer.ps1 -Version 2.2.7
```

That installs silently, asserts `Desktop\Oliviacode.lnk` and the Start Menu entry exist and point
at the installed executable, then uninstalls and asserts both are gone.

## Route B - the workflow

`.github/workflows/publish.yml` runs on clean runners. The repo-scoped `GITHUB_TOKEN` does the
publishing; no personal token is stored in the repo.

```powershell
git tag v2.2.7
git push origin v2.2.7
```

Or run **Actions -> publish -> Run workflow** with the version, after the tag exists.

The workflow builds:

| Job | Runner | Artifacts |
| --- | --- | --- |
| `windows` | `windows-latest` | `Oliviacode-Setup-<version>.exe`, `latest.yml`, blockmap |
| `linux` | `ubuntu-latest` | `Oliviacode-<version>-x64.AppImage`, `.deb`, `.rpm`, `latest-linux.yml` |
| `macos` | `macos-latest` (arm64), `macos-15-intel` (x64) | `Oliviacode-<version>-<arch>.dmg`, `.zip` |
| `checksums` | `ubuntu-latest` | `SHA256SUMS.txt` over every published asset |

Each build job skips when its artifact is already on the release, so a locally verified Windows
installer survives the tag push. The `checksums` job rewrites one SHA-256 list covering everything
actually attached.

macOS builds are unsigned and not notarized. Squirrel.Mac refuses unsigned updates, so no
`latest-mac.yml` is published and macOS installs update by download until signing is set up.
Linux AppImage installs use `latest-linux.yml`; deb and rpm installs update through the package
manager.

A tag pushed in the same operation as the repository's very first branch push may not trigger a
run, because the default branch had not been indexed yet. If the Actions tab shows no run, use
**Run workflow** once with the same version; later tags trigger automatically.

## What the installer does

- Assisted flow: licence page with the disclaimer, progress page, Finish with **Run Oliviacode**
  ticked.
- Per-user install under `%LOCALAPPDATA%\Programs\ai.oliviacode.desktop`, so it co-exists with a
  separate OpenCode install.
- Desktop shortcut `Oliviacode.lnk` and Start Menu entry, created for the current user.
  `createDesktopShortcut: "always"` recreates the desktop icon on update if it was removed.
- Uninstall removes the app and shortcuts; user data is kept unless the user deletes it.

## After the release

1. Scan the exact installer on <https://www.virustotal.com/gui/home/upload>.
2. Copy the report URL into `docs/security/virustotal.md` and the release body.
3. Bump the badge text in `docs/security/virustotal-badge.svg` from `no release scanned yet` to
   the version and detection count.
4. Paste the About text and topics from `.github/REPO.md` if the script was not used.

## Repository location

The canonical repository is <https://github.com/9562295450/Oliviacode>. All links in the app,
README, notices and release notes point there.

