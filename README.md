# Oliviacode

[![Oliviacode — a provider-agnostic desktop AI client](docs/og.png)](https://9562295450.github.io/Oliviacode/)

**A provider-agnostic desktop AI client.** An open-source AI client for developers: nothing
preconfigured, with multi-lane egress and isolated sessions built into the UI instead of bolted on.

[**Download**](https://github.com/9562295450/Oliviacode/releases/tag/v2.2.11) ·
[Windows](https://github.com/9562295450/Oliviacode/releases/download/v2.2.11/Oliviacode-Setup-2.2.11.exe) ·
[macOS arm64](https://github.com/9562295450/Oliviacode/releases/download/v2.2.11/Oliviacode-2.2.11-arm64.dmg) ·
[macOS x64](https://github.com/9562295450/Oliviacode/releases/download/v2.2.11/Oliviacode-2.2.11-x64.dmg) ·
[Linux AppImage](https://github.com/9562295450/Oliviacode/releases/download/v2.2.11/Oliviacode-2.2.11-x64.AppImage) ·
[deb](https://github.com/9562295450/Oliviacode/releases/download/v2.2.11/Oliviacode-2.2.11-x64.deb) ·
[rpm](https://github.com/9562295450/Oliviacode/releases/download/v2.2.11/Oliviacode-2.2.11-x64.rpm)

**Community:** [Discord](https://discord.gg/kDcRCu6ek) - release notes, Tor-lane questions, bug reports.
**Write-up:** [A desktop AI coding client with no provider baked in](https://dev.to/oliviacodeapp/a-desktop-ai-coding-client-with-no-provider-baked-in-1mpn) - DEV Community.

- **Multi-lane egress** — Direct, WARP, Tor and proxy lanes, each with health, latency and
  rotation. Rotate on demand, or arm a lane and let it rotate.
- **Session isolation** — every session keeps its own workspace, model selection and agent.
- **Provider-agnostic** — no endpoint in the source, no bundled key, no account. Apply a
  community template, add your own preset, or paste a registry URL.
- **One engine** — the shell drives the upstream CLI engine as a sidecar process, so tool
  execution, permissions and MCP servers behave the same as the CLI.
- **Three platforms, real packages** — NSIS installer, `.dmg` for Apple Silicon and Intel,
  `.AppImage` / `.deb` / `.rpm` for x64 Linux, built on native runners.
- **No telemetry endpoint** — the app contacts the endpoints you configured, the registry URL
  you loaded, and nothing else.

| | |
|---|---|
| Installer (2.2.7 scan) | [VirusTotal **0/50**](https://www.virustotal.com/gui/file/4fe3199ec3090b91454d2d3822b0b907bcb90f4ba106b4b983c6aa3631db0d6a) · SHA-256 `4fe3199e…` |
| App binary (2.2.7 scan) | [VirusTotal **0/68**](https://www.virustotal.com/gui/file/3dda8e6a3d82634e5f7c749238ca5701cd3cb7b60f9ee85e122295c55d93bb1d) · SHA-256 `3dda8e6a…` |
| License | MIT · [checksums and scans](https://9562295450.github.io/Oliviacode/checksums.html) |

![The Oliviacode session view, with the egress lanes and theme picker in the inspector](docs/screenshots/hero.png)

## Is this the official OpenCode app?

No. Oliviacode is an independent client, not affiliated with, endorsed by or operated by
OpenCode or its maintainers. The shell is an independent rewrite with its own identity, theme
engine and egress manager, and the engine still runs underneath as a sidecar. See
[NOTICE.md](./NOTICE.md) for upstream attribution and the list of changes.

## Requirements

- Windows 10/11, macOS 14+, or a glibc Linux distribution
- [Bun](https://bun.sh) 1.4.4+ to build from source
- Node 22+ if you want to run the packaging scripts directly

## Install

Grab the installer from [Releases](https://github.com/9562295450/Oliviacode/releases):

- **Windows** - `Oliviacode-Setup-<version>.exe`. Assisted installer: accept the license,
  press Install. A desktop shortcut and Start menu entry are created for the current user.
- **macOS / Linux** — `Oliviacode-<version>-arm64.dmg` and `-x64.dmg` for Apple Silicon and
  Intel, and `.AppImage`, `.deb` and `.rpm` for x64 Linux, attached to the same release. You can
  still build from source with the commands below.

The Windows build is unsigned. SmartScreen may ask you to confirm the publisher; the release
attaches `SHA256SUMS.txt` so you can check the file you downloaded instead of trusting the
filename. The 2.2.7 installer is scanned and clean (0/50), as is the application binary inside it
(0/68); both reports and hashes are in [docs/security/virustotal.md](./docs/security/virustotal.md).

## Run from source

```bash
bun install
bun run --cwd packages/desktop dev
```

The dev build downloads the engine binary into `packages/desktop/resources/` on first run.

## Build a release

```bash
# pin the engine version so the build is reproducible
OLIVIACODE_CLI_VERSION=2.2.6 bun run --cwd packages/desktop build

# Windows: unpacked app first, then the NSIS installer around it
bun run --cwd packages/desktop pack
OPENCODE_DESKTOP_APP="$PWD/dist/desktop/app" bun run --cwd packages/desktop pack
```

Artifacts land in `dist/desktop` at the repository root, next to `SHA256SUMS.txt`. The Windows
installer is assisted: licence page, one progress page, then Finish with **Run Oliviacode**
ticked. It creates a desktop shortcut and a Start menu entry for the current user, and
recreates the desktop shortcut on update if it was removed.

Packaging fails if the engine binary is missing or empty, if its recorded version file is empty,
or if a native module does not match the target architecture - all three are checked after
packing, not assumed. `.github/workflows/publish.yml` runs the same stages on clean Windows, Linux
and macOS runners and attaches each platform's package to the tag's release. The full checklist,
including the one-time token route, is in [docs/RELEASING.md](./docs/RELEASING.md).

## Connect a provider

Oliviacode is a generic client: nothing is connected on first run and no provider endpoint is
compiled into the app. Open the provider picker from the model chip in the composer. You can pick
a provider from the engine's catalogue and supply your own credential, or apply a community
template, which fills in a base URL for you.

![The model picker on a fresh profile: no provider, no results, nothing preselected](docs/screenshots/02-model-picker.png)

The shipped starter template includes one entry, **OpenCode Zen**, as a convenience for the
community. It is data, not a built-in feature and not an endorsement: the app never signs in for
you and never sends a credential you did not type. Apply the entry, then paste the key that
endpoint accepts — `public` for its free tier.

### Add-ons are community data, not a built-in feature

There are four places entries can come from, and none is compiled into the app:

1. **`presets.json`** — an optional local file beside the binary. It ships empty. Entries you
   add here are labelled Local, are read on every dialog open, and win on an id collision.
2. **`community-presets.json`** — a starter template that ships beside the binary. It is listed
   only inside the picker's **Community Templates** section and installs nothing until you press
   **Use**. Use copies the entry into your own cache, then applies it. Delete the file and the
   Template rows disappear.
3. **Your installed list** — `community-addons.json` in your user data directory. Entries you
   applied from the template or from a registry live here, labelled Community, and survive
   restarts.
4. **A community registry** — a JSON document at a URL you paste into
   **Add-ons → Load community add-ons**. Nothing is fetched until you press Load, the response
   is capped at 512 KB, and the validated result is cached in your user data directory so the
   list survives a restart. The URL field is optional and starts empty.

Applying an entry writes exactly one value — `provider.<id>.options.baseURL` — into
`<userData>/engine/config/opencode/opencode.json`. That config belongs to this app: the engine
runs with its XDG data, config, cache, and state directories redirected under `<userData>/engine`,
so a fresh profile is empty and the client never touches a separate OpenCode installation's
config or credentials. No credential is read, stored, or sent, no model list is invented, and
the app never signs in on your behalf or calls the endpoint for you.

[`community-presets.json`](./community-presets.json) is the starter template and the reference
registry document; [PRESETS.md](./PRESETS.md) documents the schema, the merge behaviour, and how
to run your own. Entries are a URL a community member contributed — not a partnership, not an
endorsement, and not a permission. If a service's terms do not allow this client, an entry does
not make it allowed. Whether to connect an account, and under what terms, is the account owner's
decision and responsibility.

## Egress

The egress panel shows every lane, the last rotation, and the latency and provider result for
each. Lanes are independent: a failing lane does not stop the others, and rotation is verified
against the provider endpoint before it is recorded. `autoRecover` is off by default, so a
rotation is never retried behind your back.

## Updates

Release builds from 2.2.6 on ship an update feed that points at **this repository's own
releases** and nothing else: `https://github.com/9562295450/Oliviacode/releases/latest/download`.
`electron-updater` reads it from `resources/app-update.yml`, checks five seconds after launch and
every four hours after that, and shows you the version before anything is fetched.
`autoDownload` is off, so a check never installs on its own; a version you download and defer
installs on the next quit.

Builds packaged without `OLIVIACODE_UPDATE_REPO` write no `app-update.yml` and stay silent: that
covers every release before 2.2.6, dev checkouts, and forks. The release workflow sets the
variable; to point a fork at its own releases:

```bash
OLIVIACODE_UPDATE_REPO=owner/repo bun run --cwd packages/desktop pack
```

No upstream release feed is ever consulted. Removing `app-update.yml` from an installed build
makes the updater report `unsupported` and stop checking.

### Engine updates

The desktop and the engine (`@opencode/cli`) are separate releases, so the app can keep the engine
current without shipping a new desktop build. Starting with 2.2.8, a production
build checks npm's `latest` dist-tag once per launch and may adopt a newer engine **only after it
proves itself**:

1. The platform tarball must match the `dist.integrity` sha512 the registry published for it.
2. The candidate boots against a throwaway data directory — never your sessions — and must report
   the exact version being adopted.
3. It must serve every operation the window calls: 25 of them, including `/api/session`,
   `/api/session/{id}/prompt`, `/message`, `/compact`, `/fork`, `/move`, `/context` and `/revert`.
   Additions are fine; a renamed or dropped route is a refusal.
4. It must complete a real create-then-delete session round trip on its own store.

A candidate that clears all four is staged for the next launch. That launch is the last test: the
adoption becomes permanent only once its sidecar connects. If it does not, the following launch
reverts to the bundled engine and remembers the rejection, so a broken engine is never retried.

Only a forward move inside the same major is considered; prereleases and major jumps are ignored,
and a `0.x` engine is limited to patch moves. `OLIVIACODE_ENGINE_UPDATE=off` disables the check
entirely. The same contract is verified at build time against the pinned engine
(`bun run script/engine-contract.ts`, wired into `bun run build`), so a release cannot ship a
bundled engine that already lost a route the window needs.

## Privacy

Oliviacode runs locally. It contacts the provider endpoints you configure, and the registry URL
you explicitly load, and nothing else. Requests go wherever your provider's base URL points —
including through the egress lane you select. Credentials are stored by the engine on your
machine, not uploaded to any Oliviacode-operated service. There is no Oliviacode telemetry
endpoint.

## Security

[![VirusTotal report](./docs/security/virustotal-badge.svg)](https://www.virustotal.com/gui/file/4fe3199ec3090b91454d2d3822b0b907bcb90f4ba106b4b983c6aa3631db0d6a)

- Every release publishes `SHA256SUMS.txt`; check a download with
  `Get-FileHash .\Oliviacode-Setup-*.exe -Algorithm SHA256` (PowerShell) or
  `sha256sum Oliviacode-*.AppImage`.
- The 2.2.7 installer was scanned on VirusTotal with 0/50 detections, and the application binary
  inside it with 0/68. Both reports and hashes are in
  [docs/security/virustotal.md](./docs/security/virustotal.md).
- The engine binary is fetched from the npm registry at build time and its version is pinned
  with `OLIVIACODE_CLI_VERSION`.

## Disclaimer

Oliviacode is an open-source network client. It is not affiliated with OpenCode. The default
presets are community-provided and users are responsible for complying with the Terms of Service
of any API they connect to.

Oliviacode is not affiliated with, endorsed by, sponsored by, or operated by OpenCode, its
maintainers, or any provider named in a preset or community registry. It ships no credentials,
no account, and no endpoint in its source. Everything the app talks to is something a user
configured. Provider entries are community data files (`presets.json` locally,
`community-presets.json` when hosted), not a built-in feature and not a bypass of any service's
terms; see [PRESETS.md](./PRESETS.md). Responsibility for what an account is used for, and
whether a given client is permitted, rests with that account's owner.

## License

MIT. See [LICENSE](./LICENSE). This distribution is derived from the OpenCode desktop
application; see [NOTICE.md](./NOTICE.md) for the list of changes and upstream attribution.
