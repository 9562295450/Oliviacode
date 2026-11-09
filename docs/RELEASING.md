# Releasing

Two routes, both end with the installer attached to a GitHub release. Pick one.

## Route A - local publish (no `gh`, no extra tools)

The machine needs `git`, PowerShell, and a fine-grained token once. The token is passed to git as
a one-shot HTTP header; it is never written to `.git/config`, the remote URL, or a file.

1. Create a classic token with `repo` and `workflow` scopes:
   <https://github.com/settings/tokens/new?scopes=repo,workflow&description=Oliviacode-release>
   - `repo` covers contents, releases, and the About box.
   - `workflow` is required because the repository contains `.github/workflows/*`; GitHub
     rejects any push that adds or edits those files without it.
   - Fine-grained tokens work too: **Contents: Read and write**, **Administration: Read and
     write**, **Workflows: Read and write**.
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
   **oliviacode Dev**, and installs under appId `ai.oliviacode.desktop`.

3. Publish:

   ```powershell
   $env:GH_TOKEN = "github_pat_..."
   powershell -File scripts/publish-release.ps1 -Version 2.2.6
   ```

The script commits the tree, pushes `main`, pushes the `v<version>` tag, updates the About box,
creates (or reuses) the release, and uploads the installer, `SHA256SUMS.txt`, `latest.yml` and the
blockmap. Re-running it replaces same-named assets instead of failing.

A tag pushed by Route A also queues Route B, which rebuilds the installer on the runner and
uploads with `--clobber`. Cancel that run to keep the binary verified here, or let Route B own the
release instead and verify its artifact afterwards.

Verify the installer before publishing, on a disposable profile:

```powershell
powershell -File scripts/verify-installer.ps1 -Version 2.2.6
```

That installs silently, asserts `Desktop\Oliviacode.lnk` and the Start Menu entry exist and point
at the installed executable, then uninstalls and asserts both are gone.

## Route B - the workflow

`.github/workflows/publish-windows.yml` runs on a clean `windows-latest` runner. The repo-scoped
`GITHUB_TOKEN` does the publishing; no personal token is stored in the repo.

```powershell
git tag v2.2.6
git push origin v2.2.6
```

Or run **Actions -> publish-windows -> Run workflow** with the version, after the tag exists.

The workflow builds, packs the unpacked app, packs the NSIS installer, writes `SHA256SUMS.txt`,
creates the release when it is missing, and uploads the installer, checksums, `latest.yml` and the
blockmap with `--clobber` so a re-run is safe.

A tag pushed in the same operation as the repository's very first branch push may not trigger a
run, because the default branch had not been indexed yet. If the Actions tab shows no run, use
**Run workflow** once with the same version; later tags trigger automatically.

## What the installer does

- Assisted flow: licence page with the disclaimer, progress page, Finish with **Run Oliviacode**
  ticked.
- Per-user install under `%LOCALAPPDATA%\Programs\ai.oliviacode.public`, so it co-exists with a
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

