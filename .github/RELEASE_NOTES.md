## Oliviacode 2.2.17

**The free-usage allowance follows the exit address.** 2.2.17 started from the opposite reading —
that a new exit reached the same spent budget — and refused to rotate on `FreeUsageLimitError`.
The gateway's own code and this install's own logs say otherwise: the allowance is counted per
client address, and a rotation to a fresh WARP exit cleared the wall in three seconds. This
release restores rotation on that refusal, bounds it so a run of spent exits still stops, and
fixes the four egress bugs that made the app fail on other people's machines — a log path that
pointed at the wrong install, a saved bridge port that was dialled on launch, a WARP mode that
was never handed back, and a Tor lane that ignored the Tor a user already runs.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.17.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.17-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.17-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.17-x64.AppImage`, `Oliviacode-2.2.17-x64.deb`, `Oliviacode-2.2.17-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**Why the free wall clears on a rotation — and why it did not for everyone**
- **The counter is the client address.** In upstream's console at `83f2b6f` (11 Oct 2026),
  `packages/console/app/src/routes/zen/util/handler.ts` says every request is served by a separate
  inference service and the console "only routes and rejects what it cannot route".
  `lib/inference-proxy.ts` forwards the client address as `x-zen-ip` and strips the client's own
  credentials before the service decides — so the bucket that answers is keyed on the address the
  request arrives from, not on an account.
- **Measured on this install:** `FreeUsageLimitError` at 18:16:35 and 18:17:29 UTC; a WARP rotation
  landed at 18:17:38; the next message at 18:17:41 was answered by the same session and the same
  model (`deepseek-v4.1-flash-free`) with no refusal, and kept answering. Once that exit had served
  a burst of messages it refused again with the same countdown — a per-exit daily allowance, spent
  and then refilled by the next exit.
- **The reset is a fixed daily boundary.** Every refusal carries a `Retry-After` that counts down to
  00:00 UTC the next day, whatever the exit. The boundary is shared; the allowance in front of it is
  not.
- **A free-usage refusal rotates again.** `FreeUsageLimitError` and its prose form are recognised on
  their own, skip the paid-quota gate, and take the ordinary recovery path. The proof rule still
  bounds it: two fresh exits refused inside the window and the engine stops buying more, says so,
  and points at a provider.
- **VPN exits are not the wall, and they are not a cure either.** A VPN exit carries whatever
  allowance that address has left — a shared or previously used exit can already be spent, a fresh
  one is not. That is why the same build behaves differently on two machines. Two lane
  interactions are handled: a network that blocks UDP breaks WARP's tunnel, and a proxy the OS
  already sets is kept instead of deleted.
- **`Rotate on quota` stays off.** It gates paid, credential-scoped quotas, where an exit cannot
  refill an invoice. It no longer applies to the free lane.
- **The notice names the lever:** `The free allowance is counted per exit address, so a fresh exit
  carries a fresh allowance. Rotating is what clears it; if fresh exits are refused too, connect a
  provider or wait for the provider's reset.` Saving provider settings clears it.

**Why the same build worked on one machine and failed on others**
- **The limit watcher read a log that was not being written.** It tailed
  `~/.local/share/opencode/log`, while the desktop engine writes under its own userData:
  `<userData>/engine/data/opencode/log`. On the machines where the app was installed, the file it
  watched had not grown since 11 November — so no limit was ever detected and automatic recovery
  never fired. The engine's `XDG_DATA_HOME` log is now first, the old paths remain as fallbacks.
- **A limit on the direct lane rotated nothing.** A first run starts on Direct, and a rotation of
  Direct has no exit, so auto-recovery fired, returned "pick a lane", and left the wall exactly
  where it was. A rotation that starts on Direct now spends itself on the first lane the settings
  allow (WARP, then Tor, then a proxy) and only reports "no exit" when none is available.
- **Every launch dialled the previous run's bridge port.** `load()` re-applied the saved endpoint
  before re-preparing the lane, so the sidecar started against a port whose process had died with
  the last run: a refused connect before anything had a chance to work. The lane is restored, then
  re-prepared and re-proven, and only a live endpoint is applied.
- **Direct deleted a VPN's or a company's proxy settings.** Returning to Direct removed
  `HTTP_PROXY`, `HTTPS_PROXY` and friends for the whole process tree, and set Chromium to
  `direct`. On a machine whose route is a system proxy or a VPN's proxy, that turned "back to
  Direct" into "back to no route at all". Direct now restores the inherited environment and the
  Chromium session follows the system configuration (`system`, not `direct`).
- **WARP was left in proxy mode.** `mode proxy` changes the whole WARP client: normal traffic stops
  using the tunnel while the app is open, and it survives a crash. The previous mode is recorded
  before the switch and restored when the lane is left or the app quits. An organisation-managed
  (Zero Trust) install is no longer re-registered, because that would remove the device from its
  account.
- **A dead lane never recovered.** A bridge or tunnel that died between rotations left the sidecar
  dialling a closed port, and every request failed with a refused connect that named no cause. A
  45-second check now proves the lane twice, then puts the app back on the machine's own route and
  says so once.
- **Tor ignored the Tor a user already runs.** The lane downloaded its own Expert Bundle even when
  Tor Browser or a system daemon was listening. It now adopts an existing SOCKS listener on
  `9150`/`9050` (control on `9151`/`9051` when available), proves it through a trace before keeping
  it, and only downloads when nothing answers. A censored network can point the bundled daemon at
  bridges by writing `Bridge` lines to `<userData>/egress/tor/torrc`.

**The provider check was dialling the wrong thing — and rarely ran at all**
- **The provider check never ran.** It only read the panel's fields, which almost nobody filled in,
  so every rotation was adopted unverified. The target is now resolved from the app's own
  `opencode.json` — the selected model's provider `baseURL` and key — with a manual endpoint still
  winning when one is entered. A loopback provider is reported as local instead of being probed
  through a tunnel that never carries it, and a key from the panel is held for the session and
  never written to `state.json`.
- **`providerProbe` put the provider URL in `--proxy`.** Curl was asked to use the provider as the
  proxy and to fetch the provider as the URL, so every probe failed and answered `unknown` — the
  same result as having no check at all. The lane's local proxy and the provider URL are now passed
  separately, and a direct lane probes without a proxy.
- **A provider verdict is kept only when it is evidence.** A limited address under no key is
  scrapped and the next exit is tried; a limited address under a real key keeps the exit, because
  every exit serves the same account.

**The gate still runs before anything is built**
- **`verify` on a clean runner:** typecheck, the 51 egress tests (recovery, provider verdicts,
  provider resolution, trace parsing, log discovery) and `scripts/check-error-copy.ps1`.
- **Every platform boots its own packed app on a profile that has never run**, through
  `scripts/smoke-desktop.mjs`. A regression that only reproduces on a fresh install fails the run.
- **`SHA256SUMS.txt` is only rewritten when `verify` passed.**

**Carried from 2.2.15 and 2.2.16**
- **Provider failures are summarised, never pasted.** Array-wrapped errors are unwrapped; a JSON body
  with no readable message becomes `Provider request failed with HTTP <status>`; prose bodies are
  capped at 2,000 characters.
- **A refused connection names the host and the fix,** and reads differently from an unreachable
  network.
- **Two refused exits stop the automatic path** for limits that really are about the address, with
  the count shown as evidence.
- **Custom providers.** Settings → Providers → **+ Add Custom Provider**: name, base URL, API key and
  a model list with **Detect models**. The key is stored as a credential and never written into the
  config file.

### Verify before you run
- `Oliviacode-Setup-2.2.17.exe` — 246 MB — `CHECKSUM_PLACEHOLDER`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.17
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If rotation kept running while the free-usage notice stayed up, this is the release that stops it
  and says why.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.17-x64.AppImage` then run it. The deb and rpm packages
  install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
