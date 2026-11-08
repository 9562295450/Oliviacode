import { type ComponentProps } from "solid-js"
import "./session-progress-indicator-v2.css"

// The app's one activity mark, shared by the activity chip, subagent rows, task cards and
// loading tabs. Two owl eyes blinking out of phase read as "watching" rather than "waiting",
// which is the house grammar: every other spinner is a ring, this one is alive.
export function SessionProgressIndicatorV2(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 32 16"
      width={props.width ?? 16}
      height={props.height ?? 16}
      data-component="session-progress-indicator-v2"
      aria-hidden={props["aria-hidden"] ?? "true"}
      fill="none"
    >
      <path d="M11 3 L4 8 L11 13 L11 9.6 L7.6 8 L11 6.4 Z" fill="currentColor" class="owl-progress-eye" />
      <path
        d="M21 3 L28 8 L21 13 L21 9.6 L24.4 8 L21 6.4 Z"
        fill="currentColor"
        class="owl-progress-eye owl-progress-eye-right"
      />
    </svg>
  )
}
