#!/usr/bin/env bun
/**
 * Build-time proof that the engine being bundled still answers every operation the window calls.
 *
 * The adoption gate protects against a *newer* engine changing its API. This protects the other
 * direction: the app ships a pinned engine, and a pin that lost a route would break every install
 * before any adoption had a chance to run. Same gate, run against the binary that is about to be
 * packaged.
 *
 * `bun run script/engine-contract.ts` on its own checks `resources/` in this package.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { requiredOperations } from "../src/main/service/engine-contract"
import { gate } from "../src/main/service/engine-gate"

export interface VerifyInput {
  readonly binary: string
  /** The version the bundle claims. Omitted for a source build, whose version is only known at runtime. */
  readonly expectedVersion?: string
}

/** Boots `binary` in a throwaway root and refuses it unless it still serves the desktop's contract. */
export async function verifyBundledEngine(input: VerifyInput) {
  const sandbox = mkdtempSync(path.join(tmpdir(), "engine-build-gate-"))

  try {
    const result = await gate({
      binary: input.binary,
      expectedVersion: input.expectedVersion,
      contract: { generatedFrom: "desktop", required: requiredOperations },
      sandbox,
    })

    return result
  } finally {
    try {
      rmSync(sandbox, { recursive: true, force: true })
    } catch {
      // The engine may still hold a handle; the temp directory is disposable either way.
    }
  }
}

export function bundledVersion(resources = path.resolve(import.meta.dir, "../resources")) {
  try {
    return readFileSync(path.join(resources, "opencode-cli.version"), "utf8").trim() || undefined
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const resources = path.resolve(import.meta.dir, "../resources")
  const binary = path.join(resources, process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli")
  const version = bundledVersion(resources)

  console.log(`engine   ${binary}`)
  console.log(`version  ${version ?? "(source build)"}`)

  const result = await verifyBundledEngine({ binary, expectedVersion: version })

  console.log(`ok       ${result.ok}`)
  console.log(`reason   ${result.reason ?? "-"}`)
  console.log(`evidence ${JSON.stringify(result.evidence)}`)

  if (!result.ok) {
    for (const missing of result.missing) console.error(`missing  ${missing.method} ${missing.path}`)
    process.exit(1)
  }
}
