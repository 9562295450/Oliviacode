import { For } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"

/**
 * A one-line message whose bare URLs stay clickable.
 *
 * Lane failures name the download or the document that fixes them, and a URL the reader has
 * to retype is a URL the reader does not open. The text is the same string the engine
 * produced; only the URL segments become controls.
 */
const SPLIT = /(https?:\/\/[^\s]*[^\s.,;:)])/g
const LINK = /^https?:\/\//

export function Linkified(props: { text: string; slot: string; tone?: "ok" | "bad" }) {
  const platform = usePlatform()

  return (
    <p data-slot={props.slot} data-tone={props.tone} title={props.text}>
      <For each={props.text.split(SPLIT)}>
        {(part) =>
          LINK.test(part) ? (
            <button type="button" data-slot="egress-open" title={part} onClick={() => platform.openExternal(part)}>
              {part}
            </button>
          ) : (
            part
          )
        }
      </For>
    </p>
  )
}
