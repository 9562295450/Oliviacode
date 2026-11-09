export * as EngineGate from "./engine-gate"

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import path from "node:path"
import { check, infoVersion, type Contract } from "./engine-contract"

/**
 * Proof that a downloaded engine is safe to adopt, run before it is ever adopted.
 *
 * The candidate boots on its own loopback port against a throwaway data directory, so it cannot
 * touch the real session database or the adopted service. It has to answer `/api/info` with its
 * own version, publish an OpenAPI document that still contains every operation the window calls,
 * and complete one create-then-delete round trip against its own store. Any failure means the
 * candidate is refused and the app stays on the engine it shipped with.
 */
export interface Result {
  readonly ok: boolean
  readonly reason?: string
  readonly missing: ReadonlyArray<{ readonly method: string; readonly path: string }>
  /** Everything the gate observed, for the log line and the support bundle. */
  readonly evidence: {
    readonly version?: string
    readonly infoMs?: number
    readonly operations?: number
    readonly sessionRoundTrip?: boolean
    readonly exitCode?: number | null
    readonly stderr?: string
  }
}

const READY_TIMEOUT_MS = 60_000
const POLL_MS = 150
const REQUEST_TIMEOUT_MS = 15_000

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A port nobody holds right now. The engine is spawned immediately after, so the window is short. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))))
    })
  })
}

interface Credentials {
  readonly url: string
  readonly password?: string
}

function serviceFile(root: string) {
  return path.join(root, "state", "opencode", "service.json")
}

function readCredentials(root: string, port: number): Credentials {
  try {
    const parsed = JSON.parse(readFileSync(serviceFile(root), "utf8")) as { url?: string; password?: string }
    if (parsed.url) return { url: parsed.url, password: parsed.password }
  } catch {
    // The engine writes this file late; the fixed port is enough until it does.
  }

  return { url: `http://127.0.0.1:${port}` }
}

function authorised(credentials: Credentials) {
  return credentials.password ? `Basic ${Buffer.from(`opencode:${credentials.password}`).toString("base64")}` : undefined
}

async function request(credentials: Credentials, pathname: string, init?: RequestInit) {
  const authorization = authorised(credentials)
  const response = await fetch(`${credentials.url}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...(init?.headers ?? {}),
      ...(authorization ? { authorization } : {}),
    },
  })

  return response
}

/**
 * Boots `binary`, runs the contract and the round trip, and always leaves no process behind.
 * `sandbox` is created fresh and removed by the caller; it never points at the real user data.
 */
export async function gate(input: {
  readonly binary: string
  readonly expectedVersion?: string
  readonly contract: Contract
  readonly sandbox: string
}): Promise<Result> {
  const started = Date.now()
  const port = await freePort()

  mkdirSync(path.join(input.sandbox, "work"), { recursive: true })

  const environment = {
    ...process.env,
    XDG_DATA_HOME: path.join(input.sandbox, "data"),
    XDG_STATE_HOME: path.join(input.sandbox, "state"),
    XDG_CACHE_HOME: path.join(input.sandbox, "cache"),
    XDG_CONFIG_HOME: path.join(input.sandbox, "config"),
    // Keep the probe away from the adopted service's own registry entry.
    OPENCODE_DESKTOP_TEST_ROOT: input.sandbox,
  }

  const child = spawn(input.binary, ["serve", "--service", "--port", String(port)], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  let stderr = ""
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4_000)
  })

  const state: { exitCode: number | null } = { exitCode: null }
  child.on("exit", (code) => {
    state.exitCode = code
  })

  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }

  try {
    let credentials = readCredentials(input.sandbox, port)
    let info: unknown
    const deadline = started + READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (state.exitCode !== null) {
        return {
          ok: false,
          reason: `engine exited during boot (code ${state.exitCode})`,
          missing: [],
          evidence: { exitCode: state.exitCode, stderr },
        }
      }

      credentials = readCredentials(input.sandbox, port)
      try {
        const response = await request(credentials, "/api/info")
        if (response.ok) info = await response.json()
      } catch {
        // Not listening yet.
      }

      if (info) break
      await delay(POLL_MS)
    }

    if (!info) {
      return {
        ok: false,
        reason: "engine did not answer /api/info in time",
        missing: [],
        evidence: { exitCode: state.exitCode, stderr },
      }
    }

    const infoMs = Date.now() - started
    const version = infoVersion(info)

    if (!version) {
      return { ok: false, reason: "/api/info carries no version", missing: [], evidence: { infoMs, stderr } }
    }

    if (input.expectedVersion && version !== input.expectedVersion) {
      return {
        ok: false,
        reason: `reported version ${version}, expected ${input.expectedVersion}`,
        missing: [],
        evidence: { version, infoMs, stderr },
      }
    }

    const document = await request(credentials, "/openapi.json")
    if (!document.ok) {
      return {
        ok: false,
        reason: `openapi document unavailable (HTTP ${document.status})`,
        missing: [],
        evidence: { version, infoMs, stderr },
      }
    }

    const openapi = await document.json()
    const verdict = check(input.contract, openapi)
    const operations = typeof openapi === "object" && openapi !== null ? Object.keys((openapi as { paths?: object }).paths ?? {}).length : 0

    if (!verdict.ok) {
      return {
        ok: false,
        reason: verdict.reason ?? `${verdict.missing.length} required operations missing`,
        missing: verdict.missing,
        evidence: { version, infoMs, operations, stderr },
      }
    }

    // A real round trip, because a document can list a route the router no longer wires up.
    const created = await request(credentials, "/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "engine gate",
        location: { directory: path.join(input.sandbox, "work") },
      }),
    })

    if (!created.ok) {
      return {
        ok: false,
        reason: `session create failed (HTTP ${created.status})`,
        missing: [],
        evidence: { version, infoMs, operations, sessionRoundTrip: false, stderr },
      }
    }

    const session = (await created.json()) as { data?: { id?: string }; id?: string }
    const id = session.data?.id ?? session.id

    if (!id) {
      return {
        ok: false,
        reason: "session create returned no id",
        missing: [],
        evidence: { version, infoMs, operations, sessionRoundTrip: false, stderr },
      }
    }

    const removed = await request(credentials, `/api/session/${encodeURIComponent(id)}`, { method: "DELETE" })
    const removedSession = removed.ok || removed.status === 204 || removed.status === 404

    return {
      ok: removedSession,
      reason: removedSession ? undefined : `session delete failed (HTTP ${removed.status})`,
      missing: [],
      evidence: {
        version,
        infoMs,
        operations,
        sessionRoundTrip: removedSession,
        exitCode: state.exitCode,
        stderr,
      },
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      missing: [],
      evidence: { exitCode: state.exitCode, stderr },
    }
  } finally {
    stop()
    // Give the child a moment to release its port and database handles before the caller deletes the sandbox.
    const released = Date.now() + 10_000
    while (existsSync(serviceFile(input.sandbox)) && child.exitCode === null && Date.now() < released) await delay(POLL_MS)
    writeFileSync(path.join(input.sandbox, "gate.json"), JSON.stringify({ port, version: input.expectedVersion }, null, 2))
  }
}
