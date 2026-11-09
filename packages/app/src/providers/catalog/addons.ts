import { createResource, createSignal } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"

/**
 * Providers the user has explicitly brought in.
 *
 * The client ships no provider of its own. A provider id becomes visible only when the user
 * supplies it: an installed add-on names it, or the app holds a credential the user typed here.
 * The engine's keyless catalogue, and anything it merely detected from the environment, is not a
 * provider the user chose, so a fresh install lists nothing at all. A starter template is copied
 * into the installed list only when the user applies it, and that copy is what makes it visible.
 */

const [revision, setRevision] = createSignal(0)

/** Call after an add-on is applied or removed so every consumer re-reads the list. */
export const refreshProviderAddons = () => setRevision((value) => value + 1)

export function useProviderAddons() {
  const platform = usePlatform()

  const [providers] = createResource(
    () => revision(),
    async () => {
      const presets = platform.presets

      if (!presets) return [] as string[]

      const addons = await presets.list().catch(() => [])

      return addons.map((addon) => addon.provider)
    },
  )

  return () => new Set(providers() ?? [])
}
