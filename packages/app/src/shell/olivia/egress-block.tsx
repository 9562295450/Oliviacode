import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useDialog } from "@opencode/ui/context/dialog"
import { usePlatform } from "@/runtime/platform/platform"
import { infiniteLanes, laneLabel, phaseLabel, type InfiniteLane } from "@/egress"
import { EgressPanel } from "@/shell/egress/panel"

/**
 * The sidebar's view of the egress engine: the exit address, the lane switch, and the one
 * button that changes where the next request comes from.
 *
 * Everything with a table in it stays in the panel. This block is a readout and three
 * controls, sized to the sidebar, so a rotation never needs a settings screen.
 */
export function OliviaEgress() {
  const platform = usePlatform()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const [started, setStarted] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const engine = () => platform.egress
  const state = () => engine()?.state()
  const lane = () => state()?.lane
  const working = () => state()?.phase === "probing" || state()?.phase === "rotating"
  const elapsed = () => (started() ? Math.max(0, Math.floor((tick() - started()) / 1000)) : 0)

  // A WARP registration is a minute of the daemon's time. A spinner that never counts is
  // indistinguishable from a button that did nothing, so the note carries the seconds.
  createEffect(() => {
    if (!working()) {
      setStarted(0)
      return
    }
    if (!started()) {
      setStarted(Date.now())
      setTick(Date.now())
    }
    const timer = setInterval(() => setTick(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  // The current lane shows the engine's phase; the others show the last health reading.
  const dot = (target: InfiniteLane) => {
    if (target === lane()) {
      if (working()) return "busy"
      return state()?.phase === "error" ? "down" : "current"
    }

    const entry = state()?.health.find((item) => item.lane === target)

    if (!entry || entry.checkedAt === 0) return "unknown"

    return entry.alive ? "ok" : "down"
  }

  const rotate = async () => {
    if (busy()) return

    setBusy(true)

    try {
      await engine()?.rotate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={platform.egress}>
      <section data-slot="olivia-egress" data-phase={state()?.phase ?? "idle"}>
        <header data-slot="olivia-block-head">
          <span data-slot="olivia-phase-dot" data-phase={state()?.phase ?? "idle"} aria-hidden="true" />
          <span>Egress</span>
          <span data-slot="olivia-block-note" data-truncate="">
            {state() ? phaseLabel(state()!) : "loading"}
            {working() && elapsed() > 0 ? ` ${elapsed()}s` : ""}
          </span>
          <button
            type="button"
            data-slot="olivia-icon"
            data-push=""
            title="Open the egress panel"
            aria-label="Open the egress panel"
            onClick={() => void dialog.show(() => <EgressPanel />)}
          >
            <Icon name="sliders" />
          </button>
        </header>

        <div data-slot="olivia-egress-trace">
          <Show
            when={state()?.trace}
            fallback={<span data-slot="olivia-egress-ip" data-muted="">no route yet</span>}
          >
            {(trace) => (
              <>
                <span data-slot="olivia-egress-ip" title={trace().ip}>
                  {trace().ip}
                </span>
                <Show when={trace().loc}>
                  <span data-slot="olivia-egress-loc">{trace().loc}</span>
                </Show>
              </>
            )}
          </Show>
        </div>

        <div data-slot="olivia-lanes" role="group" aria-label="Egress lane">
          <For each={infiniteLanes}>
            {(target) => (
              <button
                type="button"
                data-slot="olivia-lane"
                data-active={target === lane() ? "" : undefined}
                aria-pressed={target === lane()}
                title={`Route through ${laneLabel(target)}`}
                onClick={() => void engine()?.setLane(target)}
              >
                <span data-slot="olivia-live-dot" data-state={dot(target)} aria-hidden="true" />
                {laneLabel(target)}
              </button>
            )}
          </For>
        </div>

        <div data-slot="olivia-egress-actions">
          <button
            type="button"
            data-slot="olivia-rotate"
            disabled={busy() || working() || !state()}
            title="Get a new exit address on this lane"
            onClick={() => void rotate()}
          >
            <Show when={busy() || working()} fallback={<Icon name="refresh" />}>
              <Loader width={12} height={12} />
            </Show>
            <span>Rotate</span>
          </button>
          <button
            type="button"
            data-slot="olivia-arm"
            data-armed={state()?.armed ? "" : undefined}
            aria-pressed={state()?.armed ?? false}
            title="Rotate automatically when the sidecar reports a limit"
            onClick={() => void engine()?.arm(!state()?.armed)}
          >
            <Icon name="lock" />
            <span>{state()?.armed ? "Armed" : "Arm"}</span>
          </button>
        </div>

        <Show when={state()?.watch}>
          <p data-slot="olivia-egress-watch" title={state()!.watch}>
            {state()!.watch}
          </p>
        </Show>

        <Show when={state()?.phase === "error" && state()?.lastError}>
          <p data-slot="olivia-egress-error" title={state()!.lastError}>
            {state()!.lastError}
          </p>
        </Show>
      </section>
    </Show>
  )
}
