## Oliviacode 2.2.6

A privacy-focused desktop AI client. Nothing is preconfigured: no provider, no endpoint, no
credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.6.exe` |

macOS and Linux artifacts are built from source by the release workflow when those runners are
enabled; this release ships the Windows installer.

### Verify before you run
- `SHA256SUMS.txt` carries the SHA-256 for the installer.
- VirusTotal: see `docs/security/virustotal.md`. The report is attached once the exact binary is
  scanned.
- The Windows installer is unsigned. SmartScreen asks you to confirm the publisher; check the
  hash against this release before you do.

### What's new
- **Context meter in the composer.** The bar above the prompt shows how much of the selected
  model's context window the session occupies, with `Compact` and `New session` beside it.
- **Background precompute is on by default.** The session summary is prepared as the context
  nears the threshold, so automatic compaction swaps in a ready answer instead of stopping the
  turn to write one.
- **Continue in new session.** `/continue` runs a compaction and then forks the full history into
  a fresh session, so long work carries on without the old turns' weight. Available as a slash
  command, the palette entry, and the composer's `New session` button.
- **In-app updates.** The app checks `9562295450/Oliviacode` releases shortly after launch and
  every four hours, announces a new version in the corner, downloads it on request, and restarts
  into the installer. The bundled CLI engine still updates through OpenCode on its own.

### Updating
- Builds from 2.2.6 onward update themselves from this repository's releases.
- **2.2.5 does not.** It was packaged before the release feed existed, so it cannot see updates:
  download this installer once, install it, and every later release arrives in the app.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is downloaded from npm at build time; the version shipped is listed in the release
  assets.
