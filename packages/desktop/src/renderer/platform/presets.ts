import type { PresetPlatform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

/**
 * Provider addons.
 *
 * Read-only data plus one write: applying an addon patches a base URL into the engine's global
 * config. No credential is involved at any point, so there is nothing to cache or redact here.
 * A community registry is fetched only when the user supplies a URL.
 */
export function createPresetPlatform(api: ElectronAPI): PresetPlatform {
  return {
    fetch: (url) => api.presetFetch(url),
    list: () => api.presetList(),
    apply: (id) => api.presetApply(id),
  }
}
