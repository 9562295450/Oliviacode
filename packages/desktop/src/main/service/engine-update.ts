export * as EngineUpdate from "./engine-update"

import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { stageName } from "./cli-version"
import * as Adoption from "./engine-adoption"
import { requiredOperations, type Channel } from "./engine-contract"
import { gate } from "./engine-gate"
import * as Registry from "./engine-registry"

/**
 * The free-maintenance half of the engine: fetch a newer engine, prove it before it is allowed near
 * the real data, and give a launch that turns out badly a way back.
 *
 * Three entry points, in the order a launch uses them:
 *
 * - `preferred()` runs synchronously while the CLI is resolved, and answers "is this launch running
 *   the bundled engine or an adopted one".
 * - `confirmBoot()` runs once the sidecar has connected, which is the only proof that the adopted
 *   engine boots inside this app rather than merely inside the sandbox.
 * - `refresh()` runs after the app is up, and is the only part that touches the network. It never
 *   throws and never affects the running session: a new engine that passes its gate is adopted for
 *   the next launch, because swapping the engine under a live sidecar is how a session gets lost.
 *
 * Anything at all going wrong leaves the bundled engine in place. That is the whole design.
 */

/** The desktop channel maps to how far a channel is allowed to follow upstream. */
export function channelFor(channel: "local" | "dev" | "beta" | "prod"): Channel {
  if (channel === "prod") return "latest"
  if (channel === "beta") return "minor"

  // `dev` and `local` run from the source tree; an engine fetched from npm is not what they test.
  return "bundled"
}

function executableName(platform = process.platform) {
  return platform === "win32" ? "opencode-cli.exe" : "opencode-cli"
}

export function stageDirectory(userData: string, version: string, arch: string = process.arch) {
  return path.join(userData, "cli", stageName(version, arch))
}

export function stageBinary(userData: string, version: string, arch: string = process.arch) {
  return path.join(stageDirectory(userData, version, arch), executableName())
}

export interface Preferred {
  readonly version?: string
  readonly binary?: string
}

/**
 * What this launch should run. Synchronous because it sits on the path to the first window.
 *
 * A missing stage is treated as a failed adoption: the record is replaced with a rejection so the
 * same broken download is not retried on every launch, and the bundled engine runs instead.
 */
export function preferred(input: { readonly userData: string; readonly bundledVersion: string }): Preferred {
  const file = Adoption.file(input.userData)
  const record = Adoption.read(file)
  const decision = Adoption.decide(record, input.bundledVersion)

  if (decision.action === "none") {
    if (decision.record !== record) Adoption.write(file, decision.record)

    return {}
  }

  if (decision.action === "demote") {
    // `attempting` means the previous launch picked this engine and never confirmed a boot.
    Adoption.write(file, Adoption.rejecting(record.adopted!.version, "adopted engine did not complete a boot"))

    return {}
  }

  const version = decision.version!
  const binary = stageBinary(input.userData, version)

  if (!existsSync(binary)) {
    Adoption.write(file, Adoption.rejecting(version, "adopted engine stage is missing"))

    return {}
  }

  // Writing the transition before the engine runs is what makes an unconfirmed boot recoverable.
  if (decision.record !== record) Adoption.write(file, decision.record)

  return { version, binary }
}

/**
 * The adopted engine really booted inside the app: the sidecar answered and the window is talking
 * to it. Only now does the adoption become permanent.
 */
export function confirmBoot(userData: string, version: string): boolean {
  const file = Adoption.file(userData)
  const record = Adoption.read(file)
  const confirmed = Adoption.confirmed(record, version)

  if (confirmed === record) return false
  Adoption.write(file, confirmed)

  return true
}

export interface RefreshInput {
  readonly userData: string
  /** The engine this process is running, bundled or adopted. */
  readonly current: string
  readonly channel: Channel
  readonly platform?: string
  readonly arch?: string
  /** Support and test hook: adopt exactly this version when the channel allows it. */
  readonly pin?: string
}

export interface Outcome {
  readonly status: "adopted" | "current" | "refused" | "skipped" | "error"
  readonly version?: string
  readonly reason?: string
  readonly evidence?: Readonly<Record<string, unknown>>
}

let running = false

/**
 * Looks for a newer engine on `channel`, proves it, and stages it for the next launch.
 *
 * One at a time: two refreshes racing would download the same tarball twice and could write the
 * adoption record against two different candidates.
 */
export async function refresh(input: RefreshInput): Promise<Outcome> {
  if (input.channel === "bundled") return { status: "skipped", reason: "channel does not adopt engines" }
  if (process.env.OLIVIACODE_ENGINE_UPDATE === "off") return { status: "skipped", reason: "updates disabled" }
  if (running) return { status: "skipped", reason: "refresh already running" }

  running = true

  try {
    return await run(input)
  } catch (error) {
    return { status: "error", reason: error instanceof Error ? error.message : String(error) }
  } finally {
    running = false
  }
}

async function run(input: RefreshInput): Promise<Outcome> {
  const candidate = await Registry.candidate({
    current: input.current,
    channel: input.channel,
    platform: input.platform,
    arch: input.arch,
    pin: input.pin,
  })

  if (!candidate) return { status: "current", reason: "no newer engine on this channel" }

  const version = candidate.version
  const downloaded = await Registry.download(candidate.package, input.platform)

  // The package carries this machine's binary but is published from the umbrella's version, so the
  // two agreeing is part of what "the version we asked for" means.
  if (downloaded.version !== version)
    return { status: "refused", version, reason: `package contains ${downloaded.version}` }

  const binary = stageBinary(input.userData, version, input.arch)
  stage(binary, downloaded.binary)

  const sandbox = path.join(input.userData, "engine-gate", stageName(version, input.arch))
  rmSync(sandbox, { recursive: true, force: true })

  try {
    const result = await gate({
      binary,
      expectedVersion: version,
      contract: { generatedFrom: input.current, required: requiredOperations },
      sandbox,
    })

    if (!result.ok) {
      // The stage is removed as well as refused, so a later retry cannot run a candidate the gate
      // already rejected even if the record were lost.
      remove(stageDirectory(input.userData, version, input.arch))
      Adoption.write(Adoption.file(input.userData), Adoption.rejecting(version, result.reason ?? "gate refused"))

      return { status: "refused", version, reason: result.reason, evidence: result.evidence }
    }

    Adoption.write(
      Adoption.file(input.userData),
      Adoption.adopting({ version, channel: input.channel, from: input.current }),
    )

    return { status: "adopted", version, evidence: result.evidence }
  } finally {
    remove(sandbox)
  }
}

function stage(binary: string, bytes: Uint8Array) {
  mkdirSync(path.dirname(binary), { recursive: true })
  const temporary = `${binary}.${process.pid}.tmp`

  writeFileSync(temporary, bytes)
  // Windows has no executable bit; the filesystem decides by extension.
  if (process.platform !== "win32") chmodSync(temporary, 0o755)
  renameSync(temporary, binary)
}

function remove(target: string) {
  // Windows refuses to delete a file the engine still holds; the stage cleaner retries on next launch.
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    // Left for the next launch's cleanStages pass.
  }
}
