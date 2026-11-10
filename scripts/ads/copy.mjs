/**
 * What goes out, per channel.
 *
 * The claim set is fixed: BYOK desktop client, no bundled provider, no hardcoded endpoint,
 * multi-lane egress including Tor, MIT, three platforms. Nothing here promises anything the
 * repository cannot back up, because the first person who clicks through checks.
 */
export const repo = "https://github.com/9562295450/Oliviacode"

export const discord = "https://discord.gg/kDcRCu6ek"

export const oneLiner =
  "Oliviacode: a desktop AI coding client that runs on your own model key. No bundled provider, no hardcoded endpoint, no account with us."

export const bsky = `${oneLiner} Tor lane, MIT licence, Windows/macOS/Linux. ${repo} Discord: ${discord}`

export const mastodon = `${oneLiner}

Three egress lanes, one of them Tor. MIT licensed. Built as a shell so the provider stays yours.

Repo: ${repo}
Discord: ${discord}`

export const hnTitle = "Show HN: Oliviacode – a BYOK desktop AI client with a Tor egress lane"

export const hnTitlePlain = "Oliviacode: a BYOK desktop AI client with a Tor egress lane"

export const hnText = `I build this in the open. It is a desktop client for AI coding sessions where the model connection belongs to you: you paste your own key, you point it at whatever endpoint you want, and the app never ships a provider or a key of its own.

The parts that took the longest:

- Egress. There are three lanes - direct, a SOCKS bridge, and Tor. The Tor lane allocates its own SOCKS and control ports per launch, binds the HTTP bridge on port 0, shuts down through the control socket, and retries once on a fresh data directory if the first bootstrap hits a lock. Failures are reported by cause instead of "tor exited during bootstrap", which was the old message and was useless.

- The runtime. A long-lived session process with a sidecar the window talks to over a local socket. If the sidecar does not come up, the launch rolls back rather than leaving a half-open window.

- Local tooling. There is an MCP server in the box that exposes web_search and web_fetch, with the backend URL and key supplied by the user, never bundled.

MIT licensed, Windows installer plus macOS and Linux builds on the releases page. Feedback on the Tor lane and the packaging is the useful part - those are the two places where the bugs live. The Discord is where the release notes go and where I answer questions about the Tor lane: ${discord}`

export const devtoTitle = "A desktop AI coding client with no provider baked in"

export const devtoBody = `Most AI coding tools assume the model connection is theirs. You sign in to their service, their key is on their server, and the client is a window onto an account you do not control. I wanted the opposite arrangement: a client where the model connection belongs to the person running it.

Oliviacode is that client. You paste your own key, point it at any compatible endpoint, and the app ships no provider, no key, and no endpoint of its own. If you stop paying your provider, you change the endpoint. The app does not care.

## What is actually in the box

**A long-lived session process with a sidecar.** The window talks to a local sidecar over a socket rather than embedding the runtime. If the sidecar does not come up, the launch rolls back instead of leaving a half-open window on screen. That rollback is boring to write and very obvious when it is missing.

**Three egress lanes.** Direct, a local SOCKS bridge, and Tor. The Tor lane allocates its SOCKS and control ports per launch instead of assuming the defaults, so two copies of the app do not fight over the same socket. It binds the HTTP bridge on port 0 - the kernel picks a free port - and reports back what it actually got. Shutdown goes through the control socket rather than killing a process and hoping.

The first version reported \`tor exited during bootstrap\` for every failure, which is useless: a lock on the data directory, a port already taken, and a genuinely broken binary all looked identical. The current one retries once on a fresh data directory when the failure is a lock or a bind, and maps the remaining causes to something a person can act on.

**Local web tools.** There is an MCP server in the app that exposes \`web_search\` and \`web_fetch\`. The search backend URL and key are user-supplied, same as the model. Nothing is proxied through a service I run, because I do not run one.

## Why BYOK is the interesting part

The moment a client ships its own endpoint, three things follow: your prompts go through someone else's account, the price is set by that someone, and the client's roadmap is really a roadmap for that endpoint. BYOK separates those. It also means the client has to be honest about compatibility - the moment the model is a variable, the tool has to work with the variable instead of assuming one vendor's quirks.

Practically that means the provider layer is a shell: a base URL, a key, a model name, and a wire format. No default endpoint compiled in. If the repository ever grew a hardcoded URL, the whole premise would be dead, so it is the one thing worth guarding in review.

## Packaging

Windows gets an NSIS installer. macOS and Linux builds come out of the same release workflow. The installer carries the runtime binary and a version file, and the release pipeline checks that the version inside the payload matches the tag - a mismatch is the kind of bug that ships quietly and confuses everyone for a week.

The licence is MIT. If you want to fork it and put your own provider in, that is the point.

## What I would like feedback on

Two areas where the bugs live:

1. **The Tor lane.** Bootstrap timing, data directory reuse, and shutdown behaviour under a slow network. If you have run Tor inside a desktop app and have opinions about lifecycle, I want them.
2. **Packaging.** Windows installer edge cases, macOS notarisation, and the Linux AppImage/deb split.

Repository: ${repo}

Discord for release notes and Tor-lane questions: ${discord}

If you try it, the useful report is the one that says which lane, which OS, and what the log said - not just "it did not work".`

export const byChannel = { bsky, mastodon, hnTitle, hnText, devtoTitle, devtoBody, discord }
