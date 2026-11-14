## Oliviacode 2.2.19

**An update can no longer leave a shortcut pointing at the version it replaced.** The installer
kept a desktop and Start Menu entry the previous install had asked it to preserve, so a link
written by an install directory that has since changed still aimed at the old executable — which
the same install had just deleted. Windows then answered "the item that this shortcut refers to
has been changed or moved", and a checked **Run Oliviacode** on the Finish page started nothing.
Both entries, and any taskbar pin, are now written to the executable the install just wrote.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.19.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.19-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.19-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.19-x64.AppImage`, `Oliviacode-2.2.19-x64.deb`, `Oliviacode-2.2.19-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**Why the shortcut broke**
- **The template skips the link on an update.** electron-builder's `addDesktopLink` only calls
  `CreateShortCut` when the previous install did not ask to keep shortcuts; when it did and the
  run is an update it leaves the existing link alone, and `addStartMenuLink` only renames a link
  that moved.
- **The install directory moves.** 2.2.5 and newer install into a directory named after the app
  ID rather than the shared package name, and the installer deletes this channel's executable
  from the old directory as it leaves. A link written before that move dangles the moment the
  install finishes.
- **The shortcut is now written every time.** `installer.nsh` rewrites the desktop entry, the
  Start Menu entry (inside the menu folder when one is configured) and the taskbar pin, if it
  exists, to `$INSTDIR` plus the executable name, then tells the shell the icons changed. The
  checked **Run Oliviacode** box starts that same entry, so it starts the new build.
- **Covered by a test.** `script/windows-installer.test.ts` compiles the include with the real
  NSIS toolchain, points two links at a path that does not exist, runs the install, and asserts
  both resolve to the executable it wrote.

**Carried from 2.2.18**
- **A session is named from the first thing you type, and the old unnamed rows were named too.**
  A startup pass names every root session whose title is null or an old timestamped fallback from
  its first substantive message — no model call, no tokens — and stamps greeting-only sessions
  with their date and time so the rows stay apart.
- **A row reads as the work it holds** from the first keystroke: the tab store keeps the first
  user message as a preview until the core rename lands.
- **The free allowance follows the exit address** (2.2.17), with the egress fixes that made the
  app fail on other machines: the limit watcher reads the log the desktop engine writes, a Direct
  lane rotation spends itself on the first lane the settings allow, launch restores and re-proves
  the lane, Direct no longer deletes a system or VPN proxy, WARP's proxy mode is handed back, a
  dead lane falls back to the machine's own route, and Tor adopts a Tor that is already running.
- **Custom providers.** Settings → Providers → **+ Add Custom Provider**: name, base URL, API key
  and a model list with **Detect models**. The key is stored as a credential and never written
  into the config file.

**The gate still runs before anything is built**
- **`verify` on a clean runner:** typecheck, the egress suite and `scripts/check-error-copy.ps1`.
- **Every platform boots its own packed app on a profile that has never run**, through
  `scripts/smoke-desktop.mjs`.
- **`SHA256SUMS.txt` is only rewritten when `verify` passed.**

### Verify before you run
- `Oliviacode-Setup-2.2.19.exe` — `CHECKSUM_PLACEHOLDER`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through
  2.2.19 installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If a shortcut on the desktop or in the Start Menu said the app had moved, this release repairs
  it on install instead of leaving it to be deleted by hand.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.19-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
