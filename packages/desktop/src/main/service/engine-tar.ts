export * as EngineTar from "./engine-tar"

import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"

/**
 * The two things a downloaded engine has to survive before it is allowed near a stage directory:
 * the registry's own integrity string, and getting the executable out of an npm tarball without a
 * tar dependency. npm publishes `dist.integrity` as `sha512-<base64>` over the exact tarball bytes,
 * so a mismatch means the file did not arrive as published and is thrown away unread.
 */
export function verifyIntegrity(tarball: Uint8Array, integrity: string): boolean {
  const [algorithm, expected] = integrity.split("-", 2)
  if (!algorithm || !expected) return false

  const actual = createHash(algorithm).update(tarball).digest("base64")

  return actual === expected
}

const BLOCK = 512

function octal(buffer: Uint8Array, start: number, length: number): number {
  const text = Buffer.from(buffer.subarray(start, start + length)).toString("ascii").replace(/\0/g, "").trim()

  // Base-256 encoding appears when a size exceeds the octal field's range; no engine binary does, but
  // guessing a size is worse than refusing the archive.
  if (!/^[0-7]*$/.test(text)) throw new Error(`unsupported tar field: ${text.slice(0, 16)}`)

  return text.length === 0 ? 0 : Number.parseInt(text, 8)
}

export interface Entry {
  readonly name: string
  readonly bytes: Uint8Array
}

/** npm publishes `.tgz`: a gzip stream around a ustar archive. A plain ustar is accepted too. */
function decompress(input: Uint8Array): Uint8Array {
  if (input.length > 2 && input[0] === 0x1f && input[1] === 0x8b) return gunzipSync(input)

  return input
}

/** Walks a ustar archive and returns every regular file whose name matches. GNU longnames are skipped. */
function entries(tarball: Uint8Array): Entry[] {
  const found: Entry[] = []
  const archive = decompress(tarball)
  let offset = 0

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK)

    // Two zero blocks end the archive; one zero block is padding.
    if (header.every((byte) => byte === 0)) break

    const name = Buffer.from(header.subarray(0, 100)).toString("utf8").replace(/\0.*$/s, "")
    const prefix = Buffer.from(header.subarray(345, 500)).toString("utf8").replace(/\0.*$/s, "")
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] ?? 0)
    const body = offset + BLOCK

    if (body + size > archive.length) throw new Error(`truncated tar entry ${name}`)

    // Only regular files carry content worth keeping; 'L' holds a long name for the next entry.
    if (type === "0" || type === "\0" || type === "") {
      found.push({ name: prefix ? `${prefix}/${name}` : name, bytes: archive.subarray(body, body + size) })
    }

    offset = body + Math.ceil(size / BLOCK) * BLOCK
  }

  return found
}

/**
 * Pulls the engine executable out of a platform package tarball. The package ships one binary under
 * `package/bin/`, so the match is on the basename rather than on a hardcoded prefix that npm is free
 * to change.
 */
export function extractExecutable(tarball: Uint8Array, executable: string): Uint8Array | undefined {
  const match = entries(tarball).find((entry) => {
    const base = entry.name.split("/").pop()

    return base === executable || base === executable.replace(/\.exe$/, "")
  })

  return match?.bytes
}

/** Reads `package/package.json` from a tarball, because the version that ships must match the one requested. */
export function extractManifest(tarball: Uint8Array): { version?: string; name?: string } | undefined {
  const manifest = entries(tarball).find((entry) => entry.name === "package/package.json")

  if (!manifest) return undefined

  try {
    return JSON.parse(Buffer.from(manifest.bytes).toString("utf8")) as { version?: string; name?: string }
  } catch {
    return undefined
  }
}
