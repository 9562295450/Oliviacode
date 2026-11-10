/**
 * Mastodon: sign up through the web form, confirm through a disposable inbox, post.
 *
 * The API signup endpoint is closed to unauthenticated callers on current releases - it answers
 * 401 "The access token is invalid" no matter how correct the payload is - so this drives the
 * same form a person uses, in ghost, and then publishes from the compose page.
 */
import { mastodon as copy } from "../copy.mjs"
import { links as messageLinks, waitForMail, resumeMailtm } from "../lib/mail.mjs"

const defaultInstance = "mstdn.party"

async function fillSignup(session, { username, email, password }) {
  await session.waitFor(
    `document.querySelector('input[name="user[email]"]') || [...document.querySelectorAll('button')].some((el) => /^accept$/i.test((el.innerText || '').trim()))`,
    25_000,
  )

  // Current releases open with a rules step; older ones go straight to the form.
  const hasAccept = await session.eval(
    `Boolean([...document.querySelectorAll('button')].find((el) => /^accept$/i.test((el.innerText || '').trim())))`,
  )
  if (hasAccept) {
    await session.clickByText("button", "Accept")
    await new Promise((done) => setTimeout(done, 2000))
  }

  await session.waitFor("document.querySelector('input[name=\"user[email]\"]')", 30_000)
  const usernameField = (await session.eval(
    `Boolean(document.querySelector('input[name="user[account_attributes][username]"]'))`,
  ))
    ? 'input[name="user[account_attributes][username]"]'
    : 'input[name="user[username]"]'

  await session.type(usernameField, username)
  await session.type('input[name="user[email]"]', email)
  await session.type('input[name="user[password]"]', password)
  const confirmField = 'input[name="user[password_confirmation]"]'
  if (await session.eval(`Boolean(document.querySelector('${confirmField}'))`)) {
    await session.type(confirmField, password)
  }

  for (const [part, value] of [
    ["1i", "1990"],
    ["2i", "01"],
    ["3i", "01"],
  ]) {
    const selector = `input[name="user[date_of_birth(${part})]"]`
    if (await session.eval(`Boolean(document.querySelector('${selector}'))`)) await session.type(selector, value)
  }

  await session.eval(`(() => {
    const box = document.querySelector('input[name="user[agreement]"]')
    if (box && !box.checked) box.click()
    return box ? box.checked : false
  })()`)
}

export default async function mastodon(ctx) {
  const instance = ctx.args.instance ?? defaultInstance
  const base = `https://${instance}`
  const port = Number(ctx.args.port ?? 9337)
  const profile = ctx.args.profile ?? `mastodon-${instance.split(".")[0]}`
  const saved = await ctx.readState(`mastodon-${instance.split(".")[0]}.json`)
  let account = saved

  const session = await ctx.openPage({ port, name: profile })

  try {
    await session.goto(`${base}/explore`)
    await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
    let signedIn = await session.eval(`Boolean(document.querySelector('a[href="/publish"]'))`)

    if (!signedIn) {
      const inbox = await ctx.createInbox(ctx.args["mail-provider"] ? [ctx.args["mail-provider"]] : undefined)
      ctx.log(`mastodon: mailbox ${inbox.address} (${inbox.provider})`)

      const password = ctx.randomPassword(20)
      const baseName = (ctx.args.user ?? "oliviacode")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 28)
      const candidates = [baseName, `${baseName}1`, `${baseName}dev`, `${baseName}hq`]

      let created = null
      const failures = []

      for (const username of candidates) {
        await session.goto(`${base}/auth/sign_up`)
        await fillSignup(session, { username, email: inbox.address, password })
        ctx.log(`mastodon: submitting signup as ${username}`)
        await session.click('button[type="submit"]')
        await ctx.sleep(3500)
        await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)

        const text = (await session.text()).replace(/\s+/g, " ")
        if (
          /confirm|confirmation/i.test(text) ||
          !(await session.eval(`Boolean(document.querySelector('input[name="user[email]"]'))`))
        ) {
          created = username
          break
        }
        failures.push(text.slice(0, 200))
        if (/taken|already|invalid/i.test(text)) {
          ctx.log(`mastodon: ${username} refused`)
          continue
        }
        throw new Error(`signup failed: ${text.slice(0, 300)}`)
      }

      if (!created) throw new Error(`no username accepted\n${failures.join("\n")}`)

      account = {
        platform: "mastodon",
        instance,
        handle: `${created}@${instance}`,
        username: created,
        password,
        email: inbox.address,
        mailbox: inbox.provider,
        emailPassword: inbox.password,
        profile,
        port,
        profileUrl: `${base}/@${created}`,
        createdAt: new Date().toISOString(),
      }
      await ctx.writeState(`mastodon-${instance.split(".")[0]}.json`, account)
      await ctx.saveAccount(account)
      ctx.log(`mastodon: account created - @${account.handle}`)

      const message = await waitForMail(inbox, {
        timeoutMs: 300_000,
        match: (mail) => /confirm/i.test(`${mail.subject} ${mail.text} ${mail.html}`),
      })
      if (!message) throw new Error("confirmation mail never arrived")

      const links = messageLinks(message)
      const confirm =
        links.find((link) => /confirmation|confirm/i.test(link)) ?? links.find((link) => link.startsWith(base))
      if (!confirm) throw new Error(`confirmation mail had no link: ${(message.text ?? "").slice(0, 300)}`)

      ctx.log("mastodon: opening the confirmation link")
      await session.goto(confirm)
      await ctx.sleep(2500)
      const after = (await session.text()).replace(/\s+/g, " ")
      ctx.log(`mastodon: ${after.slice(0, 160)}`)

      signedIn = await session.eval(`Boolean(document.querySelector('a[href="/publish"]'))`)
      if (!signedIn) {
        ctx.log("mastodon: signing in with the new credentials")
        await session.goto(`${base}/auth/sign_in`)
        await session.waitFor("document.querySelector('input[name=\"user[email]\"]')", 30_000)
        await session.type('input[name="user[email]"]', inbox.address)
        await session.type('input[name="user[password]"]', password)
        await session.click('button[type="submit"]')
        await ctx.sleep(3500)
        signedIn = await session.eval(`Boolean(document.querySelector('a[href="/publish"]'))`)
      }
      if (!signedIn) throw new Error("could not sign in after confirmation")
    } else {
      ctx.log(`mastodon: already signed in${account ? ` as @${account.handle}` : ""}`)
    }

    if (account?.postUrl && !ctx.args.force) {
      ctx.log(`mastodon: already posted - ${account.postUrl}`)
      return account
    }

    ctx.log("mastodon: composing")
    await session.goto(`${base}/publish?text=${encodeURIComponent(copy)}`)
    await ctx.sleep(2500)
    const button = await session.eval(`(() => {
      const nodes = [...document.querySelectorAll('button')]
      const hit = nodes.find((el) => /^publish$/i.test((el.innerText || '').trim()))
      if (!hit) return null
      const rect = hit.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height, text: hit.innerText }
    })()`)
    if (!button || !button.w) throw new Error("no publish button on the compose page")
    await session.clickAt(button.x, button.y)
    await ctx.sleep(4000)
    await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)
    ctx.log(`mastodon: after publish - ${(await session.text()).replace(/\\s+/g, " ").slice(0, 160)}`)

    const postUrl = await statusUrl(session, base, account?.username)
    account = { ...account, postUrl, postedAt: new Date().toISOString() }
    await ctx.writeState(`mastodon-${instance.split(".")[0]}.json`, account)
    await ctx.saveAccount(account)
    ctx.log(`mastodon: posted - ${postUrl}`)
    return account
  } finally {
    await session.close()
  }
}

/** Newest status permalink on the author's profile. */
async function statusUrl(session, base, username) {
  if (username) {
    await session.goto(`${base}/@${username}`)
    await new Promise((done) => setTimeout(done, 2500))
    const href = await session.eval(`(() => {
      const link = document.querySelector('a[href*="/@"] time')?.closest('a') ?? document.querySelector('.status__relative-time a') ?? document.querySelector('a[href*="/statuses/"]')
      return link ? link.href : null
    })()`)
    if (href) return href
  }
  return base
}
