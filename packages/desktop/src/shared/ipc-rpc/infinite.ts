import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

const Lane = Schema.Literals(["direct", "warp", "tor", "proxy"])

const Trace = Schema.Struct({
  ip: Schema.String,
  loc: Schema.String,
  colo: Schema.String,
  warp: Schema.String,
  at: Schema.Number,
})

const Rotation = Schema.Struct({
  at: Schema.Number,
  lane: Lane,
  from: Schema.String,
  to: Schema.String,
  ms: Schema.Number,
  ok: Schema.Boolean,
  verified: Schema.Boolean,
  error: Schema.String,
})

const Provider = Schema.Struct({
  status: Schema.Literals(["ok", "limited", "unknown"]),
  ip: Schema.String,
  model: Schema.String,
  code: Schema.Number,
  at: Schema.Number,
  detail: Schema.String,
})

const Health = Schema.Struct({
  lane: Lane,
  alive: Schema.Boolean,
  latencyMs: Schema.Number,
  checkedAt: Schema.Number,
  failures: Schema.Number,
})

export const InfiniteState = Schema.Struct({
  lane: Lane,
  phase: Schema.Literals(["idle", "probing", "rotating", "ready", "armed", "error"]),
  next: Schema.NullOr(Lane),
  trace: Schema.NullOr(Trace),
  endpoint: Schema.String,
  armed: Schema.Boolean,
  autoRecover: Schema.Boolean,
  rotations: Schema.Number,
  recoveries: Schema.Number,
  failures: Schema.Number,
  since: Schema.Number,
  lastError: Schema.String,
  history: Schema.Array(Rotation),
  health: Schema.Array(Health),
  watch: Schema.String,
  stuck: Schema.String,
  provider: Schema.NullOr(Provider),
  updateAvailable: Schema.Boolean,
  updateVersion: Schema.String,
})

export const InfiniteSettings = Schema.Struct({
  autoRecover: Schema.Boolean,
  cooldownMs: Schema.Number,
  tries: Schema.Number,
  rotateTimeoutMs: Schema.Number,
  probeTimeoutMs: Schema.Number,
  resume: Schema.Boolean,
  fallback: Schema.Array(Lane),
  pinnedProxy: Schema.String,
  watchLimits: Schema.Boolean,
  quotaRotates: Schema.Boolean,
  verifyProvider: Schema.Boolean,
  providerEndpoint: Schema.String,
  providerModel: Schema.String,
  providerKey: Schema.String,
})

export const InfiniteRotateResult = Schema.Struct({
  ok: Schema.Boolean,
  from: Schema.String,
  to: Schema.String,
  lane: Lane,
  ms: Schema.Number,
  error: Schema.String,
})

/** The live engine state, sent whole on every change. */
export const InfiniteGetState = Rpc.make("InfiniteGetState", { success: InfiniteState })

export const InfiniteGetSettings = Rpc.make("InfiniteGetSettings", { success: InfiniteSettings })

export const InfiniteSetSettings = Rpc.make("InfiniteSetSettings", {
  payload: { settings: InfiniteSettings },
  success: InfiniteSettings,
})

/** Put a lane in place without rotating: wires the endpoint and probes once. */
export const InfiniteSetLane = Rpc.make("InfiniteSetLane", {
  payload: { lane: Lane },
  success: InfiniteState,
})

/** Rotate to a fresh address on the current lane, or on `lane` when one is named. */
export const InfiniteRotate = Rpc.make("InfiniteRotate", {
  payload: { lane: Schema.optionalKey(Lane) },
  success: InfiniteRotateResult,
})

/** Arm or disarm automatic recovery without touching the rest of the settings. */
export const InfiniteArm = Rpc.make("InfiniteArm", {
  payload: { armed: Schema.Boolean },
  success: InfiniteState,
})

/** Probe every lane and refresh the health column. */
export const InfiniteCheckLanes = Rpc.make("InfiniteCheckLanes", { success: InfiniteState })

/** Feed the engine a sidecar log line; it decides whether the line is a limit. */
export const InfiniteObserve = Rpc.make("InfiniteObserve", {
  payload: { line: Schema.String },
})

/** Ask the engine whether a newer CLI release is available. */
export const InfiniteCheckUpdate = Rpc.make("InfiniteCheckUpdate", {
  success: Schema.Struct({
    available: Schema.Boolean,
    version: Schema.String,
  }),
})

/** Download and install the latest CLI release. */
export const InfiniteApplyUpdate = Rpc.make("InfiniteApplyUpdate", {
  success: Schema.Struct({
    ok: Schema.Boolean,
    error: Schema.optionalKey(Schema.String),
  }),
})

export const InfiniteRpcs = RpcGroup.make(
  InfiniteGetState,
  InfiniteGetSettings,
  InfiniteSetSettings,
  InfiniteSetLane,
  InfiniteRotate,
  InfiniteArm,
  InfiniteCheckLanes,
  InfiniteObserve,
  InfiniteCheckUpdate,
  InfiniteApplyUpdate,
)
