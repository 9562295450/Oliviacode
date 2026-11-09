## Oliviacode 2.2.10

**Tor starts again on machines where it used to die during bootstrap.** The lane bound fixed loopback
ports and a fixed data directory, so a Tor Browser already listening on 9050, a second copy of the
app, or a daemon left behind by a crashed run was enough to kill the bootstrap before it reached 100%
— and the panel only said "tor exited during bootstrap". Every start now takes its own ports, shuts
the previous daemon down through its control port, and retries once on a fresh data directory when
the old one is still locked.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.10.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.10-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.10-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.10-x64.AppImage`, `Oliviacode-2.2.10-x64.deb`, `Oliviacode-2.2.10-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new
- **Tor picks free ports on every start.** SOCKS, control and the local HTTP bridge were fixed at
  9050, 9051 and 8118. Any other Tor instance on the machine — including Tor Browser, which ships
  the same daemon and the same defaults — made the bundled one exit before bootstrap. All three are
  requested from the OS per start, the controls talk to the port that was actually resolved, and the
  bridge reports the port it bound instead of the one it asked for.
- **A crashed run can't wedge the next one.** The lane shuts the daemon down with `SIGNAL SHUTDOWN`
  through the control port and waits for it, so the data-directory lock and the port bindings are
  released. If the lock is still held — a daemon orphaned by a killed process — the start retries
  once on a pristine directory instead of failing the lane.
- **The failure names the cause.** "tor exited during bootstrap" is replaced by a sentence built
  from the daemon's own last lines, timestamp stripped, with the three cases that actually happen
  mapped out: data directory locked by another instance, loopback port taken, or the system blocking
  the binary. The resolved ports are exposed on the lane for diagnostics.
- **No upstream branding in limit messages.** Running out of free usage used to tell you to
  "subscribe to OpenCode Go", and the Go limit pointed at a page this app does not have. Both now
  say what to do in this client: connect a provider or switch models, or switch to another model or
  raise the usage allowance.

The Tor fixes live in the desktop layer, so every platform gets them. The account-limit wording comes
from the engine, and this Windows installer carries the rebuilt 2.2.10 engine. The macOS and Linux
packages bundled below use the pinned 2.2.6 engine, so they keep the old wording until that pin
advances.

### Verify before you run
- `Oliviacode-Setup-2.2.10.exe` — 257,979,051 bytes —
  `6f0646326fac00795ca0e35b0e1ad06197e36017287bd09fd5b7f6393fe16616`.
- `SHA256SUMS.txt` carries the SHA-256 for the Windows installer, `latest.yml` and the blockmap.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application
  binary with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8, 2.2.9 and
  2.2.10 installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the
  hash against this release before you do.

### Installing this one
- 2.2.8 and 2.2.9 installs can take this release through the built-in updater.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions
  from this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.10-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time; the version shipped is listed in the release assets.
