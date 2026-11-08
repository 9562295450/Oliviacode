import { describe, expect, test } from "bun:test"
import { parseProviderVerdict, splitStatus } from "./provider"

const base = { ip: "203.0.113.9", model: "deepseek-v4.1-flash-free", at: 1 }

describe("parseProviderVerdict", () => {
  test("a free usage limit in a 429 is limited", () => {
    const body = JSON.stringify({
      type: "error",
      error: {
        type: "FreeUsageLimitError",
        message: "Free usage limit reached. Free models work in OpenCode",
      },
    })
    expect(parseProviderVerdict({ ...base, status: 429, body }).status).toBe("limited")
  })

  test("a 429 with no body is still limited", () => {
    expect(parseProviderVerdict({ ...base, status: 429, body: "" }).status).toBe("limited")
  })

  test("a chat completion is accepted", () => {
    const body = JSON.stringify({ id: "cmpl_1", choices: [{ index: 0, message: { content: "p" } }] })
    expect(parseProviderVerdict({ ...base, status: 200, body }).status).toBe("ok")
  })

  test("a completion that merely mentions a limit is still accepted", () => {
    const body = JSON.stringify({ id: "cmpl_2", choices: [{ message: { content: "usage limit" } }] })
    expect(parseProviderVerdict({ ...base, status: 200, body }).status).toBe("ok")
  })

  test("a 200 that is not a completion is unknown, not accepted", () => {
    expect(parseProviderVerdict({ ...base, status: 200, body: "<html>challenge</html>" }).status).toBe("unknown")
  })

  test("a rejected key is unknown: the address may be fine", () => {
    expect(parseProviderVerdict({ ...base, status: 401, body: '{"error":"invalid key"}' }).status).toBe("unknown")
  })

  test("a provider fault is unknown: it names no address", () => {
    expect(parseProviderVerdict({ ...base, status: 503, body: "upstream down" }).status).toBe("unknown")
  })

  test("a request that never landed is unknown", () => {
    const verdict = parseProviderVerdict({ ...base, status: 0, body: "timed out after 16s" })
    expect(verdict.status).toBe("unknown")
    expect(verdict.detail).toContain("timed out")
  })

  test("the limit wins over the status: a 400 carrying the type is limited", () => {
    const body = '{"error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"}}'
    expect(parseProviderVerdict({ ...base, status: 400, body }).status).toBe("limited")
  })
})

describe("splitStatus", () => {
  test("separates the body from the appended status", () => {
    expect(splitStatus('{"ok":true}\n200')).toEqual({ status: 200, body: '{"ok":true}' })
  })

  test("keeps a body that itself ends in newlines", () => {
    expect(splitStatus('{"a":1}\n\n429')).toEqual({ status: 429, body: '{"a":1}\n' })
  })

  test("an answer with no status line reads as not landed", () => {
    expect(splitStatus("nothing here")).toEqual({ status: 0, body: "nothing here" })
  })
})
