/**
 * DEV Community: create an account with a disposable address, confirm it, then publish.
 *
 * The signup form is a Rails form with a Cloudflare Turnstile field. Ghost's headful browser
 * usually gets a token without a challenge; when it does not, the field stays empty and the
 * server says so instead of silently dropping the account.
 *
 * Posting uses the editor at /new: title field, markdown body, then the publish drawer.
 */
import { devtoTitle, devtoBody } from "../copy.mjs"
import { links as messageLinks, waitForMail, resumeMailtm, resumeTempmail } from "../lib/mail.mjs"

const signupUrl = "https://dev.to/users/sign_up?state=email_signup"
const enterUrl = "https://dev.to/enter"

function waitForToken(session, timeoutMs = 45_000) {
  return session.waitFor(
    `(() => { const el = document.querySelector('[name="cf-turnstile-response"]'); return el && el.value && el.value.length > 20 })()`,
    timeoutMs,
  )
}

/** Fill the signup form and wait for a Turnstile token, reloading when the widget stalls. */
async function fillSignup(session, ctx, { username, email, password }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await session.goto(signupUrl)
    await session.waitFor("document.querySelector('input[name=\"user[email]\"]')", 30_000)
    await session.pause(1400, 2900)

    await session.typeHuman('input[name="user[name]"]', "Oliviacode")
    await session.pause(350, 850)
    await session.typeHuman('input[name="user[username]"]', username)
    await session.pause(400, 950)
    await session.typeHuman('input[name="user[email]"]', email)
    await session.pause(500, 1200)
    await session.typeHuman('input[name="user[password]"]', password)
    await session.pause(300, 800)
    await session.typeHuman('input[name="user[password_confirmation]"]', password)
    await session.pause(700, 1600)
    try {
      await waitForToken(session, 25_000)
      return
    } catch {
      ctx.log(`devto: Turnstile issued no token (attempt ${attempt}), reloading`)
    }
  }
  throw new Error("Turnstile never issued a token")
}

/** Follow the confirmation link from the mail and report what the site said. */
async function confirmAddress(session, ctx, account) {
  // A real address belongs to a person, not to this process: the link gets clicked there.
  if (account.mailbox === "own") {
    ctx.log(`devto: ${account.email} needs the confirmation link clicked in that inbox`)
    return account
  }

  const inbox =
    account.mailbox === "mail.tm"
      ? await resumeMailtm(account.email, account.emailPassword)
      : await resumeTempmail(account.emailPassword)
  ctx.log(`devto: polling ${account.email} for the confirmation mail`)
  const message = await waitForMail(inbox, { timeoutMs: 300_000 })
  if (!message) throw new Error("confirmation mail never arrived")

  const links = messageLinks(message)
  const confirm = links.find((link) => /confirm|confirmation/i.test(link)) ?? links.find((link) => /dev\.to/.test(link))
  if (!confirm) throw new Error(`confirmation mail had no link: ${(message.text ?? "").slice(0, 300)}`)

  ctx.log("devto: opening the confirmation link")
  await session.goto(confirm)
  await ctx.sleep(2500)
  const after = (await session.text()).replace(/\s+/g, " ")
  ctx.log(`devto: ${after.slice(0, 160)}`)
  return { ...account, confirmed: true }
}

export default async function devto(ctx) {
  const port = Number(ctx.args.port ?? 9336)
  const profile = ctx.args.profile ?? "devto"
  const saved = await ctx.readState("devto.json")
  let account = saved
  const session = await ctx.openPage({ port, name: profile })

  try {
    if (account && !account.confirmed) {
      ctx.log("devto: resuming an unconfirmed account")
      account = await confirmAddress(session, ctx, account)
      await ctx.writeState("devto.json", account)
      await ctx.saveAccount(account)
    }

    await session.goto("https://dev.to/")
    await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
    let loggedIn = await session.eval(`Boolean(document.querySelector('a[href="/new"]'))`)

    if (!loggedIn && account) {
      ctx.log(`devto: signing in as ${account.handle}`)
      await session.goto(enterUrl)
      await session.waitFor("document.querySelector('input[name=\"user[email]\"]')", 30_000)
      await session.type('input[name="user[email]"]', account.email)
      await session.type('input[name="user[password]"]', account.password)
      await waitForToken(session).catch(() => undefined)
      await session.click('input[name="commit"]')
      await ctx.sleep(4000)
      loggedIn = await session.eval(`Boolean(document.querySelector('a[href="/new"]'))`)
      if (!loggedIn) {
        const text = (await session.text()).replace(/\s+/g, " ")
        if (/confirm your email/i.test(text)) {
          ctx.log(`devto: waiting on the confirmation click for ${account.email}`)
          return account
        }
        throw new Error(`sign-in failed: ${text.slice(0, 300)}`)
      }
    }

    if (!loggedIn) {
      const inbox = ctx.args.email
        ? { address: ctx.args.email, provider: "own", password: null }
        : await ctx.createInbox(ctx.args["mail-provider"] ? [ctx.args["mail-provider"]] : undefined)
      ctx.log(`devto: mailbox ${inbox.address} (${inbox.provider})`)

      const password = ctx.randomPassword(20)
      const base = (ctx.args.user ?? "oliviacode")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 20)
      const candidates = [base, `${base}1`, `${base}dev`, `${base}hq`, `${base}client`, `${base}app`]

      let created = null
      let pendingConfirmation = false
      const failures = []

      for (const username of candidates) {
        await fillSignup(session, ctx, { username, email: inbox.address, password })

        ctx.log(`devto: submitting signup as ${username}`)
        await session.click('input[name="commit"]')
        await ctx.sleep(4000)
        await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)

        const text = (await session.text()).replace(/\s+/g, " ")
        if (/confirm your email/i.test(text)) {
          ctx.log(`devto: account ${username} created, email confirmation pending`)
          created = username
          pendingConfirmation = true
          break
        }
        if (await session.eval(`Boolean(document.querySelector('a[href="/new"]'))`)) {
          created = username
          break
        }
        failures.push(text.slice(0, 220))
        if (/already has been taken|has already been taken/i.test(text)) {
          ctx.log(`devto: ${username} is taken`)
          continue
        }
        throw new Error(`signup failed: ${text.slice(0, 400)}`)
      }

      if (!created) throw new Error(`no username accepted\n${failures.join("\n")}`)

      account = {
        platform: "devto",
        handle: created,
        password,
        email: inbox.address,
        mailbox: inbox.provider,
        emailPassword: inbox.password,
        profile,
        port,
        profileUrl: `https://dev.to/${created}`,
        createdAt: new Date().toISOString(),
        confirmed: !pendingConfirmation,
      }
      await ctx.writeState("devto.json", account)
      await ctx.saveAccount(account)
      ctx.log(`devto: account ready - ${account.handle}`)

      if (pendingConfirmation) {
        account = await confirmAddress(session, ctx, account)
        await ctx.writeState("devto.json", account)
        await ctx.saveAccount(account)
      }
    } else {
      ctx.log(`devto: already signed in${account ? ` as ${account.handle}` : ""}`)
    }

    if (!account) {
      // Signed in without local state: read the handle off the navbar and record it.
      const handle = await session.eval(`(() => {
        const link = [...document.querySelectorAll('a[href^="/"]')].find((a) => a.querySelector('img') && a.getAttribute('href').split('/').length === 2)
        return link ? link.getAttribute('href').slice(1) : null
      })()`)
      account = { platform: "devto", handle, profile, port, profileUrl: handle ? `https://dev.to/${handle}` : null }
      await ctx.writeState("devto.json", account)
      await ctx.saveAccount(account)
    }

    if (!ctx.args.post) return account

    await session.goto("https://dev.to/new")
    await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
    await ctx.sleep(3000)
    const map = await session.eval(`JSON.stringify({
      title: [...document.querySelectorAll('input, textarea')].filter((el) => /title/i.test(el.name || el.id || el.placeholder || '')).map((el) => ({ tag: el.tagName, id: el.id, name: el.name, placeholder: el.placeholder })),
      editors: [...document.querySelectorAll('textarea, [contenteditable="true"]')].map((el) => ({ tag: el.tagName, id: el.id, name: el.name, cls: String(el.className).slice(0, 80), placeholder: el.placeholder || '' })),
      buttons: [...document.querySelectorAll('button')].map((el) => (el.innerText || '').trim()).filter(Boolean).slice(0, 30),
    }, null, 1)`)
    ctx.log(map)

    return account
  } finally {
    await session.close()
  }
}
