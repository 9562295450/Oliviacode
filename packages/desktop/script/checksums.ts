#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, writeFile } from "node:fs/promises"
import path from "node:path"

// Writes SHA256SUMS.txt for the release artifacts in a directory, so a download can be checked
// against a published hash instead of trusted by filename. Streams each file: installers are
// hundreds of megabytes and must not be held in memory.
const dir = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "..", "dist"))

const entries = (await readdir(dir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS.txt")
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

const lines: string[] = []

for (const name of entries) {
  const hash = createHash("sha256")

  await new Promise<void>((resolve, reject) => {
    createReadStream(path.join(dir, name))
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", reject)
  })

  lines.push(`${hash.digest("hex")}  ${name}`)
}

await writeFile(path.join(dir, "SHA256SUMS.txt"), lines.join("\n") + "\n")

console.log(`SHA256SUMS.txt: ${entries.length} file(s) in ${dir}`)
