## Oliviacode 2.2.5

A privacy-focused desktop AI client. Nothing is preconfigured: no provider, no endpoint, no
credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.5.exe` |

macOS and Linux artifacts are built from source by the release workflow when those runners are
enabled; this release ships the Windows installer.

### Verify before you run
- `SHA256SUMS.txt` carries the SHA-256 for the installer.
- VirusTotal: see `docs/security/virustotal.md`. The report is attached once the exact binary is
  scanned.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the
  hash against this release before you do.

### What's in it
- Generic client core. No provider domain is compiled into the app; the provider list starts
  empty.
- Provider add-ons are community data: a starter template you install with one click, your own
  installed entries, or a registry URL you paste into **Add-ons -> Load community add-ons**.
  Nothing is fetched until you press Load, and nothing is applied until you press Use.
- Multi-lane egress: Direct, WARP, Tor, proxy, with health checks and rotation.
- Per-session workspace, model, and agent isolation.
- Branded Windows installer: licence page with the disclaimer, desktop shortcut, Start Menu
  shortcut, launch after install.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is downloaded from npm at build time; the version shipped is listed in the release
  assets.
