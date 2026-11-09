export * as EngineRegistry from "./engine-registry"

import { accepts, compare, type Channel } from "./engine-contract"
import { extractExecutable, extractManifest, verifyIntegrity } from "./engine-tar"

/**
 * The registry side of a free engine update: ask npm what exists, pick the platform package that
 * matches this machine, and fetch it with the integrity string the registry published.
 *
 * Only `latest` is consulted for a channel move. Enumerating every published version means pulling
 * a packument measured in megabytes to choose between releases that a channel would reject anyway;
 * one tag plus the range check in `engine-contract` answers the same question with one small request.
 */
const REGISTRY = "https://registry.npmjs.org"
const PACKAGE = "@opencode/cli"
const TIMEOUT_MS = 60_000

async function get(url: string): Promise<Response> {
  let response: Response

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "oliviacode-desktop" },
    })
  } catch (error) {
    // A bare "operation timed out" says nothing about which request hung.
    throw new Error(`${url}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) throw new Error(`${url} responded ${response.status}`)

  return response
}

export async function distTags(): Promise<Record<string, string>> {
  const response = await get(`${REGISTRY}/-/package/${PACKAGE}/dist-tags`)

  return (await response.json()) as Record<string, string>
}

export interface Manifest {
  readonly name: string
  readonly version: string
  readonly optionalDependencies?: Record<string, string>
  readonly dist: { readonly tarball: string; readonly integrity?: string }
}

export async function manifestOf(name: string, version: string): Promise<Manifest> {
  const response = await get(`${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`)

  return (await response.json()) as Manifest
}

export async function manifest(version: string): Promise<Manifest> {
  return manifestOf(PACKAGE, version)
}

export function osName(platform: string = process.platform): "windows" | "darwin" | "linux" {
  if (platform === "win32") return "windows"
  if (platform === "darwin") return "darwin"

  return "linux"
}

export function executableName(platform: string = process.platform) {
  return platform === "win32" ? "opencode.exe" : "opencode"
}

export interface PlatformPackage {
  readonly name: string
  readonly version: string
}

/**
 * The optional dependencies that can carry this machine's binary, in preference order.
 *
 * x64 has two builds: `baseline` (no AVX2 requirement) and the plain one. The public build pins
 * `baseline`, so adoption does the same — a plain build on a CPU without AVX2 dies with an illegal
 * instruction, which is the one failure the gate cannot catch because it happens on the user's
 * machine, not in the sandbox, if the CPU differs.
 */
const PLATFORM_PACKAGES: ReadonlyArray<{
  readonly os: string
  readonly arch: string
  readonly names: ReadonlyArray<string>
}> = [
  { os: "win32", arch: "arm64", names: ["@opencode/cli-windows-arm64"] },
  { os: "win32", arch: "x64", names: ["@opencode/cli-windows-x64-baseline", "@opencode/cli-windows-x64"] },
  { os: "darwin", arch: "arm64", names: ["@opencode/cli-darwin-arm64"] },
  { os: "darwin", arch: "x64", names: ["@opencode/cli-darwin-x64-baseline", "@opencode/cli-darwin-x64"] },
  { os: "linux", arch: "arm64", names: ["@opencode/cli-linux-arm64"] },
  { os: "linux", arch: "x64", names: ["@opencode/cli-linux-x64-baseline", "@opencode/cli-linux-x64"] },
]

/** The optional dependency that carries this machine's binary, exactly as the umbrella package declares it. */
export function platformPackage(
  input: Manifest,
  platform: string = process.platform,
  arch: string = process.arch,
): PlatformPackage | undefined {
  const candidates = PLATFORM_PACKAGES.find((item) => item.os === platform && item.arch === arch)

  for (const name of candidates?.names ?? []) {
    const version = input.optionalDependencies?.[name]

    if (version) return { name, version }
  }

  return undefined
}

export function tarballUrl(input: PlatformPackage) {
  // Scoped tarballs drop the scope from the file name: @scope/name -> name-<version>.tgz
  const short = input.name.split("/").pop()!

  return `${REGISTRY}/${input.name}/-/${short}-${input.version}.tgz`
}

export interface Download {
  readonly binary: Uint8Array
  /** The version the package itself claims, which the gate then has to agree with. */
  readonly version: string
  readonly bytes: number
}

/** Fetches and verifies one platform package, returning the executable bytes only. */
export async function download(input: PlatformPackage, platform: string = process.platform): Promise<Download> {
  const published = await manifestOf(input.name, input.version)
  const integrity = published.dist?.integrity

  // A release without an integrity string cannot be verified, and an unverified executable is not
  // installed: the registry publishes one for every version this client is willing to take.
  if (!integrity) throw new Error(`${input.name}@${input.version} publishes no integrity string`)

  const response = await get(published.dist.tarball || tarballUrl(input))
  const tarball = new Uint8Array(await response.arrayBuffer())

  if (!verifyIntegrity(tarball, integrity)) throw new Error(`${input.name}@${input.version} failed integrity check`)

  const extracted = extractManifest(tarball)
  if (extracted?.version !== input.version) {
    throw new Error(`${input.name} contains version ${extracted?.version ?? "unknown"}, expected ${input.version}`)
  }

  const binary = extractExecutable(tarball, executableName(platform))
  if (!binary) throw new Error(`${input.name} contains no ${executableName(platform)}`)

  return { binary, version: extracted.version, bytes: tarball.byteLength }
}

export interface Candidate {
  readonly version: string
  readonly package: PlatformPackage
  readonly umbrella: Manifest
}

/**
 * The newest engine this channel would accept, or undefined when upstream has nothing for it.
 * `latest` is the only tag consulted: `next` and `beta` are prereleases, which a channel refuses.
 */
export async function candidate(input: {
  readonly current: string
  readonly channel: Channel
  readonly platform?: string
  readonly arch?: string
  /** Test and support hook: adopt exactly this version when the channel would accept it. */
  readonly pin?: string
}): Promise<Candidate | undefined> {
  if (input.channel === "bundled") return undefined

  const version = input.pin ?? (await distTags()).latest
  if (!version || !accepts(input.current, version, input.channel)) return undefined

  const umbrella = await manifest(version)
  const platform = platformPackage(umbrella, input.platform, input.arch)

  return platform ? { version, package: platform, umbrella } : undefined
}

/** True when `candidate` is a legitimate forward move from `current` on this channel. */
export function forward(current: string, candidate: string, channel: Channel): boolean {
  return accepts(current, candidate, channel) && compare(candidate, current) > 0
}
