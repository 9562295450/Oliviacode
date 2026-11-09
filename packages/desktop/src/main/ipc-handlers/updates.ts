import { Effect } from "effect"
import { UpdateRpcs } from "../../shared/ipc-rpc"
import { checkForUpdates, downloadUpdate, installUpdate, updaterState } from "../updater"

export const updateHandlers = UpdateRpcs.toLayer(
  Effect.gen(function* () {
    return UpdateRpcs.of({
      UpdateGetState: () => Effect.sync(updaterState),
      UpdateCheck: () => Effect.tryPromise(() => checkForUpdates()).pipe(Effect.orDie),
      UpdateDownload: () => Effect.tryPromise(() => downloadUpdate()).pipe(Effect.orDie),
      UpdateInstall: () => Effect.sync(() => installUpdate()),
    })
  }),
)
