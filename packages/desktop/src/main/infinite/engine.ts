/**
 * The egress engine.
 *
 * One object owns the lane, the endpoint the app should talk through, and the history of
 * what actually changed. Every rotation ends in a trace probe and is only counted when the
 * address differs from the one before it — a rotation that returns the same exit is a
 * failure, not a success with a footnote.
 *
 * The engine has no timer that runs on its own except the recovery cooldown. Everything
 * else is pull: a probe on demand, a rotation on request, and a log line pushed in from
 * the sidecar watcher.
 */
import { EventEmitter } from "node:events"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import {
  clampInt,
  infiniteBounds,
  infiniteDefaults,
  infiniteLanes,
  type InfiniteLane,
  type InfiniteSettings,
  type InfiniteState,
  type LaneHealth,
  type ProviderVerdict,
  type RotateResult,
  type RotationRecord,
} from "../../shared/infinite"
import { ProxyPool } from "./proxies"
import { providerProbe, type ProviderConfig } from "./provider"
import { classifyProvider, readActiveProvider, type ActiveProvider } from "./provider-config"
import {
  FREE_ALLOWANCE,
  freeLimitStuck,
  proofLimit,
  proofReset,
  proofRotated,
  recoveryProof,
  stuckNotice,
  type RecoveryProof,
} from "./recovery"
import { SidecarEndpoint } from "./sidecar-endpoint"
import { probe, type Trace } from "./trace"
import { Tor } from "./tor"
import { sleep, Warp } from "./warp"

/** `warp-cli proxy port` is configurable; the port is fixed so a saved endpoint survives a restart. */
const WARP_PROXY_PORT = 40000
/** Written by every successful rotation; the panel and the compare both read it. */
const HISTORY_LIMIT = 40
/** How many past exits to refuse when looking for a new one. */
const RECENT_EXITS = 8
/** A reconnect that has not answered by now is left running; the next request still lands. */
const RESUME_TIMEOUT_MS = 20_000
/** How many restarts one endpoint move gets before the next rotation or lane switch tries again. */
const RESUME_ATTEMPTS = 2
const RESUME_RETRY_MS = 1_500
/**
 * How often the active lane is checked when nobody is asking.
 *
 * A bridge or a tunnel can die between rotations — Tor crashes, WARP is disconnected from
 * its own window, a free proxy expires. The sidecar keeps dialling the dead loopback port
 * and every request fails with a refused connect that names no cause. Two failed checks in
 * a row is enough evidence to put the app back on the machine's own route.
 */
const WATCHDOG_MS = 45_000
const WATCHDOG_STRIKES = 2
/** A provider key is re-read at most this often; the config changes on a person's click. */
const PROVIDER_CACHE_MS = 30_000
/** This build's version, compared against OpenCode's CLI releases. */
const __OLIVIACODE_VERSION__ = "0.1.0"

/** Limit wording that describes the network rather than the account. */
const LIMIT_PATTERNS: readonly RegExp[] = [
  /rate[ _-]?limit(?:ed)?/i,
  /too many requests/i,
  /limit reached/i,
  // A status field, never a bare number: `http.span=429` is a span id, not a refusal.
  /(?:http\.)?status[=:] ?"?429\b/i,
  /(?:status|code)[=:] ?"?429\b/i,
]

/**
 * Records that describe the process, not the provider.
 *
 * The sidecar logs every shell it spawns at INFO with the full command line, so a command
 * that merely mentions a limit would otherwise read as one. Level and message shape are
 * checked together: INFO/DEBUG records are never inferences, and a spawn record is always
 * the harness talking to itself.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /level=(?:INFO|DEBUG|TRACE)\b/,
  /message="spawning process"/,
  /message="Sent HTTP response" http\.span=\d+ role=server http\.method=\S+ http\.url=\S+ http\.status=(?:200|204|304)\b/,
]

/**
 * Wording that names an allowance rather than a network block.
 *
 * A paid quota is spent by the credential, so a new exit reaches the same answer and
 * `quotaRotates` gates it — off by default, because an exit cannot refill an invoice.
 *
 * The free lane is the exception inside this list: upstream's inference proxy forwards the
 * client address as `x-zen-ip`, so that allowance is counted per exit address and a fresh
 * exit does carry a fresh allowance. `FREE_ALLOWANCE` is matched before this list is read
 * and never takes the `quotaRotates` gate; see `observe`.
 */
const QUOTA_PATTERNS: readonly RegExp[] = [
  /free usage limit/i,
  /freeusagelimiterror/i,
  /quota (?:exceeded|exhausted|reached)/i,
  /usage limit/i,
  /out of (?:credits|requests)/i,
  /resets? (?:at|in)\b/i,
]

export type EngineHooks = {
  /** Restart the sidecar so the new endpoint is picked up and the session resumes. */
  readonly restartSidecar?: () => Promise<void>
}

/** One attempt on one lane: an exit that held, or the reason it did not. */
type Step =
  | { readonly ok: true; readonly endpoint: string; readonly trace: Trace; readonly verified: boolean }
  | { readonly ok: false; readonly error: string }

export class InfiniteEngine extends EventEmitter {
  readonly warp = new Warp()
  readonly tor = new Tor()
  readonly proxies = new ProxyPool()

  #settings: InfiniteSettings = infiniteDefaults
  #hooks: EngineHooks = {}
  #lane: InfiniteLane = "direct"
  #phase: InfiniteState["phase"] = "idle"
  #next: InfiniteLane | null = null
  #trace: Trace | null = null
  #endpoint = ""
  /** The endpoint the running sidecar was actually started with, which lags `#endpoint`. */
  readonly #service = new SidecarEndpoint()
  #armed = true
  #rotations = 0
  #recoveries = 0
  #failures = 0
  #since = Date.now()
  #lastError = ""
  #history: RotationRecord[] = []
  #health: LaneHealth[] = infiniteLanes.map((lane) => ({
    lane,
    alive: false,
    latencyMs: 0,
    checkedAt: 0,
    failures: 0,
  }))
  #watch = ""
  #watchAt = 0
  /** The last provider check, so the panel can show what a rotation actually bought. */
  #provider: ProviderVerdict | null = null
  /** The addresses of the last few successful exits, newest first. */
  #exits: string[] = []
  /** How many fresh exits the provider has refused since the last manual rotation. */
  #proof: RecoveryProof = recoveryProof
  /** Set once rotation is proven not to clear the limit; empty while it may still help. */
  #stuck = ""
  #rotating: Promise<RotateResult> | null = null
  #recentHits = new Map<string, number>()
  #disposed = false
  /** CLI update check: last-checked version and whether a newer CLI release exists. */
  #updateChecked = 0
  #updateAvailable = false
  #updateVersion = ""
  /** The provider target read from the engine config, cached between rotations. */
  #providerConfig: { readonly at: number; readonly value: ActiveProvider } | null = null
  /** The lane watchdog: one probe at a time, never during a rotation. */
  #watchdog: NodeJS.Timeout | null = null
  #watchdogBusy = false
  #watchdogStrikes = 0

  get settings() {
    return this.#settings
  }

  get lane() {
    return this.#lane
  }

  get endpoint() {
    return this.#endpoint
  }

  configure(hooks: EngineHooks) {
    this.#hooks = hooks
  }

  // ---------------------------------------------------------------- persistence

  #file() {
    return join(app.getPath("userData"), "egress", "state.json")
  }

  async load() {
    let scrubKey = false
    try {
      const raw = JSON.parse(readFileSync(this.#file(), "utf8")) as Record<string, unknown>
      const stored = (raw.settings ?? {}) as Record<string, unknown>
      // A save written before this feature has no `quotaRotates`. That install kept
      // recovery behind a manual Arm, so the upgrade arms it once and the sidebar can
      // disarm it again. `quotaRotates` is not forced on with it: an allowance is not
      // something an exit can refill, and the default is now the record-only behaviour.
      const legacy = typeof stored !== "object" || !("quotaRotates" in stored)

      this.#settings = sanitizeSettings(stored)
      // A key written by an older build is not resurrected and never written again. The
      // probe resolves the key from the provider config at request time instead.
      scrubKey = this.#settings.providerKey !== ""
      this.#settings = { ...this.#settings, providerKey: "" }
      if (legacy) this.#settings = { ...this.#settings, autoRecover: true }
      this.#lane = infiniteLanes.includes(raw.lane as InfiniteLane) ? (raw.lane as InfiniteLane) : "direct"
      this.#armed = legacy ? true : raw.armed === true
      this.#rotations = typeof raw.rotations === "number" ? raw.rotations : 0
      this.#recoveries = typeof raw.recoveries === "number" ? raw.recoveries : 0
      this.#failures = typeof raw.failures === "number" ? raw.failures : 0
      this.#exits = Array.isArray(raw.exits) ? raw.exits.filter((value): value is string => typeof value === "string") : []
      // Older saves predate the provider check; a record without a verdict reads as
      // unverified rather than failing the state schema the window decodes against.
      this.#history = Array.isArray(raw.history)
        ? (raw.history as RotationRecord[])
            .slice(0, HISTORY_LIMIT)
            .map((record) => ({ ...record, verified: record.verified === true }))
        : []
      // The endpoint is deliberately not restored. A bridge port belongs to the process
      // that opened it, and the one in the saved state died with the last run; applying it
      // here pointed the sidecar at a closed port before `activate` could re-prepare, which
      // is the refused connect users saw on every launch. The lane is restored, then
      // `boot` re-proves it and applies the endpoint it actually gets.
      this.#endpoint = ""
      this.#trace = null
    } catch {
      // No saved state is the normal first run, not a failure.
    }
    // Rewrite the file at once when it carried a key: the plaintext should not survive a
    // single further launch, even if nothing else in the settings changes.
    if (scrubKey) this.#save()
    this.#emit()
  }

  #save() {
    const body = JSON.stringify(
      {
        // The probe key is held for this session only; a state file is not a vault.
        settings: { ...this.#settings, providerKey: "" },
        lane: this.#lane,
        endpoint: this.#endpoint,
        armed: this.#armed,
        rotations: this.#rotations,
        recoveries: this.#recoveries,
        failures: this.#failures,
        exits: this.#exits,
        history: this.#history,
      },
      null,
      2,
    )
    try {
      mkdirSync(dirname(this.#file()), { recursive: true })
      writeFileSync(this.#file(), body, "utf8")
    } catch {
      // A read-only profile must not stop the engine from running this session.
    }
  }

  // ---------------------------------------------------------------- state

  snapshot(): InfiniteState {
    return {
      lane: this.#lane,
      phase: this.#phase,
      next: this.#next,
      trace: this.#trace,
      endpoint: this.#endpoint,
      armed: this.#armed,
      autoRecover: this.#settings.autoRecover,
      rotations: this.#rotations,
      recoveries: this.#recoveries,
      failures: this.#failures,
      since: this.#since,
      lastError: this.#lastError,
      history: this.#history.slice(0, HISTORY_LIMIT),
      health: this.#health,
      watch: this.#watch,
      stuck: this.#stuck,
      provider: this.#provider,
      updateAvailable: this.#updateAvailable,
      updateVersion: this.#updateVersion,
    }
  }

  #emit() {
    this.emit("state", this.snapshot())
  }

  // ---------------------------------------------------------------- settings

  setSettings(input: InfiniteSettings): InfiniteSettings {
    this.#settings = sanitizeSettings(input)
    if (!this.#settings.autoRecover) this.#armed = false
    // Saving settings is a person answering the notice — a provider, a key, a model. Whatever
    // the engine concluded before that answer is stale.
    this.#stuck = ""
    this.#providerConfig = null
    this.#save()
    this.#emit()
    return this.#settings
  }

  setArmed(armed: boolean) {
    this.#armed = armed
    // Arming is the switch the sidebar offers. A persisted "recover automatically" that
    // stayed off would make that button a no-op, so arming turns it on too. It is also a
    // person asking the engine to try again, so the strikes collected on the old exits go.
    if (armed && !this.#settings.autoRecover) this.#settings = { ...this.#settings, autoRecover: true }
    if (armed) {
      this.#proof = proofReset(this.#proof)
      this.#stuck = ""
    }
    if (this.#phase !== "rotating") this.#phase = armed ? "armed" : this.#trace ? "ready" : "idle"
    this.#save()
    this.#emit()
  }

  // ---------------------------------------------------------------- lanes

  /** Point the app at a lane and prove it answers. No rotation, just activation. */
  async activate(lane: InfiniteLane): Promise<InfiniteState> {
    // Leaving the WARP lane gives the client its own mode back. Proxy mode is a change to
    // the whole client, not to this app, so it is not left behind.
    if (this.#lane === "warp" && lane !== "warp") await this.warp.restore().catch(() => "")
    this.#lane = lane
    this.#phase = "probing"
    this.#lastError = ""
    this.#provider = null
    // The previous lane's endpoint belongs to a bridge this call has not prepared. Keeping
    // it would show an address from the old lane and leave the sidecar dialling it after a
    // failed switch; the route falls back to the machine's own until a new one is proven.
    this.#endpoint = ""
    this.#trace = null
    applyEndpoint("")
    // A different lane is a different set of exits; strikes from the last one say nothing
    // about this one.
    this.#proof = proofReset(this.#proof)
    this.#watchdogStrikes = 0
    this.#stuck = ""
    this.#emit()

    const prepared = await this.#prepare(lane)

    if (prepared.error) {
      this.#failures += 1
      this.#lastError = prepared.error
      this.#phase = "error"
      this.#save()
      this.#emit()
      return this.snapshot()
    }

    const outcome = await probe(prepared.endpoint, this.#settings.probeTimeoutMs)

    if (!outcome.ok) {
      this.#failures += 1
      this.#lastError = outcome.error
      this.#phase = "error"
      this.#recordHealth(lane, false, outcome.latencyMs)
      this.#save()
      this.#emit()
      return this.snapshot()
    }

    this.#endpoint = prepared.endpoint
    applyEndpoint(this.#endpoint)
    // A lane switch starts a fresh bridge on a fresh port. Without this the sidecar would keep
    // dialling the old one, which is the refused-connect ticket this patch exists for.
    void this.#resume()
    this.#trace = outcome.trace
    this.#since = Date.now()
    this.#phase = this.#armed ? "armed" : "ready"
    this.#recordHealth(lane, true, outcome.latencyMs)
    this.#rememberExit(outcome.trace.ip)
    this.#save()
    this.#emit()
    return this.snapshot()
  }

  /** Start every lane-specific process a lane needs, and return its endpoint. */
  async #prepare(lane: InfiniteLane): Promise<{ endpoint: string; error: string }> {
    switch (lane) {
      case "direct":
        return { endpoint: "", error: "" }

      case "warp": {
        const error = await this.warp.prepare(WARP_PROXY_PORT)
        return { endpoint: error ? "" : this.warp.endpoint, error }
      }

      case "tor": {
        const error = await this.tor.start()
        return { endpoint: error ? "" : this.tor.endpoint, error }
      }

      case "proxy": {
        const settings = this.#settings
        if (settings.pinnedProxy) {
          const outcome = await probe(settings.pinnedProxy, settings.probeTimeoutMs)
          return outcome.ok ? { endpoint: settings.pinnedProxy, error: "" } : { endpoint: "", error: outcome.error }
        }
        const refreshed = await this.proxies.refresh()
        if (refreshed) return { endpoint: "", error: refreshed }
        const found = await this.proxies.findWorking(Math.min(8, settings.tries * 2), settings.probeTimeoutMs)
        if (!found.entry) return { endpoint: "", error: "no working free proxy" }
        return { endpoint: found.entry.url, error: "" }
      }
    }
  }

  // ---------------------------------------------------------------- rotation

  /**
   * Rotate to a different exit address and verify it. Concurrent calls share one
   * rotation — two limit lines in the same second must not spend two registrations.
   *
   * This is the path a person takes, so it clears the strikes: they may have switched model,
   * connected a provider, or restarted the tunnel since the last attempt, and none of that is
   * visible to the engine.
   */
  rotate(lane?: InfiniteLane): Promise<RotateResult> {
    this.#proof = proofReset(this.#proof)
    this.#stuck = ""
    return this.#rotateShared(lane)
  }

  /** The automatic path. It keeps the score, because nothing about the ticket changed. */
  #rotateShared(lane?: InfiniteLane): Promise<RotateResult> {
    if (this.#rotating) return this.#rotating
    this.#rotating = this.#rotate(lane).finally(() => {
      this.#rotating = null
    })
    return this.#rotating
  }

  async #rotate(lane?: InfiniteLane): Promise<RotateResult> {
    const target = lane ?? this.#lane
    const started = Date.now()
    const from = this.#trace?.ip ?? ""
    this.#phase = "rotating"
    this.#next = null
    this.#lastError = ""
    this.#provider = null
    this.#emit()

    // `direct` has no exit to rotate, but it is where a first run starts. Refusing here is
    // why an out-of-the-box install could watch the wall and never move: auto-recovery fired,
    // the rotation returned "pick a lane", and nothing changed. Spend the recovery on the
    // first lane this settings file allows instead.
    const fallbacks = [...new Set(this.#settings.fallback.filter((entry) => entry !== "direct"))]
    const order: InfiniteLane[] =
      target === "direct" ? fallbacks : [target, ...fallbacks.filter((entry) => entry !== target)]

    if (order.length === 0) {
      const result: RotateResult = {
        ok: false,
        from,
        to: from,
        lane: target,
        ms: Date.now() - started,
        error: "the direct lane has no exit to rotate; pick WARP, Tor, or a proxy, or add one to the fallbacks",
      }
      this.#failures += 1
      this.#lastError = result.error
      this.#phase = "error"
      this.#emit()
      return result
    }

    // A lane change before rotating, so the endpoint the app is handed matches the lane.
    // A rotation that started on `direct` only learns its lane from the attempt that wins.
    const first = order[0]!
    if (target !== "direct" && target !== this.#lane) {
      this.#lane = target
      this.#endpoint = ""
    }

    const attempts = Math.max(1, this.#settings.tries)
    let lastError = ""
    let lastLane: InfiniteLane = first
    let winner: InfiniteLane | null = null

    for (const [index, current] of order.entries()) {
      lastLane = current
      // The budget is per lane and per attempt start. Every tool call inside an attempt has
      // its own deadline (`warp-cli` gives `registration new` two minutes), so the engine
      // must not kill one mid-flight — it only refuses to start another once the budget is
      // spent, then moves to the next lane. This is what keeps a 66-second WARP
      // re-registration from being called a failure by a 60-second setting.
      const deadline = Date.now() + this.#settings.rotateTimeoutMs

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        this.#next = index + 1 < order.length ? order[index + 1]! : null

        if (attempt > 1 && Date.now() > deadline) {
          lastError = `${current}: no exit inside ${Math.round(this.#settings.rotateTimeoutMs / 1_000)}s`
          break
        }

        const step = await this.#rotateOnce(current, from, attempt).catch<Step>((error) => ({
          ok: false,
          error: message(error),
        }))

        if (!step.ok) {
          lastError = step.error
          if (attempt < attempts) {
            // A short pause between attempts keeps the daemon from refusing a repeat.
            await sleep(750)
          }
          continue
        }

        this.#lane = current
        this.#trace = step.trace
        this.#endpoint = step.endpoint
        applyEndpoint(this.#endpoint)
        this.#rotations += 1
        // From here a limit line is evidence about this address, not about the last one.
        this.#proof = proofRotated(this.#proof, Date.now())
        this.#watchdogStrikes = 0
        this.#since = Date.now()
        this.#phase = this.#armed ? "armed" : "ready"
        this.#rememberExit(step.trace.ip)
        this.#recordHealth(current, true, Date.now() - started)
        this.#pushHistory({
          at: Date.now(),
          lane: current,
          from,
          to: step.trace.ip,
          ms: Date.now() - started,
          ok: true,
          verified: step.verified,
          error: "",
        })

        // The sidecar inherits this process's proxy environment, so it only picks up a moved
        // endpoint once it is started again. `#resume` decides against the endpoint the sidecar
        // was last started with, not the one this rotation began on — that is what lands a port
        // change even when the rotation returned the same url it started from.
        void this.#resume()

        this.#next = null
        this.#save()
        this.#emit()
        winner = current
        break
      }

      if (winner) break
    }

    if (winner) {
      return {
        ok: true,
        from,
        to: this.#trace?.ip ?? "",
        lane: winner,
        ms: Date.now() - started,
        error: "",
      }
    }

    this.#failures += 1
    this.#lastError = lastError || "rotation did not produce a new address"
    this.#phase = "error"
    this.#recordHealth(lastLane, false, Date.now() - started)
    const failed: RotateResult = {
      ok: false,
      from,
      to: this.#trace?.ip ?? "",
      lane: lastLane,
      ms: Date.now() - started,
      error: this.#lastError,
    }
    this.#pushHistory({
      at: Date.now(),
      lane: lastLane,
      from,
      to: failed.to,
      ms: failed.ms,
      ok: false,
      verified: false,
      error: failed.error,
    })
    this.#save()
    this.#emit()
    return failed
  }

  /**
   * One attempt on one lane. Resolves with the new trace and endpoint, or with the reason
   * it could not produce an address different from `from`.
   */
  async #rotateOnce(lane: InfiniteLane, from: string, attempt: number): Promise<Step> {
    let endpoint = ""

    switch (lane) {
      case "warp": {
        const rotated = await this.warp.rotate()
        if (!rotated.ok) return { ok: false, error: rotated.error }
        endpoint = this.warp.endpoint
        break
      }

      case "tor": {
        const rotated = await this.tor.rotate()
        if (!rotated.ok) return { ok: false, error: rotated.error }
        endpoint = this.tor.endpoint || (await this.tor.start() ? "" : this.tor.endpoint)
        if (!endpoint) return { ok: false, error: "tor bridge is not listening" }
        break
      }

      case "proxy": {
        await this.proxies.refresh()
        // Exclude the exits already spent so a small pool cannot cycle back to the same one.
        const found = await this.proxies.findWorking(
          Math.max(3, this.#settings.tries),
          this.#settings.probeTimeoutMs,
          () => undefined,
        )
        if (!found.entry) return { ok: false, error: "no working free proxy answered" }
        endpoint = found.entry.url
        break
      }

      case "direct":
        return { ok: false, error: "the direct lane has no exit to rotate" }
    }

    const outcome = await probe(endpoint, this.#settings.probeTimeoutMs)
    if (!outcome.ok) return { ok: false, error: outcome.error }

    if (from && outcome.trace.ip === from) {
      return {
        ok: false,
        error: `attempt ${attempt} returned the same exit ${from}`,
      }
    }

    if (this.#exits.includes(outcome.trace.ip)) {
      return {
        ok: false,
        error: `attempt ${attempt} reused a recent exit ${outcome.trace.ip}`,
      }
    }

    if (this.#settings.verifyProvider) {
      const target = this.#probeTarget()

      // A provider on loopback never travels the lane: `NO_PROXY` excludes it, and its own
      // pool counts its own quota. Probing it through a tunnel would answer about a route
      // the session does not take — and mark a perfectly good exit unverified.
      if (target.kind === "local") {
        this.#provider = {
          status: "unknown",
          ip: outcome.trace.ip,
          model: target.model,
          code: 0,
          at: Date.now(),
          detail: "provider runs on this machine; the lane does not carry it",
        }
        this.#emit()
        return { ok: true, endpoint, trace: outcome.trace, verified: false }
      }

      if (target.kind === "remote") {
        // The endpoint and key come from the provider the session actually uses. A manually
        // entered endpoint still wins, so a person can point the probe somewhere else.
        const config: ProviderConfig = { endpoint: target.endpoint, key: target.key, model: target.model }
        const verdict = await providerProbe(config, outcome.trace.ip, {
          timeoutMs: this.#settings.probeTimeoutMs,
          model: target.model,
          key: target.key,
          proxy: endpoint,
        })
        this.#provider = verdict
        this.#emit()

        if (verdict.status === "limited" && !target.key) {
          // Park the address so the pool does not hand it back on the next attempt, and let
          // the loop spend the next one on an address the provider has not refused. It also
          // joins the recent-exit list, so a lane that returns it is refused before a probe.
          if (lane === "proxy") this.proxies.failed(endpoint)
          this.#rememberExit(outcome.trace.ip)
          return { ok: false, error: `provider still limited on ${outcome.trace.ip}` }
        }

        // A limit under a real key is an account allowance: every exit serves the same
        // account, so the address is kept. `unknown` keeps the exit for the same reason —
        // a probe that could not answer is not evidence that the address is refused. Both
        // land in the history as unverified.
        return { ok: true, endpoint, trace: outcome.trace, verified: verdict.status === "ok" }
      }
    }

    // Verification is off: the exit stands on its trace alone, and the history says so.
    return { ok: true, endpoint, trace: outcome.trace, verified: false }
  }

  /**
   * The provider the probe should ask, from the panel or from the config the app is using.
   *
   * A manual endpoint wins when it is set, so the check can be pointed at any provider
   * without touching `opencode.json`. Otherwise the answer is read from the same file the
   * sidecar reads, which is the only place the session's real provider is written down.
   */
  #probeTarget(): ActiveProvider {
    const manual = this.#settings.providerEndpoint
    if (manual) return classifyProvider(manual, this.#settings.providerModel, this.#settings.providerKey)

    // The config changes when a person clicks a model; a short cache keeps a rotation from
    // reading and parsing the file once per attempt.
    const now = Date.now()
    if (this.#providerConfig && now - this.#providerConfig.at < PROVIDER_CACHE_MS) return this.#providerConfig.value

    const value = readActiveProvider()
    this.#providerConfig = { at: now, value }
    return value
  }

  // ---------------------------------------------------------------- watchdog

  /** Start the periodic lane check. Idempotent; `dispose` clears it. */
  startWatchdog() {
    if (this.#watchdog || this.#disposed) return
    const timer = setInterval(() => void this.#watchOnce(), WATCHDOG_MS)
    timer.unref?.()
    this.#watchdog = timer
  }

  /**
   * A lane that stops answering is put back to Direct.
   *
   * The sidecar does not know a bridge died; it keeps dialling the loopback port and every
   * request fails with a refused connect that names no cause. Two failed checks in a row is
   * enough evidence, and a person can always pick the lane again — staying on a dead port
   * is the failure that never recovers on its own.
   */
  async #watchOnce() {
    if (this.#disposed || this.#watchdogBusy) return
    if (this.#rotating || this.#phase === "rotating") return
    const dead = this.#lane
    if (dead === "direct") return
    if (!this.#endpoint) return

    this.#watchdogBusy = true
    try {
      const outcome = await probe(this.#endpoint, this.#settings.probeTimeoutMs)

      if (outcome.ok) {
        if (this.#watchdogStrikes > 0) this.#watchdogStrikes = 0
        this.#recordHealth(dead, true, outcome.latencyMs)
        return
      }

      this.#watchdogStrikes += 1
      this.#recordHealth(dead, false, outcome.latencyMs)
      if (this.#watchdogStrikes < WATCHDOG_STRIKES) {
        this.#emit()
        return
      }

      await this.#fallbackToDirect(dead, outcome.error).catch(() => undefined)
    } finally {
      this.#watchdogBusy = false
    }
  }

  /** Leave a dead lane for the machine's own route, and say so once. */
  async #fallbackToDirect(dead: InfiniteLane, why: string) {
    this.#watchdogStrikes = 0
    this.#lane = "direct"
    this.#endpoint = ""
    this.#trace = null
    applyEndpoint("")
    // Proxy mode is a change to the whole WARP client; leaving the lane gives it back.
    if (dead === "warp") await this.warp.restore().catch(() => "")

    // Direct is not assumed: the machine's own route is probed so the panel shows a real
    // address, or the failure that the lane switch exposed.
    const direct = await probe("", this.#settings.probeTimeoutMs)
    if (direct.ok) {
      this.#trace = direct.trace
      this.#since = Date.now()
    }

    this.#lastError = direct.ok
      ? `${dead} stopped answering (${why}); back on the machine's own route`
      : `${dead} stopped answering (${why}); the machine's own route did not answer either (${direct.error})`
    this.#phase = this.#armed ? "armed" : "ready"
    this.#recordHealth("direct", direct.ok, direct.latencyMs)
    void this.#resume()
    this.#save()
    this.#emit()
  }

  // ---------------------------------------------------------------- limits

  /**
   * Feed a line of sidecar output. Network-shaped limits always arm recovery; account-shaped
   * quota lines arm it too unless `quotaRotates` is off. The engine debounces by lane so one
   * exhausted request does not start four rotations.
   */
  observe(line: string) {
    if (!this.#settings.watchLimits) return
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) return

    // The free lane's refusal also reads as "usage limit" prose. It is counted per exit
    // address, so it must not inherit the quota gate below — rotation is the lever that
    // clears it.
    const free = FREE_ALLOWANCE.test(line)
    const quota = !free && QUOTA_PATTERNS.some((pattern) => pattern.test(line))
    const network = LIMIT_PATTERNS.some((pattern) => pattern.test(line))
    if (!free && !quota && !network) return

    const now = Date.now()
    this.#noteWatch(line)

    // Already proven: another limit line on the same evidence buys nothing. Only a person gets
    // out of this state — a manual rotation, a lane switch or re-arming clears the notice.
    if (this.#stuck) return

    // A limit that lands on an exit the engine just bought is evidence about the address. Two
    // of those and the next rotation is a purchase with a known answer, so it is not made: the
    // engine says what it learned instead of buying a third exit to learn it again.
    const reading = proofLimit(this.#proof, now)
    this.#proof = reading.proof
    if (reading.verdict === "stuck") {
      const notice = free ? freeLimitStuck(reading.strike) : stuckNotice(reading.strike)
      if (this.#stuck !== notice) {
        this.#stuck = notice
        this.#emit()
      }
      return
    }

    // An account allowance is not refilled by a new address. This switch is the explicit
    // opt-in for anyone who wants to spend a rotation on one anyway; it is off by default
    // because the answer is already known for the free lane and the exits are not free.
    if (quota && !this.#settings.quotaRotates) return

    for (const [key, at] of this.#recentHits) {
      if (now - at > 120_000) this.#recentHits.delete(key)
    }

    const key = this.#lane
    const last = this.#recentHits.get(key) ?? 0
    if (now - last < this.#settings.cooldownMs) return
    this.#recentHits.set(key, now)

    if (!this.#armed || !this.#settings.autoRecover) return

    this.#recoveries += 1
    this.#save()
    this.#emit()
    void this.#rotateShared().catch(() => undefined)
  }

  /** Record the latest limit line without pushing a snapshot per repeated line. */
  #noteWatch(line: string) {
    // Every retry writes a fresh timestamp; the sentence behind it is what repeats.
    const body = line.trim().replace(/^timestamp=\S+\s+/, "")
    const text = (/cause="([^"]{1,200})"/.exec(body)?.[1] ?? /message="([^"]{1,200})"/.exec(body)?.[1] ?? body).slice(
      0,
      240,
    )

    const now = Date.now()
    if (text === this.#watch && now - this.#watchAt < 15_000) return
    this.#watch = text
    this.#watchAt = now
    this.#emit()
  }

  /**
   * Check whether the bundled CLI engine has a newer release on OpenCode's GitHub.
   * Only the CLI engine is checked — the Olivia UI is never updated by this path.
   * Results are cached for 10 minutes; a missed check leaves the button hidden.
   */
  async checkUpdate(): Promise<{ available: boolean; version: string }> {
    const now = Date.now()
    if (now - this.#updateChecked < 600_000) {
      return { available: this.#updateAvailable, version: this.#updateVersion }
    }
    this.#updateChecked = now

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(
        "https://api.github.com/repos/anomalyco/opencode/releases/latest",
        { signal: controller.signal, cache: "no-store", headers: { Accept: "application/vnd.github+json" } },
      )
      clearTimeout(timer)
      const json = (await response.json()) as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string }> }
      const latest = json.tag_name?.replace(/^v/, "") || ""
      if (latest) {
        this.#updateVersion = latest
        this.#updateAvailable = this.#newerThan(latest)
      }
    } catch {
      // Silent: a missed check leaves the button hidden, which is the safe default.
    }

    return { available: this.#updateAvailable, version: this.#updateVersion }
  }

  /**
   * Download and replace the bundled CLI engine with the latest release from OpenCode's
   * GitHub. Only the CLI binary is replaced — the Olivia UI is never touched.
   */
  async applyUpdate(): Promise<{ ok: boolean; error?: string }> {
    if (!this.#updateAvailable || !this.#updateVersion) {
      return { ok: false, error: "no update available" }
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      const response = await fetch(
        "https://api.github.com/repos/anomalyco/opencode/releases/latest",
        { signal: controller.signal, cache: "no-store", headers: { Accept: "application/vnd.github+json" } },
      )
      clearTimeout(timer)
      const json = (await response.json()) as {
        tag_name?: string
        assets?: Array<{ name: string; browser_download_url: string }>
      }
      const cliAsset = json.assets?.find((a) => a.name.includes("cli") && a.name.endsWith(".exe"))
      if (!cliAsset) {
        return { ok: false, error: "no CLI asset found in release" }
      }

      const dl = await fetch(cliAsset.browser_download_url, { signal: controller.signal })
      const buffer = await dl.arrayBuffer()

      const fs = await import("node:fs/promises")
      const cliPath = await import("node:path").then((p) => p.join(process.resourcesPath, "cli", "opencode-cli.exe"))
      await fs.writeFile(cliPath, Buffer.from(buffer))

      this.#updateAvailable = false
      this.#updateVersion = ""
      this.#emit()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  #newerThan(candidate: string): boolean {
    const parts = (s: string) => s.split(".").map((p) => Number(p) || 0)
    const here = parts(__OLIVIACODE_VERSION__)
    const there = parts(candidate)
    for (let i = 0; i < Math.max(here.length, there.length); i += 1) {
      const a = here[i] ?? 0
      const b = there[i] ?? 0
      if (b > a) return true
      if (a > b) return false
    }
    return false
  }

  /** Probe every lane that is installed, and fill the health column. */
  async checkLanes(): Promise<InfiniteState> {
    const targets: { lane: InfiniteLane; endpoint: string }[] = [{ lane: "direct", endpoint: "" }]

    const warp = await this.warp.status()
    if (warp.found && this.warp.endpoint) targets.push({ lane: "warp", endpoint: this.warp.endpoint })

    const tor = await this.tor.status()
    if (tor.installed) targets.push({ lane: "tor", endpoint: this.tor.endpoint })

    await this.proxies.refresh()
    const proxy = this.proxies.pick()
    if (proxy) targets.push({ lane: "proxy", endpoint: proxy.url })

    // Health-aware ordering: try lanes that answered recently and fast first.
    const ranked = targets
      .map((target) => {
        const health = this.#health.find((h) => h.lane === target.lane)
        const score = health?.alive ? 1_000_000 - (health.latencyMs || 0) - (health.failures * 10_000) : -1
        return { ...target, score }
      })
      .sort((a, b) => b.score - a.score)

    await Promise.all(
      ranked.map(async ({ lane, endpoint }) => {
        // An unstarted Tor has no bridge to probe; report it as installed but down.
        if (lane === "tor" && !endpoint.startsWith("http")) {
          this.#recordHealth(lane, false, 0)
          return
        }
        const outcome = await probe(endpoint, this.#settings.probeTimeoutMs)
        this.#recordHealth(lane, outcome.ok, outcome.latencyMs)
      }),
    )

    this.#emit()
    return this.snapshot()
  }

  #recordHealth(lane: InfiniteLane, alive: boolean, latencyMs: number) {
    this.#health = this.#health.map((entry) =>
      entry.lane !== lane
        ? entry
        : {
            lane,
            alive,
            latencyMs,
            checkedAt: Date.now(),
            failures: alive ? 0 : entry.failures + 1,
          },
    )
  }

  #rememberExit(ip: string) {
    if (!ip) return
    this.#exits = [ip, ...this.#exits.filter((value) => value !== ip)].slice(0, RECENT_EXITS)
  }

  #pushHistory(record: RotationRecord) {
    this.#history = [record, ...this.#history].slice(0, HISTORY_LIMIT)
  }

  /** The proxy a `proxy` lane is currently on, when it is on one. */
  get proxyUrl() {
    return this.#lane === "proxy" ? this.#endpoint : ""
  }

  /**
   * Move the service onto a new endpoint after the rotation has already been reported.
   * The rotation stands even when the reconnect does not; the next request reconnects on
   * its own, and a stuck service can only hold this fiber for the timeout.
   *
   * The decision is made against the endpoint the sidecar was started with, never against the
   * endpoint the rotation began on. A bridge that comes back on a different port moves
   * `#endpoint` while the sidecar is still holding the old variable, and a restart that fails
   * leaves the record behind so the next rotation or lane switch tries again.
   */
  #resume(attempt = 1) {
    const restart = this.#hooks.restartSidecar
    if (!this.#settings.resume || !restart) return

    const endpoint = this.#endpoint

    if (!this.#service.moved(endpoint)) return

    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer in ${RESUME_TIMEOUT_MS / 1000}s`)), RESUME_TIMEOUT_MS)
      timer.unref?.()
    })

    void Promise.race([restart(), timeout])
      .then(() => {
        // A newer move can land while this restart was in flight; only claim the endpoint it
        // was started for, otherwise the next call would see the sidecar as already moved.
        if (this.#endpoint === endpoint) this.#service.adopt(endpoint)
        this.#lastError = ""
        this.#emit()
      })
      .catch((error) => {
        this.#lastError = `rotation ok, resume failed: ${message(error)}`
        this.#emit()
        if (this.#disposed || attempt >= RESUME_ATTEMPTS || this.#endpoint !== endpoint) return
        setTimeout(() => this.#resume(attempt + 1), RESUME_RETRY_MS).unref?.()
      })
  }

  async dispose() {
    this.#disposed = true
    if (this.#watchdog) {
      clearInterval(this.#watchdog)
      this.#watchdog = null
    }
    // The WARP client belongs to the machine, not to this app. A quit while its lane is
    // selected puts the mode it had before back before the process goes away.
    await this.warp.restore().catch(() => "")
    await this.tor.stop().catch(() => undefined)
    this.removeAllListeners()
  }

  get disposed() {
    return this.#disposed
  }
}

/** Every numeric arrives from the renderer; clamp it here so the engine never runs unbounded. */
export function sanitizeSettings(input: unknown): InfiniteSettings {
  const raw = (input ?? {}) as Partial<InfiniteSettings>
  const fallback = infiniteDefaults
  const allowed = new Set<string>(infiniteLanes)

  return {
    autoRecover: raw.autoRecover === true,
    cooldownMs: clampInt(Number(raw.cooldownMs), ...infiniteBounds.cooldownMs, fallback.cooldownMs),
    tries: clampInt(Number(raw.tries), ...infiniteBounds.tries, fallback.tries),
    rotateTimeoutMs: clampInt(Number(raw.rotateTimeoutMs), ...infiniteBounds.rotateTimeoutMs, fallback.rotateTimeoutMs),
    probeTimeoutMs: clampInt(Number(raw.probeTimeoutMs), ...infiniteBounds.probeTimeoutMs, fallback.probeTimeoutMs),
    resume: raw.resume !== false,
    fallback: Array.isArray(raw.fallback)
      ? raw.fallback.filter((lane): lane is InfiniteLane => typeof lane === "string" && allowed.has(lane))
      : fallback.fallback,
    pinnedProxy: typeof raw.pinnedProxy === "string" ? raw.pinnedProxy.trim().slice(0, 200) : "",
    watchLimits: raw.watchLimits !== false,
    quotaRotates: raw.quotaRotates === true,
    verifyProvider: raw.verifyProvider !== false,
    providerEndpoint: typeof raw.providerEndpoint === "string" ? raw.providerEndpoint.trim().slice(0, 300) : "",
    providerModel:
      typeof raw.providerModel === "string" && raw.providerModel.trim()
        ? raw.providerModel.trim().slice(0, 80)
        : fallback.providerModel,
    providerKey: typeof raw.providerKey === "string" ? raw.providerKey.trim().slice(0, 200) : "",
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Variables every HTTP client honours, in both cases the ecosystem uses. */
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const

/**
 * The proxy environment this process inherited, captured before any lane overwrites it.
 *
 * A corporate VPN or a proxy-required network starts the app with `HTTPS_PROXY` already set.
 * The direct lane used to delete those variables, which turned "back to Direct" into "back
 * to no route at all" for exactly the users whose network needs them. Restoring the
 * inherited values makes Direct mean the machine's own configuration, not an empty one.
 */
const inheritedProxy = new Map<string, string>(
  PROXY_VARS.flatMap((name) => {
    const value = process.env[name]
    return value ? [[name, value] as const] : []
  }),
)
const inheritedNoProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? ""

/**
 * Put the lane under the whole process tree.
 *
 * The sidecar CLI is spawned as a child of this process and inherits its environment, so
 * setting the proxy here is what makes the app's own requests take the lane — there is no
 * per-request hook to patch and nothing inside the CLI to configure. Loopback is always
 * excluded, otherwise the app would try to reach its own service through the tunnel.
 */
export function applyEndpoint(endpoint: string) {
  const noProxy = "localhost,127.0.0.1,::1,0.0.0.0"

  for (const name of PROXY_VARS) {
    if (endpoint) {
      process.env[name] = endpoint
      continue
    }
    const inherited = inheritedProxy.get(name)
    if (inherited) process.env[name] = inherited
    else delete process.env[name]
  }

  if (endpoint) {
    process.env.NO_PROXY = noProxy
    process.env.no_proxy = noProxy
  } else if (inheritedNoProxy) {
    process.env.NO_PROXY = inheritedNoProxy
    process.env.no_proxy = inheritedNoProxy
  } else {
    delete process.env.NO_PROXY
    delete process.env.no_proxy
  }

  // Electron reads proxy configuration from the app, not from the environment, for its
  // own fetches. `setProxy` is applied by the caller when a session exists.
  lastEndpoint = endpoint
}

let lastEndpoint = ""

export function currentEndpoint() {
  return lastEndpoint
}

/** One engine for the whole app: settings, the projection, and every lane process live here. */
export const engine = new InfiniteEngine()
