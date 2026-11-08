import { Effect, Schema } from "effect"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { app } from "electron"
import { PresetRpcs } from "../../shared/ipc-rpc"
import { Preset } from "../../shared/ipc-rpc/presets"

/**
 * Provider presets.
 *
 * `presets.json` is inert data shipped beside the app. Applying one only writes a base URL into
 * the engine's global config — it never stores a credential, never contacts the provider, and
 * never fabricates a model list. The engine's own catalogue supplies the models.
 */

/** The global config the engine reads. Mirrors `Global.Path.config` in @opencode/core. */
const configDir = path.join(homedir(), ".config", "opencode")

/** Both names the engine discovers; an existing file is preferred over creating a new one. */
const configCandidates = ["opencode.json", "opencode.jsonc"].map((name) => path.join(configDir, name))

const Manifest = Schema.Struct({ presets: Schema.Array(Preset) })

function presetsFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, "presets.json")

  // Running from source: packages/desktop -> repository root.
  return path.join(app.getAppPath(), "..", "..", "presets.json")
}

function list(): Preset[] {
  try {
    return Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(presetsFile(), "utf8"))).presets
  } catch {
    // A missing or malformed presets.json is not an error: the app simply offers no presets.
    return []
  }
}

function apply(id: string) {
  const preset = list().find((item) => item.id === id)
  const target = configCandidates.find((file) => existsSync(file)) ?? configCandidates[0]!

  if (!preset) return { ok: false as const, path: target, error: `Unknown preset: ${id}` }

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
  const entry = providers[preset.provider] ?? {}
  const options = { ...((entry.options ?? {}) as Record<string, unknown>), baseURL: preset.baseURL }

  config.provider = { ...providers, [preset.provider]: { ...entry, options } }

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
      PresetList: () => Effect.sync(() => list()),
      PresetApply: ({ id }) => Effect.sync(() => apply(id)),
    }),
  ),
)
