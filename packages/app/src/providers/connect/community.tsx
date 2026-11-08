import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { useDialog } from "@opencode/ui/context/dialog"
import { createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform, type PresetInfo } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"

/**
 * Shipped placeholder for the community registry.
 *
 * This is deliberately not a provider endpoint: it is the location of a JSON file that a user
 * chooses to load. Swap it for the hosted gist once one exists; nothing else in the app points
 * at a provider.
 */
export const COMMUNITY_REGISTRY_URL =
  "https://gist.githubusercontent.com/Oliviacode/community-presets/raw/community-presets.json"

const REGISTRY_FORMAT_URL = "https://github.com/Oliviacode/Oliviacode/blob/main/PRESETS.md"

/**
 * Loads a registry of community add-ons and applies one entry.
 *
 * The dialog never contacts a provider: loading reads a JSON document, and applying writes a
 * single base URL into the engine's global config. Credentials stay in the provider flow.
 */
export function DialogCommunityAddons(props: { onApplied?: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()

  const [url, setUrl] = createSignal(COMMUNITY_REGISTRY_URL)
  const [loading, setLoading] = createSignal(false)
  const [addons, setAddons] = createSignal<PresetInfo[]>()
  const [notice, setNotice] = createSignal<{ kind: "error" | "ok"; text: string }>()
  const [applying, setApplying] = createSignal<string>()

  const load = async (event: SubmitEvent) => {
    event.preventDefault()

    if (!platform.presets || loading()) return

    setLoading(true)
    setNotice(undefined)

    try {
      const result = await platform.presets.fetch(url().trim())

      if (!result.ok) {
        setAddons(undefined)
        setNotice({ kind: "error", text: result.error ?? "Registry could not be read." })
        return
      }

      setAddons(result.addons)

      if (result.addons.length === 0) setNotice({ kind: "error", text: language.t("dialog.provider.addons.empty") })
    } catch (error) {
      setNotice({ kind: "error", text: String(error) })
    } finally {
      setLoading(false)
    }
  }

  const apply = async (addon: PresetInfo) => {
    if (!platform.presets || applying()) return

    setApplying(addon.id)

    try {
      const result = await platform.presets.apply(addon.id)

      if (!result.ok) {
        setNotice({ kind: "error", text: language.t("dialog.provider.addons.failed", { error: result.error ?? "" }) })
        return
      }

      setNotice({ kind: "ok", text: language.t("dialog.provider.addons.applied", { path: result.path }) })
      props.onApplied?.()
    } catch (error) {
      setNotice({ kind: "error", text: language.t("dialog.provider.addons.failed", { error: String(error) }) })
    } finally {
      setApplying(undefined)
    }
  }

  return (
    <Dialog fit containerClass="!w-[min(calc(100vw_-_32px),560px)] !rounded-xl">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitleGroup
          title={language.t("dialog.provider.addons.title")}
          description={language.t("dialog.provider.addons.description")}
        />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col gap-3 px-4 pb-4">
        <Show
          when={platform.presets}
          fallback={
            <p class="text-[13px] leading-5 text-v2-text-text-muted">
              Community add-ons are available in the desktop app.
            </p>
          }
        >
          <form class="flex items-center gap-2" onSubmit={(event) => void load(event)}>
            <TextInput
              class="!min-w-0 !flex-1 [font-family:var(--v2-font-family-sans)]"
              type="url"
              aria-label={language.t("dialog.provider.addons.url")}
              placeholder="https://…/community-presets.json"
              value={url()}
              onInput={(event) => setUrl(event.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <Button type="submit" variant="contrast" disabled={loading() || !url().trim()} aria-busy={loading()}>
              {loading()
                ? language.t("dialog.provider.addons.loading")
                : language.t("dialog.provider.addons.load")}
            </Button>
          </form>

          <div class="min-h-0 max-h-[min(50vh,320px)] overflow-y-auto">
            <Show
              when={addons()}
              fallback={
                <div class="flex flex-col items-center gap-2 rounded-md border border-dashed border-v2-border-border-base px-4 py-8 text-center">
                  <Icon name="plus" class="text-v2-icon-icon-muted" aria-hidden="true" />
                  <p class="text-[13px] leading-5 text-v2-text-text-muted">
                    Paste a registry URL and load it. Nothing is fetched until you ask.
                  </p>
                </div>
              }
            >
              {(list) => (
                <div class="flex flex-col gap-0.5">
                  <Show when={list().length === 0}>
                    <p class="px-1 py-3 text-[13px] text-v2-text-text-muted">
                      {language.t("dialog.provider.addons.empty")}
                    </p>
                  </Show>
                  <For each={list()}>
                    {(addon) => (
                      <div class="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-v2-overlay-simple-overlay-hover">
                        <span aria-hidden="true" class="text-[13px]">
                          ⚡
                        </span>
                        <div class="flex min-w-0 flex-1 flex-col">
                          <span class="flex min-w-0 items-baseline gap-2">
                            <span class="truncate text-[13px] font-medium text-v2-text-text-base">{addon.label}</span>
                            <span class="shrink-0 rounded-sm border border-v2-border-border-base px-1 text-[10px] font-[530] uppercase leading-4 tracking-[0.04px] text-v2-text-text-faint">
                              {addon.origin === "community"
                                ? language.t("dialog.provider.addons.origin.community")
                                : language.t("dialog.provider.addons.origin.local")}
                            </span>
                          </span>
                          <span class="truncate text-[12px] leading-4 text-v2-text-text-muted">
                            {addon.description}
                          </span>
                          <span class="truncate font-mono text-[11px] leading-4 text-v2-text-text-faint">
                            {addon.provider} · {addon.baseURL}
                          </span>
                        </div>
                        <Show when={addon.docsURL}>
                          {(href) => (
                            <ExternalLink
                              href={href()}
                              class="shrink-0 rounded-sm px-1 text-[12px] text-v2-text-text-muted hover:text-v2-text-text-base"
                            >
                              {language.t("dialog.provider.addons.docs")}
                            </ExternalLink>
                          )}
                        </Show>
                        <Button
                          variant="neutral"
                          disabled={applying() === addon.id}
                          aria-busy={applying() === addon.id}
                          onClick={() => void apply(addon)}
                        >
                          {language.t("dialog.provider.addons.apply")}
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>

          <Show when={notice()}>
            {(value) => (
              <p
                role={value().kind === "error" ? "alert" : "status"}
                classList={{
                  "text-[12px] leading-4": true,
                  "text-v2-state-fg-danger": value().kind === "error",
                  "text-v2-text-text-muted": value().kind === "ok",
                }}
              >
                {value().text}
              </p>
            )}
          </Show>

          <div class="flex flex-col gap-1 border-t border-v2-border-border-base pt-3">
            <p class="text-[11px] leading-4 text-v2-text-text-faint">{language.t("dialog.provider.addons.note")}</p>
            <ExternalLink
              href={REGISTRY_FORMAT_URL}
              class="self-start rounded-sm text-[11px] leading-4 text-v2-text-text-muted underline-offset-2 hover:text-v2-text-text-base"
            >
              Registry format
            </ExternalLink>
          </div>

          <div class="flex justify-end">
            <Button variant="ghost-muted" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </Button>
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
