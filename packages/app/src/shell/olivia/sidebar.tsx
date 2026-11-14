import { For, Show, createMemo, createSignal } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@opencode/ui/icon"
import { useCommand } from "@/shell/commands/command"
import { useCurrentRoute } from "@/shell/state/layout"
import { tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import { sessionRowLabel } from "@/session/title"
import { OwlMark } from "./owl"
import "./olivia.css"
import "./owl-tokens.css"

/**
 * The queue.
 *
 * Every open tab is a row in a ledger: an ordinal, a state dot, the title, and the
 * close seat. Newest first, because the row the composer is about to write into is the
 * one the eye wants at the top. Sessions come from the tab store, so a row opens exactly
 * what the tab strip opens.
 */
export function OliviaSidebar() {
  // The build channel, not a fixed word: a release build carries no channel badge at all.
  const channel = import.meta.env.VITE_OPENCODE_CHANNEL ?? "dev"
  const tabs = useTabs()
  const command = useCommand()
  const route = useCurrentRoute()

  const [open, setOpen] = createSignal(true)
  const narrow = createMediaQuery("(max-width: 860px)")

  // Below 860px the inspector retires first; the queue stays, because it is the only
  // list of open work the window has.
  const rows = createMemo(() => tabs.store.slice().reverse())

  const active = (tab: Tab) => {
    const current = route()

    if (tab.type === "draft") return current.type === "draft" && current.draftID === tab.draftID

    return current.type === "session" && current.sessionId === tab.sessionId
  }

  const label = (tab: Tab) =>
    sessionRowLabel(
      tabs.info[tabKey(tab)],
      tab.type === "draft" ? "New session" : "Untitled session",
    )

  // Untitled rows are indistinguishable by name, so every row carries its folder.
  const folder = (tab: Tab) => tabs.info[tabKey(tab)]?.directory?.split(/[\\/]/).filter(Boolean).at(-1)

  const select = (tab: Tab) => tabs.select(tab)

  const close = (tab: Tab) => {
    const index = tabs.store.findIndex((item) => tabKey(item) === tabKey(tab))

    if (index !== -1) tabs.closeTab(index)
  }

  return (
    <aside data-slot="olivia-sidebar">
      <header data-slot="olivia-head">
        <span data-slot="olivia-logo">
          <OwlMark size={20} />
        </span>
        <span data-slot="olivia-wordmark">oliviacode</span>
        <Show when={channel !== "prod"}>
          <span data-slot="olivia-beta">{channel === "beta" ? "Beta" : "Dev"}</span>
        </Show>
      </header>

      <div data-slot="olivia-actions">
        <button type="button" data-slot="olivia-new" onClick={() => command.trigger("tab.new")}>
          <Icon name="plus" />
          <span>New session</span>
        </button>
        <button type="button" data-slot="olivia-search" onClick={() => command.trigger("sessions.search")}>
          <Icon name="magnifying-glass" />
          <span>Search</span>
          <kbd>{command.keybind("sessions.search")}</kbd>
        </button>
      </div>

      <div data-slot="olivia-section-head">
        <button
          type="button"
          data-slot="olivia-section-grow"
          data-open={open() ? "" : undefined}
          onClick={() => setOpen(!open())}
        >
          <Icon name="chevron-down" />
          <span>Queue</span>
        </button>
        <span data-slot="olivia-count">{rows().length}</span>
        <button
          type="button"
          data-slot="olivia-icon"
          title="Filter sessions"
          aria-label="Filter sessions"
          onClick={() => command.trigger("sessions.search")}
        >
          <Icon name="sliders" />
        </button>
      </div>

      <Show when={open()}>
        <div data-slot="olivia-sessions">
          <For each={rows()}>
            {(tab, index) => (
              <div
                data-slot="olivia-row"
                data-active={active(tab) ? "" : undefined}
                data-owl-talon={active(tab) ? "" : undefined}
                role="button"
                tabindex="0"
                aria-current={active(tab) ? "page" : undefined}
                onClick={() => select(tab)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  select(tab)
                }}
              >
                <span data-slot="olivia-row-index" aria-hidden="true">
                  {String(index() + 1).padStart(2, "0")}
                </span>
                <span data-slot="olivia-row-dot" data-active={active(tab) ? "" : undefined} aria-hidden="true" />
                <span data-slot="olivia-row-title" title={label(tab)}>
                  {label(tab)}
                </span>
                <Show when={folder(tab)}>
                  {(name) => (
                    <span data-slot="olivia-row-dir" title={tabs.info[tabKey(tab)]?.directory}>
                      {name()}
                    </span>
                  )}
                </Show>
                <button
                  type="button"
                  data-slot="olivia-row-close"
                  title="Close session"
                  aria-label={`Close ${label(tab)}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    close(tab)
                  }}
                >
                  <Icon name="xmark-small" />
                </button>
              </div>
            )}
          </For>
          <Show when={rows().length === 0}>
            <p data-slot="olivia-empty">Nothing open. Start a session and it lands here.</p>
          </Show>
        </div>
      </Show>

      <div data-slot="olivia-sidebar-bottom">
        <span data-slot="olivia-queue-foot">
          <span>{narrow() ? "" : `${rows().length} open`}</span>
          <span data-mono="">{tabs.closed.length} recent</span>
        </span>
      </div>
    </aside>
  )
}
