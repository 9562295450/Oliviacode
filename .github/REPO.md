# Repository copy

Paste these into the GitHub repository page. They are kept here so the description is reviewed
and versioned with the code instead of being typed once into a web form.

## About — short description

> A privacy-focused desktop AI client. Bring your own provider: nothing is preconfigured, no
> endpoint is bundled, and provider add-ons are community data you choose to load. Multi-lane
> egress, session isolation, MIT licensed.

That is 223 characters, inside GitHub's 350-character limit.

## About — website

```
https://github.com/9562295450/Oliviacode
```

## Topics

```
ai-client
desktop-app
electron
privacy
byok
bring-your-own-key
multi-provider
egress
tor
wireguard
typescript
solidjs
mit-license
```

## Social preview

Use `packages/desktop/resources/icons/icon.png` on a dark background, with the wordmark
`oliviacode` and the line `a generic AI client — bring your own provider`. Recommended size
1280×640. Upload at **Settings → General → Social preview**.

## First release body

```markdown
## Oliviacode 2.2.5

A privacy-focused desktop AI client. Nothing is preconfigured: no provider, no endpoint, no
credential. You connect an account, or you don't.

### Downloads
| Platform | File |
| --- | --- |
| Windows 10/11 x64 | `Oliviacode-Setup-2.2.5.exe` |
| macOS (arm64 / x64) | `Oliviacode-2.2.5.dmg` |
| Linux x64 | `Oliviacode-2.2.5.AppImage`, `.deb`, `.rpm` |

### Verify before you run
- SHA-256 for every artifact is in `SHA256SUMS.txt` below.
- VirusTotal report: <ADD REPORT URL>
- The Windows installer is unsigned. SmartScreen will ask you to confirm the publisher; check
  the hash against this release before you do.

### What's in it
- Generic client core. No provider domain is compiled into the app.
- Provider add-ons are community data: a shipped starter template you install with one click,
  your own installed entries, or a registry URL you paste into **Add-ons → Load community
  add-ons**. Nothing is fetched until you press Load, and nothing is applied until you press
  Use.
- Multi-lane egress: Direct, WARP, Tor, proxy, with health checks and rotation.
- Per-session workspace, model, and agent isolation.
- Branded Windows installer: license page, desktop shortcut, launch after install.

### Notes
- Oliviacode is not affiliated with OpenCode. See `NOTICE.md` and `PRESETS.md`.
- The engine is downloaded from npm at build time; the version shipped is listed in the
  release assets.
```

## Pinned issue / first-run note

> **Where do the providers come from?**
> Oliviacode ships none. Open the model chip in the composer → **Add-ons** → **Load community
> add-ons**, paste a registry URL, and pick an entry; or add your own provider id, base URL and
> token by hand. Applying an entry writes one field into `~/.config/opencode/opencode.json` and
> stores no credential.
