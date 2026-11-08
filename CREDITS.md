# Credits

oliviacode is a community fork of [OpenCode](https://github.com/anomalyco/opencode)
by anomalyco, released under the same MIT license.

## Upstream

- [anomalyco/opencode](https://github.com/anomalyco/opencode) — the original AI coding agent
  that this fork is built from. All egress lane infrastructure (WARP, Tor, proxy rotation),
  the provider probe, and the status panel are extensions of OpenCode's architecture.

## Egress lane dependencies

- [Tor Project](https://torproject.org/) — Tor Expert Bundle, bundled and launched by the
  Tor lane for circuit rotation via `SIGNAL NEWNYM`.
- [Cloudflare WARP](https://www.cloudflare.com/products/warp/) — `warp-cli` registration
  rotation for the WARP lane, when the client is installed on the host.
- Public proxy lists (proxyscrape, proxmint, iplocate) — keyless, no-signup sources for
  the free proxy lane. These are scraped at runtime and are not bundled.

## Icons and UI

- The Olivia visual language and theme are original to this fork.
- UI components (`@opencode/ui/*`) are from the upstream OpenCode codebase, retained under
  the same MIT license.

## Trademarks

OpenCode and the OpenCode logo are trademarks of anomalyco. oliviacode is not affiliated
with, endorsed by, or sponsored by anomalyco. The OpenCode update endpoint is consulted
only to determine whether a newer CLI engine is available; the Olivia UI and desktop shell
are never replaced by it.
