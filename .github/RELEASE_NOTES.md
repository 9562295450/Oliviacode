## Oliviacode 2.2.9

**A session names itself the moment you send the first message.** The title used to arrive after a
model round trip, which left every new session sitting in the list as "New session" until the small
title model answered — and forever, if it never did. Now the first line of your prompt becomes the
name before any model call runs. When the generated title lands it still takes over, and a rename
you typed still wins.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.9.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.9-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.9-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.9-x64.AppImage`, `Oliviacode-2.2.9-x64.deb`, `Oliviacode-2.2.9-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new
- **A name from the first message.** The engine publishes a provisional title — the first line of the
  prompt, whitespace collapsed, capped at 60 characters — before it selects a title model. A missing
  title agent, an unreachable provider, or an answer that never arrives now leaves a readable list
  instead of a column of identical placeholders. The generated title replaces it when it is written;
  a rename you completed while generation was in flight is left alone.
- **Rename from the row.** Every session row in Home has a pencil on hover — always visible on a
  touch screen — that opens the same inline editor the context menu already had. Untitled sessions
  used to look broken rather than editable; the menu was the only way in.
- **Two web tools for the model.** `web_fetch` and `web_search` arrive as a bundled MCP server named
  `web-tools`, registered once into the config this app already keeps under its own profile. An
  entry you have edited is left exactly as it is. `web_fetch` works as shipped: one http(s) page as
  readable text, with loopback, private and link-local addresses refused and long pages capped.
  `web_search` needs a provider — `searxng`, `brave` or `tavily` — set in `web-tools.json` under the
  app's user data directory; until then it reports that search is unconfigured rather than failing
  silently.

The automatic title ships inside the engine, and this Windows installer carries the rebuilt 2.2.9
engine. The macOS and Linux packages bundled below use the pinned 2.2.6 engine, so they get the
rename pencil now and the automatic title when that pin advances.

### Verify before you run
- `Oliviacode-Setup-2.2.9.exe` — 257,963,963 bytes —
  `98cdb31c3a7c523af4a16f5a422b350f4adc2c6260c5d2787f5deb838ddb1597`.
- `SHA256SUMS.txt` carries the SHA-256 for the Windows installer, `latest.yml` and the blockmap.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application
  binary with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 and 2.2.9
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the
  hash against this release before you do.

### Installing this one
- 2.2.8 installs can take this release through the built-in updater.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions
  from this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.9-x64.AppImage` then run it. The deb and rpm
  packages install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time; the version shipped is listed in the release assets.
