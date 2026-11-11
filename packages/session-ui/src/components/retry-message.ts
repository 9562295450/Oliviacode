/** The retry card is a single line, so a long failure is cut at this many characters. */
export const RETRY_MESSAGE_LIMIT = 80

const DIALED = " (dialled "

/**
 * Cuts a retry message for the one-line card without throwing away the endpoint.
 *
 * The dialled host is appended to the end of a transport failure, which is exactly where a plain
 * `slice` loses it — and it is the only part of a refused connect that says which hop failed. The
 * suffix is reserved before the head is trimmed, so the card keeps the address it was dialling.
 */
export function retryMessage(message: string) {
  if (message.length <= RETRY_MESSAGE_LIMIT) return message

  const at = message.lastIndexOf(DIALED)

  if (at === -1) return `${message.slice(0, RETRY_MESSAGE_LIMIT)}…`

  const suffix = message.slice(at).trimEnd()
  const head = message.slice(0, at).trimEnd()
  const room = RETRY_MESSAGE_LIMIT - suffix.length - 1

  if (room < 8) return `…${suffix}`

  return `${head.slice(0, room).trimEnd()}…${suffix}`
}
