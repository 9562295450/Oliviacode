#!/usr/bin/env bun
import { $ } from "bun"
import { exists } from "node:fs/promises"
import path from "node:path"
import { copyBuiltCliToResources, downloadCliToResources, getCurrentCli, resolveChannel } from "./utils"
import { verifyBundles } from "./verify-bundles"

// Prepares resources/ (icons, metainfo, the bundled CLI) for OPENCODE_CHANNEL and builds the app into out/.
// The CLI comes from ../cli/dist when it holds the target; otherwise dev downloads the published dev CLI,
// beta the beta CLI, and prod fails unless OLIVIACODE_CLI_VERSION pins a published CLI for the release.
const dir = path.resolve(import.meta.dir, "..")

const cli = path.resolve(dir, "../cli/dist")

const channel = resolveChannel()

const pinnedCli = process.env.OLIVIACODE_CLI_VERSION?.trim()

process.chdir(dir)

await $`bun ./script/copy-icons.ts ${channel}`

await $`bun ./script/copy-metainfo.ts ${channel}`

const built = await exists(path.join(cli, getCurrentCli().package.replace("@opencode/", "")))

if (channel === "prod" && !built && !pinnedCli)
  throw new Error(`Production desktop builds bundle the CLI from ${cli}; build it first or set OLIVIACODE_CLI_VERSION`)

if (built) await copyBuiltCliToResources(cli)

if (!built) await downloadCliToResources(channel === "beta" ? "beta" : undefined)

// The pinned engine must still serve what the window calls. A release that bundles an engine with a
// dropped route would break every install before adoption ever runs, so it stops here instead.
if (process.env.OLIVIACODE_ENGINE_GATE !== "off") {
  const { bundledVersion, verifyBundledEngine } = await import("./engine-contract")
  const resources = path.join(dir, "resources")
  const result = await verifyBundledEngine({
    binary: path.join(resources, process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"),
    expectedVersion: bundledVersion(resources),
  })

  if (!result.ok) {
    const missing = result.missing.map((operation) => `  ${operation.method} ${operation.path}`).join("\n")
    throw new Error(`bundled engine failed the desktop contract: ${result.reason}\n${missing}`)
  }

  console.log(`Bundled engine passed the desktop contract (${result.evidence.operations} operations)`)
}

await $`bunx electron-vite build`

await verifyBundles(path.join(dir, "out"))
