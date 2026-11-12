import { describe, expect, test } from "bun:test"
import { providerFailureMessage } from "../src/route/executor.js"

// Bodies collected from real provider failures. Every one of these reached a user's retry card at
// some point, either as a readable sentence or as the raw payload.
const bodies = [
  `[{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}]`,
  `{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}`,
  `{"object":"error","message":{"detail":[{"msg":"Input should be less than or equal to 1.5"}]}}`,
  `{"error":{"message":"  "}}`,
  `{"errors":[{"code":10000,"message":"Authentication error"}]}`,
  `{"detail":"Invalid API Key"}`,
  `<!DOCTYPE html><html><body>502 Bad Gateway</body></html>`,
  `{"id":"chatcmpl-1","choices":[]}`,
  `[]`,
  `{}`,
]

describe("provider error copy", () => {
  test("never shows a raw JSON payload", () => {
    for (const body of bodies) {
      const message = providerFailureMessage(503, body)

      expect(message.length).toBeGreaterThan(0)
      expect(message.startsWith("{")).toBeFalse()
      expect(message.startsWith("[")).toBeFalse()
      expect(message).not.toContain('{"')
    }
  })

  test("keeps the provider's own sentence when the body carries one", () => {
    expect(providerFailureMessage(503, bodies[0])).toBe(
      "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    )
    expect(providerFailureMessage(401, `{"detail":"Invalid API Key"}`)).toBe("Invalid API Key")
  })

  test("falls back to the status when the body explains nothing", () => {
    expect(providerFailureMessage(422, bodies[2])).toBe("Provider request failed with HTTP 422")
    expect(providerFailureMessage(400, bodies[3])).toBe("Provider request failed with HTTP 400")
    expect(providerFailureMessage(502, bodies[6])).toBe("Provider request failed with HTTP 502")
    expect(providerFailureMessage(500, undefined)).toBe("Provider request failed with HTTP 500")
  })

  test("still shows a plain-text body, capped", () => {
    expect(providerFailureMessage(400, "invalid parameter")).toBe("Provider request failed with HTTP 400: invalid parameter")
    expect(providerFailureMessage(400, "x".repeat(5000)).endsWith("…")).toBeTrue()
  })

  test("stays inside the one-line retry card", () => {
    for (const body of bodies) expect(providerFailureMessage(503, body).length).toBeLessThanOrEqual(400)
  })
})
