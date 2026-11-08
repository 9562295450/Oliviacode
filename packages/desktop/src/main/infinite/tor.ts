/**
 * Tor as an egress lane, with circuit rotation done properly.
 *
 * A new circuit is a control-port `SIGNAL NEWNYM`, not a process restart. The daemon
 * already holds open connections to its guards; asking it for a new circuit is one
 * round trip, while killing and re-bootstrapping costs the whole startup every time.
 *
 * The bundled CLI cannot speak SOCKS, so the daemon's SOCKS port is fronted by the
 * local bridge in `socks-bridge.ts`.
 */
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { connect } from "node:net"
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

const SOCKS_PORT = 9050
const CONTROL_PORT = 9051
const BRIDGE_PORT = 8118
const BOOTSTRAP_TIMEOUT_MS = 180_000

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

  get endpoint() {
    return this.#bridge?.url ?? ""
  }

  get running() {
    return this.#child !== null && this.#child.exitCode === null
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
      detail: this.#log.at(-1) ?? (installed ? "installed" : "not installed"),
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
    if (this.running && this.#bridge) return ""

    const installed = await this.ensureInstalled(onProgress)
    if (installed) return installed

    onProgress?.("starting tor")

    const dataDir = join(this.#root(), "data")
    mkdirSync(dataDir, { recursive: true })

    const child = spawn(
      this.#path(),
      [
        "--SocksPort",
        `${SOCKS_PORT}`,
        "--ControlPort",
        `${CONTROL_PORT}`,
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
    this.#bootstrapped = false
    this.#log = []

    const record = (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        this.#log.push(line)
        if (this.#log.length > 200) this.#log.shift()
        if (/Bootstrapped 100%/.test(line)) this.#bootstrapped = true
      }
    }

    child.stdout?.on("data", record)
    child.stderr?.on("data", record)
    child.on("exit", () => {
      this.#bootstrapped = false
    })

    const deadline = Date.now() + BOOTSTRAP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.#bootstrapped) break
      if (child.exitCode !== null) return `tor exited during bootstrap: ${this.#log.at(-1) ?? "no output"}`
      await sleep(400)
    }

    if (!this.#bootstrapped) {
      return `tor did not bootstrap within ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)}s`
    }

    onProgress?.("bridging socks to http")
    this.#bridge = await startBridge({ socksHost: "127.0.0.1", socksPort: SOCKS_PORT, port: BRIDGE_PORT })
    return ""
  }

  /**
   * Ask for a new circuit. Tor reuses an exit for up to ten minutes by default, so the
   * request is followed by a short wait; a caller that needs a provably different exit
   * compares the trace address afterwards, exactly like every other lane.
   */
  async rotate(): Promise<{ ok: boolean; error: string }> {
    if (!this.running) {
      const started = await this.start()
      if (started) return { ok: false, error: started }
    }

    const signal = await sendControl(`SIGNAL NEWNYM`)
    if (signal) return { ok: false, error: signal }

    // NEWNYM closes the current circuits; Tor needs a moment to build the next one.
    await sleep(1_500)
    return { ok: true, error: "" }
  }

  async stop(): Promise<void> {
    if (this.#bridge) {
      await this.#bridge.stop().catch(() => undefined)
      this.#bridge = null
    }
    if (this.#child && this.#child.exitCode === null) {
      this.#child.kill()
      this.#child = null
    }
    this.#bootstrapped = false
  }
}

/**
 * One control-port command: connect, authenticate with the no-password handshake the
 * daemon was started with, send the signal, read the reply. Returns "" on success.
 */
function sendControl(command: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: CONTROL_PORT })
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

/** True when the daemon binary is present and old enough to be a real unpack. */
export function torInstalled(path: string) {
  try {
    return statSync(path).size > 1_000_000
  } catch {
    return false
  }
}
