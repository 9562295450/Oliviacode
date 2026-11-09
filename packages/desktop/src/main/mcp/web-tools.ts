import { app } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/**
 * Registers the bundled web-tools MCP server with the engine.
 *
 * The engine owns the tool surface; this app owns none of it, so the way to add a capability is
 * the way a host adds an app: an MCP server it launches. `web-tools.mjs` ships beside the CLI in
 * `resources` and speaks JSON-RPC over stdio, the same shape the engine already speaks for every
 * other MCP server a user configures.
 *
 * The entry is written into the config this app already redirects under its own profile, and only
 * when the key is absent. An entry a user has edited is left exactly as it is: their config, their
 * server, even when it shadows ours.
 */

/** Same key the server reports in `initialize`, so the engine's MCP list reads sensibly. */
const SERVER_KEY = "web-tools"

/** Mirrors `Global.Path.config`; `isolateEngineEnvironment` has already pointed XDG here. */
function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? path.join(xdg, "opencode") : path.join(homedir(), ".config", "opencode")
}

function configTarget() {
  const candidates = ["opencode.json", "opencode.jsonc"].map((name) => path.join(configDir(), name))
  return candidates.find((file) => existsSync(file)) ?? candidates[0]!
}

/** Packaged builds ship it beside the CLI; from source it sits in the package's resources dir. */
export function serverScript() {
  if (app.isPackaged) return path.join(process.resourcesPath, "web-tools.mjs")
  return path.join(app.getAppPath(), "resources", "web-tools.mjs")
}

/** The user's own settings file. Never inside the install directory, which may not be writable. */
export function settingsFile() {
  return path.join(app.getPath("userData"), "web-tools.json")
}

const EMPTY_SETTINGS = {
  search: { provider: "none", baseUrl: "", apiKey: "" },
  fetch: { maxBytes: 1_048_576, maxChars: 20_000 },
}

function ensureSettings() {
  const file = settingsFile()
  if (existsSync(file)) return file

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(EMPTY_SETTINGS, null, 2)}\n`)
  return file
}

export type Registration =
  | { readonly ok: true; readonly path: string; readonly changed: boolean; readonly reason?: "user-owned" }
  | { readonly ok: false; readonly path: string; readonly error: string }

type McpEntry = {
  type: "local"
  command: string[]
  environment: Record<string, string>
  enabled: boolean
}

export function entryFor(script: string, settings: string, execPath: string): McpEntry {
  return {
    type: "local",
    // Electron is the only Node this app can count on being present at a known path. Running it
    // with ELECTRON_RUN_AS_NODE turns the same binary into a plain Node with no window.
    command: [execPath, script],
    environment: {
      ELECTRON_RUN_AS_NODE: "1",
      OLIVIACODE_WEB_TOOLS_CONFIG: settings,
    },
    enabled: true,
  }
}

function sameEntry(left: unknown, right: McpEntry) {
  if (!left || typeof left !== "object") return false
  const candidate = left as Record<string, unknown>
  const command = Array.isArray(candidate.command) ? candidate.command : []
  const environment = (candidate.environment ?? {}) as Record<string, unknown>

  return (
    candidate.type === right.type &&
    candidate.enabled === right.enabled &&
    command.length === right.command.length &&
    command.every((part, index) => part === right.command[index]) &&
    environment.ELECTRON_RUN_AS_NODE === right.environment.ELECTRON_RUN_AS_NODE &&
    environment.OLIVIACODE_WEB_TOOLS_CONFIG === right.environment.OLIVIACODE_WEB_TOOLS_CONFIG
  )
}

export function registerWebTools(): Registration {
  const target = configTarget()

  // The server file missing is a packaging fault, not a user choice: say so once and leave the
  // config untouched rather than publishing an entry that cannot start.
  const script = serverScript()
  if (!existsSync(script)) return { ok: false, path: target, error: `Missing ${script}.` }

  // A jsonc file with comments cannot round-trip through JSON.parse without losing them.
  let config: Record<string, unknown> = {}
  if (existsSync(target)) {
    try {
      config = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>
    } catch {
      return { ok: false, path: target, error: `${target} is not plain JSON; add the mcp.${SERVER_KEY} block by hand.` }
    }
  }

  const mcp = (config.mcp ?? {}) as Record<string, unknown>
  const entry = entryFor(script, ensureSettings(), process.execPath)

  if (SERVER_KEY in mcp) {
    if (sameEntry(mcp[SERVER_KEY], entry)) return { ok: true, path: target, changed: false }
    return { ok: true, path: target, changed: false, reason: "user-owned" }
  }

  config.mcp = { ...mcp, [SERVER_KEY]: entry }

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)

  return { ok: true, path: target, changed: true }
}
