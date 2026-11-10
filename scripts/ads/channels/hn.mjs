/**
 * Hacker News: create an account, then submit the Show HN post.
 *
 * HN has no signup API. The login page carries both forms - login and create - and the
 * create form has a hidden `creating=t` field. Everything goes through the browser's own
 * form submission so the session cookie and the anti-abuse checks see a normal navigation.
 *
 * `/submit` carries a session-scoped `fnid` hidden field, so the form is filled in place
 * rather than POSTed from here.
 */
import { hnTitle, hnTitlePlain, hnText } from "../copy.mjs"

const loginUrl = "https://news.ycombinator.com/login"
const createForm = 'form:has(input[name="creating"])'

function candidates(base) {
  const seeds = [base, `${base}1`, `${base}2`, `${base}hq`, `${base}dev`, `${base}x`]
  return seeds.map((name) => name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 15))
}

async function isLoggedIn(session) {
  return session.eval(`Boolean(document.querySelector('a[href^="logout"]'))`)
}

async function currentUser(session) {
  return session.eval(`(() => {
    const link = document.querySelector('a[href^="user?id="]')
    return link ? new URL(link.href).searchParams.get("id") : null
  })()`)
}

export default async function hackernews(ctx) {
  const port = Number(ctx.args.port ?? 9335)
  const profile = ctx.args.profile ?? "hn"
  const saved = await ctx.readState("hn.json")
  let account = saved && !ctx.args.new ? saved : null
  let session

  try {
    session = await ctx.openPage({ port, name: profile })
    await session.goto("https://news.ycombinator.com/news")
    await session.waitFor("document.readyState === 'complete'")
  } catch (error) {
    throw new Error(`cannot reach Hacker News: ${error.message}`)
  }

  try {
    const loggedIn = await isLoggedIn(session)
    if (!loggedIn && account && ctx.args.login) {
      ctx.log(`hn: logging in as ${account.handle}`)
      await session.goto(loginUrl)
      await session.type('form:not(:has(input[name="creating"])) input[name="acct"]', account.handle)
      await session.type('form:not(:has(input[name="creating"])) input[name="pw"]', account.password)
      await session.clickByText('form:not(:has(input[name="creating"])) input[type="submit"]', "login")
      await sleepFor(ctx, 1500)
      if (!(await isLoggedIn(session))) {
        const text = (await session.text()).slice(0, 300)
        throw new Error(`login rejected: ${text.replace(/\s+/g, " ")}`)
      }
    }

    if (!(await isLoggedIn(session))) {
      const base = ctx.args.user ?? "oliviacode"
      let created = null
      const failures = []

      for (const username of candidates(base)) {
        ctx.log(`hn: creating account ${username}`)
        await session.goto(loginUrl)
        await session.type(`${createForm} input[name="acct"]`, username)
        const password = ctx.randomPassword(16)
        await session.type(`${createForm} input[name="pw"]`, password)
        await session.click(`${createForm} input[type="submit"]`)
        await sleepFor(ctx, 2500)
        await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)

        const text = (await session.text()).replace(/\s+/g, " ")
        if (await isLoggedIn(session)) {
          created = { username, password }
          break
        }
        const reason = /taken|already|invalid|too (many|long|short)|sorry|cannot|can't/i.exec(text)
        failures.push(
          `${username}: ${reason ? text.slice(Math.max(0, reason.index - 60), reason.index + 120) : text.slice(0, 160)}`,
        )
        ctx.log(`hn: ${username} rejected - ${failures.at(-1)}`)
      }

      if (!created) throw new Error(`no username accepted\n${failures.join("\n")}`)

      account = {
        platform: "hackernews",
        handle: created.username,
        password: created.password,
        profile,
        port,
        profileUrl: `https://news.ycombinator.com/user?id=${created.username}`,
        createdAt: new Date().toISOString(),
      }
      await ctx.writeState("hn.json", account)
      await ctx.saveAccount(account)
      ctx.log(`hn: account ready - ${created.username}`)
    } else {
      const user = await currentUser(session)
      ctx.log(`hn: already logged in as ${user ?? account?.handle ?? "unknown"}`)
      if (!account && user) {
        account = {
          platform: "hackernews",
          handle: user,
          password: "",
          profile,
          port,
          profileUrl: `https://news.ycombinator.com/user?id=${user}`,
        }
        await ctx.writeState("hn.json", account)
        await ctx.saveAccount(account)
      }
    }

    if (!ctx.args.submit) return account

    if (account?.postUrl) {
      ctx.log(`hn: already submitted - ${account.postUrl}`)
      return account
    }

    // A submission can land on /newest instead of returning the item id. Ask the public API
    // what this account has actually posted before adding another one.
    const existing = await findSubmission(account.handle, hnTitlePlain)
    if (existing && !existing.dead) {
      account = {
        ...account,
        postUrl: `https://news.ycombinator.com/item?id=${existing.id}`,
        title: existing.title,
        postedAt: new Date().toISOString(),
      }
      await ctx.writeState("hn.json", account)
      await ctx.saveAccount(account)
      ctx.log(`hn: post already live - ${account.postUrl}`)
      return account
    }
    if (existing?.dead) ctx.log(`hn: an existing submission is dead (${existing.id}); posting again`)

    if (!ctx.args.force) {
      const karma = await session.eval(`(() => {
        const row = [...document.querySelectorAll('tr')].find((tr) => /karma/i.test(tr.innerText))
        const link = document.querySelector('a[href^="user?id="]')
        return { karma: row ? row.innerText.replace(/\\s+/g, " ").trim() : "", user: link?.innerText ?? "" }
      })()`)
      ctx.log(`hn: session ${karma.user} ${karma.karma}`)
    }

    ctx.log("hn: opening submit form")
    const title = ctx.args.plain ? hnTitlePlain : hnTitle
    let titleUsed = title
    await session.goto("https://news.ycombinator.com/submit")
    await session.waitFor("document.querySelector('input[name=\"title\"]')", 20_000)

    await session.type('input[name="title"]', title)
    if (ctx.args.text) {
      await session.type('textarea[name="text"]', hnText)
    } else {
      await session.type('input[name="url"]', "https://github.com/9562295450/Oliviacode")
    }
    await session.click('input[type="submit"][value="submit"]')
    await sleepFor(ctx, 3000)
    await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)

    let where = await session.url()

    // Show HN is periodically closed to new accounts; /showlim says so and refuses the post.
    if (where.includes("/showlim") && !ctx.args.plain) {
      ctx.log("hn: Show HN is restricted right now, retrying as a plain submission")
      await session.goto("https://news.ycombinator.com/submit")
      await session.waitFor("document.querySelector('input[name=\"title\"]')", 20_000)
      await session.type('input[name="title"]', hnTitlePlain)
      await session.type('input[name="url"]', "https://github.com/9562295450/Oliviacode")
      await session.click('input[type="submit"][value="submit"]')
      await sleepFor(ctx, 3000)
      await session.waitFor("document.readyState === 'complete'", 20_000).catch(() => undefined)
      where = await session.url()
      titleUsed = hnTitlePlain
    }

    const text = (await session.text()).replace(/\s+/g, " ")
    const itemMatch = /item\?id=(\d+)/.exec(where)

    if (itemMatch) {
      const postUrl = `https://news.ycombinator.com/item?id=${itemMatch[1]}`
      account = { ...account, postUrl, postedAt: new Date().toISOString(), title: titleUsed }
      await ctx.writeState("hn.json", account)
      await ctx.saveAccount(account)
      ctx.log(`hn: posted - ${postUrl}`)
      return account
    }

    const rejection = /(please slow down|too many|not able|karma|can't|cannot|sorry)/i.exec(text)
    if (rejection) {
      throw new Error(`submission rejected: ${text.slice(Math.max(0, rejection.index - 100), rejection.index + 200)}`)
    }
    throw new Error(`submission unclear, ended at ${where}: ${text.slice(0, 250)}`)
  } finally {
    await session?.close()
  }
}

function sleepFor(ctx, ms) {
  return new Promise((done) => setTimeout(done, ms))
}

/** The newest submission by `handle` whose title equals `title`, or null. */
async function findSubmission(handle, title) {
  try {
    const user = await (
      await fetch(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(handle)}.json`)
    ).json()
    for (const id of (user?.submitted ?? []).slice(0, 8)) {
      const item = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json()
      if (item && item.title === title) return item
    }
  } catch {
    // Network hiccup on the check is not fatal; the caller will submit.
  }
  return null
}
