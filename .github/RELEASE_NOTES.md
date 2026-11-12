## Oliviacode 2.2.15

**Errors read like sentences again.** Two failures reached users in 2.2.14 with the answer buried:
a provider that answered 503 put its whole JSON body in the retry card, and a refused connection
said only `ECONNREFUSED: Unable to connect.` with no hint about which address refused or what to
fix. Both are copy bugs, and copy bugs are the ones users read first.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.15.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.15-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.15-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.15-x64.AppImage`, `Oliviacode-2.2.15-x64.deb`, `Oliviacode-2.2.15-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**A provider failure is summarised, never pasted**
- **Google's array-wrapped errors are read properly.** Google returns
  `[{"error":{"code":503,"message":"…","status":"UNAVAILABLE"}}]` — a one-element array. The decoder
  only knew object shapes, so it found no message and the caller fell back to echoing the payload.
  `providerErrorMessage` now unwraps arrays and reads the envelope inside.
- **A JSON body that still has no readable message is not shown.** When a payload parses as JSON but
  carries no message field, the card reads `Provider request failed with HTTP 503` and the body stays
  in the details for bug reports. A wall of braces is not an explanation.
- **Prose bodies are still shown, capped at 2,000 characters.** A gateway that answers `invalid
  parameter` in plain text still gets its words through; HTML error pages still do not.

**A refused connection says which address refused**
- **The card names the host and the fix.** It now reads
  `Nothing answered at opencode.ai. Check the Base URL in the provider's settings, or wait for the
  host to come back. (ECONNREFUSED: …)` instead of leaving `ECONNREFUSED` to explain itself.
- **A refused connect is separated from an unreachable network.** `ECONNREFUSED` means something
  answered and refused; `ENOTFOUND`, `ENETUNREACH` and friends mean this machine has no path. The two
  read differently now, because they need different fixes.
- **A 503 names its sentence.** The same 503 from the screenshot now reads
  `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please
  try again later.`

**The gate that stops this shipping again**
- **`scripts/check-error-copy.ps1`** runs the message suites and then drives the real request
  executor against a closed port and a Google-style 503, asserting that a refused connect names its
  address and that neither card contains a JSON payload.
- **`scripts/publish-release.ps1` refuses to publish without it.** The gate runs before the tag is
  pushed, so a release cannot go out with copy that has not been read by the same code path a user
  reads it through.

**Carried from 2.2.14**
- **The dialled host is appended to transport failures,** including read timeouts, and the one-line
  retry card reserves the endpoint before it truncates.
- **The sidecar restarts when the lane moves,** including a lane switch, with one retry and the move
  left owed if both attempts fail.
- **Custom providers.** Settings → Providers → **+ Add Custom Provider**: name, base URL, API key and
  a model list with **Detect models**. The key is stored as a credential and never written into the
  config file.

### Verify before you run
- `Oliviacode-Setup-2.2.15.exe` — 246 MB (257,893,099 bytes) — `2fb18f50db83209af06e65dfd23f51ba3314c4a6318f28fec7ff04a526327123`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.15
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If a provider failure in 2.2.14 read as a wall of JSON, this is the release that fixes it.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.15-x64.AppImage` then run it. The deb and rpm packages
  install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
