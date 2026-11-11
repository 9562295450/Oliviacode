import { describe, expect, test } from "bun:test"
import { RETRY_MESSAGE_LIMIT, retryMessage } from "./retry-message"

const refused =
  "ECONNREFUSED: Unable to connect. Is the computer able to access the url? (dialled 127.0.0.1:9)"

describe("retryMessage", () => {
  test("a short message is shown whole", () => {
    expect(retryMessage("Connection reset")).toBe("Connection reset")
    expect(retryMessage("x".repeat(RETRY_MESSAGE_LIMIT))).toHaveLength(RETRY_MESSAGE_LIMIT)
  })

  test("a long message without an endpoint is cut at the limit", () => {
    const message = "y".repeat(RETRY_MESSAGE_LIMIT + 40)
    expect(retryMessage(message)).toBe(`${"y".repeat(RETRY_MESSAGE_LIMIT)}…`)
  })

  test("a long message keeps the dialled endpoint at the end", () => {
    const cut = retryMessage(refused)
    expect(cut.endsWith("(dialled 127.0.0.1:9)")).toBeTrue()
    expect(cut.length).toBeLessThanOrEqual(RETRY_MESSAGE_LIMIT)
    expect(cut).toContain("…")
    expect(cut.startsWith("ECONNREFUSED")).toBeTrue()
  })

  test("an endpoint that eats the whole line is shown on its own", () => {
    const message = `refused (dialled ${"a".repeat(RETRY_MESSAGE_LIMIT)})`
    expect(retryMessage(message)).toBe(`… (dialled ${"a".repeat(RETRY_MESSAGE_LIMIT)})`)
  })

  test("only the last endpoint is kept when a message repeats one", () => {
    const message = `${refused} retried against https://example.test/v1 ${refused}`
    expect(retryMessage(message).endsWith("(dialled 127.0.0.1:9)")).toBeTrue()
    expect(retryMessage(message).length).toBeLessThanOrEqual(RETRY_MESSAGE_LIMIT)
  })
})
