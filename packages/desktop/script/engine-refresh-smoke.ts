// Manual verification: one real registry round trip through the adoption path.
// Downloads the platform package (about 100 MB) and boots it, so it is not part of `bun test`.
// `bun run script/engine-refresh-smoke.ts`
// Simulates a launch whose bundled engine is 2.2.5, so npm's 2.2.6 is a legitimate forward move.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { file, read } from "../src/main/service/engine-adoption"
import { preferred, refresh } from "../src/main/service/engine-update"

const userData = mkdtempSync(path.join(tmpdir(), "engine-refresh-"))
const bundled = "2.2.5"

console.log("userData ", userData)
console.log("bundled  ", bundled)

const started = Date.now()
const outcome = await refresh({ userData, current: bundled, channel: "latest" })
const elapsed = Date.now() - started

console.log("elapsed  ", `${(elapsed / 1000).toFixed(1)}s`)
console.log("status   ", outcome.status)
console.log("version  ", outcome.version ?? "-")
console.log("reason   ", outcome.reason ?? "-")
console.log("evidence ", JSON.stringify(outcome.evidence, null, 2))
console.log("record   ", JSON.stringify(read(file(userData)), null, 2))

const picked = preferred({ userData, bundledVersion: bundled })
console.log("preferred", JSON.stringify(picked, null, 2))

if (picked.binary) {
  const size = statSync(picked.binary).size
  const head = readFileSync(picked.binary).subarray(0, 2).toString("ascii")
  console.log("binary   ", picked.binary)
  console.log("bytes    ", size)
  console.log("magic    ", head === "MZ" ? "MZ (windows PE)" : head)
}

// Second call with the adopted version as current must find nothing to do.
const again = await refresh({ userData, current: picked.version ?? bundled, channel: "latest" })
console.log("again    ", again.status, "-", again.reason ?? "")

rmSync(userData, { recursive: true, force: true })
console.log("cleanup  ", "ok")
process.exit(outcome.status === "adopted" && picked.version ? 0 : 1)
