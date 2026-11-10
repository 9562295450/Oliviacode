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
import { join } from "node:path"
import { attachTab } from "../lib/cdp.mjs"
import { reddit as copy, order, skipped } from "../copy-reddit.mjs"

const defaultPort = 9339
const signupState = "reddit-signup.json"

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

/**
 * Whether this browser carries a Reddit session.
 *
 * `/api/v1/me` used to answer with the account name; it now returns `{"features": …}` and nothing
 * else, so a name check called a perfectly signed-in profile signed out and walked it to the login
 * page, which answered "You are already logged in". The cookie store is the session speaking for
 * itself: `reddit_session` is httpOnly, and CDP reads it from outside the page.
 */
async function isSignedIn(session) {
  try {
    await session.send("Network.enable", {})
    const { cookies } = await session.send("Network.getCookies", { urls: ["https://www.reddit.com/"] })
    return (cookies ?? []).some((cookie) => cookie.name === "reddit_session" && (cookie.value ?? "").length > 20)
  } catch {
    return false
  }
}

/** Sign in if the profile is not already carrying a session. */
async function ensureSignedIn(session, ctx) {
  if (await isSignedIn(session)) {
    ctx.log("reddit: session cookie present")
    return true
  }

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
    return isSignedIn(session)
  }

  if (!ctx.args.user || !ctx.args.password) return false

  ctx.log("reddit: signing in")
  await session.goto("https://www.reddit.com/login/")
  await session.waitForElement('input[name="username"], #login-username', 30_000)
  await session.pause(1200, 2500)
  await session.typeHuman('input[name="username"], #login-username', ctx.args.user)
  await session.pause(400, 900)
  await session.typeHuman('input[name="password"], #login-password', ctx.args.password)
  await session.pause(600, 1400)
  await session.clickByText("button", "Log In")
  await ctx.sleep(6000)
  await session.waitFor("document.readyState === 'complete'", 25_000).catch(() => undefined)

  if (await isSignedIn(session)) {
    ctx.log("reddit: signed in")
    return true
  }
  const text = (await session.text()).replace(/\s+/g, " ")
  if (/verification code|two-factor|two factor/i.test(text)) {
    throw new Error("reddit: two-factor prompt - pass --cookie with reddit_session instead")
  }
  throw new Error(`reddit: sign-in failed - ${text.slice(0, 220)}`)
}

/**
 * Fill the composer and leave it ready to send.
 *
 * The current composer is a shadow-DOM title field plus a rich-text body: the body is the first
 * visible `contenteditable`, and it only accepts text after a real click lands inside it, which is
 * also how a person gets the caret there.
 */
async function fillComposer(session, ctx, { title, body }) {
  await session.waitForElement('textarea[name="title"]', 30_000)
  await session.pause(1600, 3200)
  await session.typeHuman('textarea[name="title"]', title, { clear: true })
  await session.pause(900, 1900)

  const box = await session.eval(`(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot, out)
        if (el.isContentEditable && el.getClientRects().length) out.push(el)
      }
      return out
    }
    const el = walk(document)[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })
  })()`)
  if (!box) throw new Error("reddit: no body editor on the submit page")
  const rect = JSON.parse(box)

  await session.pause(500, 1100)
  await session.clickAt(rect.x + Math.min(60, rect.w / 2), rect.y + Math.min(18, rect.h / 2))
  await session.pause(500, 1100)

  // One paste, then verify. The editor re-renders while text is arriving; paced chunks can land
  // out of order and leave a sentence scrambled, so the body goes in whole and gets compared
  // against the copy before anything is submitted.
  const normalize = (value) => value.replace(/\s+/g, " ").trim()
  const readBody = () =>
    session.eval(`(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot, out)
        if (el.isContentEditable && el.getClientRects().length) out.push(el)
      }
      return out
    }
    const el = walk(document)[0]
    return el ? el.innerText : ""
  })()`)

  await session.send("Input.insertText", { text: body })
  await session.pause(1200, 2400)

  if (normalize(await readBody()) !== normalize(body)) {
    ctx.log("reddit: body came out mangled, clearing and retyping")
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    })
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    })
    await session.pause(300, 800)
    await session.send("Input.insertText", { text: body })
    await session.pause(1200, 2400)
    if (normalize(await readBody()) !== normalize(body)) {
      throw new Error("reddit: composer body does not match the copy - refusing to submit")
    }
  }
  await session.pause(1400, 2600)
}

/** Press the button whose whole label matches, as a real mouse press. */
async function submitComposer(session, ctx, label) {
  const box = await session.eval(`(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot, out)
        if (el.tagName === "BUTTON" && el.getClientRects().length) out.push(el)
      }
      return out
    }
    const hit = walk(document).filter((el) => (el.innerText || "").trim() === ${JSON.stringify(label)}).pop()
    if (!hit) return null
    hit.scrollIntoView({ block: "center" })
    const r = hit.getBoundingClientRect()
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  })()`)
  if (!box) throw new Error(`reddit: no "${label}" button`)
  const point = JSON.parse(box)
  await session.pause(500, 1200)
  await session.clickAt(point.x, point.y)
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

/**
 * Create the account, in two passes, because the code goes to a person's inbox.
 *
 * Reddit's signup is email -> six-digit code -> username and password, with the inputs inside
 * faceplate web components and an invisible reCAPTCHA watching. The first pass types the address
 * and leaves the tab waiting on the code screen; the socket detaches so the tab survives the gap.
 * The second pass reattaches to that same tab, types the code and finishes the account.
 *
 * Every step leaves a screenshot on disk. Read the picture, not the innerText: the DOM cannot say
 * that an overlay is covering the button or that the page that answered is not the page asked for.
 */
async function createAccount(ctx) {
  const port = Number(ctx.args.port ?? defaultPort)
  const profile = ctx.args.profile ?? "reddit-edge"
  const email = ctx.args.email ?? "marlfielixdumlao@gmail.com"

  await ctx.ensureGhost({ port, name: profile, browser: ctx.args.browser ?? "edge" })
  const saved = await ctx.readState(signupState)

  let session = saved?.targetId ? await attachTab(port, saved.targetId).catch(() => null) : null
  if (!session) session = await ctx.openPage({ port, name: profile, browser: ctx.args.browser ?? "edge" })
  ctx.log(`reddit: signup tab ${session.targetId}`)

  const shoot = async (name) => {
    const file = join(ctx.stateDir, `reddit-signup-${name}.png`)
    await session.screenshot(file)
    ctx.log(`screenshot: ${file}`)
  }

  try {
    if (!saved?.targetId || ctx.args.fresh) {
      await session.goto("https://www.reddit.com/register/")
      await session.waitFor("document.readyState === 'complete'", 35_000).catch(() => undefined)
      await ctx.sleep(4000)

      await session.waitForElement('input[name="email"]', 25_000)
      await session.typeHuman('input[name="email"]', email)
      await session.pause(900, 2200)
      await shoot("1-email")

      await session.clickByText("button", "Continue")
      await ctx.sleep(7000)
      await shoot("2-code")

      await ctx.writeState(signupState, {
        targetId: session.targetId,
        email,
        step: "code",
        startedAt: new Date().toISOString(),
      })
      ctx.log(`reddit: code sent to ${email} - rerun with --code <six digits> while this tab is alive`)
      await session.detach()
      return { step: "code", targetId: session.targetId }
    }

    if (!ctx.args.code) throw new Error("reddit: a signup is waiting on its code - pass --code <six digits>")

    await session.waitForElement('input[name="code"]', 25_000)
    await session.pause(900, 1900)
    await session.typeHuman('input[name="code"]', String(ctx.args.code))
    await session.pause(700, 1500)
    await shoot("3-code-filled")

    await session.clickByText("button", "Continue")
    await ctx.sleep(7000)
    await shoot("4-account")

    await session.waitForElement('input[name="username"]', 25_000)
    await session.pause(1200, 2400)
    await session.typeHuman('input[name="username"]', ctx.args.handle ?? "oliviacodeapp")
    await session.pause(600, 1400)
    const password = ctx.args.password ?? ctx.randomPassword(20)
    await session.typeHuman('input[name="password"]', password)
    await session.pause(900, 1800)
    await shoot("5-account-filled")

    await session.clickByText("button", "Continue")
    await ctx.sleep(9000)
    await shoot("6-result")

    const url = await session.url()
    const text = (await session.text()).replace(/\s+/g, " ")
    const handle = ctx.args.handle ?? "oliviacodeapp"
    const done = !/\/register/.test(url)

    if (!done) {
      throw new Error(`reddit: signup did not finish at ${url} - ${text.slice(0, 240)}`)
    }

    await ctx.writeState(signupState, {
      targetId: session.targetId,
      email,
      handle,
      password,
      step: "done",
      finishedAt: new Date().toISOString(),
    })
    await ctx.saveAccount({ platform: "reddit", handle, password, profileUrl: `https://www.reddit.com/user/${handle}` })
    ctx.log(`reddit: account ${handle} created`)
    await session.detach()
    return { handle }
  } finally {
    await session.detach()
  }
}

export default async function reddit(ctx) {
  if (ctx.args.signup || ctx.args.code) return createAccount(ctx)

  if (ctx.args.list) {
    plan()
    return undefined
  }

  const sub = ctx.args.sub
  if (!sub) {
    plan()
    throw new Error("reddit: name a community with --sub, from the list above")
  }
  if (skipped[sub]) throw new Error(`reddit: r/${sub} is on the skip list - ${skipped[sub]}`)
  const entry = copy[sub]
  if (!entry) throw new Error(`reddit: no copy for r/${sub}; add it to copy-reddit.mjs first`)

  const port = Number(ctx.args.port ?? defaultPort)
  const profile = ctx.args.profile ?? "reddit-edge"

  // An account created here signs itself in on later runs; the password stays in state.
  const record = await ctx.readState(signupState)
  const storedUser = record?.step === "done" ? record.handle : null
  if (!ctx.args.user && !ctx.args.password && !ctx.args.cookie && record?.password) {
    ctx.args.user = record.handle
    ctx.args.password = record.password
  }

  const stateFile = `reddit-${sub}.json`
  const saved = await ctx.readState(stateFile)
  if (saved?.postUrl && !ctx.args.force) {
    ctx.log(`reddit: already posted to r/${sub} - ${saved.postUrl}`)
    return saved
  }

  const session = await ctx.openPage({ port, name: profile, browser: ctx.args.browser ?? "edge" })
  try {
    await session.goto("https://www.reddit.com/")
    await session.waitFor("document.readyState === 'complete'", 35_000).catch(() => undefined)
    const signedIn = await ensureSignedIn(session, ctx)
    if (!signedIn) {
      throw new Error("reddit: not signed in - pass --user and --password, or --cookie with a reddit_session value")
    }
    const signedInAs = ctx.args.user ?? storedUser ?? "reddit"

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
      await ctx.saveAccount({ ...account, handle: signedInAs ?? "reddit" })
      ctx.log(`reddit: commented - ${postUrl}`)
      return account
    }

    // Text submissions only. Reddit's submit page takes `?type=TEXT` but ignores `?type=LINK`
    // (the hidden submission-type input stays TEXT), so communities that require a link post are
    // on the skip list rather than half-supported here.
    await session.goto(`https://www.reddit.com/r/${sub}/submit?type=TEXT`)
    await session.waitFor("document.readyState === 'complete'", 35_000).catch(() => undefined)
    await fillComposer(session, ctx, entry)

    if (ctx.args.dry) {
      ctx.log(`reddit: dry, composer filled for r/${sub} at ${await session.url()}`)
      const found = await session.eval(`(() => {
        const walk = (root, out = []) => {
          for (const el of root.querySelectorAll("*")) {
            if (el.shadowRoot) walk(el.shadowRoot, out)
            out.push(el)
          }
          return out
        }
        const nodes = walk(document)
        const title = nodes.find((el) => el.name === "title")
        const body = nodes.find((el) => el.isContentEditable && el.getClientRects().length)
        const post = nodes.filter((el) => el.tagName === "BUTTON" && el.getClientRects().length).find((el) => (el.innerText || "").trim() === "Post")
        return JSON.stringify({
          title: title ? title.value.slice(0, 80) : null,
          bodyLength: body ? (body.innerText || "").length : 0,
          postEnabled: post ? !post.disabled : null,
        })
      })()`)
      ctx.log(found)
      const shot = join(ctx.stateDir, `reddit-dry-${sub}.png`)
      await session.screenshot(shot)
      ctx.log(`screenshot: ${shot}`)
      return { platform: "reddit", sub, dry: true }
    }

    await submitComposer(session, ctx, "Post")
    const shot = join(ctx.stateDir, `reddit-post-${sub}.png`)
    await session.screenshot(shot)
    ctx.log(`screenshot: ${shot}`)

    // Reddit answers a successful submission with a "Posted!" modal over the community feed, not
    // a redirect to the new thread, so the URL has to be resolved from the profile afterwards.
    let url = await session.url()
    if (!/\/comments\//.test(url)) {
      const fromProfile = await session.eval(`(async () => {
        const response = await fetch('https://www.reddit.com/user/${signedInAs}/submitted/', { headers: { accept: 'text/html' } })
        const html = await response.text()
        const hit = html.match(/href="(\\/r\\/[^"]+\\/comments\\/[a-z0-9]+\\/[^"]*)"/i)
        return hit ? 'https://www.reddit.com' + hit[1] : null
      })()`)
      if (fromProfile) url = fromProfile
    }
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
    await ctx.saveAccount({ ...account, handle: signedInAs ?? "reddit" })
    ctx.log(`reddit: posted to r/${sub} - ${account.postUrl}`)
    return account
  } finally {
    await session.close()
  }
}
