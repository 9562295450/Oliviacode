# Oliviacode

> **Disclaimer**
>
> Oliviacode is an open-source network client. It is not affiliated with OpenCode. The default
> presets are community-provided and users are responsible for complying with the Terms of
> Service of any API they connect to.
>
> Oliviacode is not affiliated with, endorsed by, sponsored by, or operated by OpenCode, its
> maintainers, or any provider named in a preset or community registry. It ships no credentials,
> no account, no endpoint and no default provider. Everything the app talks to is something a
> user configured. Provider entries are community data files (`presets.json` locally,
> `community-presets.json` when hosted), not a built-in feature and not a bypass of any
> service's terms; see [PRESETS.md](./PRESETS.md). Responsibility for what an account is used
> for, and whether a given client is permitted, rests with that account's owner.

A desktop AI client for developers, with multi-lane egress and session isolation built into
the UI rather than bolted on.

Oliviacode is a full redesign of the OpenCode desktop application — own identity, own shell,
own theme engine, own egress manager. It is provider-agnostic: you bring a provider and a
credential, or you don't, and the app sits there with nothing selected until you do.

- **Nothing is preconfigured.** A fresh install has no provider connected and no model
  selected. There is no default account, no default endpoint, and no bundled key.
- **Community add-ons, not built-ins.** Provider endpoints are data. The app lists a shipped
  starter template, your own installed entries, and any registry URL you paste in, and stores
  no provider endpoint in its own source. Nothing is applied until you press Use.
- **Multi-lane egress.** Direct, WARP, Tor and proxy lanes, each with health checks,
  latency tracking, and rotation. Rotate on demand, or arm a lane and let it rotate.
- **Session isolation.** Each session keeps its own workspace, model selection, and agent.
- **One engine.** The app drives the upstream CLI engine as a sidecar process, so tool
  execution, permissions and MCP servers behave the same as the CLI.

## Requirements

- Windows 10/11, macOS 14+, or a glibc Linux distribution
- [Bun](https://bun.sh) 1.4.4+ to build from source
- Node 22+ if you want to run the packaging scripts directly

## Install

Grab the installer from [Releases](https://github.com/9562295450/Oliviacode/releases):

- **Windows** - `Oliviacode-Setup-<version>.exe`. Assisted installer: accept the license,
  press Install. A desktop shortcut and Start menu entry are created for the current user.
- **macOS / Linux** - build from source with the commands below. Prebuilt artifacts are added
  when those runners are enabled in the release workflow.

The Windows build is unsigned. SmartScreen may ask you to confirm the publisher; the release
attaches `SHA256SUMS.txt` so you can check the file you downloaded instead of trusting the
filename. The VirusTotal report for each artifact is linked from
[docs/security/virustotal.md](./docs/security/virustotal.md) once that exact binary has been
scanned.

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
packing, not assumed. `.github/workflows/publish-windows.yml` runs the same two stages on a
clean `windows-latest` runner and attaches the installer to the tag's release. The full
checklist, including the one-time token route, is in [docs/RELEASING.md](./docs/RELEASING.md).

## Connect a provider

Oliviacode is a generic client: it has no provider of its own and no endpoint it prefers.
Open the provider picker from the model chip in the composer and either pick a provider from
the engine's catalogue and supply your own credential, or load an add-on that fills in a base
URL for you.

### Add-ons are community data, not a built-in feature

There are four places entries can come from, and none is compiled into the app:

1. **`presets.json`** — an optional local file beside the binary. It ships empty. Entries you
   add here are labelled Local, are read on every dialog open, and win on an id collision.
2. **`community-presets.json`** — a starter template that ships beside the binary. It is listed
   only inside **Add-ons** and installs nothing until you press **Use**. Use copies the entry
   into your own cache, then applies it. Delete the file and the Template rows disappear.
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

Oliviacode ships **no update feed**. `electron-updater` is present but inert: packaging writes
no `app-update.yml`, so the updater has nothing to check and stays quiet. To point auto-update
at this project's own releases, set it explicitly:

```bash
OLIVIACODE_UPDATE_REPO=9562295450/Oliviacode bun run --cwd packages/desktop pack
```

That writes a feed pointing at
`https://github.com/9562295450/Oliviacode/releases/latest/download`. Nothing else is read, and
no upstream release feed is ever consulted.

## Privacy

Oliviacode runs locally. It contacts the provider endpoints you configure, and the registry URL
you explicitly load, and nothing else. Requests go wherever your provider's base URL points —
including through the egress lane you select. Credentials are stored by the engine on your
machine, not uploaded to any Oliviacode-operated service. There is no Oliviacode telemetry
endpoint.

## Security

[![VirusTotal report](./docs/security/virustotal-badge.svg)](https://www.virustotal.com/gui/home/upload)

- Every release publishes `SHA256SUMS.txt`; check a download with
  `Get-FileHash .\Oliviacode-Setup-*.exe -Algorithm SHA256` (PowerShell) or
  `sha256sum Oliviacode-*.AppImage`.
- VirusTotal reports are linked from the release and from
  [docs/security/virustotal.md](./docs/security/virustotal.md). The badge above is updated
  with the report URL and detection count when a release is scanned; until then it says so.
- The engine binary is fetched from the npm registry at build time and its version is pinned
  with `OLIVIACODE_CLI_VERSION`.

## License

MIT. See [LICENSE](./LICENSE). This distribution is derived from the OpenCode desktop
application; see [NOTICE.md](./NOTICE.md) for the list of changes and upstream attribution.
