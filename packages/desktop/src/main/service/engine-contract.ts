export * as EngineContract from "./engine-contract"

import { Schema } from "effect"

/**
 * The slice of the engine's HTTP surface this desktop actually calls.
 *
 * The engine is a separate release with its own cadence, so a newer one can rename or drop a
 * route the window depends on. A contract is what makes "newer" checkable instead of assumed:
 * the candidate engine must expose every operation listed here, at the same method and path.
 * Extra operations are fine — engines only ever grow between compatible releases.
 */
export const Operation = Schema.Struct({
  method: Schema.Literals(["GET", "POST", "PATCH", "DELETE"]),
  path: Schema.String,
})
export type Operation = typeof Operation.Type

export const Contract = Schema.Struct({
  /** The engine version the contract was generated from, for the log line when a candidate is refused. */
  generatedFrom: Schema.String,
  required: Schema.Array(Operation),
})
export type Contract = typeof Contract.Type

/** The operations the window cannot run without. Kept as source, mirrored into engine-contract.json at build. */
export const requiredOperations: ReadonlyArray<Operation> = [
  { method: "GET", path: "/api/info" },
  { method: "GET", path: "/api/event" },
  { method: "GET", path: "/api/config" },
  // Settings writes a custom provider through the config document and stores its key as a credential.
  // Both routes are required: an engine without them cannot save a provider, and 2.2.12 shipped one.
  { method: "PATCH", path: "/api/experimental/config" },
  { method: "GET", path: "/api/credential" },
  { method: "POST", path: "/api/credential" },
  { method: "GET", path: "/api/agent" },
  { method: "GET", path: "/api/model" },
  { method: "GET", path: "/api/model/default" },
  { method: "GET", path: "/api/provider" },
  { method: "GET", path: "/api/mcp" },
  { method: "GET", path: "/api/project" },
  { method: "GET", path: "/api/command" },
  { method: "GET", path: "/api/skill" },
  { method: "GET", path: "/api/session" },
  { method: "POST", path: "/api/session" },
  { method: "GET", path: "/api/session/{sessionID}" },
  { method: "PATCH", path: "/api/session/{sessionID}" },
  { method: "DELETE", path: "/api/session/{sessionID}" },
  { method: "POST", path: "/api/session/{sessionID}/prompt" },
  { method: "GET", path: "/api/session/{sessionID}/message" },
  { method: "GET", path: "/api/session/{sessionID}/message/{messageID}" },
  { method: "POST", path: "/api/session/{sessionID}/interrupt" },
  { method: "POST", path: "/api/session/{sessionID}/compact" },
  { method: "POST", path: "/api/session/{sessionID}/fork" },
  { method: "POST", path: "/api/session/{sessionID}/move" },
  { method: "GET", path: "/api/session/{sessionID}/context" },
  { method: "DELETE", path: "/api/session/{sessionID}/revert" },
]

export interface Verdict {
  readonly ok: boolean
  /** Operations the candidate does not serve. Empty when `ok`. */
  readonly missing: ReadonlyArray<Operation>
  /** Set when the candidate's document could not be read at all. */
  readonly reason?: string
}

const METHODS = new Set(["get", "post", "patch", "delete", "put", "head", "options"])

/** Flattens an OpenAPI document into `"GET /api/session"` keys. Tolerates anything shaped like one. */
export function operationSet(openapi: unknown): Set<string> {
  const operations = new Set<string>()
  if (typeof openapi !== "object" || openapi === null) return operations

  const paths = (openapi as { paths?: unknown }).paths
  if (typeof paths !== "object" || paths === null) return operations

  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (typeof item !== "object" || item === null) continue

    for (const method of Object.keys(item as Record<string, unknown>)) {
      if (!METHODS.has(method)) continue

      operations.add(`${method.toUpperCase()} ${path}`)
    }
  }

  return operations
}

/** Refuses a candidate that lost any operation this desktop calls. Additions never fail the check. */
export function check(contract: Contract, openapi: unknown): Verdict {
  const operations = operationSet(openapi)

  if (operations.size === 0) return { ok: false, missing: contract.required, reason: "empty operation list" }

  const missing = contract.required.filter((operation) => !operations.has(`${operation.method} ${operation.path}`))

  return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing }
}

/** `/api/info` must carry a version, because the stage directory and the sidecar identity are keyed by it. */
export function infoVersion(info: unknown): string | undefined {
  if (typeof info !== "object" || info === null) return undefined
  const version = (info as { version?: unknown }).version

  return typeof version === "string" && version.length > 0 ? version : undefined
}

interface Parsed {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly pre?: string
}

function parse(version: string): Parsed | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim())
  if (!match) return undefined

  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] }
}

/** Negative when `a` precedes `b`. A prerelease sorts before its release, per semver. */
export function compare(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return 0

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }

  if (left.pre === right.pre) return 0
  if (left.pre === undefined) return 1
  if (right.pre === undefined) return -1

  return left.pre < right.pre ? -1 : 1
}

export type Channel = "bundled" | "patch" | "minor" | "latest"

/**
 * Which candidate versions a channel may adopt, given the engine bundled in the installed app.
 *
 * `bundled` is the shipped pin. `patch` follows fixes only. `minor` also follows features, which is
 * where upstream's API changes have historically landed — the contract gate is what makes it safe.
 * A `0.x` engine has no stable major, so only patch moves are allowed there.
 */
export function accepts(current: string, candidate: string, channel: Channel): boolean {
  if (channel === "bundled") return false
  if (compare(candidate, current) <= 0) return false

  const from = parse(current)
  const to = parse(candidate)
  if (!from || !to) return false
  if (to.major !== from.major) return false
  if (from.major === 0 && to.minor !== from.minor) return false
  if (channel === "patch" && to.minor !== from.minor) return false

  // A prerelease is someone else's test flight; this app does not adopt one by default.
  return to.pre === undefined
}

/** The highest version the channel accepts, or undefined when nothing qualifies. */
export function best(current: string, candidates: ReadonlyArray<string>, channel: Channel): string | undefined {
  return candidates
    .filter((candidate) => accepts(current, candidate, channel))
    .sort((a, b) => compare(b, a))
    .at(0)
}
