## Oliviacode 2.2.11

**WARP picks up a client you install while the app is already open.** The lane used to ask the
filesystem once, remember the miss, and go on blaming the tunnel for a client that was now sitting
in `C:\Program Files\Cloudflare\`. It now rescans both Program Files trees and `PATH` on a 15-second
recheck, so installing Cloudflare WARP and selecting the lane again connects instead of talking about
a tunnel that was never the problem.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.11.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.11-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.11-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.11-x64.AppImage`, `Oliviacode-2.2.11-x64.deb`, `Oliviacode-2.2.11-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**WARP lane**
- **A client installed mid-session is found.** No permanent negative result is cached. The scan
  covers `Cloudflare WARP` and `Cloudflare One Client` under both Program Files roots, then falls
  back to `PATH`, and a miss is retried after 15 seconds rather than until restart.
- **The lane registers before it connects.** `prepare` disconnects first (the daemon refuses mode
  and proxy-port changes while a tunnel is up), runs `registration new` when the machine is not
  registered — budgeted at 120 s, because a cold registration renegotiates keys — then sets
  `tunnel protocol MASQUE`, `mode proxy` and the proxy port, and only then connects.
- **The endpoint is decided per machine, not per assumption.** The lane probes
  `http://127.0.0.1:<port>` and hands that URL to the engine when it answers HTTP. The SOCKS→HTTP
  bridge is built only when the probe fails, which is the case on builds that really do serve
  SOCKS5 on that port. A bridge that is not needed costs a listener and a hop for nothing.
- **An unprepared WARP lane can no longer report your own address as its exit.** `healthy()` returns
  not-alive when no endpoint has been resolved, because an empty proxy means the direct lane to the
  trace code, and the direct lane is not a WARP exit.
- **The failure names the missing thing.** A machine with no client gets "Cloudflare WARP is not
  installed. Install it from https://1.1.1.1/, then select the WARP lane again." instead of a
  sentence about a tunnel that never came up.

**Window**
- **Failures are clickable.** URLs in lane errors and in the sidebar read as links you can open,
  in the panel and in the sidebar alike; the text is still exactly what the engine produced.
- **Rotate says what it did.** Pressing rotate in the sidebar prints the new exit, the lane and how
  long it took — `New exit 2a09:bac1:… · WARP · 12.4s` — for eight seconds, instead of returning to
  a phase that looks identical to never having pressed it.
- **Free-limit dialogs are provider-agnostic.** "Subscribe to OpenCode Go" is gone. The dialog says
  the free allocation ran out and offers **Connect a provider**, with no preselected provider,
  because the way out is whichever provider you already pay for. Paid-model limit rows carry the same
  **Connect a provider** action next to the reset time.

**Licensing and credits**
- **Oliviacode is credited to Malbe**, the creator and maintainer of this fork
  ([github.com/9562295450](https://github.com/9562295450)), on the About screen, in the README, in
  `NOTICE.md`, in the installer's licence page, and in the AppStream metadata as the developer.
- **The MIT notice travels intact.** `Copyright (c) 2025 opencode` is retained in `LICENSE`,
  `NOTICE.md` and the installer licence alongside
  `Copyright (c) 2026 Malbe and oliviacode contributors`. The About screen keeps the upstream writer
  credits and publication facts, states that Oliviacode is a fork redistributed under the MIT
  licence, and states plainly that it is not affiliated with, endorsed by, or sponsored by Anomaly
  Innovations, Inc.
- **The inherited copyright mark is gone.** The About screen no longer presents an upstream wordmark
  as this build's copyright owner, and the 62 non-English locale files no longer carry inherited
  About strings — they fall back to the corrected English copy.
- **Help links point at this repository.** Share Feedback and Report Bug open this fork's
  discussions and issue tracker, not upstream's.

The WARP, window and About changes live in the desktop and app layers, so every platform gets them.
This Windows installer carries the rebuilt engine; the macOS and Linux packages bundled below use
the pinned engine, so engine-side wording can trail the window until that pin advances.

### Verify before you run
- `Oliviacode-Setup-2.2.11.exe` — 257,938,944 bytes —
  `60300aaf81ac88a2fb9e9b29036f04e0ad8e8ab579d4009089f87ac5b90121c1`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application
  binary with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.11
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the
  hash against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions
  from this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.11-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time; the version shipped is listed in the release assets.
- Community: <https://discord.gg/kDcRCu6ek>
