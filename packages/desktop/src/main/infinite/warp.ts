/**
 * Cloudflare WARP as an egress lane.
 *
 * A WARP rotation is a fresh registration: delete the current one, register again, put
 * the tunnel in proxy mode and wait for the daemon to report connected. The exit address
 * changes because the registration does — not because anything is spoofed.
 *
 * Proxy mode opens a loopback listener on the daemon's proxy port. That listener answers
 * HTTP on the client built here; older documented builds describe it as SOCKS5 only. The
 * lane probes the port and hands back that URL when it answers, falling back to a local
 * HTTP bridge in front of it (`socks-bridge.ts`) when it does not. Without the fallback
 * the app would be pointed at an HTTP proxy URL that only speaks SOCKS — up, and unusable.
 *
 * The call budgets here are deliberately generous where the daemon is slow. A cold
 * `registration new` routinely takes longer than fifteen seconds while the client
 * renegotiates, and killing it mid-flight leaves the registration half-written, which
 * then makes `delete` fail with "Missing registration".
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import { run, which, type RunResult } from "./exec"
import { startBridge, type Bridge } from "./socks-bridge"
import { probe } from "./trace"

/** `registration new` renegotiates keys and reconnects; it is never a quick call. */
const REGISTER_TIMEOUT_MS = 120_000
/** Status and mode switches are local IPC to the daemon and answer immediately. */
const CONTROL_TIMEOUT_MS = 20_000
const CONNECT_TIMEOUT_MS = 60_000
/** Long enough for a cold tunnel to carry one trace, short enough to fail while the user watches. */
const PROBE_TIMEOUT_MS = 20_000

const CANDIDATES = [
  "C:\\Program Files\\Cloudflare\\Cloudflare WARP\\warp-cli.exe",
  "C:\\Program Files\\Cloudflare\\Cloudflare One Client\\warp-cli.exe",
  "C:\\Program Files (x86)\\Cloudflare\\Cloudflare WARP\\warp-cli.exe",
  "C:\\Program Files (x86)\\Cloudflare\\Cloudflare One Client\\warp-cli.exe",
]

/** The vendor directory the installer picks. The binary's folder is read, not guessed. */
const INSTALL_DIRS = ["C:\\Program Files\\Cloudflare", "C:\\Program Files (x86)\\Cloudflare"]

/** The name a PATH entry would carry, for an install that did not use the default folder. */
const NAMES = ["warp-cli.exe", "warp-cli"]

/** What the daemon says when it has no registration yet. Every fresh install answers this. */
const MISSING_REGISTRATION = /missing registration|not registered|no registration/i

/** A missing binary is looked for again after this long, so a fresh install needs no relaunch. */
const MISSING_RECHECK_MS = 15_000

/** Where the client that provides `warp-cli` comes from. Shown in the lane failure text. */
const INSTALL_URL = "https://1.1.1.1/"

/** The failure a lane with no client installed reports. Actionable, so the fix is one click. */
const NOT_INSTALLED = `Cloudflare WARP is not installed. Install it from ${INSTALL_URL}, then select the WARP lane again.`

export type WarpStatus = {
  readonly found: boolean
  readonly connected: boolean
  readonly detail: string
}

export class Warp {
  #binary: string | null = null
  #missedAt = 0
  /** The daemon's proxy port, opened on loopback by `mode proxy`. */
  #port = 40000
  #endpoint = ""
  #bridge: Bridge | null = null
  #rotations = 0

  get port() {
    return this.#port
  }

  /** The loopback HTTP proxy this lane hands the app, or "" before prepare succeeds. */
  get endpoint() {
    return this.#endpoint
  }

  /**
   * Decide what gets handed to the app: the daemon's port when it answers HTTP, or a
   * local bridge in front of it when it only speaks SOCKS5.
   *
   * The build installed here serves HTTP on its proxy port, and a bridge in that case
   * costs a listener and a hop for nothing. Older builds documented `mode proxy` as
   * SOCKS5 only, so the probe decides per machine instead of per assumption.
   */
  async #resolveEndpoint(port: number): Promise<string> {
    await this.#stopBridge()
    this.#endpoint = ""

    const direct = `http://127.0.0.1:${port}`
    const answered = await probe(direct, PROBE_TIMEOUT_MS)

    if (answered.ok) {
      this.#endpoint = direct
      return ""
    }

    const bridged = await this.#bridgeTo(port)
    if (bridged) return bridged

    await this.#stopBridge()
    this.#endpoint = ""
    return `Cloudflare WARP is connected, but its local proxy on 127.0.0.1:${port} did not answer: ${answered.error}. Restart the WARP client, then select the WARP lane again.`
  }

  /** Build the SOCKS→HTTP bridge and point the lane at it. */
  async #bridgeTo(port: number): Promise<string> {
    await this.#stopBridge()

    try {
      this.#bridge = await startBridge({ socksHost: "127.0.0.1", socksPort: port, port: 0 })
    } catch (error) {
      return `Cloudflare WARP is connected, but its local proxy bridge did not start: ${message(error)}`
    }

    this.#endpoint = this.#bridge.url
    return ""
  }

  async #stopBridge() {
    const bridge = this.#bridge
    this.#bridge = null
    if (!bridge) return

    // The direct endpoint belongs to the daemon and outlives the bridge; only the
    // bridge's own URL is dropped here.
    if (this.#endpoint === bridge.url) this.#endpoint = ""
    await bridge.stop().catch(() => undefined)
  }

  /**
   * Where the mode this app displaced is remembered.
   *
   * `mode proxy` is not a per-app setting: it changes the whole client, leaves the tunnel
   * unproxied, and survives a crash. A user who selected the WARP lane and quit used to find
   * their WARP still in proxy mode with their normal traffic unprotected. Recording the
   * previous mode before the switch is what lets `restore` put it back on the next lane
   * change, quit, or relaunch.
   */
  #modeFile() {
    try {
      return join(app.getPath("userData"), "egress", "warp-mode.json")
    } catch {
      return ""
    }
  }

  async #currentMode(): Promise<string> {
    const result = await this.#cli(["settings"], CONTROL_TIMEOUT_MS)
    return parseWarpMode(`${result.stdout}\n${result.stderr}`)
  }

  async #captureMode(): Promise<void> {
    const file = this.#modeFile()
    if (!file || existsSync(file)) return

    const mode = await this.#currentMode()
    // Nothing to remember when the client is already in the mode this lane wants, or when
    // the daemon could not say. A blank previous mode restores the default, which is warp.
    if (!mode) return

    // Whether the tunnel was up when the app took the client over. Restoring the mode but
    // not the tunnel would hand back a client that looks idle while the user's traffic is
    // unprotected, which is worse than the mode being wrong.
    const wasConnected = (await this.status()).connected

    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ mode, connected: wasConnected, at: Date.now() }, null, 2))
    } catch {
      // A read-only profile still gets the lane; only the restore is lost.
    }
  }

  /** Put the client back in the mode it was in before this lane switched it to proxy. */
  async restore(): Promise<string> {
    const file = this.#modeFile()
    if (!file) return ""

    let previous = ""
    let wasConnected = false
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { mode?: unknown; connected?: unknown }
      previous = typeof parsed.mode === "string" ? parsed.mode : ""
      wasConnected = parsed.connected === true
    } catch {
      return ""
    }

    rmSync(file, { force: true })

    // The lane's own mode needs no restore, and an empty value would leave the client in
    // proxy mode with no way back.
    if (!previous || previous === "proxy") return ""

    // The daemon refuses a mode change while a tunnel is up, which is exactly the state this
    // lane leaves it in. Disconnect first, put the mode back, then reconnect the tunnel the
    // user had. The reconnect is not awaited to "connected": the daemon keeps working after
    // this process is gone, and quitting must not wait a minute for a tunnel.
    await this.#cli(["disconnect"], CONTROL_TIMEOUT_MS)
    const result = await this.#cli(["mode", previous], CONTROL_TIMEOUT_MS)
    if (result.code !== 0) {
      return `WARP is still in proxy mode; restoring "${previous}" failed: ${reason(result, "mode", CONTROL_TIMEOUT_MS)}`
    }
    if (wasConnected) await this.#cli(["connect"], CONTROL_TIMEOUT_MS)
    return ""
  }

  /**
   * The client's path, or null when it is not installed.
   *
   * A hit is cached for the life of the process. A miss is cached only briefly: WARP is
   * installed by its own installer, outside the app, and someone who follows the download
   * link should not have to relaunch before the lane believes them.
   */
  async find(): Promise<string | null> {
    if (this.#binary) return this.#binary
    if (this.#missedAt !== 0 && Date.now() - this.#missedAt < MISSING_RECHECK_MS) return null

    for (const candidate of this.#candidates()) {
      if (await this.#isCli(candidate)) {
        this.#binary = candidate
        return candidate
      }
    }

    // An install that chose its own folder still registers with the shell.
    const located = await which(NAMES, CONTROL_TIMEOUT_MS)
    if (located && (await this.#isCli(located))) {
      this.#binary = located
      return located
    }

    this.#missedAt = Date.now()
    return null
  }

  /** Known folder names first, then every folder the vendor directory actually holds. */
  #candidates(): string[] {
    const found = [...CANDIDATES]

    for (const directory of INSTALL_DIRS) {
      let entries: string[]
      try {
        entries = readdirSync(directory)
      } catch {
        continue
      }
      for (const entry of entries) found.push(join(directory, entry, "warp-cli.exe"))
    }

    return found
  }

  async #isCli(path: string): Promise<boolean> {
    const result = await run(path, ["--version"], { timeoutMs: CONTROL_TIMEOUT_MS })
    return result.code === 0
  }

  async #cli(args: readonly string[], timeoutMs: number) {
    const binary = await this.find()
    if (!binary) return { code: 127, stdout: "", stderr: "warp-cli not found", timedOut: false }
    return run(binary, ["--accept-tos", ...args], { timeoutMs })
  }

  async status(): Promise<WarpStatus> {
    if (!(await this.find())) return { found: false, connected: false, detail: "Cloudflare WARP is not installed" }

    const result = await this.#cli(["status"], CONTROL_TIMEOUT_MS)
    const text = `${result.stdout}\n${result.stderr}`
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    // The daemon's own words decide. The one-line summary said "connected" for a
    // disconnected tunnel in older clients only because the word is inside it, so the
    // negative states are checked first.
    const connected = /\bconnected\b/i.test(text) && !/disconnect|connecting|not connected/i.test(text)

    return { found: true, connected, detail: lines[0] ?? "" }
  }

  /** True when the daemon has no registration yet, which is every fresh install. */
  async #unregistered(): Promise<boolean> {
    const result = await this.#cli(["status"], CONTROL_TIMEOUT_MS)
    return MISSING_REGISTRATION.test(`${result.stdout}\n${result.stderr}`)
  }

  /** The enrolled account type, empty when the daemon did not answer. */
  async #accountType(): Promise<string> {
    const result = await this.#cli(["registration", "show"], CONTROL_TIMEOUT_MS)
    return parseAccountType(`${result.stdout}\n${result.stderr}`)
  }

  /**
   * Put the daemon in proxy mode on `port`. Safe to call on every activation: the
   * commands are idempotent and each one is time-bounded on its own.
   *
   * A client that was installed a minute ago has no registration, and `connect` refuses
   * until it has one. Registering here is what makes the lane work on the same click that
   * installed client arrives on — no relaunch, no trip through the WARP window.
   */
  async prepare(port: number): Promise<string> {
    this.#port = port

    // Every prepare starts with no endpoint. A stale URL from a previous session would
    // let the engine probe a listener this call has not proven yet.
    this.#endpoint = ""
    await this.#stopBridge()

    // A lane with no client installed has nothing to prepare. Reporting the tunnel that
    // never came up hides the one fact the user needs: the download they are missing.
    if (!(await this.find())) return NOT_INSTALLED

    // What the client was doing before this app asks it to be a proxy. Recorded before the
    // switch, because a crash after it would otherwise leave the user's WARP in proxy mode.
    await this.#captureMode()

    // Disconnecting first is what lets the mode and port settings apply: the daemon
    // refuses both while a tunnel is up. The reconnect is a few lines below.
    await this.#cli(["disconnect"], CONTROL_TIMEOUT_MS)

    if (await this.#unregistered()) {
      const registered = await this.#register()
      if (registered) return registered
    }

    // MASQUE is the modern transport; the older WireGuard path needs a kernel driver.
    await this.#cli(["tunnel", "protocol", "set", "MASQUE"], CONTROL_TIMEOUT_MS)
    // Re-applying proxy mode disconnects and reconnects, which drops the user's own traffic
    // for a moment. It is only set when the client is not already there.
    if ((await this.#currentMode()) !== "proxy") await this.#cli(["mode", "proxy"], CONTROL_TIMEOUT_MS)
    await this.#cli(["proxy", "port", String(port)], CONTROL_TIMEOUT_MS)

    let connect = await this.#cli(["connect"], CONNECT_TIMEOUT_MS)

    // A registration that read as present can still race the daemon's own GC.
    if (connect.code !== 0 && MISSING_REGISTRATION.test(connect.stderr)) {
      const registered = await this.#register()
      if (registered) return registered
      connect = await this.#cli(["connect"], CONNECT_TIMEOUT_MS)
    }

    if (await this.#waitConnected(CONNECT_TIMEOUT_MS)) return this.#resolveEndpoint(port)

    const status = await this.status()
    const why =
      connect.code === 0 && !connect.timedOut
        ? status.detail
        : reason(connect, "connect", CONNECT_TIMEOUT_MS) || status.detail

    return `Cloudflare WARP is installed but not connected: ${why || `no state after ${Math.round(CONNECT_TIMEOUT_MS / 1_000)}s`}. Open the WARP client, connect once, then select the WARP lane again.`
  }

  /** `registration new`, with the daemon's own retry for a registration that is still around. */
  async #register(): Promise<string> {
    let registered = await this.#cli(["registration", "new"], REGISTER_TIMEOUT_MS)

    if (registered.code !== 0 && /still around/i.test(registered.stderr)) {
      await this.#cli(["registration", "delete"], CONTROL_TIMEOUT_MS)
      registered = await this.#cli(["registration", "new"], REGISTER_TIMEOUT_MS)
    }

    if (registered.code === 0) return ""

    return `Cloudflare WARP is installed but could not register: ${reason(registered, "registration new", REGISTER_TIMEOUT_MS)}. Open the WARP client once, then select the WARP lane again.`
  }

  async #waitConnected(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    let delay = 250

    while (Date.now() < deadline) {
      const status = await this.status()
      if (status.connected) return true
      await sleep(delay)
      delay = Math.min(1_500, Math.round(delay * 1.5))
    }
    return false
  }

  /**
   * Delete the registration, register again, and wait for the tunnel to come back.
   *
   * `delete` failing with "Missing registration" is not an error — it means the daemon
   * already has no registration, which is the state this call wants. The reverse case,
   * `new` failing because an old registration is "still around", is retried once after
   * a delete, because the daemon's own GC is not synchronous.
   */
  async rotate(): Promise<{ ok: boolean; error: string }> {
    if (!(await this.find())) return { ok: false, error: NOT_INSTALLED }

    // A Teams/Zero Trust device is enrolled with an organisation. Deleting the registration
    // would remove it from that account, and the exit address is chosen by the organisation
    // anyway, so there is no safe rotation to perform.
    const account = await this.#accountType()
    if (account && !/free/i.test(account)) {
      return {
        ok: false,
        error: `this WARP install is managed by an organisation (account type: ${account}); re-registering would remove it. Use Tor or a proxy for a new exit.`,
      }
    }

    await this.#cli(["disconnect"], CONTROL_TIMEOUT_MS)

    const removed = await this.#cli(["registration", "delete"], CONTROL_TIMEOUT_MS)
    if (removed.code !== 0 && !/missing registration/i.test(removed.stderr)) {
      return { ok: false, error: firstLine(removed.stderr) || `registration delete exited ${removed.code}` }
    }

    const registered = await this.#register()
    if (registered) return { ok: false, error: registered }

    this.#rotations += 1

    // Re-registration drops proxy mode, so it is re-applied before anything probes.
    const prepared = await this.prepare(this.#port)
    if (prepared) return { ok: false, error: prepared }

    return { ok: true, error: "" }
  }

  /** True when the local proxy answers and the trace says WARP is carrying it. */
  async healthy(timeoutMs: number) {
    // `probe` treats an empty proxy as the direct lane. A lane that never resolved its
    // endpoint must not report the machine's own address back as a WARP exit.
    if (!this.#endpoint) {
      return { alive: false, latencyMs: 0, detail: "Cloudflare WARP lane is not prepared", trace: null }
    }

    const outcome = await probe(this.endpoint, timeoutMs)
    return {
      alive: outcome.ok,
      latencyMs: outcome.latencyMs,
      detail: outcome.ok ? "" : outcome.error,
      trace: outcome.ok ? outcome.trace : null,
    }
  }
}

function firstLine(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
}

/** The one sentence a failed `warp-cli` call should contribute to the lane error. */
function reason(result: RunResult, command: string, timeoutMs: number) {
  if (result.timedOut) return `${command} timed out after ${Math.round(timeoutMs / 1_000)}s`
  return firstLine(result.stderr) || firstLine(result.stdout) || `${command} exited ${result.code}`
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * Read the mode out of `warp-cli settings`.
 *
 * The line is `(user set)  Mode: WarpProxy on port 40000`; older builds print `Mode: Warp`.
 * The labels are matched longest-first so `warp+doh` is not read as plain `warp`.
 */
export function parseWarpMode(text: string): string {
  const match = /^.*?\bMode:\s*(.+)$/im.exec(text)
  if (!match) return ""

  const value = match[1]!.trim().toLowerCase()
  for (const mode of ["warp+doh", "warp+dot", "tunnel_only", "proxy", "warp", "doh", "dot"]) {
    if (value.includes(mode)) return mode
  }
  return ""
}

/** `Account type: Free`; empty when the daemon did not say. */
export function parseAccountType(text: string): string {
  return /Account type:\s*([^\r\n]+)/i.exec(text)?.[1]?.trim() ?? ""
}
