import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

/**
 * A provider addon.
 *
 * An addon is inert data: it names a provider id the engine already knows from its own
 * catalogue, and the base URL to point it at. It never carries a credential, and nothing here
 * is bundled with the app — the default list is empty and every entry comes from a community
 * registry the user chooses to load.
 */
export const Preset = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  /** Provider id in the engine's catalogue, e.g. `openai`. */
  provider: Schema.String,
  baseURL: Schema.String,
  docsURL: Schema.optionalKey(Schema.String),
})

export type Preset = typeof Preset.Type

/** Where an addon came from, so the UI can say it out loud. */
export const AddonOrigin = Schema.Literals(["local", "starter", "community"])

export const Addon = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  provider: Schema.String,
  baseURL: Schema.String,
  docsURL: Schema.optionalKey(Schema.String),
  origin: AddonOrigin,
})

export type Addon = typeof Addon.Type

/** The registry a user asked to load. Validated and capped, never trusted beyond that. */
export const PresetFetch = Rpc.make("PresetFetch", {
  payload: { url: Schema.String },
  success: Schema.Struct({
    ok: Schema.Boolean,
    url: Schema.String,
    addons: Schema.Array(Addon),
    error: Schema.optionalKey(Schema.String),
  }),
})

export const PresetList = Rpc.make("PresetList", { success: Schema.Array(Addon) })

/**
 * Entries from the shipped starter template.
 *
 * These are offered in the add-ons dialog only. They are not installed, they do not appear in the
 * provider list, and nothing is written until the user presses one.
 */
export const PresetStarter = Rpc.make("PresetStarter", { success: Schema.Array(Addon) })

export const PresetApply = Rpc.make("PresetApply", {
  payload: { id: Schema.String },
  success: Schema.Struct({
    ok: Schema.Boolean,
    /** The config file written, so the UI can show where the value landed. */
    path: Schema.String,
    error: Schema.optionalKey(Schema.String),
  }),
})

export const PresetRpcs = RpcGroup.make(PresetFetch, PresetList, PresetStarter, PresetApply)
