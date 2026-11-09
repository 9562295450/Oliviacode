/**
 * Tor as an egress lane, with circuit rotation done properly.
 *
 * A new circuit is a control-port `SIGNAL NEWNYM`, not a process restart. The daemon
 * already holds open connections to its guards; asking it for a new circuit is one
 * round trip, while killing and re-bootstrapping costs the whole startup every time.
 *
 * The bundled CLI cannot speak SOCKS, so the daemon's SOCKS port is fronted by the
 * local bridge in `socks-bridge.ts`.
 *
 * Ports are allocated per start and the daemon is shut down through its control port, so
 * a second instance of the app, a crashed run, or a local Tor Browser cannot wedge the
 * lane on a fixed port or a stale data-directory lock.
 */
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { createServer, connect } from "node:net"
import { join } from "node:path"
import { app } from "electron"
import { run } from "./exec"
import { startBridge, type Bridge } from "./socks-bridge"
import { sleep } from "./warp"

/**
 * The Windows Expert Bundle. Pinned by version and checked by size, so a redirect to an
 * error page cannot be unpacked into the app's data directory.
 */
const BUNDLE_URL =
  "https://archive.torproject.org/tor-package-archive/torbrowser/14.5.7/tor-expert-bundle-windows-x86_64-14.5.7.tar.gz"
const MIN_BUNDLE_BYTES = 5_000_000

const BOOTSTRAP_TIMEOUT_MS = 180_000
const SHUTDOWN_TIMEOUT_MS = 5_000

type Ports = {
  readonly socks: number
  readonly control: number
  readonly bridge: number
}

type Attempt = {
  readonly error: string
  /** A failure another data directory or a fresh port pair can plausibly clear. */
  readonly retryable: boolean
}

export type TorStatus = {
  readonly installed: boolean
  readonly running: boolean
  readonly bootstrapped: boolean
  readonly detail: string
}

export class Tor {
  #child: ReturnType<typeof spawn> | null = null
  #bridge: Bridge | null = null
  #bootstrapped = false
  #log: string[] = []
  #ports: Ports | null = null
  #starting: Promise<string> | null = null
  #spawnError = ""

  get endpoint() {
    return this.#bridge?.url ?? ""
  }

  get running() {
    return this.#child !== null && this.#child.exitCode === null
  }

  /** The loopback ports this start resolved, for the diagnostics panel. */
  get ports(): Ports | null {
    return this.#ports
  }

  #root() {
    return join(app.getPath("userData"), "egress", "tor")
  }

  #path() {
    return join(this.#root(), "tor", "tor.exe")
  }

  async status(): Promise<TorStatus> {
    const installed = existsSync(this.#path())
    return {
      installed,
      running: this.running,
      bootstrapped: this.#bootstrapped,
      detail: describeLog(this.#log, 1)[0] ?? (installed ? "installed" : "not installed"),
    }
  }

  /**
   * Fetch and unpack the Expert Bundle. `tar.exe` is bsdtar, which ships with Windows 10
   * and later, so nothing here needs a package manager or a bundled archiver.
   */
  async ensureInstalled(onProgress?: (line: string) => void): Promise<string> {
    if (existsSync(this.#path())) return ""

    mkdirSync(this.#root(), { recursive: true })
    const archive = join(this.#root(), "tor-expert-bundle.tar.gz")

    onProgress?.("downloading the Tor Expert Bundle")

    // The bundle is fetched on the direct route before any lane is up, so this call has no
    // proxy budget behind it. A deadline keeps a stalled mirror from wedging a rotation.
    const response = await fetch(BUNDLE_URL, { redirect: "follow", signal: AbortSignal.timeout(120_000) })
    if (!response.ok) return `bundle download failed: HTTP ${response.status}`

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < MIN_BUNDLE_BYTES) {
      return `bundle download was ${bytes.byteLength} bytes, below the ${MIN_BUNDLE_BYTES} byte floor`
    }

    const { writeFileSync } = await import("node:fs")
    writeFileSync(archive, bytes)

    onProgress?.("unpacking")
    const tar = await run("tar.exe", ["-xzf", archive, "-C", this.#root()], { timeoutMs: 120_000 })
    if (tar.code !== 0) return `unpack failed: ${tar.stderr.trim() || `tar exit ${tar.code}`}`

    if (!existsSync(this.#path())) return `unpack finished but ${this.#path()} is missing`

    try {
      chmodSync(this.#path(), 0o755)
    } catch {
      // Windows ignores the bit; a read-only file would not have unpacked.
    }

    rmSync(archive, { force: true })
    return ""
  }

  /** Start the daemon and its HTTP bridge, waiting for a usable circuit. */
  async start(onProgress?: (line: string) => void): Promise<string> {
    if (this.running && this.#bridge && this.#bootstrapped) return ""
    // Two lanes can ask for Tor at once; one daemon means one bootstrap, one answer.
    if (this.#starting) return this.#starting
    this.#starting = this.#launch(onProgress).finally(() => {
      this.#starting = null
    })
    return this.#starting
  }

  async #launch(onProgress?: (line: string) => void): Promise<string> {
    const installed = await this.ensureInstalled(onProgress)
    if (installed) return installed

    onProgress?.("starting tor")

    // A run that was killed without a clean shutdown leaves its daemon holding the lock
    // on the shared data directory. Retry once on a pristine one instead of failing.
    const primary = await this.#attempt(join(this.#root(), "data"), onProgress)
    if (!primary.error) {
      this.#prune(join(this.#root(), "data"))
      return ""
    }

    if (!primary.retryable) return primary.error

    onProgress?.("retrying tor on a fresh data directory")
    const fresh = join(this.#root(), `data-${Date.now()}`)
    const retry = await this.#attempt(fresh, onProgress)
    if (retry.error) return `${primary.error} | retry: ${retry.error}`

    this.#prune(fresh)
    return ""
  }

  /** One spawn + bootstrap + bridge on `dataDir`. Ports are allocated fresh each time. */
  async #attempt(dataDir: string, onProgress?: (line: string) => void): Promise<Attempt> {
    try {
      mkdirSync(dataDir, { recursive: true })
    } catch (error) {
      return { error: `cannot create the tor data directory: ${message(error)}`, retryable: false }
    }

    let socks: number
    let control: number
    try {
      socks = await freePort()
      control = await freePort(socks)
    } catch (error) {
      return { error: `no free loopback port for tor: ${message(error)}`, retryable: false }
    }

    this.#spawnError = ""
    this.#log = []
    this.#bootstrapped = false

    const child = spawn(
      this.#path(),
      [
        "--SocksPort",
        `${socks}`,
        "--ControlPort",
        `${control}`,
        // Loopback control with no password: the listener is bound to 127.0.0.1 and the
        // only client is this process. Anything else would need a secret to distribute.
        "--CookieAuthentication",
        "0",
        "--DataDirectory",
        dataDir,
        "--Log",
        "notice stdout",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false },
    )

    this.#child = child

    const record = (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      for (const line of text.split(/\r?\n/)) {
        const clean = stripStamp(line)
        if (!clean) continue
        this.#log.push(clean)
        if (this.#log.length > 200) this.#log.shift()
        if (/Bootstrapped 100%/.test(clean)) this.#bootstrapped = true
      }
    }

    child.stdout?.on("data", record)
    child.stderr?.on("data", record)
    child.on("error", (error) => {
      this.#spawnError = message(error)
    })
    child.on("exit", () => {
      this.#bootstrapped = false
    })

    const deadline = Date.now() + BOOTSTRAP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.#bootstrapped) break
      if (this.#spawnError) return this.#fail(`tor could not be spawned: ${this.#spawnError}`)
      if (child.exitCode !== null) return this.#fail(exitReason(this.#log, child.exitCode))
      await sleep(400)
    }

    if (!this.#bootstrapped) {
      await this.#kill(child)
      return this.#fail(`tor did not bootstrap within ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)}s`)
    }

    onProgress?.("bridging socks to http")

    // Port 0 lets the OS pick a bridge port, so a stale listener on the old fixed 8118
    // (or a second copy of the app) cannot collide with this one.
    let bridge: Bridge
    try {
      bridge = await startBridge({ socksHost: "127.0.0.1", socksPort: socks, port: 0 })
    } catch (error) {
      await this.stop()
      return this.#fail(`the local bridge could not listen: ${message(error)}`)
    }

    this.#bridge = bridge
    this.#ports = { socks, control, bridge: bridge.port }
    return { error: "", retryable: false }
  }

  #fail(error: string): Attempt {
    const lower = error.toLowerCase()
    const retryable =
      /could not lock|lock file|already running|another tor/.test(lower) ||
      /address already in use|couldn't bind|could not bind|error binding|failed to bind/.test(lower)
    return { error, retryable }
  }

  /**
   * Ask for a new circuit. Tor reuses an exit for up to ten minutes by default, so the
   * request is followed by a short wait; a caller that needs a provably different exit
   * compares the trace address afterwards, exactly like every other lane.
   */
  async rotate(): Promise<{ ok: boolean; error: string }> {
    if (!this.running || !this.#ports) {
      const started = await this.start()
      if (started) return { ok: false, error: started }
    }

    if (!this.#ports) return { ok: false, error: "tor control port is not resolved" }

    const signal = await sendControl(this.#ports.control, "SIGNAL NEWNYM")
    if (signal) return { ok: false, error: signal }

    // NEWNYM closes the current circuits; Tor needs a moment to build the next one.
    await sleep(1_500)
    return { ok: true, error: "" }
  }

  async stop(): Promise<void> {
    const bridge = this.#bridge
    this.#bridge = null
    if (bridge) await bridge.stop().catch(() => undefined)

    const child = this.#child
    const ports = this.#ports
    this.#child = null
    this.#ports = null
    this.#bootstrapped = false

    if (!child || child.exitCode !== null) return

    // A clean shutdown releases the data-directory lock and the port bindings, so the
    // next launch starts from a warm directory instead of a wedged one.
    if (ports) await sendControl(ports.control, "SIGNAL SHUTDOWN").catch(() => "control unavailable")
    if (await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) return
    await this.#kill(child)
  }

  async #kill(child: ReturnType<typeof spawn>): Promise<void> {
    if (child.exitCode !== null) return
    try {
      child.kill()
    } catch {
      // Already gone between the check and the signal.
    }
    await waitForExit(child, SHUTDOWN_TIMEOUT_MS)
  }

  /** Drop data directories left behind by retries, keeping the one just used. */
  #prune(keep: string) {
    let entries: string[] = []
    try {
      entries = readdirSync(this.#root())
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.startsWith("data-")) continue
      const path = join(this.#root(), name)
      if (path === keep) continue
      try {
        rmSync(path, { recursive: true, force: true })
      } catch {
        // A directory a leaked daemon still holds is left for the next run.
      }
    }
  }
}

/** True when the daemon binary is present and old enough to be a real unpack. */
export function torInstalled(path: string) {
  try {
    return statSync(path).size > 1_000_000
  } catch {
    return false
  }
}

/** A loopback port the OS says is free right now, avoiding `taken`. */
function freePort(taken?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => {
        if (port > 0 && port !== taken) resolve(port)
        else freePort(taken).then(resolve, reject)
      })
    })
  })
}

/** `Nov 10 03:19:32.238 [notice] ...` becomes `[notice] ...`. */
function stripStamp(line: string) {
  return line.replace(/^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+/, "").trim()
}

function describeLog(lines: readonly string[], limit: number) {
  return lines
    .map(stripStamp)
    .filter((line) => line && !line.includes("Tor can't help you if you use it wrong"))
    .slice(-limit)
}

/** Map the last few daemon lines to a cause the egress panel can show as-is. */
function exitReason(lines: readonly string[], code: number | null): string {
  const all = lines.join("\n")
  const tail = describeLog(lines, 3).join(" | ") || "no output"

  if (/could not lock|lock file|is already running|another tor/i.test(all))
    return `tor could not lock its data directory: ${tail} (another instance is still running)`
  if (/address already in use|couldn't bind|could not bind|error binding|failed to bind/i.test(all))
    return `tor could not bind a loopback port: ${tail}`
  if (/permission denied|access is denied|operation not permitted|0xc0000022/i.test(all))
    return `the system blocked tor from running: ${tail}`
  return `tor exited${code === null ? "" : ` (code ${code})`} during bootstrap: ${tail}`
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, timeoutMs)
    function onExit() {
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
  })
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * One control-port command: connect, authenticate with the no-password handshake the
 * daemon was started with, send the signal, read the reply. Returns "" on success.
 */
function sendControl(port: number, command: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    let buffer = ""
    let replied = false

    const timer = setTimeout(() => {
      socket.destroy()
      resolve("tor control port timed out")
    }, 10_000)

    socket.on("connect", () => socket.write("AUTHENTICATE\r\n"))

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")

      if (!replied && buffer.includes("250 OK")) {
        replied = true
        buffer = ""
        socket.write(`${command}\r\n`)
        return
      }

      if (buffer.includes("250 OK")) {
        clearTimeout(timer)
        socket.end()
        resolve("")
      } else if (/^5\d\d /m.test(buffer)) {
        clearTimeout(timer)
        socket.destroy()
        resolve(`tor control rejected ${command}: ${buffer.trim().split(/\r?\n/)[0] ?? "no reply"}`)
      }
    })

    socket.on("error", (error) => {
      clearTimeout(timer)
      resolve(`tor control unavailable: ${error.message}`)
    })
  })
}
