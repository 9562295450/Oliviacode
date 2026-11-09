import { RpcClient, RpcClientError } from "effect/rpc"
import { AppRpcs } from "./ipc-rpc/app"
import { EventRpcs } from "./ipc-rpc/events"
import { PluginRpcs } from "./ipc-rpc/plugins"
import { FileRpcs } from "./ipc-rpc/files"
import { MenuRpcs } from "./ipc-rpc/menu"
import { StorageRpcs } from "./ipc-rpc/storage"
import { WindowRpcs } from "./ipc-rpc/window"
import { InfiniteRpcs } from "./ipc-rpc/infinite"
import { PresetRpcs } from "./ipc-rpc/presets"
import { UpdateRpcs } from "./ipc-rpc/updates"

export { AppRpcs } from "./ipc-rpc/app"

export { EventRpcs } from "./ipc-rpc/events"

export { InfiniteRpcs } from "./ipc-rpc/infinite"

export { UpdateRpcs } from "./ipc-rpc/updates"

export { PresetRpcs } from "./ipc-rpc/presets"

export { PluginRpcs } from "./ipc-rpc/plugins"

export { FileRpcs } from "./ipc-rpc/files"

export { MenuRpcs } from "./ipc-rpc/menu"

export { StorageRpcs } from "./ipc-rpc/storage"

export { WindowRpcs } from "./ipc-rpc/window"

export const DesktopRpcs = AppRpcs.merge(
  StorageRpcs,
  FileRpcs,
  WindowRpcs,
  MenuRpcs,
  EventRpcs,
  PluginRpcs,
  InfiniteRpcs,
  PresetRpcs,
  UpdateRpcs,
)

export type DesktopRpcClient = RpcClient.FromGroup<typeof DesktopRpcs, RpcClientError.RpcClientError>
