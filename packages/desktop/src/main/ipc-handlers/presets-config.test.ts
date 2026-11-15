import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { stripBom, writeCustomProvider, writeProviderBaseURL } from "./presets-config"

const BOM = "\uFEFF"

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "presets-config-"))
  return { dir, file: path.join(dir, "opencode.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe("writeProviderBaseURL", () => {
  test("writes through a UTF-8 BOM and heals the file", () => {
    const { file, cleanup } = tempDir()

    try {
      writeFileSync(file, BOM + JSON.stringify({ theme: "dark", provider: { opencode: { name: "OpenCode" } } }), "utf8")

      const result = writeProviderBaseURL(file, "opencode", "https://opencode.ai/zen/v1")

      expect(result).toEqual({ ok: true, path: file })

      const text = readFileSync(file, "utf8")
      expect(text.charCodeAt(0)).not.toBe(0xfeff)

      const config = JSON.parse(text)
      expect(config.theme).toBe("dark")
      expect(config.provider.opencode.name).toBe("OpenCode")
      expect(config.provider.opencode.options.baseURL).toBe("https://opencode.ai/zen/v1")
    } finally {
      cleanup()
    }
  })

  test("creates the file and its directory when neither exists", () => {
    const { dir, cleanup } = tempDir()

    try {
      const file = path.join(dir, "nested", "deeper", "opencode.json")
      const result = writeProviderBaseURL(file, "zen", "https://example.test/v1")

      expect(result.ok).toBe(true)
      expect(JSON.parse(readFileSync(file, "utf8")).provider.zen.options.baseURL).toBe("https://example.test/v1")
    } finally {
      cleanup()
    }
  })

  test("reports the file and JSON position for malformed input instead of throwing", () => {
    const { file, cleanup } = tempDir()

    try {
      writeFileSync(file, '{ "provider": { , } }', "utf8")

      const result = writeProviderBaseURL(file, "opencode", "https://opencode.ai/zen/v1")

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected failure")
      expect(result.path).toBe(file)
      expect(result.error).toContain(file)
      expect(result.error).toContain("not valid JSON")
    } finally {
      cleanup()
    }
  })

  test("refuses a jsonc file whose comments would be lost", () => {
    const { dir, cleanup } = tempDir()

    try {
      const file = path.join(dir, "opencode.jsonc")
      writeFileSync(file, '{\n  // keep me\n  "theme": "dark"\n}\n', "utf8")

      const result = writeProviderBaseURL(file, "opencode", "https://opencode.ai/zen/v1")

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected failure")
      expect(result.error).toContain("comments")
      expect(readFileSync(file, "utf8")).toContain("// keep me")
    } finally {
      cleanup()
    }
  })

  test("rejects a top-level array", () => {
    const { file, cleanup } = tempDir()

    try {
      writeFileSync(file, "[]", "utf8")

      const result = writeProviderBaseURL(file, "opencode", "https://opencode.ai/zen/v1")

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected failure")
      expect(result.error).toContain("JSON object")
    } finally {
      cleanup()
    }
  })

  test("keeps existing provider options", () => {
    const { file, cleanup } = tempDir()

    try {
      writeFileSync(
        file,
        JSON.stringify({ provider: { zen: { options: { apiKey: "anything", timeout: 300000 } } } }),
        "utf8",
      )

      expect(writeProviderBaseURL(file, "zen", "http://127.0.0.1:8787/v1").ok).toBe(true)

      const options = JSON.parse(readFileSync(file, "utf8")).provider.zen.options
      expect(options).toEqual({ apiKey: "anything", timeout: 300000, baseURL: "http://127.0.0.1:8787/v1" })
    } finally {
      cleanup()
    }
  })
})

describe("writeCustomProvider", () => {
  test("writes a full provider entry beside the existing ones", () => {
    const { file, cleanup } = tempDir()

    try {
      writeFileSync(file, BOM + JSON.stringify({ provider: { zen: { options: { baseURL: "http://127.0.0.1:8787/v1" } } } }), "utf8")

      const result = writeCustomProvider(file, {
        id: "verify-test",
        name: "Verify Test",
        baseURL: "https://example.test/v1",
        models: ["m1", "m2"],
      })

      expect(result).toEqual({ ok: true, path: file })

      const config = JSON.parse(readFileSync(file, "utf8"))
      expect(config.provider.zen.options.baseURL).toBe("http://127.0.0.1:8787/v1")
      expect(config.provider["verify-test"]).toEqual({
        name: "Verify Test",
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: "https://example.test/v1" },
        models: { m1: { name: "m1" }, m2: { name: "m2" } },
      })
    } finally {
      cleanup()
    }
  })
})

describe("stripBom", () => {
  test("removes only a leading BOM", () => {
    expect(stripBom(BOM + "{}")).toBe("{}")
    expect(stripBom("{}" + BOM)).toBe("{}" + BOM)
  })
})
