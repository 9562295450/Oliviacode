import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { chatEndpoint, classifyProvider, parseActiveProvider } from "./provider-config"
import { parseTrace } from "./trace"
import { logCandidates } from "./watcher"

const config = (over: Record<string, unknown> = {}) => ({
  model: "acme/fast-1",
  provider: {
    acme: {
      options: { baseURL: "https://api.acme.test/v1", apiKey: "sk-live-123" },
    },
  },
  ...over,
})

describe("chatEndpoint", () => {
  test("a base URL gains the chat route", () => {
    expect(chatEndpoint("https://api.acme.test/v1")).toBe("https://api.acme.test/v1/chat/completions")
  })

  test("a trailing slash is dropped before the route is added", () => {
    expect(chatEndpoint("https://api.acme.test/v1/")).toBe("https://api.acme.test/v1/chat/completions")
  })

  test("a full route is not doubled", () => {
    expect(chatEndpoint("https://api.acme.test/v1/chat/completions")).toBe("https://api.acme.test/v1/chat/completions")
  })

  test("an empty URL has no route", () => {
    expect(chatEndpoint("   ")).toBe("")
  })
})

describe("parseActiveProvider", () => {
  test("the selected model's provider is resolved from the current shape", () => {
    expect(parseActiveProvider(config(), {})).toEqual({
      kind: "remote",
      endpoint: "https://api.acme.test/v1/chat/completions",
      model: "fast-1",
      key: "sk-live-123",
    })
  })

  test("the legacy settings shape is read too", () => {
    const legacy = {
      model: "old/slow-2",
      providers: { old: { settings: { baseURL: "https://legacy.acme.test/v1" } } },
    }
    expect(parseActiveProvider(legacy, {})).toEqual({
      kind: "remote",
      endpoint: "https://legacy.acme.test/v1/chat/completions",
      model: "slow-2",
      key: "",
    })
  })

  test("a loopback provider is local, not probed through a lane", () => {
    const local = config({
      provider: { acme: { options: { baseURL: "http://127.0.0.1:8787/v1" } } },
    })
    expect(parseActiveProvider(local, {})).toEqual({
      kind: "local",
      endpoint: "http://127.0.0.1:8787/v1/chat/completions",
      model: "fast-1",
    })
  })

  test("localhost is loopback in any case", () => {
    const local = config({ provider: { acme: { options: { baseURL: "http://LOCALHOST:8081/v1" } } } })
    expect(parseActiveProvider(local, {}).kind).toBe("local")
  })

  test("an env template key is resolved from the process environment", () => {
    const templated = config({
      provider: { acme: { options: { baseURL: "https://api.acme.test/v1", apiKey: "{env:ACME_KEY}" } } },
    })
    expect(parseActiveProvider(templated, { ACME_KEY: "sk-env-9" })).toEqual({
      kind: "remote",
      endpoint: "https://api.acme.test/v1/chat/completions",
      model: "fast-1",
      key: "sk-env-9",
    })
  })

  test("an unresolved template key sends nothing", () => {
    const templated = config({
      provider: { acme: { options: { baseURL: "https://api.acme.test/v1", apiKey: "{env:MISSING_KEY}" } } },
    })
    const resolved = parseActiveProvider(templated, {})
    expect(resolved.kind === "remote" ? resolved.key : "wrong-kind").toBe("")
  })

  test("no model means nothing to check", () => {
    expect(parseActiveProvider({ provider: config().provider }, {})).toEqual({ kind: "none" })
  })

  test("a model with no provider prefix means nothing to check", () => {
    expect(parseActiveProvider(config({ model: "fast-1" }), {})).toEqual({ kind: "none" })
  })

  test("a provider with no base URL means nothing to check", () => {
    const bare = config({ provider: { acme: { options: {} } } })
    expect(parseActiveProvider(bare, {})).toEqual({ kind: "none" })
  })

  test("a non-object document is none, not a throw", () => {
    expect(parseActiveProvider(null, {})).toEqual({ kind: "none" })
    expect(parseActiveProvider("nope", {})).toEqual({ kind: "none" })
  })
})

describe("classifyProvider", () => {
  test("a manual remote endpoint carries the panel's key", () => {
    expect(classifyProvider("https://manual.test/v1", "m", "sk-manual")).toEqual({
      kind: "remote",
      endpoint: "https://manual.test/v1/chat/completions",
      model: "m",
      key: "sk-manual",
    })
  })

  test("a manual loopback endpoint is local", () => {
    expect(classifyProvider("http://127.0.0.1:4000/v1", "m", "sk")).toEqual({
      kind: "local",
      endpoint: "http://127.0.0.1:4000/v1/chat/completions",
      model: "m",
    })
  })

  test("a blank manual endpoint is none", () => {
    expect(classifyProvider("", "m", "sk")).toEqual({ kind: "none" })
  })
})

describe("parseTrace", () => {
  test("ipify's JSON names the address and country", () => {
    expect(parseTrace('{"ip":"203.0.113.7","country_code":"PH"}', 5)).toEqual({
      ip: "203.0.113.7",
      loc: "PH",
      colo: "",
      warp: "unknown",
      at: 5,
    })
  })

  test("a JSON body with no address is not a trace", () => {
    expect(parseTrace('{"ok":true}', 5)).toBeNull()
  })

  test("cloudflare's key=value trace is still read", () => {
    const body = "fl=abc\nip=198.51.100.4\nloc=SG\ncolo=SIN\nwarp=on\n"
    expect(parseTrace(body, 9)).toEqual({ ip: "198.51.100.4", loc: "SG", colo: "SIN", warp: "on", at: 9 })
  })
})

describe("logCandidates", () => {
  // `join` uses the host separator, so the expected strings are built the same way. Literal
  // Windows paths here passed on a developer machine and failed on the Linux runner.
  const dataRoot =
    process.platform === "win32" ? "C:\\Users\\x\\AppData\\Roaming\\app\\engine\\data" : "/home/x/.local/share/app"
  const home = process.platform === "win32" ? "C:\\Users\\x" : "/home/x"

  test("the engine's own XDG data root comes first", () => {
    const found = logCandidates({ XDG_DATA_HOME: dataRoot, LOCALAPPDATA: "/tmp/local" }, home)
    expect(found[0]).toBe(join(dataRoot, "opencode", "log"))
  })

  test("a duplicate root is only listed once", () => {
    const found = logCandidates({ XDG_DATA_HOME: dataRoot, XDG_STATE_HOME: dataRoot }, home)
    expect(found.filter((entry) => entry === join(dataRoot, "opencode", "log"))).toHaveLength(1)
  })

  test("the legacy home path is still checked", () => {
    expect(logCandidates({}, home)).toContain(join(home, ".local", "share", "opencode", "log"))
  })
})
