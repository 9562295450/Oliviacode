import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

/**
 * A provider preset read from `presets.json`.
 *
 * A preset never carries a credential: it names the provider the engine already knows from its
 * catalogue and the base URL to point it at. The user still supplies their own token.
 */
export const Preset = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  /** Provider id in the engine's catalogue, e.g. `opencode`. */
  provider: Schema.String,
  baseURL: Schema.String,
  docsURL: Schema.optionalKey(Schema.String),
})

export type Preset = typeof Preset.Type

export const PresetList = Rpc.make("PresetList", { success: Schema.Array(Preset) })

export const PresetApply = Rpc.make("PresetApply", {
  payload: { id: Schema.String },
  success: Schema.Struct({
    ok: Schema.Boolean,
    /** The config file written, so the UI can show where the value landed. */
    path: Schema.String,
    error: Schema.optionalKey(Schema.String),
  }),
})

export const PresetRpcs = RpcGroup.make(PresetList, PresetApply)
