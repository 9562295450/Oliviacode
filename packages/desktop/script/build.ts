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

await $`bunx electron-vite build`

await verifyBundles(path.join(dir, "out"))
