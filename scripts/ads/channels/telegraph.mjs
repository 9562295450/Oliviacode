/**
 * telegra.ph: a public page with no account and no email.
 *
 * The API creates an author token once and reuses it. Pages are public, cached by search
 * engines, and carry a real link back to the repository.
 */
import { repo, discord } from "../copy.mjs"

const api = "https://api.telegra.ph"

async function call(method, params) {
  const query = new URLSearchParams(params)
  const response = await fetch(`${api}/${method}?${query}`)
  const data = await response.json()
  if (!data.ok) throw new Error(`${method}: ${data.error}`)
  return data.result
}

const p = (text) => ({ tag: "p", children: [text] })
const link = (text, href) => ({ tag: "a", attrs: { href }, children: [text] })

export const telegraphTitle = "Oliviacode: a desktop AI client that runs on your own model key"

export const telegraphContent = [
  p(
    "Most AI coding clients assume the model connection is theirs. You sign in to their service, their key lives on their server, and the client is a window onto an account you do not control.",
  ),
  p(
    "Oliviacode is the other arrangement. You paste your own key, point it at any compatible endpoint, and the app ships no provider, no key and no default endpoint of its own.",
  ),
  { tag: "h3", children: ["What is in the box"] },
  {
    tag: "ul",
    children: [
      {
        tag: "li",
        children: [
          "A long-lived session process with a local sidecar. If the sidecar does not start, the launch rolls back instead of leaving a half-open window.",
        ],
      },
      {
        tag: "li",
        children: [
          "Three egress lanes: direct, a local SOCKS bridge, and Tor. The Tor lane allocates its ports per launch, binds the bridge on port 0, shuts down through the control socket, and retries once on a fresh data directory when the first bootstrap hits a lock.",
        ],
      },
      {
        tag: "li",
        children: [
          "An MCP server exposing web_search and web_fetch, with the backend URL and key supplied by the user.",
        ],
      },
      {
        tag: "li",
        children: ["Windows installer plus macOS and Linux builds from one release workflow, MIT licensed."],
      },
    ],
  },
  { tag: "h3", children: ["Why bother with BYOK"] },
  p(
    "The moment a client ships its own endpoint, your prompts go through someone else's account, the price is set by that someone, and the client's roadmap is really a roadmap for that endpoint. Separating them means the tool has to be honest about compatibility instead of assuming one vendor's quirks.",
  ),
  { tag: "h3", children: ["Where the bugs live"] },
  p(
    "Tor bootstrap timing under a slow network, and packaging across three platforms. Reports that name the lane, the OS and the log line are the useful ones.",
  ),
  { tag: "h3", children: ["Links"] },
  p(link(repo, repo)),
  p(link(discord, discord)),
]

export default async function telegraph(ctx) {
  const saved = await ctx.readState("telegraph.json")
  let account = saved

  if (!account?.accessToken) {
    const created = await call("createAccount", { short_name: "Oliviacode", author_name: "Oliviacode" })
    account = {
      platform: "telegra.ph",
      handle: created.author_name,
      accessToken: created.access_token,
      authUrl: created.auth_url,
      createdAt: new Date().toISOString(),
    }
    await ctx.writeState("telegraph.json", account)
  }

  if (account.postUrl && !ctx.args.force) {
    ctx.log(`telegraph: already published - ${account.postUrl}`)
    return account
  }

  const fields = {
    access_token: account.accessToken,
    title: telegraphTitle,
    author_name: "Oliviacode",
    content: JSON.stringify(telegraphContent),
    return_content: "false",
  }

  // telegra.ph keeps the same path when an account edits its own page, so a rerun updates
  // the live URL instead of publishing a second copy under a new path.
  const page = account.postPath
    ? await call("editPage", { ...fields, path: account.postPath })
    : await call("createPage", fields)

  const postUrl = `https://telegra.ph/${page.path}`
  account = {
    ...account,
    postUrl,
    postPath: page.path,
    postedAt: new Date().toISOString(),
    updatedAt: account.postPath ? new Date().toISOString() : undefined,
  }
  await ctx.writeState("telegraph.json", account)
  await ctx.saveAccount(account)
  ctx.log(`telegraph: published - ${postUrl}`)
  return account
}
