/**
 * Every external destination the client itself links to.
 *
 * Nothing here belongs to a provider. The app is a generic client: providers are chosen by the
 * user, and their endpoints live in the community add-on registry, never in this file.
 */
export const BRAND = {
  name: "Oliviacode",
  repo: "https://github.com/9562295450/Oliviacode",
  issues: "https://github.com/9562295450/Oliviacode/issues",
  discussions: "https://github.com/9562295450/Oliviacode/discussions",
  docs: "https://github.com/9562295450/Oliviacode/blob/main/README.md",
  addons: "https://github.com/9562295450/Oliviacode/blob/main/PRESETS.md",
  security: "https://github.com/9562295450/Oliviacode/blob/main/docs/security/virustotal.md",
} as const
