## Oliviacode 2.2.7

**This release replaces 2.2.6, which failed to start.** 2.2.6 loaded the auto-updater in a way
Electron's module loader rejects, so the main process died before the window could talk to it and
the app showed `Desktop IPC port handshake timed out`. 2.2.7 imports the updater correctly and
starts normally. No features changed.

A privacy-focused desktop AI client. Nothing is preconfigured: no provider, no endpoint in the
code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.7.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.7-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.7-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.7-x64.AppImage`, `Oliviacode-2.2.7-x64.deb`, `Oliviacode-2.2.7-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### Verify before you run
- `SHA256SUMS.txt` carries the SHA-256 for every artifact in this release.
- VirusTotal scanned the 2.2.7 application executable (`Oliviacode.exe`, the file the installer
  writes) with **0/68 detections**:
  [report](https://www.virustotal.com/gui/file/3dda8e6a3d82634e5f7c749238ca5701cd3cb7b60f9ee85e122295c55d93bb1d),
  SHA-256 `3dda8e6a3d82634e5f7c749238ca5701cd3cb7b60f9ee85e122295c55d93bb1d`, scanned 9 November
  2026. The installer itself is not uploaded; its hash is in `SHA256SUMS.txt`.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the
  hash against this release before you do.

### What's fixed
- **Startup on Windows.** The main process imported `electron-updater` as a named ESM export. It is
  a CommonJS module that exposes `autoUpdater` through a getter, so the import threw a
  `SyntaxError` before the IPC layer started. The module is now imported by its default export and
  the property is read from it.
- **The updater can no longer take startup down.** Its start call is isolated: if it ever fails,
  the error is logged and the app continues without updates instead of dying.
- **Linux and macOS builds.** The release workflow now builds AppImage, deb and rpm on
  `ubuntu-latest`, and dmg plus zip on Apple Silicon and Intel runners, and attaches them to the
  same release.
- **A community template for one-click setup.** A fresh install used to list no providers at all,
  because the only route in was a registry URL and nobody publishes one. The shipped
  `community-presets.json` now carries one convenience entry, OpenCode Zen, shown under
  **Community Templates** with the note *Community-provided. Use at your own risk.* Pressing
  **Use** writes the base URL into this app's engine config and opens the provider's own connect
  flow; paste `public` as the key for the free tier. Nothing is hardcoded: the picker reads the
  JSON, and the source contains no provider endpoint.

### Installing this one
- **2.2.6 is broken and cannot update itself**: run the 2.2.7 installer (or the platform package)
  once. It installs over 2.2.6 and keeps your settings.
- Builds from 2.2.7 onward update themselves from this repository's releases on Windows.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions
  from this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.
- The bundled CLI engine still updates through OpenCode on its own. It stays at 2.2.6 in this
  release; the shell fix does not touch it.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.7-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is downloaded from npm at build time; the version shipped is listed in the release
  assets.
