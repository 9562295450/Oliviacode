/**
 * Bounded child processes. Every external tool the engine touches — `warp-cli`, `tor`,
 * `where` — goes through here, so no call can hang the main process and every failure
 * arrives with the tool's own words instead of a bare exit code.
 */
import { spawn } from "node:child_process"

export type RunResult = {
  /** The process exit code, or 124 when the timeout fired. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  /** True only when the timeout killed the process. */
  readonly timedOut: boolean
}

export type RunOptions = {
  readonly timeoutMs: number
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
  /** Cap on captured output. A tool that floods cannot grow the heap. */
  readonly maxBytes?: number
}

const MAX_BYTES = 256 * 1024

/**
 * Run a command with a hard deadline. Resolves — never rejects — so a caller cannot
 * leak an unhandled rejection into the main process when a tool is missing.
 */
export function run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const limit = options.maxBytes ?? MAX_BYTES
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false

    const finish = (code: number) => {
      if (settled) return
      settled = true
      resolve({ code, stdout, stderr, timedOut })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args as string[], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
        // No shell: arguments stay one-per-argument, so a proxy URL with `&` is not
        // reinterpreted by cmd.exe on the way to the tool.
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        // A detached process group lets the timeout kill the tool's own children too.
        detached: process.platform !== "win32",
        windowsVerbatimArguments: false,
      })
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error)
      finish(127)
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, Math.max(1, options.timeoutMs))
    timer.unref?.()

    const append = (current: string, chunk: Buffer) => {
      if (current.length >= limit) return current
      const room = limit - current.length
      return current + chunk.subarray(0, room).toString("utf8")
    }

    child.stdout?.on("data", (chunk: Buffer) => (stdout = append(stdout, chunk)))
    child.stderr?.on("data", (chunk: Buffer) => (stderr = append(stderr, chunk)))

    child.on("error", (error) => {
      clearTimeout(timer)
      stderr = stderr || error.message
      finish(127)
    })

    child.on("close", (code, signal) => {
      clearTimeout(timer)
      finish(timedOut ? 124 : (code ?? (signal ? 128 : 0)))
    })

    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
  })
}

/** Kill a child and everything it started. Best-effort: a dead process is already done. */
export function killTree(child: ReturnType<typeof spawn>) {
  if (child.pid === undefined) return
  if (process.platform === "win32") {
    // taskkill needs the tree flag; Node's kill only reaches the direct child.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      shell: false,
    }).on("error", () => undefined)
    return
  }
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {
      // already gone
    }
  }
}

/** `where` on Windows, `command -v` elsewhere: the first absolute path, or null. */
export async function which(names: readonly string[], timeoutMs: number): Promise<string | null> {
  if (process.platform === "win32") {
    const result = await run("where", names, { timeoutMs })
    if (result.code !== 0) return null
    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return first ?? null
  }
  for (const name of names) {
    const result = await run("/bin/sh", ["-c", `command -v ${name}`], { timeoutMs })
    const first = result.stdout.trim().split(/\r?\n/)[0]
    if (result.code === 0 && first) return first
  }
  return null
}
