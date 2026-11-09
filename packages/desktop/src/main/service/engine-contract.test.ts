import { describe, expect, test } from "bun:test"

import { accepts, best, check, compare, infoVersion, operationSet, requiredOperations } from "./engine-contract"

const full = (() => {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const operation of requiredOperations) {
    paths[operation.path] ??= {}
    paths[operation.path]![operation.method.toLowerCase()] = { operationId: `${operation.method} ${operation.path}` }
  }

  return { paths }
})()

describe("operationSet", () => {
  test("flattens paths and methods into comparable keys", () => {
    const operations = operationSet({ paths: { "/api/info": { get: {} }, "/api/session": { get: {}, post: {} } } })

    expect([...operations].sort()).toEqual(["GET /api/info", "GET /api/session", "POST /api/session"])
  })

  test("ignores non-method keys and malformed documents", () => {
    expect([...operationSet({ paths: { "/api/info": { get: {}, parameters: [] } } })]).toEqual(["GET /api/info"])
    expect(operationSet(undefined).size).toBe(0)
    expect(operationSet({}).size).toBe(0)
    expect(operationSet("nope").size).toBe(0)
  })
})

describe("check", () => {
  const contract = { generatedFrom: "2.2.6", required: requiredOperations }

  test("accepts a document containing every required operation", () => {
    expect(check(contract, full)).toEqual({ ok: true, missing: [] })
  })

  test("additions never fail the check", () => {
    const extended = { paths: { ...full.paths, "/api/experimental/thing": { get: {} } } }

    expect(check(contract, extended).ok).toBe(true)
  })

  test("names the operations a candidate dropped", () => {
    const trimmed = { paths: { ...full.paths } }
    delete (trimmed.paths as Record<string, unknown>)["/api/session/{sessionID}/prompt"]

    const verdict = check(contract, trimmed)

    expect(verdict.ok).toBe(false)
    expect(verdict.missing).toEqual([{ method: "POST", path: "/api/session/{sessionID}/prompt" }])
  })

  test("an unreadable document is a refusal, not a pass", () => {
    const verdict = check(contract, { paths: {} })

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe("empty operation list")
  })
})

describe("infoVersion", () => {
  test("reads a version and rejects the shapes that carry none", () => {
    expect(infoVersion({ version: "2.2.6" })).toBe("2.2.6")
    expect(infoVersion({ version: "" })).toBeUndefined()
    expect(infoVersion({})).toBeUndefined()
    expect(infoVersion(null)).toBeUndefined()
  })
})

describe("compare", () => {
  test("orders releases and sorts a prerelease before its release", () => {
    expect(compare("2.2.6", "2.2.6")).toBe(0)
    expect(compare("2.2.6", "2.2.7")).toBeLessThan(0)
    expect(compare("2.3.0", "2.2.9")).toBeGreaterThan(0)
    expect(compare("3.0.0", "2.99.99")).toBeGreaterThan(0)
    expect(compare("2.2.6-beta.1", "2.2.6")).toBeLessThan(0)
  })
})

describe("accepts", () => {
  test("bundled never moves", () => {
    expect(accepts("2.2.6", "2.2.7", "bundled")).toBe(false)
  })

  test("patch follows fixes only", () => {
    expect(accepts("2.2.6", "2.2.7", "patch")).toBe(true)
    expect(accepts("2.2.6", "2.2.9", "patch")).toBe(true)
    expect(accepts("2.2.6", "2.3.0", "patch")).toBe(false)
  })

  test("minor follows features inside the same major", () => {
    expect(accepts("2.2.6", "2.3.0", "minor")).toBe(true)
    expect(accepts("2.2.6", "3.0.0", "minor")).toBe(false)
    expect(accepts("2.2.6", "2.3.0", "latest")).toBe(true)
  })

  test("never goes backwards, never crosses a major, never takes a prerelease", () => {
    expect(accepts("2.2.6", "2.2.5", "latest")).toBe(false)
    expect(accepts("2.2.6", "2.2.6", "latest")).toBe(false)
    expect(accepts("2.2.6", "3.0.0", "latest")).toBe(false)
    expect(accepts("2.2.6", "2.3.0-rc.1", "latest")).toBe(false)
  })

  test("0.x has no stable major, so only patch moves are allowed", () => {
    expect(accepts("0.9.4", "0.9.5", "latest")).toBe(true)
    expect(accepts("0.9.4", "0.10.0", "latest")).toBe(false)
  })
})

describe("best", () => {
  test("picks the highest acceptable candidate and ignores the rest", () => {
    expect(best("2.2.6", ["2.2.6", "2.2.8", "2.3.1", "3.0.0", "2.2.7-beta.2"], "patch")).toBe("2.2.8")
    expect(best("2.2.6", ["2.3.1", "3.0.0"], "patch")).toBeUndefined()
    expect(best("2.2.6", ["2.3.1", "2.2.7"], "minor")).toBe("2.3.1")
  })
})
