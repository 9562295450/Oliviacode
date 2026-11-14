import type { SessionInfo } from "@opencode/client/promise"
import { displayLabel } from "@opencode/util/session-title-fallback"

const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function sessionLabel(session: Pick<SessionInfo, "title" | "parentID">) {
  return displayLabel(session)
}

export function sessionTitle(title?: string) {
  if (!title) return title
  const match = title.match(pattern)

  return match?.[1] ?? title
}

/** Longer than a tab label wants, short enough to identify the work. */
const MAX_PREVIEW = 60

/**
 * The first line of the first message a session received, collapsed and clipped.
 *
 * This is the same rule the core uses for its provisional title, duplicated here because the
 * renderer needs it before the core has committed anything: a row should read as the work it
 * holds from the first keystroke.
 */
export function sessionPreview(text?: string) {
  const line = text?.replace(/\s+/g, " ").trim()
  if (!line) return undefined

  return line.length <= MAX_PREVIEW ? line : `${line.slice(0, MAX_PREVIEW - 3).trimEnd()}...`
}

/** The label a row shows: the session's name, else the work it holds, else the fallback. */
export function sessionRowLabel(input: { title?: string; preview?: string } | undefined, fallback: string) {
  const title = input?.title
  if (title && !pattern.test(title)) return title
  return input?.preview || fallback
}
