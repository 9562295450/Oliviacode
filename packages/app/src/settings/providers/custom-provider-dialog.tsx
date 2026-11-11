import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { useDialog } from "@opencode/ui/context/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { createSignal, Show, type Component } from "solid-js"
import { Option, Schema } from "effect"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import "@/settings/settings.css"

/** The AI SDK factory a plain OpenAI-compatible endpoint needs. */
const COMPATIBLE_PACKAGE = "@ai-sdk/openai-compatible"

const DETECT_TIMEOUT_MS = 8_000

export const DialogCustomProvider: Component<{
  /** Provider IDs already defined by config, so an add can't silently overwrite one. */
  existing: readonly string[]
  onSaved?: (providerID: string) => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useServerSDK()

  const [name, setName] = createSignal("")
  const [baseURL, setBaseURL] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [models, setModels] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [detecting, setDetecting] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [detectNote, setDetectNote] = createSignal<string>()

  const providerID = () =>
    name()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")

  const endpoint = () => {
    const value = baseURL().trim().replace(/\/+$/, "")

    if (!URL.canParse(value)) return undefined
    const url = new URL(value)

    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined
  }

  const modelIDs = () => {
    const seen = new Set<string>()

    return models()
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !seen.has(value) && Boolean(seen.add(value)))
  }

  const validate = () => {
    const id = providerID()

    if (id.length === 0) return language.t("settings.providers.custom.error.name")

    if (props.existing.includes(id)) return language.t("settings.providers.custom.error.exists", { id })

    if (endpoint() === undefined) return language.t("settings.providers.custom.error.baseURL")

    if (modelIDs().length === 0) return language.t("settings.providers.custom.error.models")

    return undefined
  }

  // The entry shapes an OpenAI-compatible `/models` route answers with: a bare ID, or an object that
  // names one `id`, `model` or `name`. All three decode to the ID string.
  const ModelEntry = Schema.Union([
    Schema.String,
    Schema.Struct({ id: Schema.String }),
    Schema.Struct({ model: Schema.String }),
    Schema.Struct({ name: Schema.String }),
  ])

  const ModelList = Schema.Union([
    Schema.Array(ModelEntry),
    Schema.Struct({ data: Schema.Array(ModelEntry) }),
    Schema.Struct({ models: Schema.Array(ModelEntry) }),
  ])

  const readModelIDs = (list: typeof ModelList.Type) => {
    const entries = Schema.is(Schema.Array(ModelEntry))(list) ? list : "data" in list ? list.data : list.models

    return entries.flatMap((entry) => {
      if (Schema.is(Schema.String)(entry)) return [entry]

      return ["id" in entry ? entry.id : "model" in entry ? entry.model : entry.name]
    })
  }

  const detect = async () => {
    const url = endpoint()

    if (url === undefined) {
      setError(language.t("settings.providers.custom.error.baseURL"))

      return
    }

    setDetecting(true)
    setDetectNote(undefined)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS)

    try {
      const key = apiKey().trim()

      const response = await fetch(`${url}/models`, {
        signal: controller.signal,
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const body: unknown = await response.json()
      const list = Schema.decodeUnknownOption(ModelList)(body)
      const ids = Option.isSome(list) ? readModelIDs(list.value) : []

      if (ids.length === 0) throw new Error("no models")

      setModels(ids.join(", "))
      setDetectNote(language.t("settings.providers.custom.detected", { count: ids.length }))
    } catch {
      setDetectNote(language.t("settings.providers.custom.detectFailed"))
    } finally {
      clearTimeout(timer)
      setDetecting(false)
    }
  }

  const save = async () => {
    if (busy()) return
    const invalid = validate()

    if (invalid !== undefined) {
      setError(invalid)

      return
    }

    setError(undefined)
    const base = endpoint()

    if (base === undefined) {
      setError(language.t("settings.providers.custom.error.baseURL"))

      return
    }

    setBusy(true)
    const id = providerID()
    const label = name().trim()

    try {
      // The provider is config; the secret is a credential. The model resolver applies the active
      // credential as the request key, so the key never lands in the config document.
      await sdk.api.experimental.config.update({
        providers: {
          [id]: {
            name: label,
            package: COMPATIBLE_PACKAGE,
            settings: { baseURL: base },
            models: Object.fromEntries(modelIDs().map((model) => [model, { name: model }])),
          },
        },
      })

      const key = apiKey().trim()

      if (key.length > 0) {
        await sdk.api.credential.create({
          integrationID: id,
          label,
          value: { type: "key", key },
        })
      }

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.custom.added.title", { provider: label }),
        description: language.t("settings.providers.custom.added.description"),
      })
      props.onSaved?.(id)
      dialog.close()
    } catch (cause) {
      setError(formatServerError(cause, language.t))
    } finally {
      setBusy(false)
    }
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    void save()
  }

  const disabled = () => busy() || detecting()

  return (
    <Dialog fit class="settings-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("settings.providers.custom.title")}</DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label for="custom-provider-name" class="settings-server-dialog-label">
              {language.t("settings.providers.custom.name")}
            </label>
            <TextInput
              id="custom-provider-name"
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={name()}
              placeholder={language.t("settings.providers.custom.name.placeholder")}
              invalid={!!error()}
              disabled={disabled()}
              autofocus
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label for="custom-provider-base-url" class="settings-server-dialog-label">
              {language.t("settings.providers.custom.baseURL")}
            </label>
            <TextInput
              id="custom-provider-base-url"
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              dir="ltr"
              spellcheck={false}
              autocapitalize="off"
              value={baseURL()}
              placeholder={language.t("settings.providers.custom.baseURL.placeholder")}
              invalid={!!error()}
              disabled={disabled()}
              onInput={(event) => setBaseURL(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
            <span class="settings-server-dialog-hint">{language.t("settings.providers.custom.baseURL.hint")}</span>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label for="custom-provider-api-key" class="settings-server-dialog-label">
              {language.t("settings.providers.custom.apiKey")}
            </label>
            <TextInput
              id="custom-provider-api-key"
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              dir="ltr"
              spellcheck={false}
              autocapitalize="off"
              autocomplete="off"
              value={apiKey()}
              placeholder={language.t("settings.providers.custom.apiKey.placeholder")}
              disabled={disabled()}
              onInput={(event) => setApiKey(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
            <span class="settings-server-dialog-hint">{language.t("settings.providers.custom.apiKey.hint")}</span>
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <div class="flex w-full min-w-0 items-center justify-between gap-3">
              <label for="custom-provider-models" class="settings-server-dialog-label">
                {language.t("settings.providers.custom.models")}
              </label>
              <Button
                size="small"
                variant="ghost-muted"
                disabled={disabled()}
                onClick={() => void detect()}
              >
                {detecting()
                  ? language.t("settings.providers.custom.detecting")
                  : language.t("settings.providers.custom.detect")}
              </Button>
            </div>
            <TextInput
              id="custom-provider-models"
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              dir="ltr"
              spellcheck={false}
              autocapitalize="off"
              value={models()}
              placeholder={language.t("settings.providers.custom.models.placeholder")}
              disabled={disabled()}
              onInput={(event) => setModels(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
            <Show when={detectNote()}>
              {(note) => <span class="settings-server-dialog-hint">{note()}</span>}
            </Show>
            <span class="settings-server-dialog-hint">{language.t("settings.providers.custom.models.hint")}</span>
          </div>

          <Show when={error()}>
            <span class="settings-server-dialog-error" role="alert">
              {error()}
            </span>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={disabled()} onClick={() => void save()}>
          {busy() ? language.t("settings.providers.custom.saving") : language.t("settings.providers.custom.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
