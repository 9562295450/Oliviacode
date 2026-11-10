/**
 * Read the signed-in state of a site from an open profile, without touching anything.
 *
 * Used to tell "the account exists and works" from "the account exists and is gated", which
 * local state cannot answer once the harness has stopped at a confirmation click.
 */
import { openTab } from "./lib/cdp.mjs"

const port = Number(process.argv[2] ?? 9336)
const url = process.argv[3] ?? "https://dev.to/dashboard"
const needle = process.argv[4] ?? "confirm"

const session = await openTab(port)
try {
  await session.goto(url)
  await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
  await new Promise((done) => setTimeout(done, 3500))
  const body = (await session.text()).replace(/\s+/g, " ").trim()
  console.log(`url: ${await session.url()}`)
  console.log(`text: ${body.slice(0, 600)}`)
  console.log(`contains "${needle}": ${new RegExp(needle, "i").test(body)}`)
  const hit = body.search(new RegExp(needle, "i"))
  if (hit > -1) console.log(`context: ${body.slice(Math.max(0, hit - 160), hit + 160)}`)
} finally {
  await session.close()
}
