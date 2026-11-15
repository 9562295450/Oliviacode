## Oliviacode 2.2.20

**An update that does not put the app back now says so instead of finishing quietly.** The old
version is uninstalled before the new files are written, so an extraction that stops early — a
file still held by the dying app, an antivirus lock, a full disk — leaves the install directory
empty. The installer used to report success anyway, and 2.2.19's repaired shortcut then pointed
at nothing. It now checks that the executable it just installed exists, refuses to finish as a
success, and leaves the shortcuts alone.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.20.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.20-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.20-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.20-x64.AppImage`, `Oliviacode-2.2.20-x64.deb`, `Oliviacode-2.2.20-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**The update could finish with an empty install directory**
- **The old version goes first.** `installSection.nsh` runs the previous uninstaller, which does
  `RMDir /r $INSTDIR`, and only then writes the new files. Anything that stops the write — a
  process still holding `Oliviacode.exe`, an antivirus lock, a full disk — leaves nothing behind.
- **The install still reported success**, so a checked **Run Oliviacode** started a path that did
  not exist, and the repaired shortcut from 2.2.19 pointed at the same hole.
- **It now checks the executable it installed.** `customInstall` verifies
  `$INSTDIR\${APP_EXECUTABLE_FILENAME}` after the files are written. Missing: the install exits
  with a non-zero code, shows the path it could not find, and does not touch the shortcuts.
- **A staged update is only accepted if it is complete.** `customInstallStagedApp` now asks for
  the extraction unless the directory it renamed into place actually holds the executable, instead
  of trusting a rename that reported success.
- **Tested both ways.** `script/windows-installer.test.ts` gains a case that runs `customInstall`
  against an empty directory and asserts a non-zero exit.

**Also in this build**
- **Add-ons apply on engine 2.3**, and **custom providers are saved to disk** rather than held for
  the session.

**Carried from 2.2.19**
- **The installer writes the shortcuts every time.** An update no longer keeps a desktop or Start
  Menu entry that pointed at an install directory this install had just removed; both entries and
  the taskbar pin are written to `$INSTDIR` after the files land.

**Carried from 2.2.18**
- **A session is named from the first thing you type**, and the rows created before that naming
  existed were named from their own first message — no model call, no tokens — with a date stamp
  for sessions whose only message is a greeting.

**The gate still runs before anything is built**
- **`verify` on a clean runner:** typecheck, the egress suite and `scripts/check-error-copy.ps1`.
- **Every platform boots its own packed app on a profile that has never run**, through
  `scripts/smoke-desktop.mjs`.
- **`SHA256SUMS.txt` is only rewritten when `verify` passed.**

### Verify before you run
- `Oliviacode-Setup-2.2.20.exe` — 246 MB — SHA-256 `17dc3fa04cba9fd5c6c37c1de0bd2043c40cbee3444a3088a1f70e25944b1e2c`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through
  2.2.20 installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If an update ever finishes without the app, this installer says so and names the path it could
  not find instead of leaving a shortcut that opens nothing.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.20-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
