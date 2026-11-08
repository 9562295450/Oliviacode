import { OwlSplash } from "@opencode/ui/logo"
import type { Platform } from "@opencode/app/desktop"
import { onCleanup, onMount, Show } from "solid-js"
import "./splash.css"

const FIRST_LAUNCH_DRAW_MS = 900

export function LoadingSplash(props: {
  deep: boolean
  firstLaunch: boolean
  platform: Platform
  drawingPaused: boolean
  onDrawStart: () => void
  onDrawEnd: () => void
}) {
  onMount(() => {
    if (!props.drawingPaused) return

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    props.onDrawStart()

    if (motion.matches) {
      props.onDrawEnd()
      return
    }

    // The reveal is a fixed-length sequence. The timer owns the end so the splash
    // cannot strand startup on a focus or animation event that never fires.
    const timer = window.setTimeout(() => props.onDrawEnd(), FIRST_LAUNCH_DRAW_MS)
    onCleanup(() => window.clearTimeout(timer))
  })

  const titlebarHeight = () => {
    const zoom = props.platform.webviewZoom?.() ?? 1

    if (props.platform.os === "macos") return `max(36px, ${36 / zoom}px)`

    if (props.platform.os === "windows")
      return `max(36px, env(titlebar-area-height, ${44 / Math.min(Math.max(zoom, 0.25), 1)}px))`

    return "36px"
  }

  return (
    <Show
      when={props.firstLaunch}
      fallback={
        <div
          data-component="startup-splash"
          class="h-dvh w-screen flex flex-col items-center justify-center"
          classList={{
            "bg-v2-background-bg-deep": props.deep,
            "bg-v2-background-bg-base": !props.deep,
          }}
          style={{ "background-color": "var(--oc-boot-bg, #0b0a10)" }}
        >
          <OwlSplash class="w-28 h-28" />
        </div>
      }
    >
      <div
        data-component="first-launch-splash"
        data-drawing={props.drawingPaused ? "pending" : "running"}
        aria-hidden="true"
        class="h-dvh w-screen bg-v2-background-bg-base"
        style={{
          "background-color": "var(--oc-boot-bg, #0b0a10)",
          // Match the default session's titlebar, panel insets, and wordmark position.
          "padding-block-start": `calc(${titlebarHeight()} + ${props.platform.os === "windows" ? 1 : 8}px)`,
          "padding-block-end": "8px",
          "padding-inline": "32px",
        }}
      >
        <div class="relative size-full">
          <div class="first-launch-brand">
            <span class="first-launch-brand-word">oliviacode</span>
            <span class="first-launch-brand-rule" />
          </div>
        </div>
      </div>
    </Show>
  )
}
