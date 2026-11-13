import { describe, expect, test } from "bun:test"
import {
  PROOF_WINDOW_MS,
  STUCK_AFTER,
  proofLimit,
  proofReset,
  proofRotated,
  recoveryProof,
  stuckNotice,
} from "./recovery"

const t0 = 1_700_000_000_000

describe("recovery proof", () => {
  test("rotates on a limit that no rotation preceded", () => {
    const reading = proofLimit(recoveryProof, t0)
    expect(reading.verdict).toBe("rotate")
    expect(reading.strike).toBe(0)
    expect(reading.proof).toEqual(recoveryProof)
  })

  test("stops after the configured number of refused fresh exits", () => {
    let proof = recoveryProof
    let now = t0

    // Every rotation lands on a new address, and the provider refuses it again.
    for (let attempt = 1; attempt <= STUCK_AFTER; attempt += 1) {
      proof = proofRotated(proof, now)
      const reading = proofLimit(proof, now + 5_000)
      expect(reading.strike).toBe(attempt)
      expect(reading.verdict).toBe(attempt < STUCK_AFTER ? "rotate" : "stuck")
      proof = reading.proof
      now += 30_000
    }
  })

  test("counts one strike per rotation, however many retry lines carry it", () => {
    const proof = proofRotated(recoveryProof, t0)
    let reading = proofLimit(proof, t0 + 1_000)
    expect(reading.strike).toBe(1)

    // A queued request that fails ten times inside the same rotation is one attempt.
    for (let retry = 0; retry < 10; retry += 1) {
      reading = proofLimit(reading.proof, t0 + 2_000 + retry)
      expect(reading.strike).toBe(1)
      expect(reading.verdict).toBe("rotate")
    }
  })

  test("a rotation outside the window is not evidence about the address", () => {
    const proof = proofRotated(recoveryProof, t0)
    const reading = proofLimit(proof, t0 + PROOF_WINDOW_MS + 1)
    expect(reading.strike).toBe(0)
    expect(reading.verdict).toBe("rotate")
  })

  test("a manual rotation clears the strikes but keeps counting the new one", () => {
    let proof = proofRotated(recoveryProof, t0)
    proof = proofLimit(proof, t0 + 1_000).proof
    expect(proof.strikes).toBe(1)

    proof = proofReset(proof)
    expect(proof.strikes).toBe(0)

    proof = proofRotated(proof, t0 + 20_000)
    expect(proofLimit(proof, t0 + 21_000).strike).toBe(1)
  })

  test("returns the same object when there is nothing to reset", () => {
    expect(proofReset(recoveryProof)).toBe(recoveryProof)
  })

  test("the notice names the count and the way out", () => {
    expect(stuckNotice(0)).toBe("")
    expect(stuckNotice(1)).toBe("")
    const notice = stuckNotice(STUCK_AFTER)
    expect(notice).toContain(`${STUCK_AFTER} new exits`)
    expect(notice).toContain("Switch models or connect a provider.")
  })
})
