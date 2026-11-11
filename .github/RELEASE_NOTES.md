## Oliviacode 2.2.13

**2.2.12 could not save a custom provider. 2.2.13 can.** The dialog was right; the engine under it was
older. Saving a provider goes through the engine's config route, and the engine bundled with 2.2.12
was built before that route learned to carry provider entries, so the write was refused with
`Missing key at ["shell"]` and nothing was saved. This release builds the engine from the same commit
as the window, on every platform, so the route and the dialog agree.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.13.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.13-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.13-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.13-x64.AppImage`, `Oliviacode-2.2.13-x64.deb`, `Oliviacode-2.2.13-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**Custom providers**
- **Settings → Providers → + Add Custom Provider.** Name, base URL, API key, and a model list with a
  **Detect models** button that reads `{baseURL}/models`. For endpoints the catalogue does not know:
  a gateway, a proxy, a local server, your own route.
- **The row appears the moment you save.** The dialog writes the provider into the global config
  document and re-reads the provider, model and config catalogues, so the connected list shows the
  new row without a restart.
- **The key never lands in a config file.** Base URL, package and model IDs go into
  `opencode.jsonc`; the API key is created as a `key` credential for that provider and applied by the
  model resolver at request time. The config document holds no secret.
- **A provider ID is derived from the name and never overwrites.** `Antigravity` becomes
  `antigravity`; a name whose ID already exists is an inline error, not a silent replacement.
- **Model IDs are required and can be discovered.** Any OpenAI-compatible `/models` shape is read — a
  bare array, `{ data: [...] }` or `{ models: [...] }`, with entries as strings or `{ id }`,
  `{ model }`, `{ name }`. The request times out after 8 s and the field stays editable by hand.
- **Keyless endpoints stay listed.** Visibility used to require a credential. A config-defined
  provider now counts as supplied by you, which is what a local server with no key needs.
- **The write preserves your file.** The engine patches the config as JSONC, so comments, key order
  and formatting outside `providers` survive, and each entry is decoded against the provider schema
  before it is written.

**One engine, built here**
- Every release job now builds the bundled engine from the tagged commit instead of downloading a
  published CLI. The window and the engine can no longer disagree about a route or a field, and all
  three platforms ship the same engine version.
- The engine contract gate still runs during the build: the bundled binary must answer every
  operation the window calls before a package is produced.

**Carried from 2.2.12**
- WARP picks up a client you install while the app is already open; the lane rescans both Program
  Files roots and `PATH` on a 15-second recheck.

**Carried from 2.2.11**
- **Window:** failures are clickable links; rotate prints the new exit, lane and elapsed time;
  free-limit dialogs are provider-agnostic.
- **Licensing and credits:** Oliviacode is credited to **Malbe** on the About screen, in the README,
  in `NOTICE.md`, in the installer's licence page and in the AppStream metadata. The MIT notice keeps
  `Copyright (c) 2025 opencode` alongside `Copyright (c) 2026 Malbe and oliviacode contributors`, and
  the About screen states that this fork is not affiliated with, endorsed by or sponsored by Anomaly
  Innovations, Inc.

### Verify before you run
- `Oliviacode-Setup-2.2.13.exe` — 246 MB (257,895,764 bytes) — `48ab9ad08b25bea5a4d6a0fa79b0c3e5997b6408546f59567d08bd1c7f5f8896`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.13
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- If you installed 2.2.12, update to 2.2.13 before adding a custom provider: 2.2.12's engine refuses
  the write.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.13-x64.AppImage` then run it. The deb and rpm packages
  install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
