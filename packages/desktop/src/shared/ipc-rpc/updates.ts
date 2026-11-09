import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

/**
 * The shell updater's state. `unsupported` is a build without a release feed: a dev checkout, or an app
 * packaged without OLIVIACODE_UPDATE_REPO. Every app version below 2.2.6 was packaged without one.
 */
export const UpdateStatus = Schema.Struct({
  state: Schema.Literals([
    "unsupported",
    "idle",
    "checking",
    "available",
    "downloading",
    "ready",
    "up-to-date",
    "error",
  ]),
  version: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String),
  percent: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
  checkedAt: Schema.optionalKey(Schema.Number),
})

export type UpdateStatus = Schema.Schema.Type<typeof UpdateStatus>

export const UpdateGetState = Rpc.make("UpdateGetState", { success: UpdateStatus })

export const UpdateCheck = Rpc.make("UpdateCheck", { success: UpdateStatus })

export const UpdateDownload = Rpc.make("UpdateDownload", { success: UpdateStatus })

/** Quits into the downloaded installer; never returns when the install starts. */
export const UpdateInstall = Rpc.make("UpdateInstall")

export const UpdateRpcs = RpcGroup.make(UpdateGetState, UpdateCheck, UpdateDownload, UpdateInstall)
