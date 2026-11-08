import { createSignal, onCleanup } from "solid-js"
import type { EgressPlatform } from "@opencode/app/desktop"
import type { InfiniteLane, InfiniteSettings, InfiniteState } from "@opencode/app/egress"
import type { ElectronAPI } from "../api-types"

/**
 * The window's live view of the egress engine.
 *
 * One subscription per window, started when the platform is built. Every change arrives as
 * a whole snapshot from main, so the renderer never has to merge partial updates and two
 * windows always agree. The first read is a request: a window that opens after a rotation
 * still draws the state that rotation produced.
 */
export function createEgressPlatform(api: ElectronAPI): EgressPlatform {
  const [state, setState] = createSignal<InfiniteState | undefined>(undefined)
  const [settings, setSettings] = createSignal<InfiniteSettings | undefined>(undefined)

  const stop = api.onInfiniteChanged((next) => setState(next))
  onCleanup(stop)

  void api
    .infiniteState()
    .then((value) => setState((current) => (current ? current : value)))
    .catch(() => undefined)
  void api
    .infiniteSettings()
    .then((value) => setSettings(value))
    .catch(() => undefined)

  return {
    state,
    settings,
    async setLane(lane) {
      await api.infiniteSetLane(lane)
      void api.infiniteState().then((value) => setState(value))
    },
    async rotate(lane: InfiniteLane | undefined) {
      return api.infiniteRotate(lane)
    },
    async arm(armed) {
      await api.infiniteArm(armed)
      void api.infiniteState().then((value) => setState(value))
    },
    async check() {
      setState(await api.infiniteCheckLanes())
    },
    async checkUpdate() {
      return api.infiniteCheckUpdate()
    },
    async applyUpdate() {
      return api.infiniteApplyUpdate()
    },
    observe(line) {
      // Fire and forget: the engine publishes the resulting watch line with its next snapshot.
      void api.infiniteObserve(line)
    },
    async save(next) {
      await api.infiniteSetSettings(next)
      void api.infiniteSettings().then((value) => setSettings(value))
    },
  }
}
