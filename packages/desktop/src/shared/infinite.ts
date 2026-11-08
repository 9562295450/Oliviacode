/**
 * The egress contract lives in `@opencode/app/egress` — the renderer and the main process
 * both need it, and the app package is the one place they already share types from.
 * Re-exported here so main-process modules have a single local import.
 */
export * from "@opencode/app/egress"
