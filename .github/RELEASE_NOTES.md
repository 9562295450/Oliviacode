## Oliviacode 2.2.14

**A refused connection now says what it dialled, and the sidecar follows the lane onto a new port.**
Two bugs made a dead lane look like a dead provider. Bun reports a refused connect as
`ECONNREFUSED: Unable to connect. Is the computer able to access the url?` — the address is the one
detail missing, so a report could not tell a stale local bridge from an endpoint that is down. And the
sidecar reads the proxy environment once, at spawn, while the engine's endpoint moves on every
rotation: when a Tor or WARP bridge came back on a different port, the CLI kept dialling the old one.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.14.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.14-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.14-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.14-x64.AppImage`, `Oliviacode-2.2.14-x64.deb`, `Oliviacode-2.2.14-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**The error message names the host**
- **`(dialled 127.0.0.1:8091)` is appended to the failure.** The request wrapper records the URL it
  actually dialled and the message carries it, so the card reads
  `ECONNREFUSED: Unable to connect. Is the computer able to access the url? (dialled 127.0.0.1:8091)`
  instead of leaving the address out.
- **The host rides on the transport error too.** `TransportError.url` is set, which is what the
  "Can't reach …" card reads to name the host, and what `Export Logs` preserves.
- **Both layers of the stack are covered.** An error that the AI SDK wraps ("Cannot connect to API")
  and one it passes through raw both end up naming the endpoint. Only the host and port are added;
  the runtime's own wording is untouched.
- **Applies to read timeouts as well.** A stalled stream or a header timeout now names the endpoint
  it was waiting on, not just a connect failure.
- **The retry card keeps the endpoint.** The one-line retry card cuts a long failure at 80
  characters; the dialled host is reserved before the cut, so a refused connect reads
  `ECONNREFUSED: Unable to connect. Is the computer able to… (dialled 127.0.0.1:8091)` instead of
  dropping the address off the end.
- **The default port is not printed.** `https://api.example.com` stays `api.example.com`; a
  non-default port is shown, because a port mismatch is exactly the case this is for.

**The sidecar follows the lane**
- **The restart decision is made against what the sidecar was started with.** The engine keeps the
  endpoint it last passed to a running sidecar and compares against that, never against the endpoint
  the rotation began on. A bridge that comes back on a new port is a move, even when the rotation
  produced the same URL twice.
- **Lane switches restart it too.** `Settings` → lane, or a rotate that changes lanes, now brings the
  sidecar onto the new port. Before this, only a rotation whose endpoint changed did.
- **A failed restart is retried once, then owed again.** The first attempt gets a second try 1.5 s
  later; if both fail, the pending endpoint is kept, so the next rotation or lane switch tries again
  instead of recording a move that never happened.
- **Nothing restarts when the port did not move.** WARP and a Tor `NEWNYM` keep their local proxy
  across a rotation and only the exit behind it changes, so live turns are not aborted for nothing.

**Carried from 2.2.13**
- **Custom providers.** Settings → Providers → **+ Add Custom Provider**: name, base URL, API key and
  a model list with **Detect models** against `{baseURL}/models`. The key is stored as a credential
  and never written into the config file.
- **One engine, built here.** Every release job builds the bundled engine from the tagged commit and
  the contract gate refuses a binary that cannot answer the routes the window calls.

### Verify before you run
- `Oliviacode-Setup-2.2.14.exe` — 246 MB (257,896,117 bytes) — `27429134ff059970eeb52f93fd46667c64a92f0c3f823282977903ad14d0e02f`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.14
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If you are on 2.2.11 or older and use a Tor or WARP lane, this release is the one that fixes the
  sidecar staying on a dead port after the bridge moves.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.14-x64.AppImage` then run it. The deb and rpm packages
  install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
