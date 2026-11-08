import { Effect } from "effect"
import { InfiniteRpcs } from "../../shared/ipc-rpc"
import { InfiniteChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { engine } from "../infinite/engine"
import { BackgroundService } from "../service/background-service"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { getMainWindows } from "../windows"

/**
 * The egress engine's IPC face.
 *
 * Side effects that belong to the main process — restarting the sidecar, pushing a state
 * change to every open window — are wired here rather than inside the engine, so the
 * engine stays testable and has no dependency on Electron's window tree.
 */
export const infiniteHandlers = InfiniteRpcs.toLayer(
  Effect.gen(function* () {
    const background = yield* BackgroundService.Service

    engine.configure({
      restartSidecar: async () => {
        // A reconnect restarts the CLI service and hands every window the new origin.
        await Effect.runPromise(background.reconnect).then(SidecarCredentials.ready)
      },
    })

    // One subscription for the process: the engine emits a whole snapshot each time and
    // every window draws it, so a window opened mid-rotation is never out of date.
    const publish = (state: unknown) => {
      for (const win of getMainWindows()) {
        if (win.isDestroyed() || win.webContents.isDestroyed()) continue
        emitIpcEvent(win.webContents, new InfiniteChanged({ state: state as never }))
      }
    }
    engine.on("state", publish)
    yield* Effect.addFinalizer(() => Effect.sync(() => engine.off("state", publish)))

    return InfiniteRpcs.of({
      InfiniteGetState: () => Effect.sync(() => engine.snapshot()),
      InfiniteGetSettings: () => Effect.sync(() => engine.settings),
      InfiniteSetSettings: ({ settings }) => Effect.sync(() => engine.setSettings(settings)),
      InfiniteSetLane: ({ lane }) => Effect.tryPromise(() => engine.activate(lane)).pipe(Effect.orDie),
      InfiniteRotate: ({ lane }) =>
        Effect.tryPromise(() => engine.rotate(lane)).pipe(
          Effect.map((result) => ({ ...result })),
          Effect.orDie,
        ),
      InfiniteArm: ({ armed }) =>
        Effect.sync(() => {
          engine.setArmed(armed)
          return engine.snapshot()
        }),
      InfiniteCheckLanes: () => Effect.tryPromise(() => engine.checkLanes()).pipe(Effect.orDie),
      InfiniteObserve: ({ line }) => Effect.sync(() => engine.observe(line)),
      InfiniteCheckUpdate: () =>
        Effect.tryPromise(() => engine.checkUpdate()).pipe(Effect.orDie),
      InfiniteApplyUpdate: () =>
        Effect.tryPromise(() => engine.applyUpdate()).pipe(Effect.orDie),
    })
  }),
)
