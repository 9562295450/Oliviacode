/**
 * Every external destination the client itself links to.
 *
 * Nothing here belongs to a provider. The app is a generic client: providers are chosen by the
 * user, and their endpoints live in the community add-on registry, never in this file.
 */
export const BRAND = {
  name: "Oliviacode",
  repo: "https://github.com/Oliviacode/Oliviacode",
  issues: "https://github.com/Oliviacode/Oliviacode/issues",
  discussions: "https://github.com/Oliviacode/Oliviacode/discussions",
  docs: "https://github.com/Oliviacode/Oliviacode/blob/main/README.md",
  addons: "https://github.com/Oliviacode/Oliviacode/blob/main/PRESETS.md",
  security: "https://github.com/Oliviacode/Oliviacode/blob/main/docs/security/virustotal.md",
} as const
