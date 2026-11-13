/**
 * Which provider the app is actually pointed at.
 *
 * The egress engine used to ask the panel for a provider URL, a model and a key. Almost
 * nobody fills those in, so every rotation was adopted unverified and the provider column
 * stayed empty — the check existed but never ran. The app already knows the answer: the
 * engine reads `opencode.json`, whose `model` is `provider/model`. This module reads the
 * same file and hands the probe the endpoint and model the session really uses.
 *
 * A provider listening on loopback is reported separately. `NO_PROXY` keeps loopback out of
 * every lane, so a probe through a tunnel would test a route the session never takes, and
 * the local pool counts its own quota anyway.
 *
 * The key is read here for one request and never written anywhere: the engine's own state
 * file persists settings, and a credential on disk is not a setting.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ActiveProvider =
  /** No model is selected, or the selected provider has no usable base URL. */
  | { readonly kind: "none" }
  /** Reachable only from this machine: a lane switch does not change what it sees. */
  | { readonly kind: "local"; readonly endpoint: string; readonly model: string }
  /** A remote OpenAI-compatible endpoint the probe can actually spend one token on. */
  | { readonly kind: "remote"; readonly endpoint: string; readonly model: string; readonly key: string }

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i

/** The engine's config root, which `isolateEngineEnvironment` pins under userData. */
export function configDir(env: NodeJS.ProcessEnv = process.env) {
  const xdg = env.XDG_CONFIG_HOME?.trim()
  return xdg ? join(xdg, "opencode") : join(homedir(), ".config", "opencode")
}

/** Both names the engine discovers; the first that exists wins. */
export function configCandidates(env: NodeJS.ProcessEnv = process.env) {
  return [join(configDir(env), "opencode.json"), join(configDir(env), "opencode.jsonc")]
}

/**
 * Turn a provider base URL into the chat route the probe posts to.
 *
 * `baseURL` is a root (`https://host/v1`), not a route. Posting to the root answers 404 or an
 * HTML landing page, which reads as `unknown` and silently disables verification — the exact
 * failure this module exists to remove.
 */
export function chatEndpoint(baseURL: string) {
  const trimmed = baseURL.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

/** Resolve `{env:NAME}` templates; a literal key is returned unchanged. */
function literalKey(value: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof value !== "string") return ""
  const template = /^\{env:([A-Z0-9_]+)\}$/i.exec(value.trim())
  if (template) return env[template[1]!] ?? ""
  if (value.includes("{env:")) return ""
  return value.trim()
}

function isLoopback(endpoint: string) {
  try {
    return LOOPBACK.test(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

/**
 * Classify an endpoint someone typed into the panel, under the same rules as the config.
 *
 * A manual endpoint wins over the config so the check can be pointed elsewhere without
 * editing a file the app owns; everything after that decision is identical.
 */
export function classifyProvider(baseURL: string, model: string, key: string): ActiveProvider {
  const endpoint = chatEndpoint(baseURL)
  if (!endpoint) return { kind: "none" }
  if (isLoopback(endpoint)) return { kind: "local", endpoint, model }
  return { kind: "remote", endpoint, model, key: key.trim() }
}

type Entry = {
  readonly options?: { readonly baseURL?: unknown; readonly apiKey?: unknown }
  readonly settings?: { readonly baseURL?: unknown; readonly apiKey?: unknown }
  readonly baseURL?: unknown
}

function entryFor(config: Record<string, unknown>, id: string): Entry | null {
  // Current shape: `{ provider: { id: { options } } }`. Older files used
  // `{ providers: { id: { settings } } }` and both are still read by the engine.
  const current = (config.provider ?? {}) as Record<string, Entry>
  const legacy = (config.providers ?? {}) as Record<string, Entry>
  return current[id] ?? legacy[id] ?? null
}

/** Read one parsed config document. Pure, so the shape is testable without a filesystem. */
export function parseActiveProvider(config: unknown, env: NodeJS.ProcessEnv = process.env): ActiveProvider {
  if (!config || typeof config !== "object") return { kind: "none" }
  const document = config as Record<string, unknown>

  const selected = typeof document.model === "string" ? document.model.trim() : ""
  const slash = selected.indexOf("/")
  if (slash <= 0) return { kind: "none" }

  const id = selected.slice(0, slash)
  const model = selected.slice(slash + 1)
  if (!id || !model) return { kind: "none" }

  const entry = entryFor(document, id)
  if (!entry) return { kind: "none" }

  const base =
    (typeof entry.options?.baseURL === "string" && entry.options.baseURL) ||
    (typeof entry.settings?.baseURL === "string" && entry.settings.baseURL) ||
    (typeof entry.baseURL === "string" && entry.baseURL) ||
    ""

  if (!base.trim()) return { kind: "none" }

  const key = literalKey(entry.options?.apiKey ?? entry.settings?.apiKey ?? "", env)
  return classifyProvider(base, model, key)
}

/** The live answer, read from the config the engine is using right now. */
export function readActiveProvider(env: NodeJS.ProcessEnv = process.env): ActiveProvider {
  for (const file of configCandidates(env)) {
    if (!existsSync(file)) continue
    try {
      return parseActiveProvider(JSON.parse(readFileSync(file, "utf8")), env)
    } catch {
      // A commented jsonc file is not readable by the app either; try the next name.
    }
  }
  return { kind: "none" }
}
