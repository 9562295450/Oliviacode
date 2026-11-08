/**
 * Cloudflare WARP as an egress lane.
 *
 * A WARP rotation is a fresh registration: delete the current one, register again, put
 * the tunnel in proxy mode and wait for the daemon to report connected. The exit address
 * changes because the registration does — not because anything is spoofed.
 *
 * The call budgets here are deliberately generous where the daemon is slow. A cold
 * `registration new` routinely takes longer than fifteen seconds while the client
 * renegotiates, and killing it mid-flight leaves the registration half-written, which
 * then makes `delete` fail with "Missing registration".
 */
import { run } from "./exec"
import { probe } from "./trace"

/** `registration new` renegotiates keys and reconnects; it is never a quick call. */
const REGISTER_TIMEOUT_MS = 120_000
/** Status and mode switches are local IPC to the daemon and answer immediately. */
const CONTROL_TIMEOUT_MS = 20_000
const CONNECT_TIMEOUT_MS = 60_000

const CANDIDATES = [
  "C:\\Program Files\\Cloudflare\\Cloudflare WARP\\warp-cli.exe",
  "C:\\Program Files (x86)\\Cloudflare\\Cloudflare WARP\\warp-cli.exe",
]

export type WarpStatus = {
  readonly found: boolean
  readonly connected: boolean
  readonly detail: string
}

export class Warp {
  #binary: string | null = null
  #resolved = false
  #port = 40000
  #rotations = 0

  get port() {
    return this.#port
  }

  /** The local HTTP proxy WARP exposes in proxy mode. */
  get endpoint() {
    return `http://127.0.0.1:${this.#port}`
  }

  async find(): Promise<string | null> {
    if (this.#resolved) return this.#binary
    this.#resolved = true

    for (const candidate of CANDIDATES) {
      const result = await run(candidate, ["--version"], { timeoutMs: CONTROL_TIMEOUT_MS })
      if (result.code === 0) {
        this.#binary = candidate
        return candidate
      }
    }
    return null
  }

  async #cli(args: readonly string[], timeoutMs: number) {
    const binary = await this.find()
    if (!binary) return { code: 127, stdout: "", stderr: "warp-cli not installed", timedOut: false }
    return run(binary, ["--accept-tos", ...args], { timeoutMs })
  }

  async status(): Promise<WarpStatus> {
    if (!(await this.find())) return { found: false, connected: false, detail: "warp-cli not installed" }

    const result = await this.#cli(["status"], CONTROL_TIMEOUT_MS)
    const text = `${result.stdout}\n${result.stderr}`.trim()
    const connected = /Status update:\s*Connected/i.test(text)
    return { found: true, connected, detail: text.split(/\r?\n/)[0] ?? "" }
  }

  /**
   * Put the daemon in proxy mode on `port`. Safe to call on every activation: the
   * commands are idempotent and each one is time-bounded on its own.
   */
  async prepare(port: number): Promise<string> {
    this.#port = port

    // MASQUE is the modern transport; the older WireGuard path needs a kernel driver.
    await this.#cli(["tunnel", "protocol", "set", "MASQUE"], CONTROL_TIMEOUT_MS)
    await this.#cli(["mode", "proxy"], CONTROL_TIMEOUT_MS)
    await this.#cli(["proxy", "port", String(port)], CONTROL_TIMEOUT_MS)

    const connected = await this.#waitConnected(CONNECT_TIMEOUT_MS)
    if (connected) return ""
    await this.#cli(["connect"], CONNECT_TIMEOUT_MS)
    return (await this.#waitConnected(CONNECT_TIMEOUT_MS)) ? "" : "WARP did not report connected"
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
    if (!(await this.find())) return { ok: false, error: "warp-cli not installed" }

    await this.#cli(["disconnect"], CONTROL_TIMEOUT_MS)

    const removed = await this.#cli(["registration", "delete"], CONTROL_TIMEOUT_MS)
    if (removed.code !== 0 && !/missing registration/i.test(removed.stderr)) {
      return { ok: false, error: firstLine(removed.stderr) || `registration delete exited ${removed.code}` }
    }

    let registered = await this.#cli(["registration", "new"], REGISTER_TIMEOUT_MS)

    if (registered.code !== 0 && /still around/i.test(registered.stderr)) {
      await this.#cli(["registration", "delete"], CONTROL_TIMEOUT_MS)
      registered = await this.#cli(["registration", "new"], REGISTER_TIMEOUT_MS)
    }

    if (registered.code !== 0) {
      return {
        ok: false,
        error: registered.timedOut
          ? `registration new timed out after ${Math.round(REGISTER_TIMEOUT_MS / 1000)}s`
          : firstLine(registered.stderr) || `registration new exited ${registered.code}`,
      }
    }

    this.#rotations += 1

    // Re-registration drops proxy mode, so it is re-applied before anything probes.
    const prepared = await this.prepare(this.#port)
    if (prepared) return { ok: false, error: prepared }

    return { ok: true, error: "" }
  }

  /** True when the local proxy answers and the trace says WARP is carrying it. */
  async healthy(timeoutMs: number) {
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

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
