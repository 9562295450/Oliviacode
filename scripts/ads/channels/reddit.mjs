/**
 * Reddit: one submission per run, in the shape that community's rules allow.
 *
 * Three shapes are handled because three of the target communities require them: a normal text
 * submission, a comment in the pinned "new projects" megathread, and a text submission whose links
 * go in the first comment (r/AI_Agents rule 3). Everything is typed at human pace and the run
 * refuses to post the same community twice unless --force is passed.
 *
 * Reddit answers 403 to this host's plain HTTP clients, so all of it goes through the browser.
 */
import { reddit as copy, order, skipped } from "../copy-reddit.mjs"

const defaultPort = 9339

function plan() {
  for (const sub of order) {
    const entry = copy[sub]
    console.log(
      `${sub.padEnd(18)} weight ${entry.weight}  ${entry.megathread ? "megathread comment" : "text post"}  ${entry.title}`,
    )
  }
  console.log("\nskipped:")
  for (const [sub, reason] of Object.entries(skipped)) console.log(`  ${sub.padEnd(18)} ${reason}`)
}

/** Sign in if the profile is not already carrying a session. */
async function ensureSignedIn(session, ctx) {
  const signedIn = await session.eval(
    `Boolean(document.querySelector('#USER_DROPDOWN_ID, [aria-label="Open user menu"], button[aria-label*="profile" i]'))`,
  )
  if (signedIn) return true

  if (ctx.args.cookie) {
    await session.send("Network.enable", {})
    await session.send("Network.setCookie", {
      name: "reddit_session",
      value: ctx.args.cookie,
      domain: ".reddit.com",
      path: "/",
      secure: true,
      httpOnly: true,
    })
    await session.goto("https://www.reddit.com/")
    await ctx.sleep(4000)
    return session.eval(`Boolean(document.querySelector('#USER_DROPDOWN_ID, [aria-label="Open user menu"]'))`)
  }

  if (!ctx.args.user || !ctx.args.password) return false

  ctx.log("reddit: signing in")
  await session.goto("https://www.reddit.com/login/")
  await session.waitFor("document.querySelector('#login-username, input[name=\"username\"]')", 30_000)
  await session.pause(1200, 2500)
  const userField = (await session.eval(`Boolean(document.querySelector('#login-username'))`))
    ? "#login-username"
    : 'input[name="username"]'
  await session.typeHuman(userField, ctx.args.user)
  await session.pause(400, 900)
  await session.typeHuman("#login-password, input[name='password']", ctx.args.password)
  await session.pause(600, 1400)
  await session.clickByText("button", "Log In")
  await ctx.sleep(6000)
  await session.waitFor("document.readyState === 'complete'", 25_000).catch(() => undefined)

  const text = (await session.text()).replace(/\s+/g, " ")
  if (/verification code|two-factor|two factor/i.test(text)) {
    throw new Error("reddit: two-factor prompt - pass --cookie with reddit_session instead")
  }
  const ok = await session.eval(`Boolean(document.querySelector('#USER_DROPDOWN_ID, [aria-label="Open user menu"]'))`)
  if (!ok) throw new Error(`reddit: sign-in failed - ${text.slice(0, 220)}`)
  ctx.log("reddit: signed in")
  return true
}

/** Fill the text composer on a submission page and leave it ready to send. */
async function fillComposer(session, ctx, { title, body }) {
  await session.waitFor("document.querySelector('#post-title, textarea[name=\"title\"]')", 30_000)
  await session.pause(1600, 3200)

  const titleField = (await session.eval(`Boolean(document.querySelector('#post-title'))`))
    ? "#post-title"
    : 'textarea[name="title"]'
  await session.typeHuman(titleField, title, { clear: true })
  await session.pause(900, 1900)

  const editor = await session.eval(`(() => {
    const el = [...document.querySelectorAll('[contenteditable="true"], textarea[name="text"]')]
      .find((node) => node.offsetParent && !/comment/i.test(node.getAttribute('placeholder') || ''))
    if (!el) return null
    if (!el.id) el.id = "ads-body"
    return "#" + el.id
  })()`)
  if (!editor) throw new Error("reddit: no body editor on the submit page")

  await session.focus(editor, true)
  for (const chunk of body.match(/[\s\S]{1,280}/g) ?? []) {
    await session.send("Input.insertText", { text: chunk })
    await session.pause(150, 470)
  }
  await session.pause(1400, 2600)
  return editor
}

/** Click the submit control whose label matches, ignoring the disabled state check. */
async function submitComposer(session, ctx, label) {
  const clicked = await session.eval(`(() => {
    const el = [...document.querySelectorAll('button')]
      .filter((node) => node.offsetParent && new RegExp('^' + ${JSON.stringify(label)} + '$', 'i').test((node.innerText || '').trim()))
    const hit = el[el.length - 1]
    if (!hit) return false
    hit.click()
    return true
  })()`)
  if (!clicked) throw new Error(`reddit: no "${label}" button`)
  await ctx.sleep(6000)
  await session.waitFor("document.readyState === 'complete'", 25_000).catch(() => undefined)
  await session.pause(1500, 3000)
}

/** Comment on an existing post (megathread or first-comment duty). */
async function comment(session, ctx, url, body) {
  await session.goto(url)
  await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
  await session.pause(2200, 4000)
  const editor = await session.eval(`(() => {
    const el = [...document.querySelectorAll('[contenteditable="true"], textarea[name="text"]')]
      .find((node) => node.offsetParent)
    if (!el) return null
    if (!el.id) el.id = "ads-comment"
    return "#" + el.id
  })()`)
  if (!editor) throw new Error(`reddit: no comment box on ${url}`)
  await session.focus(editor, true)
  for (const chunk of body.match(/[\s\S]{1,280}/g) ?? []) {
    await session.send("Input.insertText", { text: chunk })
    await session.pause(150, 470)
  }
  await session.pause(1200, 2200)
  await submitComposer(session, ctx, "Comment")
  const link = await session.eval(`(() => {
    const hit = [...document.querySelectorAll('a[href*="/comment/"]')].pop()
    return hit ? hit.href : location.href
  })()`)
  return link
}

export default async function reddit(ctx) {
  if (ctx.args.list) {
    plan()
    return undefined
  }

  const sub = ctx.args.sub
  if (!sub) {
    plan()
    throw new Error("reddit: name a community with --sub, from the list above")
  }
  const entry = copy[sub]
  if (!entry) throw new Error(`reddit: no copy for r/${sub}; add it to copy-reddit.mjs first`)

  const port = Number(ctx.args.port ?? defaultPort)
  const profile = ctx.args.profile ?? "reddit"
  const stateFile = `reddit-${sub}.json`
  const saved = await ctx.readState(stateFile)
  if (saved?.postUrl && !ctx.args.force) {
    ctx.log(`reddit: already posted to r/${sub} - ${saved.postUrl}`)
    return saved
  }

  const session = await ctx.openPage({ port, name: profile })
  try {
    await session.goto("https://www.reddit.com/")
    await session.waitFor("document.readyState === 'complete'", 35_000).catch(() => undefined)
    if (!(await ensureSignedIn(session, ctx))) {
      throw new Error("reddit: not signed in - pass --user and --password, or --cookie with a reddit_session value")
    }

    if (entry.megathread) {
      const megathread = await session.eval(`(async () => {
        const response = await fetch('https://www.reddit.com/r/${sub}/', { headers: { accept: 'text/html' } })
        const html = await response.text()
        const hit = html.match(/href="(\\/r\\/${sub}\\/comments\\/[a-z0-9]+\\/[^"]*megathread[^"]*)"/i)
        return hit ? 'https://www.reddit.com' + hit[1] : null
      })()`)
      if (!megathread) throw new Error(`reddit: could not find the r/${sub} new-project megathread`)
      ctx.log(`reddit: megathread ${megathread}`)
      const postUrl = await comment(session, ctx, megathread, entry.body)
      const account = { platform: "reddit", sub, kind: "comment", postUrl, postedAt: new Date().toISOString() }
      await ctx.writeState(stateFile, account)
      await ctx.saveAccount({ ...account, handle: ctx.args.user ?? "reddit" })
      ctx.log(`reddit: commented - ${postUrl}`)
      return account
    }

    const kind = ctx.args.link ? "LINK" : "TEXT"
    await session.goto(`https://www.reddit.com/r/${sub}/submit?type=${kind}`)
    await session.waitFor("document.readyState === 'complete'", 35_000).catch(() => undefined)

    if (ctx.args.link) {
      await session.waitFor('input[name="url"], #post-url', 30_000)
      await session.pause(1500, 3000)
      await session.typeHuman('input[name="url"], #post-url', ctx.args.link)
      await session.pause(600, 1300)
      await session.typeHuman('#post-title, textarea[name="title"]', entry.title, { clear: true })
    } else {
      await fillComposer(session, ctx, entry)
    }

    if (ctx.args.dry) {
      ctx.log(`reddit: dry, composer filled for r/${sub} at ${await session.url()}`)
      const found = await session.eval(`JSON.stringify({
        title: document.querySelector('#post-title, textarea[name="title"]')?.value?.slice(0, 80) ?? null,
        bodyLength: [...document.querySelectorAll('[contenteditable="true"]')].map((el) => (el.innerText || '').length),
        buttons: [...document.querySelectorAll('button')].filter((el) => el.offsetParent).map((el) => (el.innerText || '').trim()).filter(Boolean).slice(0, 12),
      })`)
      ctx.log(found)
      return { platform: "reddit", sub, dry: true }
    }

    await submitComposer(session, ctx, "Post")
    const url = await session.url()
    const text = (await session.text()).replace(/\s+/g, " ")
    if (!/\/comments\//.test(url)) throw new Error(`reddit: r/${sub} did not accept the post - ${text.slice(0, 260)}`)

    let account = {
      platform: "reddit",
      sub,
      kind: "post",
      postUrl: url.split("?")[0],
      postedAt: new Date().toISOString(),
    }

    if (entry.firstComment) {
      await session.pause(2500, 4500)
      account = { ...account, commentUrl: await comment(session, ctx, account.postUrl, entry.firstComment) }
    }

    await ctx.writeState(stateFile, account)
    await ctx.saveAccount({ ...account, handle: ctx.args.user ?? "reddit" })
    ctx.log(`reddit: posted to r/${sub} - ${account.postUrl}`)
    return account
  } finally {
    await session.close()
  }
}
