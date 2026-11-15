import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * File plumbing for provider add-ons.
 *
 * Kept free of Electron imports so the parsing and write rules can be tested directly. `presets.ts`
 * owns discovery and the RPC layer; this module owns the single file mutation.
 */

/**
 * Windows editors — and PowerShell 5.1's `Out-File -Encoding utf8` — prepend a BOM. `JSON.parse`
 * rejects it, so every read strips it. A write from here emits no BOM and heals the file.
 */
export function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function readJsonFile(file: string): unknown {
  return JSON.parse(stripBom(readFileSync(file, "utf8")))
}

export function parsesAsJson(text: string) {
  try {
    JSON.parse(stripBom(text))
    return true
  } catch {
    return false
  }
}

export type WriteResult = { ok: true; path: string } | { ok: false; path: string; error: string }

/** A JSON document's top level must be an object; anything else cannot hold a `provider` map. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Reads, mutates and writes the config document. Never throws: the caller is an IPC handler. */
function update(file: string, mutate: (config: Record<string, unknown>) => void): WriteResult {
  try {
    if (file.endsWith(".jsonc") && existsSync(file) && !parsesAsJson(readFileSync(file, "utf8")))
      return { ok: false, path: file, error: `${file} contains comments; add the block by hand.` }

    const config = asRecord(existsSync(file) ? readJsonFile(file) : {})

    if (!config) return { ok: false, path: file, error: `${file} does not contain a JSON object.` }

    mutate(config)

    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8")

    return { ok: true, path: file }
  } catch (error) {
    return { ok: false, path: file, error: describeFailure(error, file) }
  }
}

export function writeProviderBaseURL(file: string, provider: string, baseURL: string): WriteResult {
  return update(file, (config) => {
    const providers = asRecord(config.provider) ?? {}
    const entry = asRecord(providers[provider]) ?? {}
    const options = { ...(asRecord(entry.options) ?? {}), baseURL }
    config.provider = { ...providers, [provider]: { ...entry, options } }
  })
}

/** A custom OpenAI-compatible provider typed into the add-provider dialog. */
export function writeCustomProvider(
  file: string,
  entry: { id: string; name: string; baseURL: string; models: readonly string[] },
): WriteResult {
  return update(file, (config) => {
    const providers = asRecord(config.provider) ?? {}
    const previous = asRecord(providers[entry.id]) ?? {}
    const models = Object.fromEntries(entry.models.map((model) => [model, { name: model }]))

    config.provider = {
      ...providers,
      [entry.id]: { ...previous, name: entry.name, package: "@ai-sdk/openai-compatible", settings: { baseURL: entry.baseURL }, models },
    }
  })
}

/**
 * Applies one preset entry. An entry without a models list only points a provider id the engine
 * catalogue already knows at a base URL. An entry with one names a provider the catalogue does
 * not know, so it is written as a full custom provider instead.
 */
export function writePreset(
  file: string,
  entry: { provider: string; label: string; baseURL: string; models?: readonly string[] },
): WriteResult {
  if (entry.models?.length)
    return writeCustomProvider(file, { id: entry.provider, name: entry.label, baseURL: entry.baseURL, models: entry.models })

  return writeProviderBaseURL(file, entry.provider, entry.baseURL)
}

/** A failure the user can act on: which file, which errno, which JSON position. */
export function describeFailure(error: unknown, file: string) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const detail = error instanceof Error ? error.message : String(error)

  if (code === "EACCES" || code === "EPERM") return `No permission to write ${file} (${code}): ${detail}`
  if (code === "ENOSPC") return `The volume holding ${file} is full.`
  if (code === "EROFS") return `${file} is on a read-only volume.`
  if (error instanceof SyntaxError) return `${file} is not valid JSON: ${detail}`
  if (code) return `Writing ${file} failed (${code}): ${detail}`

  return `Writing ${file} failed: ${detail}`
}
