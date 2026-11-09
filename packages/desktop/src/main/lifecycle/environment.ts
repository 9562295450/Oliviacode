import http from "node:http"
import path from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { app } from "electron"
import { Effect, Path } from "effect"
import { registerWebTools } from "../mcp/web-tools"
import { DesktopPaths } from "../paths"
import { getUserShell, loadShellEnv } from "../service/shell-env"
import { registerRendererProtocol, setDockIcon, setProtocolReporter } from "../windows"
import { scoped } from "../native/logging"
import { applySpellcheck, spellcheckMenuItems } from "../native/spellcheck"
import { nativeT } from "../native/translations"

// electron-context-menu attaches to every existing and future window, so it can load once the first
// window is up instead of holding up startup with its dependency tree.
export const installContextMenu = Effect.gen(function* () {
  const { default: contextMenu } = yield* Effect.promise(() => import("electron-context-menu"))
  contextMenu({
    showSaveImageAs: true,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    // Getters, because electron-context-menu reads the labels each time the menu opens.
    labels: {
      get cut() {
        return nativeT("desktop.menu.cut")
      },
      get copy() {
        return nativeT("desktop.menu.copy")
      },
      get paste() {
        return nativeT("desktop.menu.paste")
      },
      get selectAll() {
        return nativeT("desktop.menu.selectAll")
      },
    },
    append: (_actions, params) => (params.isEditable ? spellcheckMenuItems() : []),
  })
})

export const prepareApplicationEnvironment = Effect.gen(function* () {
  yield* loadSystemCertificates
  yield* loadProxyEnvironment
})

export const preferApplicationEnvironment = Effect.gen(function* () {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? yield* loadShellEnv(shell) : null
  yield* Effect.sync(() => {
    if (!shellEnv?.XDG_STATE_HOME) delete process.env.XDG_STATE_HOME
    Object.assign(process.env, {
      ...shellEnv,
      OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
      OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
      OPENCODE_CLIENT: "desktop",
    })
  })
})

/**
 * Keeps the bundled engine's global state inside this app's own profile.
 *
 * The engine otherwise resolves its data, config and cache directories from the user's home and
 * inherits whatever the official install left there — including its provider database and stored
 * credentials. A separate client must start with nothing it did not create itself, so every XDG
 * root is redirected to a sibling of userData. Tests and onboarding already choose their own roots
 * and are left alone.
 */
export const isolateEngineEnvironment = Effect.sync(() => {
  if (process.env.OPENCODE_TEST_ONBOARDING === "1" || process.env.OPENCODE_DESKTOP_TEST_ROOT) return

  const root = path.join(app.getPath("userData"), "engine")

  process.env.XDG_DATA_HOME = path.join(root, "data")
  process.env.XDG_CONFIG_HOME = path.join(root, "config")
  process.env.XDG_CACHE_HOME = path.join(root, "cache")
  process.env.XDG_STATE_HOME = path.join(root, "state")

  // These three override the XDG roots inside the engine. Inheriting any of them would let the shell
  // that launched this app steer the engine at another installation's config, plugins, and credentials.
  delete process.env.OPENCODE_CONFIG
  delete process.env.OPENCODE_CONFIG_CONTENT
  delete process.env.OPENCODE_CONFIG_DIR

  return process.env.XDG_CONFIG_HOME
}).pipe(
  // Registering after the redirect is the whole point: the entry lands in this profile's config and
  // nowhere else. A failure here costs web research, not the launch, so it is logged and dropped.
  Effect.tap(() =>
    Effect.try(() => registerWebTools()).pipe(
      Effect.catch((error) => Effect.logWarning("failed to register the web tools server", { error })),
    ),
  ),
)

export const prepareDesktop = Effect.gen(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve

  if (app.isPackaged || process.env.OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION !== "1")
    app.setAsDefaultProtocolClient("opencode")
  const runFork = Effect.runForkWith(yield* Effect.context())
  setProtocolReporter((level, message, data) =>
    runFork(scoped("protocol", level === "error" ? Effect.logError(message, data) : Effect.logWarning(message, data))),
  )
  registerRendererProtocol(paths.rendererRoot)
  setDockIcon(path, paths)
  applySpellcheck()
})

export const loadProxyEnvironment = Effect.gen(function* () {
  yield* Effect.try(() => {
    ensureLoopbackNoProxy()
    // SAFETY: Electron 41.2 ships a Node with http.setGlobalProxyFromEnv, which the current @types/node lacks.
    const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv(): void }
    proxyAwareHttp.setGlobalProxyFromEnv()
  }).pipe(Effect.catch((error) => Effect.logWarning("failed to load proxy environment", { error })))
})

const loadSystemCertificates = Effect.try({
  try: () => {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  },
  catch: (error) => error,
}).pipe(Effect.catch((error) => Effect.logWarning("failed to load system certificates", { error })))

// Bun reads lowercase `no_proxy` alone whenever it is set, so both spellings get the same merged list.
function ensureLoopbackNoProxy() {
  const noProxy = [
    ...new Set(
      [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
        (value ?? "").split(",").flatMap((entry) => entry.trim() || []),
      ),
    ),
  ].join(",")

  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
}
