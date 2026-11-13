/**
 * Startup and teardown for the egress engine.
 *
 * Three things have to happen before the first request leaves the app: the saved lane is
 * restored, the Chromium session learns the proxy, and the log watcher starts feeding
 * limits in. All three live here so `desktop.ts` stays a list of layers.
 */
import { session } from "electron"
import { Effect } from "effect"
import { engine } from "./engine"
import { watchSidecarLogs, type Watcher } from "./watcher"

let watcher: Watcher | null = null
let unsubscribe: (() => void) | null = null
/** The rule last handed to Chromium; `null` means this process has not set one yet. */
let applied: string | null = null

/**
 * Chromium keeps its own proxy configuration; the environment variables the CLI inherits
 * do not reach it. Setting both is what makes the window's fetch and the sidecar's fetch
 * leave by the same door.
 *
 * The Direct lane resolves to `system`, not to `direct`. A VPN, a corporate PAC file or a
 * proxy set in the OS is the machine's own route, and answering "direct" overrode all of
 * them — turning the lane that is supposed to mean "as configured" into "no proxy at all".
 */
async function applySessionProxy(endpoint: string) {
  const target = session.defaultSession
  if (!target) return

  // `state` fires on every phase change; the rule only has to move when the door does.
  if (endpoint === applied) return

  try {
    if (endpoint) {
      await target.setProxy({
        mode: "fixed_servers",
        proxyRules: new URL(endpoint).host,
        // Chromium is launched with `<-loopback>`, which drops the implicit bypass, so the
        // loopback rules have to be named or the window sends its own service through the lane.
        proxyBypassRules: "localhost;127.0.0.1;[::1];<local>",
      })
    } else {
      await target.setProxy({ mode: "system" })
    }
    applied = endpoint
  } catch {
    // A malformed endpoint is rejected by the engine before it reaches here; a session
    // that refuses the rule still has the environment path for the CLI.
  }
}

export const start = Effect.gen(function* () {
  yield* Effect.promise(() => engine.load())

  // A restored endpoint is applied to Chromium too, not only to the environment. An empty
  // one is still applied: it is what puts the session back on the machine's own proxy
  // configuration instead of leaving a rule from the previous run in place.
  const restored = engine.snapshot().endpoint
  yield* Effect.promise(() => applySessionProxy(restored))

  const onState = (state: ReturnType<typeof engine.snapshot>) => {
    void applySessionProxy(state.endpoint)
  }
  engine.on("state", onState)
  unsubscribe = () => engine.off("state", onState)

  watcher = watchSidecarLogs((line) => engine.observe(line))

  // A bridge that dies between rotations is otherwise invisible: the sidecar keeps dialling
  // the closed port and every request fails without naming a cause.
  engine.startWatchdog()

  // The saved lane is re-proven after boot so the sidebar opens on the exit address the app
  // left on. WARP answers immediately; Tor pays its bootstrap here, off the startup path.
  const restoredLane = engine.lane
  if (restoredLane !== "direct" && engine.settings.resume) void engine.activate(restoredLane).catch(() => undefined)

  yield* Effect.logInfo("egress engine ready", { lane: engine.lane, endpoint: engine.snapshot().endpoint })

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      watcher?.stop()
      watcher = null
      unsubscribe?.()
      unsubscribe = null
      await engine.dispose()
    }),
  )
})
