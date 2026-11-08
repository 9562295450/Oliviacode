import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { prefersReducedMotion } from "@opencode/ui/motion"

const target = ["o", "l", "i", "v", "i", "a", "c", "o", "d", "e"] as const

const choices = ["o", "l", "i", "v", "a", "c", "d", "e"] as const

export function AnimatedWordmark(props: { active: boolean }) {
  const [state, setState] = createStore({ letters: [...target] })
  const timers = new Set<ReturnType<typeof setTimeout>>()

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()

        if (!active || prefersReducedMotion()) {
          setState("letters", [...target])

          return
        }

        const starts = target.map(() => choices[Math.floor(Math.random() * choices.length)])
        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState("letters", starts)

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              target.map((letter, index) =>
                tick >= settles[index] ? letter : choices[Math.floor(Math.random() * choices.length)],
              ),
            )
            timers.delete(timer)
          }, tick * 75)

          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox="0 0 294 42" aria-hidden="true">
      <defs>
        <symbol id="settings-about-letter-o" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 30H6V18H18V30Z" />
          <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" />
        </symbol>
        <symbol id="settings-about-letter-l" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M6 30H18V36H6V30Z" />
          <path d="M6 6H0V36H24V30H6V6Z" />
        </symbol>
        <symbol id="settings-about-letter-i" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M9 18H15V30H9V18Z" />
          <path d="M9 0H15V6H9V0ZM9 12H15V36H9V12Z" />
        </symbol>
        <symbol id="settings-about-letter-v" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M12 24L8 36H16L12 24Z" />
          <path d="M0 6H6L12 24L18 6H24L16 36H8L0 6Z" />
        </symbol>
        <symbol id="settings-about-letter-a" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M6 26H18V30H6V26Z" />
          <path d="M18 18H6V24H18V18ZM24 36H0V12H24V36Z" />
        </symbol>
        <symbol id="settings-about-letter-c" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M24 30H6V18H24V30Z" />
          <path d="M24 12H6V30H24V36H0V6H24V12Z" />
        </symbol>
        <symbol id="settings-about-letter-d" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 30H6V18H18V30Z" />
          <path d="M18 12H6V30H18V12ZM24 36H0V6H18V0H24V36Z" />
        </symbol>
        <symbol id="settings-about-letter-e" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M24 24V30H6V24H24Z" />
          <path d="M24 24H6V30H24V36H0V6H24V24ZM6 18H18V12H6V18Z" />
        </symbol>
      </defs>
      <For each={state.letters}>
        {(letter, index) => (
          <use href={`#settings-about-letter-${letter}`} x={index() * 30} width="24" height="42" />
        )}
      </For>
    </svg>
  )
}
