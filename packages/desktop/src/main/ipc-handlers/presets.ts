import { Effect, Schema } from "effect"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { PresetRpcs } from "../../shared/ipc-rpc"

/**
 * Provider addons.
 *
 * The app ships no provider endpoints of its own. `presets.json` next to the binary is a
 * local, user-editable template file and is empty by default. Community entries arrive only
 * when a user asks for a registry by URL; the response is validated, size-capped, and cached
 * in userData so the picker survives a restart.
 *
 * Nothing here touches credentials. Applying an addon writes one field — the provider's base
 * URL — into the engine's global config.
 */

/** The global config the engine reads. Mirrors `Global.Path.config` in @opencode/core. */
const configDir = path.join(homedir(), ".config", "opencode")

/** Both names the engine discovers; an existing file is preferred over creating a new one. */
const configCandidates = ["opencode.json", "opencode.jsonc"].map((name) => path.join(configDir, name))

/** A registry is a small JSON file. Anything larger is not one. */
const MAX_REGISTRY_BYTES = 512 * 1024

/** Registry fetches are user-initiated, but must still not hang the IPC layer. */
const REGISTRY_TIMEOUT_MS = 20_000

const Preset = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  provider: Schema.String,
  baseURL: Schema.String,
  docsURL: Schema.optionalKey(Schema.String),
})

/** Accepts the bare array form and the `{ presets: [...] }` form a gist usually has. */
const Registry = Schema.Union([Schema.Struct({ presets: Schema.Array(Preset) }), Schema.Array(Preset)])

type PresetEntry = typeof Preset.Type

type Stored = PresetEntry & { origin: "local" | "community" }

function presetsFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, "presets.json")

  // Running from source: packages/desktop -> repository root.
  return path.join(app.getAppPath(), "..", "..", "presets.json")
}

function cacheFile() {
  return path.join(app.getPath("userData"), "community-addons.json")
}

function readLocal(): Stored[] {
  try {
    const parsed = Schema.decodeUnknownSync(Registry)(JSON.parse(readFileSync(presetsFile(), "utf8")))
    const list = Array.isArray(parsed) ? parsed : parsed.presets

    return list.map((item) => ({ ...item, origin: "local" as const }))
  } catch {
    // Missing, empty or malformed: the app simply offers no local entries.
    return []
  }
}

function readCache(): Stored[] {
  try {
    const parsed = Schema.decodeUnknownSync(Registry)(JSON.parse(readFileSync(cacheFile(), "utf8")))
    const list = Array.isArray(parsed) ? parsed : parsed.presets

    return list.map((item) => ({ ...item, origin: "community" as const }))
  } catch {
    return []
  }
}

function list(): Stored[] {
  // Local file wins on id collision so a user's own edit is never shadowed by a registry.
  const local = readLocal()
  const seen = new Set(local.map((item) => item.id))

  return [...local, ...readCache().filter((item) => !seen.has(item.id))]
}

async function fetchRegistry(url: string) {
  const parsed = new URL(url)

  // A registry is data over HTTP(S). No file://, no data:, no redirects into them.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return { ok: false as const, url, addons: [], error: "Only http(s) registry URLs are supported." }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)

  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/json" },
    })

    if (!response.ok)
      return { ok: false as const, url, addons: [], error: `Registry returned HTTP ${response.status}.` }

    const body = await response.text()

    if (body.length > MAX_REGISTRY_BYTES)
      return { ok: false as const, url, addons: [], error: "Registry is larger than 512 KB; refusing it." }

    const decoded = Schema.decodeUnknownSync(Registry)(JSON.parse(body))
    const entries = Array.isArray(decoded) ? decoded : decoded.presets
    const addons = entries.map((item) => ({ ...item, origin: "community" as const }))

    mkdirSync(path.dirname(cacheFile()), { recursive: true })
    writeFileSync(cacheFile(), JSON.stringify({ presets: entries }, null, 2) + "\n")

    return { ok: true as const, url, addons }
  } catch (error) {
    return { ok: false as const, url, addons: [], error: describe(error) }
  } finally {
    clearTimeout(timer)
  }
}

function describe(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Registry request timed out."
    return error.message
  }

  return String(error)
}

function apply(id: string) {
  const addon = list().find((item) => item.id === id)
  const target = configCandidates.find((file) => existsSync(file)) ?? configCandidates[0]!

  if (!addon) return { ok: false as const, path: target, error: `Unknown addon: ${id}` }

  // A commented jsonc file cannot round-trip through JSON.parse without losing the comments,
  // so refuse rather than rewrite it. The user adds the block by hand.
  if (target.endsWith(".jsonc") && existsSync(target) && !parsesAsJson(readFileSync(target, "utf8")))
    return {
      ok: false as const,
      path: target,
      error: `${target} contains comments or trailing commas; add the provider block by hand.`,
    }

  const config = existsSync(target) ? (JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>) : {}
  const providers = (config.provider ?? {}) as Record<string, Record<string, unknown>>
  const entry = providers[addon.provider] ?? {}
  const options = { ...((entry.options ?? {}) as Record<string, unknown>), baseURL: addon.baseURL }

  config.provider = { ...providers, [addon.provider]: { ...entry, options } }

  mkdirSync(configDir, { recursive: true })
  writeFileSync(target, JSON.stringify(config, null, 2) + "\n")

  return { ok: true as const, path: target }
}

function parsesAsJson(text: string) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export const presetHandlers = PresetRpcs.toLayer(
  Effect.succeed(
    PresetRpcs.of({
      PresetFetch: ({ url }) => Effect.promise(() => fetchRegistry(url)),
      PresetList: () => Effect.sync(() => list()),
      PresetApply: ({ id }) => Effect.sync(() => apply(id)),
    }),
  ),
)
