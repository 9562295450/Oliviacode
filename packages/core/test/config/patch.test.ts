import { describe, expect, test } from "bun:test"
import { patchDocument } from "@opencode/core/config"
import { parse } from "jsonc-parser"

const read = (text: string) => parse(text) as Record<string, unknown>

describe("patchDocument", () => {
  test("sets and clears the shell", () => {
    const set = patchDocument("{}\n", { shell: "/bin/zsh" })
    expect(read(set).shell).toBe("/bin/zsh")

    const cleared = patchDocument(set, { shell: null })
    expect(cleared).not.toContain("shell")
  })

  test("leaves the shell alone when the patch omits it", () => {
    const text = '{\n  "shell": "/bin/fish"\n}\n'
    expect(read(patchDocument(text, {})).shell).toBe("/bin/fish")
  })

  test("adds, replaces and removes a provider", () => {
    const added = patchDocument("{}\n", {
      providers: {
        antigravity: {
          name: "Antigravity",
          package: "@ai-sdk/openai-compatible",
          settings: { baseURL: "https://api.example.com/v1" },
          models: { "model-one": { name: "model-one" } },
        },
      },
    })
    expect(read(added).providers).toEqual({
      antigravity: {
        name: "Antigravity",
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: "https://api.example.com/v1" },
        models: { "model-one": { name: "model-one" } },
      },
    })

    const replaced = patchDocument(added, {
      providers: { antigravity: { name: "Antigravity", settings: { baseURL: "https://api.example.com/v2" } } },
    })
    expect((read(replaced).providers as Record<string, { name: string }>).antigravity.name).toBe("Antigravity")
    expect(JSON.stringify(replaced)).toContain("https://api.example.com/v2")
    expect(JSON.stringify(replaced)).not.toContain("/v1")

    const removed = patchDocument(replaced, { providers: { antigravity: null } })
    expect(read(removed).providers).toEqual({})
  })

  test("keeps comments and unrelated keys", () => {
    const text = '{\n  // keep me\n  "theme": "dark",\n  "shell": null\n}\n'
    const patched = patchDocument(text, { shell: "cmd.exe", providers: { mine: { name: "Mine" } } })

    expect(patched).toContain("// keep me")
    expect(read(patched).theme).toBe("dark")
    expect(read(patched).shell).toBe("cmd.exe")
  })

  test("ends the document with a newline", () => {
    expect(patchDocument("{}", {})).toBe("{}\n")
    expect(patchDocument("", { shell: "cmd.exe" }).endsWith("\n")).toBe(true)
  })

  test("refuses a provider entry that does not match the schema", () => {
    expect(() => patchDocument("{}\n", { providers: { broken: { models: 5 } } })).toThrow()
  })
})
