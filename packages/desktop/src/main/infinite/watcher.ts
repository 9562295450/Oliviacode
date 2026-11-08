/**
 * The limit watcher.
 *
 * The sidecar writes its own log files under the user's state directory; nothing in the
 * desktop process reads them today. Tailing the newest one is how the engine learns that a
 * window ran out without the renderer having to interpret an error toast.
 *
 * Polling rather than `fs.watch`: the CLI rotates files and rewrites them, and a watcher on
 * a replaced inode silently stops delivering. A stat every couple of seconds costs nothing
 * and always finds the file that is actually being written.
 */
import { readdirSync, readSync, closeSync, openSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Where the CLI writes its log, in the order the clients actually use.
 *
 * The service logs next to its data (`~/.local/share/opencode/log`) on every platform this
 * ships on. The old state-directory path is kept because a Linux build that sets
 * `XDG_STATE_HOME` writes there, and a watcher pointed at a directory that does not exist
 * never sees a line — which is how automatic recovery stayed armed and silent.
 */
function resolveLogDirectory(): string | null {
  const candidates: string[] = []

  if (process.env.XDG_STATE_HOME) candidates.push(join(process.env.XDG_STATE_HOME, "opencode", "log"))
  candidates.push(join(homedir(), ".local", "share", "opencode", "log"))
  candidates.push(join(homedir(), ".local", "state", "opencode", "log"))
  // A packaged Windows build sets its data root under Local AppData, so the service's log
  // is not under the XDG tree at all on that install.
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, "opencode", "log"))

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return candidate
    } catch {
      // Not there; the next candidate may be.
    }
  }

  return null
}

const POLL_MS = 2_000
/** A log line longer than this is truncated; only the marker at the front matters. */
const MAX_BYTES_PER_READ = 64 * 1024

export type Watcher = {
  stop(): void
}

/**
 * Watch the newest file under the opencode log directory and hand each new complete line
 * to `onLine`. Returns a handle whose `stop` clears the timer.
 */
export function watchSidecarLogs(onLine: (line: string) => void): Watcher {
  let file = ""
  let offset = 0
  let carry = ""
  let timer: NodeJS.Timeout | null = null

  const poll = () => {
    try {
      // Resolved per poll: the service can create its log directory after the app boots.
      const directory = resolveLogDirectory()
      if (!directory) return

      const newest = newestLog(directory)
      if (!newest) return

      if (newest !== file) {
        file = newest
        // Start at the end of an existing file: the history is not this session's business.
        offset = statSync(newest).size
        carry = ""
        return
      }

      const size = statSync(newest).size
      if (size < offset) {
        // Truncated in place: the writer restarted the file.
        offset = 0
        carry = ""
      }
      if (size === offset) return

      const length = Math.min(MAX_BYTES_PER_READ, size - offset)
      const buffer = Buffer.allocUnsafe(length)
      const handle = openSync(newest, "r")

      try {
        readSync(handle, buffer, 0, length, offset)
      } finally {
        closeSync(handle)
      }

      offset += length

      const text = carry + buffer.toString("utf8")
      const lines = text.split(/\r?\n/)
      // The last element is either empty or a partial line; hold it for the next read.
      carry = lines.pop() ?? ""

      for (const line of lines) {
        if (line.trim()) onLine(line)
      }
    } catch {
      // A file vanishing between the listing and the read is normal during rotation.
    }
  }

  timer = setInterval(poll, POLL_MS)
  timer.unref?.()

  return {
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

function newestLog(directory: string): string | null {
  let best: { path: string; mtime: number } | null = null

  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".log")) continue
    const path = join(directory, name)
    try {
      const stat = statSync(path)
      if (!best || stat.mtimeMs > best.mtime) best = { path, mtime: stat.mtimeMs }
    } catch {
      // Removed between listing and stat.
    }
  }

  return best?.path ?? null
}
