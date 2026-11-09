export type BrowserErrorCode = "lifecycle" | "navigation" | "input" | "timeout" | "capture"

export class CaptureError extends Error {
  readonly code: BrowserErrorCode

  constructor(code: BrowserErrorCode, message: string) {
    super(message)
    this.name = "CaptureError"
    this.code = code
  }
}
