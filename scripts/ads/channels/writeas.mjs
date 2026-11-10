/**
 * write.as: anonymous public post, no account, no email.
 *
 * The API takes a body and returns a slug. Anonymous posts are not listed on the site's
 * front page but they are public, permanent and indexable, which is what a link is for.
 */
import { devtoBody } from "../copy.mjs"

export default async function writeas(ctx) {
  const saved = await ctx.readState("writeas.json")
  if (saved?.postUrl && !ctx.args.force) {
    ctx.log(`write.as: already published - ${saved.postUrl}`)
    return saved
  }

  const response = await fetch("https://write.as/api/posts", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Oliviacode/2.2.10" },
    body: JSON.stringify({
      title: "Oliviacode: a desktop AI client that runs on your own model key",
      body: devtoBody,
      appearance: "norm",
      language: "en",
    }),
  })

  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  if (!response.ok || !data?.data) throw new Error(`write.as ${response.status}: ${text.slice(0, 300)}`)

  const id = data.data.id
  const postUrl = `https://write.as/${id}`
  const account = {
    platform: "write.as",
    handle: "anonymous",
    postUrl,
    id,
    editToken: data.data.token ?? null,
    createdAt: new Date().toISOString(),
  }
  await ctx.writeState("writeas.json", account)
  await ctx.saveAccount(account)
  ctx.log(`write.as: published - ${postUrl}`)
  return account
}
