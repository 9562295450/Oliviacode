import { useLanguage } from "@/runtime/i18n/language"
import { Show } from "solid-js"

export type ContextUsage = {
  readonly used: number
  readonly limit: number
}

/** The context a turn actually occupied: prompt tokens plus what the model wrote back. */
export function contextTokens(tokens: {
  readonly input: number
  readonly output: number
  readonly cache: { readonly read: number; readonly write: number }
}): number {
  return tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

/** 12.4k, 184k, 1.0M: the composer has one line, so the unit carries the scale. */
export function formatContextTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`

  return String(Math.max(0, Math.round(value)))
}

/**
 * A slim meter above the composer: how much of the selected model's window this session occupies, with
 * the two ways out. `/compact` summarizes in place; the second button compacts and forks the full history
 * into a new session, so the work continues without the old turns' weight.
 */
export function SessionContextMeter(props: {
  usage: ContextUsage
  compacting: boolean
  onCompact: () => void
  onContinue: () => void
}) {
  const language = useLanguage()

  const percent = () => Math.max(0, Math.min(100, (props.usage.used / props.usage.limit) * 100))
  const tone = () =>
    percent() >= 90
      ? "bg-v2-background-bg-accent"
      : percent() >= 70
        ? "bg-v2-icon-icon-accent"
        : "bg-v2-border-border-muted"

  return (
    <div
      class="flex items-center justify-end gap-2 text-[11px] text-v2-text-text-weak"
      data-component="session-context-meter"
      title={language.t("session.context.title", { percent: String(Math.round(percent())) })}
    >
      <button
        type="button"
        class="rounded px-1.5 py-0.5 transition-colors hover:bg-v2-background-bg-layer-02 disabled:opacity-50"
        disabled={props.compacting}
        onClick={props.onCompact}
      >
        {language.t("session.context.compact")}
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 transition-colors hover:bg-v2-background-bg-layer-02 disabled:opacity-50"
        disabled={props.compacting}
        onClick={() => props.onContinue()}
      >
        {language.t("session.context.continue")}
      </button>
      <div class="h-1 w-24 overflow-hidden rounded-full bg-v2-background-bg-layer-02">
        <div class={`h-full rounded-full transition-[width] ${tone()}`} style={{ width: `${percent()}%` }} />
      </div>
      <span class="tabular-nums">
        {language.t("session.context.used", {
          used: formatContextTokens(props.usage.used),
          limit: formatContextTokens(props.usage.limit),
        })}
      </span>
      <Show when={props.compacting}>
        <span class="text-v2-text-text-accent">{language.t("command.session.compact")}</span>
      </Show>
    </div>
  )
}
