/**
 * The egress contract, shared by the main process and the renderer.
 *
 * This module is re-exported by `@opencode/desktop/shared/infinite` so the Electron main
 * process and the app package agree on one shape without either importing the other's
 * internals.
 */

export const infiniteLanes = ["direct", "warp", "tor", "proxy"] as const

/** How the app reaches the network. `direct` is the machine's own route. */
export type InfiniteLane = (typeof infiniteLanes)[number]

/** What the engine is doing right now. */
export type InfinitePhase = "idle" | "probing" | "rotating" | "ready" | "armed" | "error"

/** One fetch of the egress trace: who the far end thinks we are. */
export type EgressTrace = {
  readonly ip: string
  readonly loc: string
  readonly colo: string
  readonly warp: string
  readonly at: number
}

/** A single rotation, kept so the panel can show what actually happened. */
export type RotationRecord = {
  readonly at: number
  readonly lane: InfiniteLane
  readonly from: string
  readonly to: string
  readonly ms: number
  readonly ok: boolean
  /** The provider accepted the new exit; false when it answered a limit or could not be asked. */
  readonly verified: boolean
  /** Why it failed, when it did. Empty on success. */
  readonly error: string
}

/** A per-lane health reading, kept short so the panel can rank lanes. */
export type LaneHealth = {
  readonly lane: InfiniteLane
  readonly alive: boolean
  readonly latencyMs: number
  readonly checkedAt: number
  /** Consecutive failures since the last success; drives the backoff. */
  readonly failures: number
}

/** What the provider said about the exit address, when the engine asked it. */
export type ProviderVerdict = {
  /** `ok` keeps the exit, `limited` scraps it, `unknown` keeps it unproven. */
  readonly status: "ok" | "limited" | "unknown"
  readonly ip: string
  readonly model: string
  /** The HTTP status the provider answered, or 0 when the request never landed. */
  readonly code: number
  readonly at: number
  /** The provider's own words when it refused; empty when it accepted. */
  readonly detail: string
}

/** The whole engine state, sent whole on every change. */
export type InfiniteState = {
  readonly lane: InfiniteLane
  readonly phase: InfinitePhase
  /** The lane the engine would move to at the next rotation, when queued. */
  readonly next: InfiniteLane | null
  readonly trace: EgressTrace | null
  /** Where the app connects: an HTTP proxy URL, or empty for a direct route. */
  readonly endpoint: string
  readonly armed: boolean
  readonly autoRecover: boolean
  readonly rotations: number
  readonly recoveries: number
  readonly failures: number
  readonly since: number
  readonly lastError: string
  /** The last few rotations, newest first. */
  readonly history: readonly RotationRecord[]
  /** One reading per lane, in `infiniteLanes` order. */
  readonly health: readonly LaneHealth[]
  /** The limit the engine is watching for, in the words the sidecar used. */
  readonly watch: string
  /**
   * Set when rotation has been proven not to clear the limit: at least two fresh exit
   * addresses were refused too. Empty while another rotation may still help.
   */
  readonly stuck: string
  /** The last provider check, or null when none has run since the engine started. */
  readonly provider: ProviderVerdict | null
  /** Whether a newer CLI release is available, per the update endpoint. */
  readonly updateAvailable: boolean
  /** The newer version string, empty when none is available. */
  readonly updateVersion: string
}

/** What the engine needs to know to run. Every value is bounded at the edge. */
export type InfiniteSettings = {
  /** Rotate by itself when the sidecar reports a limit. */
  readonly autoRecover: boolean
  /** Wait this long after a rotation before the next one may start, in ms. */
  readonly cooldownMs: number
  /** How many times one limit event may try to find a new address. */
  readonly tries: number
  /**
   * How long one lane may keep starting attempts before the engine moves on, in ms. An
   * attempt already running is never killed: its tool has its own deadline, and a WARP
   * re-registration regularly needs more than a minute.
   */
  readonly rotateTimeoutMs: number
  /** How long a trace probe may take, in ms. */
  readonly probeTimeoutMs: number
  /** Resume the session after a rotation by restarting the sidecar. */
  readonly resume: boolean
  /** Prefer the next lane in this order; empty means keep the current lane. */
  readonly fallback: readonly InfiniteLane[]
  /** The HTTP proxy a `proxy` lane rotation picks from, when pinned. Empty means pick automatically. */
  readonly pinnedProxy: string
  /** Detect `429` and limit wording in the sidecar log and rotate on it. */
  readonly watchLimits: boolean
  /**
   * Rotate on account-shaped quota lines too. The free lane counts its allowance per
   * address, so a "free usage limit" line is exactly what a new exit can clear.
   */
  readonly quotaRotates: boolean
  /** Ask the provider whether the new exit may use it before keeping it. */
  readonly verifyProvider: boolean
  /** The provider endpoint the verification spends one token on. Empty means no provider check. */
  readonly providerEndpoint: string
  /** The model the provider check spends one token on. Empty means none selected. */
  readonly providerModel: string
  /** The key the provider check sends; empty means no key is sent. */
  readonly providerKey: string
}

export const infiniteDefaults: InfiniteSettings = {
  // The whole point of the watcher is to outlive a limit without a click. Arming is what
  // turns it live, and a first run starts armed; the sidebar button still disarms it.
  autoRecover: true,
  cooldownMs: 10_000,
  tries: 4,
  rotateTimeoutMs: 60_000,
  probeTimeoutMs: 8_000,
  resume: true,
  fallback: ["warp", "tor", "proxy"],
  pinnedProxy: "",
  watchLimits: true,
  quotaRotates: true,
  verifyProvider: false,
  providerEndpoint: "",
  providerModel: "",
  providerKey: "",
}

/** Bounds for every numeric setting, so a hand-edited config cannot wedge the engine. */
export const infiniteBounds = {
  cooldownMs: [0, 600_000],
  tries: [1, 40],
  rotateTimeoutMs: [5_000, 300_000],
  probeTimeoutMs: [1_000, 60_000],
} as const satisfies Record<string, readonly [number, number]>

/** What a rotation reports back to the caller. */
export type RotateResult = {
  readonly ok: boolean
  readonly from: string
  readonly to: string
  readonly lane: InfiniteLane
  readonly ms: number
  readonly error: string
}

export function clampInt(value: number, low: number, high: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(high, Math.max(low, Math.round(value)))
}

export function laneLabel(lane: InfiniteLane) {
  switch (lane) {
    case "direct":
      return "Direct"
    case "warp":
      return "WARP"
    case "tor":
      return "Tor"
    case "proxy":
      return "Proxy"
  }
}

/** The shortest honest description of a phase, for the status pill. */
export function phaseLabel(state: Pick<InfiniteState, "phase" | "lane" | "armed">) {
  switch (state.phase) {
    case "idle":
      return "Idle"
    case "probing":
      return "Checking"
    case "rotating":
      return "Rotating"
    case "ready":
      return "Active"
    case "armed":
      return state.armed ? "Armed" : "Active"
    case "error":
      return "Fault"
  }
}
