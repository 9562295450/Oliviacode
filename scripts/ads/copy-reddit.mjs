/**
 * Reddit copy, one entry per community, shaped by that community's own rules.
 *
 * The rule titles decide the format, not the message: r/AI_Agents puts links in comments,
 * r/selfhosted only accepts new projects in its megathread, r/foss wants the licence up front.
 * Every entry discloses that the author built it, because the ones that do not are the ones that
 * get removed and take the domain with them.
 */
export const repo = "https://github.com/9562295450/Oliviacode"
export const writeup = "https://dev.to/oliviacodeapp/a-desktop-ai-coding-client-with-no-provider-baked-in-1mpn"
export const discord = "https://discord.gg/kDcRCu6ek"
export const site = "https://9562295450.github.io/Oliviacode/"

const disclosure = "Disclosure: I build this. It is MIT, there is no paid tier, and there is nothing to sign up for."

const facts = `What it is: a desktop client for AI coding sessions where the model connection belongs to
the person running it. You paste a base URL, a key and a model name; the app ships none of those.
No default endpoint compiled in, no account with the project, no telemetry.`

const egress = `Egress is per session and selectable: Direct, Cloudflare WARP, Tor or your own proxy. Sessions
are isolated on disk in SQLite, so a project in one lane does not share state with another.
Windows installer, macOS dmg, Linux AppImage/deb/rpm, all from the same release workflow.`

export const reddit = {
  LocalLLaMA: {
    weight: 1,
    title: "A desktop client where the model connection stays yours, with a Tor egress lane per session",
    body: `Most of the interest here is in which model runs and how well it runs. This is the layer
underneath that, and it is the part I kept rebuilding badly enough to want a real one.

${facts}

${egress}

Why it might matter to this sub specifically: the provider layer is a shell — base URL, key, model
name, wire format — so anything OpenAI-compatible works, including a llama.cpp or vLLM endpoint on
your own box. Nothing in the repo names a default host, and that is the one property I guard in
review, because a single hardcoded URL would make the whole premise a lie.

The parts I would like torn apart: Tor bootstrap lifecycle in a desktop app (data directory reuse,
shutdown under a slow network), and packaging across three platforms.

Write-up with the reasoning and the failure modes: ${writeup}
Source: ${repo}
Discord if you want to argue about the Tor lane: ${discord}

${disclosure}`,
  },

  SideProject: {
    weight: 1,
    title: "I built a desktop AI coding client that ships with no provider, no key and no endpoint",
    body: `Every AI client I tried assumed the connection was theirs: sign in to their service, their key
sits on their server, the app is a window onto an account I do not control. I wanted the opposite
arrangement, so I built it.

${facts}

${egress}

It is at 2.2.10 with installers for all three platforms. The honest state of it: the egress lanes
and session isolation are solid, the Tor lane is the one that still bites under bad networks, and
the macOS build is notarised but not battle-tested by strangers yet.

Write-up: ${writeup}
Repo: ${repo}
Discord: ${discord}

${disclosure} Feedback on anything broken is more useful to me than stars.`,
  },

  foss: {
    weight: 1,
    title: "Oliviacode: MIT desktop AI client, no bundled provider, Tor egress lane",
    body: `Licence first, since that is the rule here: MIT, source at ${repo}, no CLA, no open-core tier,
no telemetry, no account with the project.

${facts}

${egress}

It runs a bundled open-source agent engine and supplies the window, the session store and the egress
layer around it. Forking it and putting your own provider in is the intended use.

Write-up: ${writeup}
Discord: ${discord}

${disclosure}`,
  },

  opensource: {
    weight: 2,
    title: "Oliviacode – MIT desktop AI client with a provider layer you configure and a Tor egress lane",
    body: `I have been building this in the open for a while and it is finally at a state worth other
people's eyes.

${facts}

${egress}

The design constraint that shaped everything: no provider is privileged. Presets are community data
files, not built-in features, and the app refuses to ship a default endpoint because that is how a
"bring your own key" client quietly becomes a reseller.

Write-up: ${writeup}
Source and releases: ${repo}
Discord: ${discord}

${disclosure}`,
  },

  LLMDevs: {
    weight: 2,
    title: "Provider layer as a shell: what changes when the client ships no endpoint",
    body: `A design note rather than a launch, because the interesting part is structural.

The usual client hardcodes a provider, and everything downstream assumes it: retries, streaming
framing, tool-call shape, error mapping, even the settings screen. Oliviacode goes the other way —
base URL, key, model name and wire format are user data, and the app ships none of them. Two things
that turned out to matter more than expected:

1. Error mapping. "Stream ended" is useless. Cause-specific errors (auth, rate limit, context
   overflow, transport) have to be derived from the provider's own response, not from the HTTP
   status alone, or every user report is unactionable.
2. Encrypted egress interacts with streaming. A Tor circuit that dies mid-stream must surface as a
   transport error the session can retry, not as a hung generation.

${egress}

Source: ${repo}
Write-up with the Tor bootstrap failure mapping: ${writeup}
Discord: ${discord}

${disclosure} No commercial angle — MIT, and I am not selling anything here.`,
  },

  AI_Agents: {
    weight: 2,
    title: "Per-session egress for agent runs: Direct, WARP, Tor or proxy, isolated on disk",
    body: `Most agent tooling runs every task through one network path and one session store. That is fine
until one run needs a different exit than the last, or until you want two projects that cannot see
each other's state.

Oliviacode is a desktop client built around that split: each session picks its egress lane (Direct,
Cloudflare WARP, Tor, or your own proxy) and keeps its own SQLite state, with fork/move/compact from
the UI. The provider connection is user-supplied — base URL, key, model name — and the app ships no
default endpoint, no bundled provider and no account.

MIT, Windows/macOS/Linux. Links in the first comment, per the rules.

${disclosure}`,
    firstComment: `Repo: ${repo}
Write-up on the egress and provider layers: ${writeup}
Discord: ${discord}`,
  },

  selfhosted: {
    weight: 3,
    megathread: true,
    title: "Oliviacode – self-hosted-friendly desktop AI client, BYO endpoint (llama.cpp/vLLM/Ollama compatible)",
    body: `Posting this in the new-project megathread rather than the main feed, per rule 6.

A desktop AI coding client that expects you to point it at your own inference: any OpenAI-compatible
base URL works, including a llama.cpp server, vLLM or an Ollama endpoint behind a reverse proxy. It
ships no provider, no key and no default host, and no telemetry.

${egress}

MIT, three platforms, no account with the project. ${repo} — write-up: ${writeup} — Discord: ${discord}

${disclosure}`,
  },
}

/**
 * Communities that were checked and rejected, with the reason, so the next run does not retry them
 * blind.
 */
export const skipped = {
  linux: "rule 6 bans self-promotion; and a client for proprietary model APIs is off-topic by rule 5",
  ChatGPTCoding: "rule 5 bans pure self-promotion and low-value project posts; needs account history first",
  programming: "self-promotion ban; the post would be removed on sight",
  InternetIsBeautiful: "websites only, not desktop software",
  coolgithubprojects:
    "rejects text posts: 'This community requires you to add an image, link, or AMA', and the submit page " +
    "ignores ?type=LINK (the hidden input stays TEXT), so a link post cannot be composed here",
}

export const order = ["LocalLLaMA", "SideProject", "foss", "opensource", "LLMDevs", "AI_Agents", "selfhosted"]
