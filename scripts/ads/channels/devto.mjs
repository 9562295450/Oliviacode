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

/** A published article permalink, as opposed to the editor or a profile. */
const isArticleUrl = (href) => /^https:\/\/dev\.to\/[^/]+\/[a-z0-9-]{8,}\/?$/i.test(href ?? "")

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

    if (account?.postUrl && !ctx.args.force) {
      ctx.log(`devto: already posted - ${account.postUrl}`)
      return account
    }

    await session.goto("https://dev.to/new")
    await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
    await session.waitFor("document.querySelector('#article-form-title')", 30_000)
    await session.pause(1400, 2700)

    await session.typeHuman("#article-form-title", devtoTitle)
    await session.pause(700, 1500)

    // Nobody types six thousand characters; they paste the article and nudge it afterwards.
    await session.focus("#article_body_markdown")
    for (const chunk of devtoBody.match(/[\s\S]{1,320}/g) ?? []) {
      await session.send("Input.insertText", { text: chunk })
      await session.pause(160, 520)
    }
    await session.pause(1200, 2400)

    const bodyLen = await session.eval(`document.querySelector('#article_body_markdown')?.value.length ?? 0`)
    ctx.log(`devto: editor holds ${bodyLen} characters of body`)

    // Publish either publishes straight through or opens the options drawer, depending on the
    // release and on whether the editor already has tags. Both paths are one click from live.
    await session.clickByText("button", "Publish")
    await session.pause(2200, 3800)
    await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)

    if (ctx.args.dry) {
      const panel = await session.eval(`JSON.stringify({
        inputs: [...document.querySelectorAll('input')].filter((el) => el.offsetParent).map((el) => ({ type: el.type, id: el.id, name: el.name, placeholder: el.placeholder })),
        buttons: [...document.querySelectorAll('button, input[type="submit"]')].filter((el) => el.offsetParent).map((el) => ({ text: (el.innerText || el.value || '').trim(), type: el.type, id: el.id })).filter((el) => el.text),
      })`)
      ctx.log(`devto: dry, url is ${await session.url()}`)
      ctx.log(panel)
      return account
    }

    if (!isArticleUrl(await session.url())) {
      // Tags live in the drawer's own field on current releases; the article publishes without
      // them, so a missing field is not a reason to stop.
      const tagSelector = await session.eval(`(() => {
        const el = [...document.querySelectorAll('input')].find((n) => n.offsetParent && /tag/i.test(n.id + n.name + n.placeholder))
        if (!el) return null
        if (!el.id) el.id = "ads-tag-field"
        return el.id ? "#" + el.id : null
      })()`)
      if (tagSelector) {
        await session.typeHuman(tagSelector, "opensource, ai, tools, privacy")
        await session.pause(400, 900)
        await session.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        })
        await session.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        })
        await session.pause(700, 1500)
      }

      // The drawer's submit is the last visible Publish; the toolbar one is behind it.
      const submitted = await session.eval(`(() => {
        const hits = [...document.querySelectorAll('button, input[type="submit"]')]
          .filter((el) => el.offsetParent && /^publish$/i.test((el.innerText || el.value || '').trim()))
        const el = hits[hits.length - 1]
        if (!el) return false
        el.click()
        return true
      })()`)
      if (!submitted) throw new Error("no publish submit in the drawer")

      await ctx.sleep(6000)
      await session.waitFor("document.readyState === 'complete'", 25_000).catch(() => undefined)
      await session.pause(1500, 3000)
    }

    const postUrl = isArticleUrl(await session.url())
      ? (await session.url()).split("?")[0]
      : await session.eval(`(() => {
          const href = [...document.querySelectorAll('a[href*="/@"]')].map((a) => a.href)
            .find((candidate) => /dev\\.to\\/[^/]+\\/[a-z0-9-]{8,}$/i.test(candidate))
          return href ?? null
        })()`)
    const text = (await session.text()).replace(/\s+/g, " ")
    ctx.log(`devto: after publish - ${text.slice(0, 200)}`)
    if (!postUrl) throw new Error(`published but no permalink found; page said: ${text.slice(0, 300)}`)

    account = { ...account, postUrl, postedAt: new Date().toISOString() }
    await ctx.writeState("devto.json", account)
    await ctx.saveAccount(account)
    ctx.log(`devto: posted - ${postUrl}`)

    return account
  } finally {
    await session.close()
  }
}
