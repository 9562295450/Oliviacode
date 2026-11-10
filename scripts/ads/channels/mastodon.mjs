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

/**
 * State file stem for an instance.
 *
 * Taking the first label collides ("mastodon" serves both mastodon.au and mastodon.nu), which
 * silently overwrote one instance's credentials with another's. The full host, slugged, is unique.
 */
function stateKey(instance) {
  return instance.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

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
    // Nobody reads a rules page and clicks in the same frame; dwell, scroll, then accept.
    await session.pause(2200, 4800)
    await session.eval(`window.scrollBy(0, ${180 + Math.round(Math.random() * 260)})`)
    await session.pause(900, 2400)
    await session.clickByText("button", "Accept")
    await session.pause(1800, 3600)
  }

  await session.waitFor("document.querySelector('input[name=\"user[email]\"]')", 30_000)
  await session.pause(1200, 2600)

  const usernameField = (await session.eval(
    `Boolean(document.querySelector('input[name="user[account_attributes][username]"]'))`,
  ))
    ? 'input[name="user[account_attributes][username]"]'
    : 'input[name="user[username]"]'

  await session.typeHuman(usernameField, username)
  await session.pause(420, 980)
  await session.typeHuman('input[name="user[email]"]', email)
  await session.pause(520, 1300)
  await session.typeHuman('input[name="user[password]"]', password)
  await session.pause(300, 820)
  const confirmField = 'input[name="user[password_confirmation]"]'
  if (await session.eval(`Boolean(document.querySelector('${confirmField}'))`)) {
    await session.typeHuman(confirmField, password)
    await session.pause(380, 900)
  }

  for (const [part, value] of [
    ["1i", "1990"],
    ["2i", "01"],
    ["3i", "01"],
  ]) {
    const selector = `input[name="user[date_of_birth(${part})]"]`
    if (await session.eval(`Boolean(document.querySelector('${selector}'))`)) {
      await session.typeHuman(selector, value)
      await session.pause(220, 560)
    }
  }

  await session.pause(700, 1700)
  await session.eval(`(() => {
    const box = document.querySelector('input[name="user[agreement]"]')
    if (box && !box.checked) box.click()
    return box ? box.checked : false
  })()`)
  // A beat on the foot of the form before reaching for submit.
  await session.pause(900, 2100)
}

export default async function mastodon(ctx) {
  const instance = ctx.args.instance ?? defaultInstance
  const base = `https://${instance}`
  const port = Number(ctx.args.port ?? 9337)
  const profile = ctx.args.profile ?? `mastodon-${stateKey(instance)}`
  const saved = await ctx.readState(`mastodon-${stateKey(instance)}.json`)
  let account = saved

  const session = await ctx.openPage({ port, name: profile })

  try {
    await session.goto(`${base}/explore`)
    await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
    let signedIn = await session.eval(`Boolean(document.querySelector('a[href="/publish"]'))`)

    if (!signedIn && account?.mailbox === "own" && !ctx.args.login) {
      ctx.log(`mastodon: @${account.handle} is waiting on the confirmation click; rerun with --login`)
      return account
    }

    if (!signedIn && account && ctx.args.login) {
      ctx.log(`mastodon: signing in as @${account.handle}`)
      await session.goto(`${base}/auth/sign_in`)
      await session.waitFor("document.querySelector('input[name=\"user[email]\"]')", 30_000)
      await session.pause(1100, 2400)
      await session.typeHuman('input[name="user[email]"]', account.email)
      await session.pause(400, 950)
      await session.typeHuman('input[name="user[password]"]', account.password)
      await session.pause(600, 1500)
      await session.click('button[type="submit"]')
      await ctx.sleep(4000)
      signedIn = await session.eval(`Boolean(document.querySelector('a[href="/publish"]'))`)
      if (!signedIn) {
        const text = (await session.text()).replace(/\s+/g, " ")
        if (/confirm/i.test(text)) {
          ctx.log(`mastodon: ${account.email} is still unconfirmed`)
          return account
        }
        throw new Error(`sign-in failed: ${text.slice(0, 300)}`)
      }
      ctx.log("mastodon: signed in")
    }

    if (!signedIn) {
      const inbox = ctx.args.email
        ? { address: ctx.args.email, provider: "own", password: null }
        : await ctx.createInbox(ctx.args["mail-provider"] ? [ctx.args["mail-provider"]] : undefined)
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
      await ctx.writeState(`mastodon-${stateKey(instance)}.json`, account)
      await ctx.saveAccount(account)
      ctx.log(`mastodon: account created - @${account.handle}`)

      if (inbox.provider === "own") {
        ctx.log(`mastodon: confirm the link sent to ${inbox.address}, then rerun with --login`)
        return account
      }

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
    await ctx.writeState(`mastodon-${stateKey(instance)}.json`, account)
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
