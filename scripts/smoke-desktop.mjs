/**
 * Boot the packaged desktop app on a profile that has never run before, and prove the window
 * renders. This is the check the 2.2.14 and 2.2.15 regressions did not have: both were found,
 * fixed and verified by hand on one developer's machine, with that machine's config, cache and
 * engine already installed. A clean root is the closest thing CI has to a new user.
 *
 * Usage:
 *   bun scripts/smoke-desktop.mjs                 # finds the packed app
 *   bun scripts/smoke-desktop.mjs --app <path>    # explicit executable
 *   bun scripts/smoke-desktop.mjs --keep          # leave the profile on disk for a diagnosis
 *   bun scripts/smoke-desktop.mjs --no-sandbox    # CI only: Chromium cannot sandbox on a runner
 *
 * Exit 0 means the app started, answered the devtools protocol, and painted its shell. It does
 * not assert anything about a provider: this is the "does it open at all" gate that runs before
 * an artifact is uploaded.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const keep = args.includes("--keep")
const timeoutMs = Number(flag("--timeout") ?? 90_000)
const explicit = flag("--app")
// Ubuntu 24.04 restricts unprivileged user namespaces, so Chromium's own sandbox cannot start
// on a stock runner. CI passes this; a desktop machine never needs it.
const sandbox = args.includes("--no-sandbox") ? ["--no-sandbox"] : []

/** The packed app, per platform. electron-builder's output folder is named by target and arch. */
function candidates() {
  const packageJson = JSON.parse(readFileSync(join(root, "packages/desktop/package.json"), "utf8"))
  const product = packageJson.build?.productName ?? "Oliviacode"
  // The prod Linux executable is the appId with its trailing `.desktop` stripped, so an
  // AppImage launcher cannot mistake the binary for a desktop entry.
  const appId = process.env.OLIVIACODE_APP_ID ?? "ai.oliviacode.desktop"
  const linuxBinary = appId.replace(/\.desktop$/, "")
  if (process.platform === "win32") {
    return [
      join(root, "dist/desktop/app", `${product}.exe`),
      join(root, "dist/desktop/win-unpacked", `${product}.exe`),
      join(root, "packages/desktop/dist/win-unpacked", `${product}.exe`),
    ]
  }
  if (process.platform === "darwin") {
    return ["mac-arm64", "mac", "mac-x64", "mac-universal"].map((dir) =>
      join(root, "packages/desktop/dist", dir, `${product}.app/Contents/MacOS/${product}`),
    )
  }
  return [
    join(root, "packages/desktop/dist/linux-unpacked", linuxBinary),
    join(root, "packages/desktop/dist/linux-unpacked", product.toLowerCase()),
    join(root, "dist/desktop/app", linuxBinary),
    join(root, "dist/desktop/linux-unpacked", linuxBinary),
  ]
}

function locate() {
  if (explicit) {
    const path = resolve(explicit)
    if (!existsSync(path)) throw new Error(`--app does not exist: ${path}`)
    return path
  }
  const tried = candidates()
  const found = tried.find((path) => existsSync(path))
  if (!found) {
    throw new Error(`no packed app found. Looked in:\n${tried.map((path) => `  ${path}`).join("\n")}`)
  }
  return found
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitForPage(port, deadline) {
  let last = ""
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) })
      const pages = await response.json()
      const page = pages.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl)
      if (page) return page
      last = `no page yet (${pages.length} targets)`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(500)
  }
  throw new Error(`devtools did not answer in ${Math.round(timeoutMs / 1000)}s: ${last}`)
}

/**
 * The devtools target exists as soon as the window is created, which is before the renderer has
 * run a single line. Poll the page itself until it has painted, so a slow first boot on a clean
 * profile is not read as a broken shell.
 */
async function waitForShell(page, deadline) {
  let last = { url: "", text: "", nodes: 0 }
  while (Date.now() < deadline) {
    const rendered = await evaluate(
      page.webSocketDebuggerUrl,
      `(() => {
        const body = document.body
        return {
          url: location.href,
          text: body ? body.innerText.slice(0, 4000) : "",
          nodes: body ? body.querySelectorAll("*").length : 0,
        }
      })()`,
    ).catch(() => null)
    if (rendered) {
      last = rendered
      if (rendered.nodes > 100 && rendered.text.trim().length > 20) return rendered
    }
    await sleep(500)
  }
  return last
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolveValue, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error("evaluate timed out"))
    }, 15_000)

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      )
    })
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message ?? "protocol error"))
      if (message.result?.exceptionDetails) {
        return reject(new Error(message.result.exceptionDetails.text ?? "renderer threw"))
      }
      resolveValue(message.result?.result?.value)
    })
    socket.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("devtools socket failed"))
    })
  })
}

const executable = locate()
const profile = mkdtempSync(join(tmpdir(), "oliviacode-smoke-"))
const devtools = await freePort()
const service = await freePort()

const started = Date.now()
const child = spawn(executable, [`--remote-debugging-port=${devtools}`, "--no-first-run", ...sandbox], {
  env: {
    ...process.env,
    // A root that has never held a config, a credential, a cache or a provisioned engine.
    OPENCODE_DESKTOP_TEST_ROOT: profile,
    OLIVIACODE_SERVICE_PORT: String(service),
    ELECTRON_ENABLE_LOGGING: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
})

let output = ""
child.stdout.on("data", (chunk) => {
  output += String(chunk)
})
child.stderr.on("data", (chunk) => {
  output += String(chunk)
})

const exited = new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })))

function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === "win32" && child.pid) {
    // Electron's helper processes are children of this pid; a bare kill leaves them holding the
    // app binaries, which then blocks the next pack.
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
  } else {
    child.kill()
  }
  // Windows gives a window process children; the app's own quit path handles them, but a
  // hung instance must not leave the runner waiting.
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL")
  }, 10_000).unref?.()
}

/** A profile held by a still-closing helper is not a failed boot; the temp dir can wait. */
async function cleanup() {
  if (keep) return
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true })
      return
    } catch {
      await sleep(500)
    }
  }
}

const fail = async (message) => {
  stop()
  await Promise.race([exited, sleep(12_000)])
  console.error(`FAIL ${message}`)
  if (output.trim()) console.error(`\n--- app output ---\n${output.slice(-4_000)}`)
  console.error(`profile: ${profile}${keep ? "" : " (removed)"}`)
  await cleanup()
  process.exit(1)
}

const race = await Promise.race([
  waitForPage(devtools, Date.now() + timeoutMs).then((page) => ({ page })),
  exited.then((state) => ({ state })),
])

if (race.state) await fail(`the app exited before it rendered (code ${race.state.code}, signal ${race.state.signal})`)

const rendered = await waitForShell(race.page, Date.now() + timeoutMs)

if (!rendered.url) await fail("renderer did not answer")
if (!/oc:\/\/|localhost/.test(rendered.url)) await fail(`window opened an unexpected url: ${rendered.url}`)
if (rendered.text.trim().length < 20) await fail(`the shell painted nothing (${rendered.nodes} nodes)`)
if (!/new session|oliviacode/i.test(rendered.text)) {
  await fail(`the shell painted unexpected text: ${JSON.stringify(rendered.text.slice(0, 200))}`)
}

const version = JSON.parse(readFileSync(join(root, "packages/desktop/package.json"), "utf8")).version
const reached = Date.now() - started

stop()
await Promise.race([exited, sleep(12_000)])
await cleanup()

console.log(`ok        ${executable}`)
console.log(`ok        clean profile rendered in ${reached}ms (${rendered.nodes} nodes)`)
console.log(`ok        version under test ${version}`)
