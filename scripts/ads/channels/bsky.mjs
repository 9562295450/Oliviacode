/**
 * Bluesky: account creation and posting over the ATProto HTTP API.
 *
 * No browser, no UI, no automation tells - the PDS is a REST service and a normal client
 * speaks to it directly. The email has to be confirmable, so a disposable inbox is minted
 * first and kept for verification links.
 */
import { bsky as copy, repo } from "../copy.mjs"

const service = "https://bsky.social"

async function xrpc(method, body, token, { url = service } = {}) {
  const headers = { "content-type": "application/json" }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${url}/xrpc/${method}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const reason = data?.error ?? data?.message ?? text.slice(0, 300)
    throw new Error(`${method} ${response.status} ${reason}`)
  }
  return data
}

/** Byte offsets, not character offsets: the facet index is UTF-8. */
function linkFacets(text, links) {
  const encoder = new TextEncoder()
  const facets = []
  for (const link of links) {
    const at = text.indexOf(link)
    if (at < 0) continue
    const byteStart = encoder.encode(text.slice(0, at)).length
    const byteEnd = byteStart + encoder.encode(link).length
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: link }],
    })
  }
  return facets
}

async function resolveHandle(handle) {
  try {
    const data = await xrpc(`com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`)
    return data?.did ?? null
  } catch {
    return null
  }
}

export default async function bluesky(ctx) {
  const saved = await ctx.readState("bsky.json")
  let account = saved

  if (account?.accessJwt) {
    try {
      const session = await xrpc("com.atproto.server.getSession", undefined, account.accessJwt)
      ctx.log(`bsky: session alive as ${session.handle}`)
      account = { ...account, handle: session.handle, did: session.did }
    } catch {
      ctx.log("bsky: stored token expired, minting a new session")
      const session = await xrpc("com.atproto.server.createSession", {
        identifier: account.handle,
        password: account.password,
      })
      account = { ...account, ...session }
    }
  } else {
    const password = ctx.randomPassword(20)
    const base = ctx.args.handle ?? "oliviacode"
    const candidates = [base, `${base}1`, `${base}ai`, `${base}hq`, `${base}dev`]

    let created = null
    const failures = []
    for (const name of candidates) {
      const handle = `${name}.bsky.social`
      const taken = await resolveHandle(handle)
      if (taken) {
        failures.push(`${handle}: already resolves to ${taken}`)
        continue
      }

      const inbox = await ctx.createInbox(ctx.args["mail-provider"] ? [ctx.args["mail-provider"]] : undefined)
      ctx.log(`bsky: mailbox ${inbox.address} (${inbox.provider})`)

      try {
        const session = await xrpc("com.atproto.server.createAccount", {
          handle,
          email: inbox.address,
          password,
          birthDate: "1990-01-01T00:00:00.000Z",
        })
        created = {
          handle: session.handle ?? handle,
          did: session.did,
          ...session,
          email: inbox.address,
          mailbox: inbox.provider,
          emailPassword: inbox.password,
        }
        break
      } catch (error) {
        failures.push(`${handle}: ${error.message}`)
        ctx.log(`bsky: ${handle} refused - ${error.message}`)
      }
    }

    if (!created) throw new Error(`no handle accepted\n${failures.join("\n")}`)

    account = {
      platform: "bluesky",
      handle: created.handle,
      did: created.did,
      password,
      email: created.email,
      mailbox: created.mailbox,
      emailPassword: created.emailPassword,
      accessJwt: created.accessJwt,
      refreshJwt: created.refreshJwt,
      profileUrl: `https://bsky.app/profile/${created.handle}`,
      createdAt: new Date().toISOString(),
    }
    await ctx.writeState("bsky.json", account)
    await ctx.saveAccount(account)
    ctx.log(`bsky: account ready - ${account.handle}`)
  }

  if (account.postUrl && !ctx.args.force) {
    ctx.log(`bsky: already posted - ${account.postUrl}`)
    return account
  }

  const record = {
    $type: "app.bsky.feed.post",
    text: copy,
    createdAt: new Date().toISOString(),
    langs: ["en"],
  }
  const facets = linkFacets(copy, [repo])
  if (facets.length) record.facets = facets

  const result = await xrpc(
    "com.atproto.repo.createRecord",
    { repo: account.did, collection: "app.bsky.feed.post", record },
    account.accessJwt,
  )

  const rkey = result.uri.split("/").pop()
  const postUrl = `https://bsky.app/profile/${account.handle}/post/${rkey}`
  account = { ...account, postUrl, postUri: result.uri, postedAt: new Date().toISOString() }
  await ctx.writeState("bsky.json", account)
  await ctx.saveAccount(account)
  ctx.log(`bsky: posted - ${postUrl}`)
  return account
}
