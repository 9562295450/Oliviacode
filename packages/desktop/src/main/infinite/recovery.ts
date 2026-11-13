/**
 * Whether another rotation is worth spending.
 *
 * The engine reacts to a limit line by buying a new exit. That works only while the limit is
 * about the address. When a rotation lands on a different, probed address and the provider
 * refuses that one too, the address is not the thing being counted — and the next rotation
 * will buy the same answer again, one WARP re-registration at a time, while the notice on
 * screen never changes.
 *
 * This module keeps that score. One refusal on a fresh exit is a reason to try once more; two
 * is proof enough to stop and say so, because at that point the engine has already spent two
 * exits on the same refusal. The number is small on purpose: every strike is a tunnel the
 * user paid for in seconds of no connection.
 */

/** A fresh address refused again inside this window was spent for nothing. */
export const PROOF_WINDOW_MS = 120_000

/** Rotations that each bought a new address and still ended in the same refusal. */
export const STUCK_AFTER = 2

export type RecoveryProof = {
  /** When the last rotation landed on a different address, or 0 before the first one. */
  readonly rotatedAt: number
  /** Consecutive rotations that were followed by the same limit. */
  readonly strikes: number
  /** The rotation whose strike is already counted, so retries of one request cannot stack. */
  readonly countedFor: number
}

export const recoveryProof: RecoveryProof = { rotatedAt: 0, strikes: 0, countedFor: 0 }

export type ProofReading = {
  readonly proof: RecoveryProof
  /** `rotate` spends another exit; `stuck` says the limit is not about the address. */
  readonly verdict: "rotate" | "stuck"
  /** How many fresh exits have been refused, for the notice the panel shows. */
  readonly strike: number
}

/** Record a rotation that produced a different address and passed its trace probe. */
export function proofRotated(proof: RecoveryProof, now: number): RecoveryProof {
  return { rotatedAt: now, strikes: proof.strikes, countedFor: 0 }
}

/**
 * Read one limit line against the last rotation.
 *
 * A limit with no recent rotation is the ordinary case and rotates. A limit inside the window
 * is the provider refusing the address the rotation just bought, and counts once per rotation
 * no matter how many retry lines carry it — a queued request that fails ten times must not
 * look like ten attempts.
 */
export function proofLimit(proof: RecoveryProof, now: number): ProofReading {
  const inside = proof.rotatedAt !== 0 && now - proof.rotatedAt <= PROOF_WINDOW_MS
  if (!inside || proof.countedFor === proof.rotatedAt) return { proof, verdict: "rotate", strike: proof.strikes }

  const strikes = proof.strikes + 1
  const next = { ...proof, strikes, countedFor: proof.rotatedAt }
  return { proof: next, verdict: strikes >= STUCK_AFTER ? "stuck" : "rotate", strike: strikes }
}

/** A person asked again, or moved to another lane: forget the strikes, keep the clock. */
export function proofReset(proof: RecoveryProof): RecoveryProof {
  return proof.strikes === 0 ? proof : { ...proof, strikes: 0, countedFor: 0 }
}

/**
 * The sentence the panel shows when rotation has been proven not to help.
 *
 * It names the count because the count is the evidence: the user can see that the engine did
 * not simply give up on the first refusal. It never claims to know how the provider counts —
 * only what was tried, and what to do instead.
 */
export function stuckNotice(strikes: number) {
  if (strikes < STUCK_AFTER) return ""
  return `Rotating is not clearing this limit: ${strikes} new exits were refused too. Switch models or connect a provider.`
}

/**
 * Wording that identifies the free lane's allowance refusal.
 *
 * `FreeUsageLimitError` is the gateway's own type name and survives body flattening as prose.
 *
 * The allowance is counted **per exit address**, not per account. Upstream's inference proxy
 * forwards the client address as `x-zen-ip` and strips the caller's own credentials
 * (`proxyInference` in upstream `packages/console/app/src/lib/inference-proxy.ts`), so the
 * bucket that answers is keyed on the address the request arrives from. Measured on the live
 * gateway: the same model answered three seconds after a WARP rotation landed on a fresh
 * exit, then refused again once that exit had served its day's messages — with the same
 * 00:00 UTC `Retry-After` each time. A new exit therefore does carry a new allowance, which
 * is exactly why the engine rotates on this refusal instead of sitting on it.
 */
export const FREE_ALLOWANCE = /free\s*usage\s*limit|freeusagelimiterror/i

/**
 * The sentence the panel shows while a free-limit rotation is still the right move.
 *
 * It names the mechanism because the mechanism is the answer: people rotate, see it work,
 * and then get told "rotating will not clear it" — which is the one sentence that makes them
 * stop using the lever that was working.
 */
export function allowanceNotice() {
  return "The free allowance is counted per exit address, so a fresh exit carries a fresh allowance. Rotating is what clears it; if fresh exits are refused too, connect a provider or wait for the provider's reset."
}

/**
 * The sentence the panel shows once fresh exits stop clearing the free allowance.
 *
 * Only reachable after the proof module has seen two different exits refused inside the
 * window — the same evidence standard as every other stuck notice, spent on the one limit
 * that used to clear on the first rotation.
 */
export function freeLimitStuck(strikes: number) {
  return `The free allowance is counted per exit address, and ${strikes} fresh exits were refused too. Connect a provider or wait for the provider's reset.`
}
