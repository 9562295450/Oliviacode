export * as EngineAdoption from "./engine-adoption"

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"

/**
 * The record that lets a downloaded engine be abandoned without a user noticing.
 *
 * Adoption is a two-phase commit against reality: the gate proves the engine can boot and answer,
 * but only the next launch proves it boots *inside this app*. So an adopted version is written as
 * `pending`, becomes `attempting` when a launch actually picks it, and only reaches `ok` once the
 * sidecar connected. A launch that finds `attempting` is looking at the previous launch's failure,
 * and reverts to the bundled engine instead of failing twice.
 */
export const Boot = Schema.Literals(["pending", "attempting", "ok"])

export const Record = Schema.Struct({
  adopted: Schema.optional(
    Schema.Struct({
      version: Schema.String,
      channel: Schema.String,
      /** Engine version this adoption moved away from, for the log and the revert. */
      from: Schema.String,
      boot: Boot,
      adoptedAt: Schema.Number,
    }),
  ),
  rejected: Schema.optional(
    Schema.Struct({
      version: Schema.String,
      reason: Schema.String,
      at: Schema.Number,
    }),
  ),
})
export type Record = typeof Record.Type

export const empty: Record = {}

export function file(userData: string) {
  return path.join(userData, "engine-adoption.json")
}

export function read(target: string): Record {
  if (!existsSync(target)) return empty

  try {
    const parsed = Schema.decodeUnknownSync(Record)(JSON.parse(readFileSync(target, "utf8")))

    return parsed
  } catch {
    // A hand-edited or truncated record is indistinguishable from none; the app falls back to bundled.
    return empty
  }
}

export function write(target: string, record: Record) {
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(record, null, 2))
  renameSync(temporary, target)
}

export function clear(target: string) {
  rmSync(target, { force: true })
}

export type Action = "use-adopted" | "demote" | "none"

export interface Decision {
  readonly action: Action
  readonly record: Record
  /** The version a launch would run, when it is not the bundled one. */
  readonly version?: string
}

/**
 * Works out what this launch runs, given the record left by the last one.
 *
 * Pure by design: the caller writes `record` back. `bundledSupersedes` covers the ordinary case of
 * an app update that ships an engine at or past the adopted one, where the adoption becomes noise.
 */
export function decide(record: Record, bundledVersion: string): Decision {
  const adopted = record.adopted

  if (!adopted) return { action: "none", record }

  if (adopted.version === bundledVersion) return { action: "none", record: empty }

  if (adopted.boot === "attempting") return { action: "demote", record: empty }

  if (adopted.boot === "pending")
    return {
      action: "use-adopted",
      record: { ...record, adopted: { ...adopted, boot: "attempting" } },
      version: adopted.version,
    }

  return { action: "use-adopted", record, version: adopted.version }
}

/** Marks the adopted engine as one that really booted inside the app. Called only after the sidecar connects. */
export function confirmed(record: Record, version: string): Record {
  if (record.adopted?.version !== version || record.adopted.boot === "ok") return record

  return { ...record, adopted: { ...record.adopted, boot: "ok" } }
}

export function adopting(input: {
  readonly version: string
  readonly channel: string
  readonly from: string
  readonly at?: number
}): Record {
  return {
    adopted: {
      version: input.version,
      channel: input.channel,
      from: input.from,
      boot: "pending",
      adoptedAt: input.at ?? Date.now(),
    },
  }
}

export function rejecting(version: string, reason: string, at = Date.now()): Record {
  return { rejected: { version, reason, at } }
}
