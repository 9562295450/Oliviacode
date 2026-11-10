/**
 * Ask an instance to send the confirmation mail again.
 *
 * Signup mails get filed, throttled or dropped. Resending from the same browser profile the
 * signup used puts a current link in the mailbox without minting a second account, and it is
 * paced like a person filling a one-field form.
 */
import { openTab } from "./lib/cdp.mjs"

const instance = process.argv[2] ?? "mastodon.au"
const email = process.argv[3]
const port = Number(process.argv[4] ?? 9338)

if (!email) {
  console.error("usage: node scripts/ads/confirm-resend.mjs <instance> <email> [port]")
  process.exit(2)
}

const session = await openTab(port)
try {
  await session.goto(`https://${instance}/auth/confirmation/new`)
  await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
  await session.waitFor('document.querySelector(\'input[type="email"], input[name="user[email]"]\')', 25_000)

  const selector = (await session.eval(`Boolean(document.querySelector('input[name="user[email]"]'))`))
    ? 'input[name="user[email]"]'
    : 'input[type="email"]'

  await session.pause(1400, 2800)
  await session.typeHuman(selector, email)
  await session.pause(700, 1600)
  await session.click('button[type="submit"], input[type="submit"]')
  await session.pause(2500, 4500)
  await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)

  const body = (await session.text()).replace(/\s+/g, " ").trim()
  console.log(`url: ${await session.url()}`)
  console.log(`page: ${body.slice(0, 400)}`)
} finally {
  await session.close()
}
