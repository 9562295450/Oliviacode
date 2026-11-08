import type { PresetPlatform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

/**
 * Provider presets.
 *
 * Read-only data plus one write: applying a preset patches a base URL into the engine's global
 * config. No credential is involved at any point, so there is nothing to cache or redact here.
 */
export function createPresetPlatform(api: ElectronAPI): PresetPlatform {
  return {
    list: () => api.presetList(),
    apply: (id) => api.presetApply(id),
  }
}
