## Oliviacode 2.2.16

**Rotation now proves whether it helped, and stops when it didn't.** The free lane counts its
allowance per address, so a new exit can clear `You've used today's free messages`. It also might
not — the allowance can be tied to something a new address does not change. Until now the engine
rotated on every limit line regardless, spending WARP re-registrations and Tor circuits while the
notice on screen never moved. It now keeps score: two fresh exits refused by the same limit and it
stops, says so, and names the way out.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.16.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.16-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.16-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.16-x64.AppImage`, `Oliviacode-2.2.16-x64.deb`, `Oliviacode-2.2.16-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**A rotation is a purchase, and the engine counts what it buys**
- **One strike per rotation.** A limit line that arrives within 120 seconds of a rotation that
  landed on a different, probed address means the provider refused that address. It counts once per
  rotation, however many retry lines carry it — a queued request failing ten times is one attempt,
  not ten.
- **Two strikes and it stops.** A third rotation would buy a third exit to learn the same answer.
  The engine leaves the lane alone instead, and the egress panel shows:
  `Rotating is not clearing this limit: 2 new exits were refused too. Switch models or connect a
  provider.`
- **Automatic and manual rotations are separate.** The automatic path keeps the score because
  nothing about the ticket changed. Pressing **Rotate**, switching lanes or re-arming clears it,
  because a person may have switched model or connected a provider since the last attempt.
- **The panel shows the proof, not a spinner.** `EGRESS` keeps the notice until one of those
  actions clears it, so a wall that rotation cannot fix no longer looks like a wall that is still
  being worked on.

**The gate that tests a fresh install, not this machine**
- **`verify` runs before anything is built.** Typecheck, the egress recovery unit tests and
  `scripts/check-error-copy.ps1` run on a clean Ubuntu runner. A failed gate stops the release
  before a single artifact is produced.
- **Every platform boots its own packed app on a profile that has never run.** `scripts/smoke-desktop.mjs`
  starts the packaged binary with a temporary root and free ports, waits for the renderer, and
  asserts the shell painted. Windows runs it against the unpacked app the installer wraps; Linux
  runs it under Xvfb; macOS runs it against the packed `.app`. A regression that only reproduces on
  a clean install fails the workflow instead of the users.
- **Checksums wait for the gate.** `SHA256SUMS.txt` is only rewritten when `verify` passed.

**Also in this build**
- **Queue rows carry their folder.** Two untitled sessions were indistinguishable by name; each row
  now shows the last path segment of its directory, and the inspector no longer repeats the counts
  the sidebar already shows.
- **The update banner sits above the prompt bar** instead of over it.

**Carried from 2.2.15**
- **Provider failures are summarised, never pasted.** Array-wrapped errors are unwrapped; a JSON body
  with no readable message becomes `Provider request failed with HTTP <status>`; prose bodies are
  capped at 2,000 characters.
- **A refused connection names the host and the fix,** and a refused connect reads differently from
  an unreachable network.
- **Custom providers.** Settings → Providers → **+ Add Custom Provider**: name, base URL, API key and
  a model list with **Detect models**. The key is stored as a credential and never written into the
  config file.

### Verify before you run
- `Oliviacode-Setup-2.2.16.exe` — 246 MB (257,905,655 bytes) — `847ebbb4e745fdc7e270dd703999782549429032a17d6c91e1a596cc18b700d4`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.16
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If rotation kept running while the free-usage notice stayed up, this is the release that stops it
  and tells you why.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.16-x64.AppImage` then run it. The deb and rpm packages
  install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
