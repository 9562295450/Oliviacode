# oliviacode

A desktop AI client for developers, with multi-lane egress and session isolation built into
the UI rather than bolted on.

oliviacode is a full redesign of the OpenCode desktop application — own identity, own shell,
own theme engine, own egress manager. It is provider-agnostic: you bring a provider and a
credential, or you don't, and the app sits there with nothing selected until you do.

- **Nothing is preconfigured.** A fresh install has no provider connected and no model
  selected. There is no default account, no default endpoint, and no bundled key.
- **Multi-lane egress.** Direct, WARP, Tor and proxy lanes, each with health checks,
  latency tracking, and rotation. Rotate on demand, or arm a lane and let it rotate.
- **Session isolation.** Each session keeps its own workspace, model selection, and agent.
- **One engine.** The app drives the upstream CLI engine as a sidecar process, so tool
  execution, permissions and MCP servers behave the same as the CLI.

## Requirements

- Windows 10/11, macOS 14+, or a glibc Linux distribution
- [Bun](https://bun.sh) 1.4.4+ to build from source
- Node 22+ if you want to run the packaging scripts directly

## Run from source

```bash
bun install
bun run --cwd packages/desktop dev
```

The dev build downloads the engine binary into `packages/desktop/resources/` on first run.

## Build a release

```bash
# pin the engine version so the build is reproducible
OLIVIACODE_CLI_VERSION=2.2.5 bun run --cwd packages/desktop build

# package the installer for the current platform
bun run --cwd packages/desktop pack
```

Artifacts land in `packages/desktop/dist`. Packaging fails if the engine binary is missing or
empty, if its recorded version file is empty, or if a native module does not match the target
architecture — all three are checked after packing, not assumed.

## Connect a provider

Open **Settings → Providers**. Nothing is connected by default. You can:

1. Pick a provider from the catalog and supply your own credential, or
2. Click **⚡ Load preset** to write a provider block from `presets.json` into
   `~/.config/opencode/opencode.json`, then paste your own token.

The preset only fills in a base URL and model list. It never contains a credential and never
authenticates on your behalf. `presets.json` ships empty of secrets by design; add your own
entries or delete the file.

## Egress

The egress panel shows every lane, the last rotation, and the latency and provider result for
each. Lanes are independent: a failing lane does not stop the others, and rotation is verified
against the provider endpoint before it is recorded. `autoRecover` is off by default, so a
rotation is never retried behind your back.

## Updates

oliviacode ships **no update feed**. `electron-updater` is present but inert: packaging writes
no `app-update.yml`, so the updater has nothing to check and stays quiet. To point auto-update
at this project's own releases, set it explicitly:

```bash
OLIVIACODE_UPDATE_REPO=Oliviacode/Oliviacode bun run --cwd packages/desktop pack
```

That writes a feed pointing at
`https://github.com/Oliviacode/Oliviacode/releases/latest/download`. Nothing else is read, and
no upstream release feed is ever consulted.

## Privacy

oliviacode runs locally. It contacts the provider endpoints you configure, and nothing else.
Requests go wherever your provider's base URL points — including through the egress lane you
select. Credentials are stored by the engine on your machine, not uploaded to any
oliviacode-operated service. There is no oliviacode telemetry endpoint.

## License

MIT. See [LICENSE](./LICENSE). This distribution is derived from the OpenCode desktop
application; see [NOTICE.md](./NOTICE.md) for the list of changes and upstream attribution.
