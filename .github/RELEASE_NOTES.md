## Oliviacode 2.2.12

**Custom providers are a button now.** Settings → Providers has **+ Add Custom Provider**: name, base
URL, API key, and a model list with a **Detect models** button that reads `{baseURL}/models`. It is
for the endpoints the catalogue does not know — a gateway, a proxy, a local server, your own
`antigravity` — and it works without a key when the endpoint does not need one.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.12.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.12-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.12-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.12-x64.AppImage`, `Oliviacode-2.2.12-x64.deb`, `Oliviacode-2.2.12-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**Custom providers**
- **The row appears the moment you save.** The dialog writes the provider into the global config
  document and re-reads the provider, model and config catalogues, so the connected list shows the
  new row without a restart.
- **The key never lands in a config file.** Base URL, package and model IDs go into
  `opencode.jsonc`; the API key is created as a `key` credential for that provider and applied by the
  model resolver at request time. The config document holds no secret.
- **A provider ID is derived from the name and never overwrites.** `Antigravity` becomes
  `antigravity`; a name whose ID already exists is an inline error, not a silent replacement.
- **Model IDs are required and can be discovered.** Any OpenAI-compatible `/models` shape is read —
  a bare array, `{ data: [...] }` or `{ models: [...] }`, with entries as strings or `{ id }`,
  `{ model }`, `{ name }`. The request times out after 8 s and the field stays editable by hand.
- **Keyless endpoints stay listed.** Visibility used to require a credential. A config-defined
  provider now counts as supplied by you, which is what a local server with no key needs.
- **The write is validated server-side.** `PATCH /api/experimental/config` carries provider entries
  as JSON; the server decodes each one against the provider schema before editing the document, so a
  malformed entry is refused instead of being written.

**Carried from 2.2.11**
- **WARP picks up a client you install while the app is already open.** The lane rescans both
  Program Files roots and `PATH` on a 15-second recheck instead of caching the miss until restart.
- **Window:** failures are clickable links; rotate prints the new exit, lane and elapsed time;
  free-limit dialogs are provider-agnostic.
- **Licensing and credits:** Oliviacode is credited to **Malbe** on the About screen, in the README,
  in `NOTICE.md`, in the installer's licence page and in the AppStream metadata. The MIT notice keeps
  `Copyright (c) 2025 opencode` alongside `Copyright (c) 2026 Malbe and oliviacode contributors`, and
  the About screen states that this fork is not affiliated with, endorsed by or sponsored by Anomaly
  Innovations, Inc.

The custom-provider dialog and the config endpoint live in the app and server layers, so every
platform gets them. This Windows installer carries the rebuilt engine; the macOS and Linux packages
bundled below use the pinned engine.

### Verify before you run
- `Oliviacode-Setup-2.2.12.exe` — 257,940,609 bytes —
  `13228554f8fcce13ec285e14facd76ca9b54484ec41c5ebb3f60beb3b6546f61`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application
  binary with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.12
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
- **Linux AppImage:** `chmod +x Oliviacode-2.2.12-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time; the version shipped is listed in the release assets.
- Community: <https://discord.gg/kDcRCu6ek>
