import { For, onMount } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useTheme } from "@opencode/ui/theme/context"
import { useSettingsDialog } from "@/settings/command"
import type { ColorScheme } from "@opencode/ui/theme/context"

const schemes: { id: ColorScheme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
]

/**
 * The theme engine in one row: the active theme's name, a swatch strip that changes it on
 * click, and the three color schemes. The full catalogue stays one click away so the strip
 * can stay short enough to read.
 */
export function OliviaTheme() {
  const theme = useTheme()
  const openAppearance = useSettingsDialog("appearance")

  onMount(() => void theme.loadThemes())

  // A theme may describe itself with a palette or with seed colors; either gives the strip
  // one honest color to paint.
  const swatch = (id: string) => {
    const variant = theme.themes()[id]?.dark

    if (!variant) return "var(--v2-grey-500)"

    const palette = "palette" in variant ? variant.palette : undefined
    const seeds = "seeds" in variant ? variant.seeds : undefined

    return palette?.primary ?? seeds?.primary ?? "var(--v2-grey-500)"
  }

  return (
    <section data-slot="olivia-theme">
      <header data-slot="olivia-block-head">
        <span data-slot="olivia-theme-glyph" aria-hidden="true">
          <Icon name="edit" />
        </span>
        <span>Theme</span>
        <span data-slot="olivia-block-note" data-truncate="" title={theme.name(theme.themeId())}>
          {theme.name(theme.themeId())}
        </span>
        <button
          type="button"
          data-slot="olivia-icon"
          data-push=""
          title="Open the theme settings"
          aria-label="Open the theme settings"
          onClick={() => openAppearance()}
        >
          <Icon name="settings-gear" />
        </button>
      </header>

      <div data-slot="olivia-swatches" role="listbox" aria-label="Theme">
        <For each={theme.ids()}>
          {(id) => (
            <button
              type="button"
              data-slot="olivia-swatch"
              data-active={id === theme.themeId() ? "" : undefined}
              role="option"
              aria-selected={id === theme.themeId()}
              aria-label={theme.name(id)}
              title={theme.name(id)}
              style={{ "--olivia-swatch": swatch(id) }}
              onClick={() => theme.setTheme(id)}
            />
          )}
        </For>
      </div>

      <div data-slot="olivia-schemes" role="group" aria-label="Color scheme">
        <For each={schemes}>
          {(scheme) => (
            <button
              type="button"
              data-slot="olivia-scheme"
              data-active={theme.colorScheme() === scheme.id ? "" : undefined}
              aria-pressed={theme.colorScheme() === scheme.id}
              onClick={() => theme.setColorScheme(scheme.id)}
            >
              {scheme.label}
            </button>
          )}
        </For>
      </div>
    </section>
  )
}
