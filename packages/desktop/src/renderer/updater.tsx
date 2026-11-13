import { useLanguage } from "@opencode/app/desktop"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { UpdateStatus } from "../shared/ipc-rpc/updates"
import type { ElectronAPI } from "./api-types"

/** The fork's release page; the same feed the packaged app updates from. */
const RELEASES = "https://github.com/9562295450/Oliviacode/releases/latest"

/**
 * The shell updater's only face. It shows the version the installed app already has, announces a release
 * the main process found, downloads it on request, and restarts into the installer once it is ready.
 * The bundled CLI is not part of this feed — the engine updates through OpenCode on its own.
 */
export function DesktopUpdater(props: { api: ElectronAPI; version: string }) {
  const language = useLanguage()
  const [status, setStatus] = createSignal<UpdateStatus>({ state: "idle" })
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  const receive = (next: UpdateStatus) => {
    setStatus(next)
    if (next.state === "available") setOpen(true)
  }

  onMount(() => {
    props.api.updateState().then(receive, () => undefined)
  })
  onCleanup(props.api.onUpdateChanged(receive))

  // A release found while the card is closed still deserves a look; a downloaded one leaves the
  // choice of when to restart to the user.
  createEffect(() => {
    if (status().state === "ready") setOpen(true)
  })

  const visible = () => status().state !== "unsupported"

  const label = () => {
    const state = status()

    if (state.state === "available") return language.t("desktop.update.available", { version: state.version ?? "" })
    if (state.state === "downloading")
      return language.t("desktop.update.downloading", { percent: String(Math.round(state.percent ?? 0)) })
    if (state.state === "ready") return language.t("desktop.update.ready")
    if (state.state === "checking") return language.t("desktop.update.checking")
    if (state.state === "error") return language.t("desktop.update.failed")

    return language.t("desktop.update.check")
  }

  const run = (action: () => Promise<UpdateStatus>) => {
    if (busy()) return
    setBusy(true)
    setOpen(true)
    action().then(receive, (cause: unknown) =>
      receive({
        state: "error",
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    ).finally(() => setBusy(false))
  }

  const check = () => run(props.api.updateCheck)
  const download = () => run(props.api.updateDownload)
  const install = () => {
    if (busy()) return
    setBusy(true)
    void props.api.updateInstall().catch(() => setBusy(false))
  }

  return (
    <Show when={visible()}>
      <div class="fixed bottom-12 right-4 z-[60] flex flex-col items-end gap-2" data-component="desktop-updater">
        <button
          type="button"
          class="flex items-center gap-2 rounded-full border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-1.5 text-[12px] text-v2-text-text-base shadow-lg transition-colors hover:bg-v2-background-bg-layer-02"
          onClick={() => setOpen((value) => !value)}
          title={language.t("desktop.update.title")}
        >
          <Show when={status().state === "available" || status().state === "ready"}>
            <span class="size-1.5 rounded-full bg-v2-background-bg-accent" />
          </Show>
          <span>{label()}</span>
        </button>

        <Show when={open()}>
          <div class="w-80 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 text-[12px] text-v2-text-text-base shadow-xl">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-medium">{language.t("desktop.update.title")}</span>
              <span class="text-v2-text-text-weak">
                {language.t("desktop.update.current", { version: props.version })}
              </span>
            </div>

            <Show when={status().state === "downloading"}>
              <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-02">
                <div
                  class="h-full rounded-full bg-v2-background-bg-accent transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, status().percent ?? 0))}%` }}
                />
              </div>
            </Show>

            <Show when={status().notes}>
              {(notes) => (
                <p class="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-v2-text-text-weak">
                  {notes()}
                </p>
              )}
            </Show>

            <Show when={status().state === "error"}>
              <p class="mt-2 whitespace-pre-wrap break-words text-[11px] text-v2-text-text-muted">
                {status().error}
              </p>
            </Show>

            <div class="mt-3 flex items-center gap-2">
              <Show
                when={status().state !== "available" && status().state !== "ready"}
                fallback={
                  <Show
                    when={status().state === "ready"}
                    fallback={
                      <button
                        type="button"
                        class="rounded-md bg-v2-background-bg-accent px-2.5 py-1 text-[12px] font-medium text-v2-text-text-inverse disabled:opacity-50"
                        disabled={busy()}
                        onClick={download}
                      >
                        {language.t("desktop.update.download")}
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="rounded-md bg-v2-background-bg-accent px-2.5 py-1 text-[12px] font-medium text-v2-text-text-inverse disabled:opacity-50"
                      disabled={busy()}
                      onClick={install}
                    >
                      {language.t("desktop.update.restart")}
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-v2-border-border-base px-2.5 py-1 text-[12px]"
                      onClick={() => setOpen(false)}
                    >
                      {language.t("desktop.update.later")}
                    </button>
                  </Show>
                }
              >
                <button
                  type="button"
                  class="rounded-md border border-v2-border-border-base px-2.5 py-1 text-[12px] disabled:opacity-50"
                  disabled={busy() || status().state === "downloading"}
                  onClick={check}
                >
                  {status().state === "checking" ? language.t("desktop.update.checking") : language.t("desktop.update.check")}
                </button>
              </Show>

              <button
                type="button"
                class="ml-auto text-[11px] text-v2-text-text-weak underline-offset-2 hover:underline"
                onClick={() => props.api.openExternal(RELEASES)}
              >
                {language.t("desktop.update.releaseNotes")}
              </button>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
