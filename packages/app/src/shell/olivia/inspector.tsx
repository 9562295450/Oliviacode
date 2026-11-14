import { Show, createMemo } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { usePlatform } from "@/runtime/platform/platform"
import { useCurrentRoute } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { sessionRowLabel } from "@/session/title"
import { OliviaEgress } from "./egress-block"
import { OliviaTheme } from "./theme-block"
import { OwlMark } from "./owl"

const surfaceLabel = {
  home: "Home",
  settings: "Settings",
  connect: "Connect",
  components: "Components",
  draft: "Draft",
  session: "Session",
} as const

/**
 * The inspector is the third lane: the surface you are on, the exit your requests take,
 * and the theme engine. Everything here is a reading rather than a route, so the
 * transcript keeps the full plane and the controls keep a fixed home.
 */
export function OliviaInspector(props: { onClose: () => void }) {
  const platform = usePlatform()
  const route = useCurrentRoute()
  const tabs = useTabs()

  const current = createMemo(() => {
    const value = route()

    if (value.type === "draft")
      return tabs.store.find((tab) => tab.type === "draft" && tab.draftID === value.draftID)

    if (value.type === "session")
      return tabs.store.find((tab) => tab.type === "session" && tab.sessionId === value.sessionId)

    return undefined
  })

  const title = createMemo(() => {
    const tab = current()

    if (!tab) return surfaceLabel[route().type]
    return sessionRowLabel(tabs.info[tabKey(tab)], "Untitled session")
  })

  const server = () => {
    const value = route()
    return value.type === "session" ? value.server : undefined
  }

  return (
    <aside data-slot="olivia-inspector" aria-label="Inspector">
      <header data-slot="olivia-inspector-head">
        <OwlMark size={14} />
        <span>Inspector</span>
        <button
          type="button"
          data-slot="olivia-icon"
          data-push=""
          title="Hide inspector"
          aria-label="Hide inspector"
          onClick={props.onClose}
        >
          <Icon name="xmark-small" />
        </button>
      </header>

      <div data-slot="olivia-inspector-scroll">
        <section data-slot="olivia-block">
          <header data-slot="olivia-block-head">
            <span data-slot="olivia-block-label">Surface</span>
          </header>
          <p data-slot="olivia-route-title" title={title()}>
            {title()}
          </p>
          <dl data-slot="olivia-kv">
            <div>
              <dt>Kind</dt>
              <dd data-mono="">{surfaceLabel[route().type]}</dd>
            </div>
            <Show when={server()}>
              {(value) => (
                <div>
                  <dt>Server</dt>
                  <dd data-mono="" title={value()}>
                    {value()}
                  </dd>
                </div>
              )}
            </Show>
          </dl>
        </section>

        <OliviaEgress />
        <OliviaTheme />

        <footer data-slot="olivia-inspector-foot">
          <span>oliviacode</span>
          <span data-mono="">{platform.version ? `v${platform.version}` : "dev"}</span>
        </footer>
      </div>
    </aside>
  )
}
