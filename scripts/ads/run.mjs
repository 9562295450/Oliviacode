#!/usr/bin/env node
/**
 * Advertisement and account harness.
 *
 * Free channels only. Nothing here spends money, and nothing here shows a window: the browser
 * it drives is ghost's, which renders onto a private Win32 desktop.
 *
 *   node scripts/ads/run.mjs smoke            # prove the CDP socket and the inbox clients
 *   node scripts/ads/run.mjs mail             # mint a disposable inbox and print the address
 *   node scripts/ads/run.mjs hn               # create a Hacker News account through the browser
 *   node scripts/ads/run.mjs hn --submit      # submit the Show HN post on that account
 *   node scripts/ads/run.mjs bsky             # create a Bluesky account over the ATProto API and post
 *   node scripts/ads/run.mjs mastodon         # sign up on an open Mastodon instance, confirm, post
 *   node scripts/ads/run.mjs accounts         # list what exists, without secrets
 *
 * State - addresses, passwords, tokens - lands in `scripts/ads/state/`, which .gitignore covers.
 */
import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { openSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInbox } from "./lib/mail.mjs"
import { openTab } from "./lib/cdp.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..", "..")
const stateDir = join(here, "state")
const ghostScript = join(root, "scripts", "ghost", "ghost.ps1")

const log = (...parts) => console.log(...parts)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item.startsWith("--")) {
      const [key, inline] = item.slice(2).split("=")
      if (inline !== undefined) args[key] = inline
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[key] = argv[++i]
      else args[key] = true
    } else {
      args._.push(item)
    }
  }
  return args
}

async function ghostAlive(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/** Start ghost on `port` if nothing is listening there, then wait for its endpoint. */
async function ensureGhost({ port = 9333, name = "bench", browser, timeoutMs = 150_000 } = {}) {
  const running = await ghostAlive(port)
  if (running) return running

  await mkdir(stateDir, { recursive: true })
  const logPath = join(stateDir, `ghost-${port}.log`)
  const out = openSync(logPath, "a")

  log(`ghost: starting profile "${name}" on port ${port} (log: ${logPath})`)
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ghostScript,
    "-Command",
    "launch",
    "-Name",
    name,
    "-Port",
    String(port),
  ]
  if (browser) args.push("-Browser", browser)

  const child = spawn("powershell", args, { stdio: ["ignore", out, out], windowsHide: true })
  const exited = new Promise((resolve) => child.once("exit", resolve))

  const deadline = Date.now() + timeoutMs
  let done = false
  exited.then(() => {
    done = true
  })
  while (Date.now() < deadline) {
    const up = await ghostAlive(port)
    if (up) return up
    if (done) break
    await sleep(750)
  }
  const tail = await readFile(logPath, "utf8").catch(() => "")
  throw new Error(
    `ghost did not open port ${port} within ${timeoutMs}ms\n${tail.trim().split("\n").slice(-8).join("\n")}`,
  )
}

async function openPage({ port = 9333, name = "bench", browser }) {
  await ensureGhost({ port, name, browser })
  return openTab(port)
}

function randomPassword(length = 18) {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let out = ""
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `${out}!7a`
}

async function readState(file) {
  try {
    return JSON.parse(await readFile(join(stateDir, file), "utf8"))
  } catch {
    return null
  }
}

async function writeState(file, value) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, file), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

/** Append or replace one account record, keyed by platform + handle. */
async function saveAccount(record) {
  const accounts = (await readState("accounts.json")) ?? []
  const key = `${record.platform}:${record.handle}`
  const next = accounts.filter((item) => `${item.platform}:${item.handle}` !== key)
  next.push({ ...record, savedAt: new Date().toISOString() })
  await writeState("accounts.json", next)
  return next
}

// ---------------------------------------------------------------------------------------------
// smoke

async function smoke(args) {
  const port = Number(args.port ?? 9333)
  const version = await ensureGhost({ port, name: args.name ?? "bench" })
  log(`ghost: ${version.Browser} on port ${port}`)

  const session = await openTab(port)
  try {
    await session.goto("https://example.com/")
    const facts = await session.eval(`JSON.stringify({
      title: document.title,
      ua: navigator.userAgent,
      webdriver: navigator.webdriver,
      screen: [screen.width, screen.height],
      viewport: [innerWidth, innerHeight],
    })`)
    log(`page: ${facts}`)

    const shot = join(stateDir, "smoke.png")
    await mkdir(stateDir, { recursive: true })
    await session.screenshot(shot)
    log(`screenshot: ${shot}`)
  } finally {
    await session.close()
  }

  const inbox = await createInbox()
  log(`inbox: ${inbox.provider} ${inbox.address}`)
  await writeState("smoke-inbox.json", { provider: inbox.provider, address: inbox.address, password: inbox.password })
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------
// mail

async function mail(args) {
  const inbox = await createInbox(args.provider ? [args.provider] : undefined)
  log(`provider: ${inbox.provider}`)
  log(`address:  ${inbox.address}`)
  if (inbox.password) log(`password: ${inbox.password}`)
  await writeState("last-inbox.json", { provider: inbox.provider, address: inbox.address, password: inbox.password })
}

// ---------------------------------------------------------------------------------------------
// inspect

/** Map a page's forms, fields and buttons, and leave a screenshot behind. */
async function inspect(args) {
  const url = args._[1] ?? args.url
  if (!url) throw new Error("inspect needs a URL")
  const port = Number(args.port ?? 9333)
  const profile = args.profile ?? "bench"
  const session = await openPage({ port, name: profile })
  try {
    await session.goto(url)
    await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
    const map = await session.eval(`JSON.stringify({
      title: document.title,
      url: location.href,
      forms: [...document.forms].map((form) => ({
        action: form.action,
        method: form.method,
        fields: [...form.elements].filter((el) => el.name).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type, name: el.name, placeholder: el.placeholder || "", label: (el.labels?.[0]?.innerText || "").trim().slice(0, 60) })),
        buttons: [...form.querySelectorAll('button, input[type=submit]')].map((el) => (el.innerText || el.value || "").trim().slice(0, 60)),
      })),
      links: [...document.querySelectorAll('a[href]')].slice(0, 40).map((a) => ({ text: (a.innerText || "").trim().slice(0, 60), href: a.href })),
    }, null, 1)`)
    log(map)
    const shot = join(stateDir, `${args.name ?? "inspect"}.png`)
    await mkdir(stateDir, { recursive: true })
    await session.screenshot(shot)
    log(`screenshot: ${shot}`)
  } finally {
    await session.close()
  }
}

/**
 * What the browser says about itself, and whether the two halves agree.
 *
 * A user agent that claims Chrome while navigator.userAgentData.brands lists Chromium and nothing
 * else is a contradiction any risk engine reads in one line. Chrome Stable always advertises a
 * "Google Chrome" brand; Chrome for Testing does not, and the infobar saying "only for automated
 * testing" is the visible half of the same fact.
 */
async function identity(args) {
  const port = Number(args.port ?? 9333)
  await ensureGhost({ port, name: args.name ?? "bench", browser: args.browser })
  const session = await openTab(port)
  try {
    const version = await session.send("Browser.getVersion", {})
    await session.goto("https://example.com/")
    await sleep(1500)
    const raw = await session.eval(`(async () => {
      const ua = navigator.userAgentData
      const high = ua ? await ua.getHighEntropyValues(["fullVersionList"]) : null
      return JSON.stringify({
        ua: navigator.userAgent,
        brands: ua ? ua.brands : null,
        fullVersionList: high ? high.fullVersionList : null,
        webdriver: navigator.webdriver,
      })
    })()`)
    const info = JSON.parse(raw)
    log(`product: ${version.product}`)
    log(`ua: ${info.ua}`)
    log(`brands: ${JSON.stringify(info.brands)}`)
    log(`full: ${JSON.stringify(info.fullVersionList)}`)

    const brands = info.brands ?? []
    const claimsEdge = /Edg\//.test(info.ua)
    const claimsChrome = !claimsEdge && /Chrome\//.test(info.ua)
    const saysEdge = brands.some((entry) => /Microsoft Edge/i.test(entry.brand))
    const saysChrome = brands.some((entry) => /Google Chrome/i.test(entry.brand))

    if (claimsEdge && !saysEdge) log("identity: FAIL - UA claims Edge, brands do not")
    else if (claimsChrome && !saysChrome)
      log("identity: FAIL - UA claims Chrome, brands say Chromium only (automation build)")
    else if (info.webdriver) log("identity: FAIL - navigator.webdriver is true")
    else log("identity: consistent")
  } finally {
    await session.close()
  }
}

// ---------------------------------------------------------------------------------------------
// look

/**
 * Screenshot the page and print the path. Nothing else.
 *
 * This is the observation step, and it exists because reading `innerText` is not seeing. The DOM
 * says what the document contains; the image says what is on the screen — which pane is scrolled
 * where, what sits above the fold, whether an overlay is covering the button, whether the page
 * that answered is the page that was asked for. Look at the file before acting on it.
 */
async function look(args) {
  const url = args._[1] ?? args.url
  const port = Number(args.port ?? 9333)
  const session = await openPage({ port, name: args.profile ?? args.name ?? "bench", browser: args.browser })
  try {
    if (args.width || args.height) {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: Number(args.width ?? 1440),
        height: Number(args.height ?? 900),
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (url) {
      await session.goto(url)
      await session.waitFor("document.readyState === 'complete'", 30_000).catch(() => undefined)
      await sleep(Number(args.settle ?? 3000))
    }
    await mkdir(stateDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const shot = join(stateDir, args.out ?? `look-${port}-${stamp}.png`)
    await session.screenshot(shot)
    log(shot)
  } finally {
    await session.close()
  }
}

// ---------------------------------------------------------------------------------------------
// channels
async function channel(name) {
  const module = await import(`./channels/${name}.mjs`)
  return module.default
}

async function main() {
  const argv = parseArgs(process.argv.slice(2))
  const command = argv._[0] ?? "smoke"

  const context = {
    args: argv,
    log,
    sleep,
    openPage,
    ensureGhost,
    ghostAlive,
    createInbox,
    randomPassword,
    readState,
    writeState,
    saveAccount,
    stateDir,
  }

  if (command === "smoke") return smoke(argv)
  if (command === "mail") return mail(argv)
  if (command === "inspect") return inspect(argv)
  if (command === "look") return look(argv)
  if (command === "identity") return identity(argv)
  if (command === "accounts") {
    const accounts = (await readState("accounts.json")) ?? []
    if (!accounts.length) return log("no accounts recorded yet")
    for (const account of accounts) {
      log(
        `${account.platform.padEnd(9)} ${String(account.handle).padEnd(28)} ${account.postUrl ?? account.profileUrl ?? ""}`,
      )
    }
    return undefined
  }

  if (["hn", "bsky", "mastodon", "devto", "telegraph", "writeas", "reddit"].includes(command)) {
    const handler = await channel(command)
    return handler(context)
  }

  log(`unknown command: ${command}`)
  log(
    "commands: smoke | identity | look | mail | inspect | hn | bsky | mastodon | devto | telegraph | reddit | accounts",
  )
  process.exitCode = 2
}

main().catch((error) => {
  console.error(`ads: ${error.message}`)
  if (process.env.ADS_DEBUG) console.error(error.stack)
  process.exitCode = 1
})
