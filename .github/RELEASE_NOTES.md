## Oliviacode 2.2.18

**A session is named from the first thing you type — and the ones already sitting
there unnamed get named too.** Session rows were only titled once a model call came
back with a title, and the gate for that call could never fire again after a
restart: a row that reached the database with no title kept no title for the life
of the install. 2.2.17's list of "Untitled session" rows is that bug. This release
names those rows from the message you already sent, with no model call and no
tokens, and it makes a row read as its own work from the first keystroke.

A provider-agnostic, open-source desktop AI client. Nothing is preconfigured: no provider, no
endpoint in the code, no credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.18.exe` |
| macOS Apple Silicon (arm64) | `Oliviacode-2.2.18-arm64.dmg` |
| macOS Intel (x64) | `Oliviacode-2.2.18-x64.dmg` |
| Linux x64 | `Oliviacode-2.2.18-x64.AppImage`, `Oliviacode-2.2.18-x64.deb`, `Oliviacode-2.2.18-x64.rpm` |

macOS and Linux packages are built by the release workflow on native runners. They are unsigned;
see the platform notes below.

### What's new

**Why the untitled rows existed**
- **A new session was already named on its first prompt.** Since 2.2.9 the core writes a
  provisional title — the first line of your message, whitespace collapsed, clipped at 60
  characters — the moment the prompt is admitted, then replaces it when a model returns a
  better one.
- **`session_v2.title` was still null for older rows.** The model naming call is gated on
  `promoted > 0 && !parentID && isUntitled(session)`, and that gate only runs while a prompt is
  being admitted. A row written before 2.2.9, imported from another install, or created by a
  client that posted its own title has a null in the column and nothing in the app ever looked
  at it again. On the machine this was found on, 23 rows dated 25 October to 7 November were
  null and every one of them read "Untitled session".
- **The rows are now named from their own first message.** One pass at startup selects root
  sessions whose title is null or an old `New session - <timestamp>` fallback and names each
  from the first user message carrying at least 12 characters, looking no further than the
  first 10 messages. It is a database read and a rename — no model call, no network, no tokens —
  so it runs before the engine is even dialled.
- **A greeting cannot name a session, so the row gets its time.** A dozen rows reading `hi` is
  the same problem in a different costume. When no message in the window is long enough to
  identify the work, the title keeps the message and appends its timestamp —
  `hi · 2026-11-07 16:37` — so the rows stay apart without inventing content.
- **The pass runs once per process.** The session table is shared by every directory, so a
  second location's instance would only re-read rows the first pass had already named.

**The list reads as the work, not as a placeholder**
- **Rows carry the first message.** The tab store now persists the first user message as a
  clipped preview, so a row shows the work it holds from the first keystroke instead of waiting
  for the rename to arrive over the wire. The sidebar and the inspector both read the same
  label: a real title if there is one, else the preview, else the fallback.
- **A timestamped fallback is never shown to anyone.** `New session - 2026-07-30T18:45:03.662Z`
  is recognised and skipped in favour of the preview.

**Carried from 2.2.17**
- **The free allowance follows the exit address.** A free-usage refusal rotates again, bounded
  by the proof rule: two fresh exits refused inside the window and the engine stops buying
  more, says so, and points at a provider.
- **The egress fixes that made the app fail on other machines:** the limit watcher reads the
  log the desktop engine actually writes, a Direct lane rotation spends itself on the first
  lane the settings allow, launch restores and re-proves the lane instead of dialling the
  previous run's port, Direct no longer deletes a system or VPN proxy, WARP's proxy mode is
  recorded and handed back, a dead lane is proved twice and then falls back to the machine's
  own route, and Tor adopts a Tor that is already running.
- **Provider failures are summarised, never pasted.** Array-wrapped errors are unwrapped; a JSON
  body with no readable message becomes `Provider request failed with HTTP <status>`; prose
  bodies are capped at 2,000 characters.
- **Custom providers.** Settings → Providers → **+ Add Custom Provider**: name, base URL, API key
  and a model list with **Detect models**. The key is stored as a credential and never written
  into the config file.

**The gate still runs before anything is built**
- **`verify` on a clean runner:** typecheck, the egress suite (recovery, provider verdicts,
  provider resolution, trace parsing, log discovery) and `scripts/check-error-copy.ps1`.
- **Every platform boots its own packed app on a profile that has never run**, through
  `scripts/smoke-desktop.mjs`. A regression that only reproduces on a fresh install fails the run.
- **`SHA256SUMS.txt` is only rewritten when `verify` passed.**

### Verify before you run
- `Oliviacode-Setup-2.2.18.exe` — `CHECKSUM_PLACEHOLDER`.
- `SHA256SUMS.txt` carries the SHA-256 for every artifact on this release; it is rewritten from
  GitHub's own digests once the macOS and Linux jobs finish.
- The 2.2.7 installer was scanned at VirusTotal with **0/50 detections** and the application binary
  with **0/68**; those reports are on the
  [checksums page](https://9562295450.github.io/Oliviacode/checksums.html). The 2.2.8 through 2.2.18
  installers are pending their first scan.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the hash
  against this release before you do.

### Installing this one
- 2.2.8 and newer installs can take this release through the built-in updater.
- The first launch after updating performs the one-time naming pass over the sessions that never
  got a title. It is a local database read; nothing is sent anywhere.
- macOS builds are unsigned, so automatic updates are not enabled there; download new versions from
  this page until the app is signed and notarized.
- Linux AppImage installs can check `latest-linux.yml`; deb and rpm installs update through the
  package manager.

### Platform notes
- **macOS:** the app is not notarized. First launch: right-click the app, choose **Open**, then
  confirm. Drag it to Applications from the dmg.
- **Linux AppImage:** `chmod +x Oliviacode-2.2.18-x64.AppImage` then run it. The deb and rpm packages
  install the same app for your package manager.
- **Windows:** the installer is per-user and does not require an administrator.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is bundled at build time from the tagged commit; the version shipped is listed in the
  release assets.
- Community: <https://discord.gg/kDcRCu6ek>
