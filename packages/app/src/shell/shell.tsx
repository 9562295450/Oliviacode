import { createSignal, Show, startTransition, Suspense, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useDialog } from "@opencode/ui/context/dialog"
import { Titlebar } from "@/shell/titlebar/titlebar"
import { ToastRegion } from "@/shell/notifications/toast"
import { UploadToastHost } from "@/composer/attachments/uploads"
import { useSettings } from "@/settings/model"
import { PluginServerCover } from "@/runtime/plugin/server-shell"
import { PluginSlot } from "@/runtime/plugin/render"
import { COMMAND_SEARCH_ID, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { OliviaSidebar } from "@/shell/olivia/sidebar"
import { OliviaRail } from "@/shell/olivia/rail"
import { OliviaInspector } from "@/shell/olivia/inspector"
import "./olivia/olivia.css"

export const sidebarToggleCommand = { id: "sidebar.toggle", keybind: "mod+shift+b" }

export const inspectorToggleCommand = { id: "inspector.toggle", keybind: "mod+shift+i" }

/**
 * The shell.
 *
 * Four lanes, four jobs: the rail starts work and never moves, the queue lists what is
 * open, the plane is the surface the route draws for itself, and the inspector reads the
 * exit, the theme and the current surface. The titlebar keeps only the drag region and the
 * window controls, so every command that lived there still owns its keybind.
 */
export default function Layout(props: ParentProps) {
  const preferences = useSettings()
  const command = useCommand()
  const language = useLanguage()
  const dialog = useDialog()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const mobile = createMediaQuery("(max-width: 767px)")
  const narrow = createMediaQuery("(max-width: 1180px)")

  const [queueOpen, setQueueOpen] = createSignal(true)
  const [inspectorOpen, setInspectorOpen] = createSignal(true)

  const bottomTitlebar = () => mobile() && preferences.general.mobileTitlebarPosition() === "bottom"

  // The command contract takes no return value; the signal setter returns the new value.
  const toggleSidebar = () => {
    setQueueOpen((value) => !value)
  }

  const toggleInspector = () => {
    setInspectorOpen((value) => !value)
  }

  command.register("sidebar", () => [
    {
      ...sidebarToggleCommand,
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      onSelect: toggleSidebar,
    },
    {
      ...inspectorToggleCommand,
      title: "Toggle inspector",
      category: language.t("command.category.view"),
      onSelect: toggleInspector,
    },
  ])

  // Every surface has a palette: routes with their own register under the same key, and the newest wins.
  command.register("palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = servers.visible.find((item) => servers.current(item)) ?? servers.visible[0]

        if (!conn) return
        const { HomeCommandPalette } = await import("@/home/start/command-palette")
        void dialog.show(() => (
          <HomeCommandPalette
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              global.serverCtx(server)?.projects.touch(entry.project?.worktree ?? entry.directory)
              void startTransition(() => {
                tabs.select(tabs.addSessionTab({ server, sessionId: sessionID }))
              })
            }}
          />
        ))
      },
    },
  ])

  command.register("commands", () => [
    {
      id: COMMAND_SEARCH_ID,
      title: language.t("command.commands.search"),
      category: language.t("command.category.view"),
      onSelect: async () => {
        const { DialogCommandSearch } = await import("@/shell/commands/command-search")
        void dialog.show(() => <DialogCommandSearch />)
      },
    },
  ])

  return (
    <div
      data-slot="olivia-shell"
      class="relative flex flex-1 min-h-0 min-w-0 flex-col select-none bg-v2-background-bg-deep [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        // Routes draw their own rounded panel; these insets are the gap between that panel
        // and the window, the same gap Kilo leaves around its main surface.
        "--shell-inline-inset": mobile() ? "1px" : "8px",
        "--shell-top-inset": bottomTitlebar() || mobile() ? "0px" : "8px",
        "--shell-bottom-inset": bottomTitlebar()
          ? "8px"
          : mobile()
            ? "max(8px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))"
            : "8px",
        "--sidebar-inset-start": "11px",
        "--sidebar-inset-end": "3px",
        "--sidebar-divider-bleed": "0px",
        "--session-header-inset-end": "12px",
      }}
    >
      <Titlebar minimal />
      <div class="flex flex-1 min-h-0 min-w-0 flex-row">
        <OliviaRail queueOpen={queueOpen()} onToggleQueue={toggleSidebar} />
        <Show when={queueOpen() && !mobile()}>
          <OliviaSidebar />
        </Show>
        <main
          class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-content"
          style={{
            "padding-top": bottomTitlebar() ? "env(safe-area-inset-top, 0px)" : "0px",
            // A docked composer touch bar takes over the safe area.
            "padding-bottom": bottomTitlebar()
              ? "0px"
              : "var(--shell-safe-area-bottom, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))",
            "--settings-bottom-inset": bottomTitlebar()
              ? "40px"
              : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
          }}
        >
          <PluginServerCover>
            <Suspense>{props.children}</Suspense>
          </PluginServerCover>
        </main>
        <Show when={inspectorOpen() && !narrow()}>
          <OliviaInspector onClose={toggleInspector} />
        </Show>
      </div>
      {/* On touch devices the active composer moves its actions here: the bottom edge, or the top of the keyboard.
          Last in order, so it stays below a bottom titlebar. */}
      <div data-slot="composer-touch-bar-mount" class="order-last shrink-0" />
      <PluginSlot at="window.bottom" input={{}} />
      <ToastRegion />
      <UploadToastHost />
    </div>
  )
}
