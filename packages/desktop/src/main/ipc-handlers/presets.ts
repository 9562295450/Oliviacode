import { Effect, Schema } from "effect"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { PresetRpcs } from "../../shared/ipc-rpc"
import { readJsonFile, stripBom, writeCustomProvider, writePreset } from "./presets-config"

/**
 * Provider addons.
 *
 * The app ships no provider endpoints of its own. `presets.json` next to the binary is a
 * local, user-editable template file and is empty by default. `community-presets.json` is a
 * starter template that the add-ons dialog offers but never installs on its own. Community
 * entries arrive only when a user asks for a registry by URL; the response is validated,
 * size-capped, and cached in userData so the picker survives a restart.
 *
 * Nothing here touches credentials. Applying an addon writes the provider's base URL into the
 * engine config owned by this app — or, for an entry carrying a models list, a full custom
 * provider under an id the engine catalogue does not know. The engine's XDG config home is
 * redirected under userData before it starts, so this never reads or writes another
 * installation's config.
 */

/** The global config the engine reads. Mirrors `Global.Path.config` in @opencode/core. */
function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? path.join(xdg, "opencode") : path.join(homedir(), ".config", "opencode")
}

/** Both names the engine discovers; an existing file is preferred over creating a new one. */
function configCandidates() {
  return ["opencode.json", "opencode.jsonc"].map((name) => path.join(configDir(), name))
}

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
  keyHint: Schema.optionalKey(Schema.String),
  /**
   * Model ids the endpoint serves. Present only on entries whose provider id the engine
   * catalogue does not know: applying one writes a custom provider instead of a base URL.
   */
  models: Schema.optionalKey(Schema.Array(Schema.String)),
})

/** Accepts the bare array form and the `{ presets: [...] }` form a gist usually has. */
const Registry = Schema.Union([Schema.Struct({ presets: Schema.Array(Preset) }), Schema.Array(Preset)])

type PresetEntry = typeof Preset.Type

type Stored = PresetEntry & { origin: "local" | "starter" | "community" }

function presetsFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, "presets.json")

  // Running from source: packages/desktop -> repository root.
  return path.join(app.getAppPath(), "..", "..", "presets.json")
}

function starterFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, "community-presets.json")

  return path.join(app.getAppPath(), "..", "..", "community-presets.json")
}

function cacheFile() {
  return path.join(app.getPath("userData"), "community-addons.json")
}

/** Both accepted registry shapes collapse to the entry array. */
function entries(parsed: typeof Registry.Type): readonly PresetEntry[] {
  return "presets" in parsed ? parsed.presets : parsed
}

function readLocal(): Stored[] {
  try {
    const parsed = Schema.decodeUnknownSync(Registry)(readJsonFile(presetsFile()))

    return entries(parsed).map((item) => ({ ...item, origin: "local" as const }))
  } catch {
    // Missing, empty or malformed: the app simply offers no local entries.
    return []
  }
}

function readStarter(): Stored[] {
  try {
    const parsed = Schema.decodeUnknownSync(Registry)(readJsonFile(starterFile()))

    return entries(parsed).map((item) => ({ ...item, origin: "starter" as const }))
  } catch {
    return []
  }
}

function readCache(): Stored[] {
  try {
    const parsed = Schema.decodeUnknownSync(Registry)(readJsonFile(cacheFile()))

    return entries(parsed).map((item) => ({ ...item, origin: "community" as const }))
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

    const decoded = Schema.decodeUnknownSync(Registry)(JSON.parse(stripBom(body)))
    const list = entries(decoded)
    const addons = list.map((item) => ({ ...item, origin: "community" as const }))

    mkdirSync(path.dirname(cacheFile()), { recursive: true })
    writeFileSync(cacheFile(), JSON.stringify({ presets: list }, null, 2) + "\n")

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
  const installed = list()
  const addon = installed.find((item) => item.id === id) ?? readStarter().find((item) => item.id === id)
  const candidates = configCandidates()
  const target = candidates.find((file) => existsSync(file)) ?? candidates[0]!

  if (!addon) return { ok: false as const, path: target, error: `Unknown addon: ${id}` }

  const written = writePreset(target, addon)

  if (!written.ok) return { ok: false as const, path: written.path, error: written.error }

  // A starter entry becomes an installed one the moment the user applies it, so the provider list
  // keeps showing it after a restart without re-reading the shipped template.
  if (addon.origin === "starter" && !installed.some((item) => item.id === addon.id)) {
    try {
      remember(addon)
    } catch {
      // The provider is already in the config; the cache only keeps the entry listed.
    }
  }

  return { ok: true as const, path: written.path }
}

/** Adds an applied starter entry to the community cache so `list()` returns it from now on. */
function remember(addon: Stored) {
  const entries = [...readCache().map(strip), strip(addon)]
  mkdirSync(path.dirname(cacheFile()), { recursive: true })
  writeFileSync(cacheFile(), JSON.stringify({ presets: entries }, null, 2) + "\n")
}

function strip(entry: Stored): PresetEntry {
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    provider: entry.provider,
    baseURL: entry.baseURL,
    ...(entry.docsURL ? { docsURL: entry.docsURL } : {}),
    ...(entry.keyHint ? { keyHint: entry.keyHint } : {}),
    ...(entry.models ? { models: entry.models } : {}),
  }
}

/** Writes a user-typed provider into the same config file the engine reads. */
function save(id: string, name: string, baseURL: string, models: readonly string[]) {
  const candidates = configCandidates()
  const target = candidates.find((file) => existsSync(file)) ?? candidates[0]!

  return writeCustomProvider(target, { id, name, baseURL, models })
}

export const presetHandlers = PresetRpcs.toLayer(
  Effect.succeed(
    PresetRpcs.of({
      PresetFetch: ({ url }) => Effect.promise(() => fetchRegistry(url)),
      PresetList: () => Effect.sync(() => list()),
      PresetStarter: () => Effect.sync(() => readStarter()),
      PresetApply: ({ id }) => Effect.sync(() => apply(id)),
      PresetSave: ({ id, name, baseURL, models }) => Effect.sync(() => save(id, name, baseURL, models)),
    }),
  ),
)
