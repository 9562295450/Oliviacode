import { describe, expect, test } from "bun:test"
import { sessionPreview, sessionRowLabel } from "./title"

describe("sessionPreview", () => {
  test("collapses the first message onto one line", () => {
    expect(sessionPreview("  fix   the\nbuild\tplease  ")).toBe("fix the build please")
  })

  test("clips at sixty characters and keeps the ellipsis inside the budget", () => {
    const preview = sessionPreview("x".repeat(200))
    expect(preview?.length).toBe(60)
    expect(preview?.endsWith("...")).toBe(true)
  })

  test("an empty or missing message has no preview", () => {
    expect(sessionPreview("   ")).toBeUndefined()
    expect(sessionPreview(undefined)).toBeUndefined()
  })
})

describe("sessionRowLabel", () => {
  test("a real title wins over the preview", () => {
    expect(sessionRowLabel({ title: "Keylogger build", preview: "make me a keylogger" }, "Untitled session")).toBe(
      "Keylogger build",
    )
  })

  test("the preview stands in while the session is still unnamed", () => {
    expect(sessionRowLabel({ preview: "make me a keylogger" }, "Untitled session")).toBe("make me a keylogger")
  })

  test("a timestamped fallback title is not shown to anyone", () => {
    expect(
      sessionRowLabel({ title: "New session - 2026-07-30T18:45:03.662Z", preview: "add a test" }, "Untitled session"),
    ).toBe("add a test")
  })

  test("nothing known falls back to the caller's label", () => {
    expect(sessionRowLabel(undefined, "New session")).toBe("New session")
    expect(sessionRowLabel({}, "Untitled session")).toBe("Untitled session")
  })
})
