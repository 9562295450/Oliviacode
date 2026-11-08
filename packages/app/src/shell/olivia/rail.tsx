import { For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import { useCommand } from "@/shell/commands/command"
import { useCurrentRoute } from "@/shell/state/layout"
import { useSettingsDialog } from "@/settings/command"
import { usePlatform } from "@/runtime/platform/platform"
import { OwlMark } from "./owl"

type RailItem = {
  id: string
  label: string
  icon: string
  run: () => void
  active?: () => boolean
}

/**
 * The rail is the app's spine: the mark, the three verbs that start work, the session
 * queue toggle, and the exit reading. It never collapses, so the window always has a
 * fixed left edge and the queue beside it is free to close.
 */
export function OliviaRail(props: { queueOpen: boolean; onToggleQueue: () => void }) {
  const command = useCommand()
  const route = useCurrentRoute()
  const platform = usePlatform()
  const openSettings = useSettingsDialog()
  const navigate = useNavigate()

  const items = (): RailItem[] => [
    {
      id: "new",
      label: "New session",
      icon: "plus",
      run: () => command.trigger("tab.new"),
    },
    {
      id: "search",
      label: "Search sessions",
      icon: "magnifying-glass",
      run: () => command.trigger("sessions.search"),
    },
    {
      id: "home",
      label: "Home",
      icon: "grid-plus",
      run: () => navigate("/"),
      active: () => route().type === "home",
    },
  ]

  const phase = () => platform.egress?.state()?.phase ?? "idle"

  return (
    <nav data-slot="olivia-rail" aria-label="Primary">
      <button
        type="button"
        data-slot="olivia-rail-brand"
        title="oliviacode"
        aria-label="oliviacode"
        onClick={() => navigate("/")}
      >
        <OwlMark size={22} />
      </button>

      <span data-slot="olivia-rail-rule" aria-hidden="true" />

      <For each={items()}>
        {(item) => (
          <button
            type="button"
            data-slot="olivia-rail-item"
            data-active={item.active?.() ? "" : undefined}
            title={item.label}
            aria-label={item.label}
            aria-current={item.active?.() ? "page" : undefined}
            onClick={item.run}
          >
            <Icon name={item.icon} />
          </button>
        )}
      </For>

      <button
        type="button"
        data-slot="olivia-rail-item"
        data-active={props.queueOpen ? "" : undefined}
        data-rail-toggle=""
        title={props.queueOpen ? "Hide queue" : "Show queue"}
        aria-label={props.queueOpen ? "Hide queue" : "Show queue"}
        aria-pressed={props.queueOpen}
        onClick={props.onToggleQueue}
      >
        <Icon name="sidebar" />
      </button>

      <div data-slot="olivia-rail-spacer" />

      <Show when={platform.egress}>
        <span
          data-slot="olivia-rail-phase"
          data-phase={phase()}
          title={`Egress ${phase()}`}
          aria-hidden="true"
        />
      </Show>

      <button
        type="button"
        data-slot="olivia-rail-item"
        title="Settings"
        aria-label="Settings"
        onClick={() => openSettings()}
      >
        <Icon name="settings-gear" />
      </button>
    </nav>
  )
}
