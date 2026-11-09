import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"

import { extractExecutable, extractManifest, verifyIntegrity } from "./engine-tar"

const BLOCK = 512

/** Writes the ustar header the reader parses. The checksum is not read, but a real one is cheap. */
function header(input: { name: string; size: number; type?: string; prefix?: string }) {
  const block = Buffer.alloc(BLOCK)

  block.write(input.name, 0, 100, "utf8")
  block.write("0000644\0", 100, 8, "ascii")
  block.write("0000000\0", 108, 8, "ascii")
  block.write("0000000\0", 116, 8, "ascii")
  block.write(`${input.size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii")
  block.write("00000000000\0", 136, 12, "ascii")
  block.write(input.type ?? "0", 156, 1, "ascii")
  block.write("ustar\0", 257, 6, "ascii")
  block.write("00", 263, 2, "ascii")
  if (input.prefix) block.write(input.prefix, 345, 155, "utf8")

  block.write("        ", 148, 8, "ascii")
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii")

  return block
}

function archive(entries: ReadonlyArray<{ name: string; body?: string | Uint8Array; type?: string; prefix?: string }>) {
  const parts: Buffer[] = []

  for (const entry of entries) {
    const bytes = typeof entry.body === "string" ? Buffer.from(entry.body) : Buffer.from(entry.body ?? [])
    parts.push(header({ name: entry.name, size: bytes.byteLength, type: entry.type, prefix: entry.prefix }), bytes)
    const padding = (BLOCK - (bytes.byteLength % BLOCK)) % BLOCK
    if (padding) parts.push(Buffer.alloc(padding))
  }

  parts.push(Buffer.alloc(BLOCK * 2))

  return new Uint8Array(Buffer.concat(parts))
}

describe("verifyIntegrity", () => {
  const bytes = new TextEncoder().encode("engine bytes")
  const digest = createHash("sha512").update(bytes).digest("base64")

  test("accepts the digest the registry publishes", () => {
    expect(verifyIntegrity(bytes, `sha512-${digest}`)).toBe(true)
  })

  test("refuses different bytes, a different algorithm, and a malformed string", () => {
    expect(verifyIntegrity(new TextEncoder().encode("other bytes"), `sha512-${digest}`)).toBe(false)
    expect(verifyIntegrity(bytes, `sha256-${digest}`)).toBe(false)
    expect(verifyIntegrity(bytes, "sha512")).toBe(false)
    expect(verifyIntegrity(bytes, "")).toBe(false)
  })
})

describe("extractExecutable", () => {
  test("pulls the binary out of package/bin", () => {
    const tarball = archive([
      { name: "package/package.json", body: `{"name":"@opencode/cli-windows-x64","version":"2.2.6"}` },
      { name: "package/bin/opencode.exe", body: "MZ-binary" },
    ])

    expect(Buffer.from(extractExecutable(tarball, "opencode.exe")!).toString()).toBe("MZ-binary")
  })

  test("matches the binary without a windows extension too", () => {
    const tarball = archive([{ name: "package/bin/opencode", body: "ELF-binary" }])

    expect(Buffer.from(extractExecutable(tarball, "opencode.exe")!).toString()).toBe("ELF-binary")
    expect(Buffer.from(extractExecutable(tarball, "opencode")!).toString()).toBe("ELF-binary")
  })

  test("ignores directories, unrelated files, and a missing binary", () => {
    const tarball = archive([
      { name: "package/bin", type: "5" },
      { name: "package/bin/README.md", body: "not a binary" },
    ])

    expect(extractExecutable(tarball, "opencode.exe")).toBeUndefined()
  })

  test("joins the ustar prefix back onto the name", () => {
    const tarball = archive([{ name: "opencode.exe", prefix: "package/bin", body: "MZ" }])

    expect(extractExecutable(tarball, "opencode.exe")).toBeDefined()
  })

  test("reads a gzipped .tgz, which is what the registry actually publishes", () => {
    const tarball = archive([
      { name: "package/package.json", body: `{"name":"cli","version":"2.2.6"}` },
      { name: "package/bin/opencode.exe", body: "MZ-gzipped" },
    ])
    const gzipped = new Uint8Array(gzipSync(Buffer.from(tarball)))

    expect(Buffer.from(extractExecutable(gzipped, "opencode.exe")!).toString()).toBe("MZ-gzipped")
    expect(extractManifest(gzipped)?.version).toBe("2.2.6")
  })

  test("a truncated entry is refused instead of slicing past the end", () => {
    const complete = archive([{ name: "package/bin/opencode.exe", body: "MZ-binary" }])
    const truncated = complete.subarray(0, BLOCK + 4)

    expect(() => extractExecutable(truncated, "opencode.exe")).toThrow(/truncated/)
  })
})

describe("extractManifest", () => {
  test("reads package/package.json", () => {
    const tarball = archive([{ name: "package/package.json", body: `{"name":"cli","version":"2.2.6"}` }])

    expect(extractManifest(tarball)).toEqual({ name: "cli", version: "2.2.6" })
  })

  test("missing or unreadable manifests are undefined, never a throw", () => {
    expect(extractManifest(archive([{ name: "package/bin/opencode.exe", body: "MZ" }]))).toBeUndefined()
    expect(extractManifest(archive([{ name: "package/package.json", body: "{not json" }]))).toBeUndefined()
  })
})
