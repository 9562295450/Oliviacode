import { BrowserWindow, nativeImage, type NativeImage } from "electron"
import { CaptureError } from "./error"
import { FrameRing, type CapturedFrame, type FrameRingOptions } from "./frames"
import { frameHash, tileRgba, type RgbaFrame } from "./flipbook"

/**
 * The agentic browser.
 *
 * A real Chromium in an offscreen window: it navigates, clicks, types, scrolls and runs script,
 * with a persistent profile so a sign-in survives a restart. Nothing here is a simulation of a
 * browser, which is why it can be handed a login form at all.
 *
 * Two surfaces reach the model. `outline()` returns the page as text — every interactive element
 * with its label and centre point — because a pruned tree is cheaper and more precise than pixels
 * for "click the Sign in button". `frames()` returns what actually moved, because no tree says the
 * modal animated in or the captcha rejected you. Both, in that order, is what the 2026 agents
 * converged on.
 *
 * Capture is a ring in memory. The window paints; dirty frames are hashed, identical paints are
 * dropped, and what survives is encoded to JPEG and pushed. Reading drains the ring, so the buffer
 * exists only between the paint and the read.
 */

export type AgenticBrowserOptions = {
  /** Defaults to a persistent partition: a signed-in session outlives the app. */
  readonly partition?: string
  readonly width?: number
  readonly height?: number
  readonly framesPerSecond?: number
  readonly ring?: FrameRingOptions
}

export type InteractiveElement = {
  readonly index: number
  readonly tag: string
  readonly role: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly disabled: boolean
}

export type PageOutline = {
  readonly url: string
  readonly title: string
  readonly text: string
  readonly elements: readonly InteractiveElement[]
  readonly truncated: boolean
}

const NAVIGATION_TIMEOUT_MS = 30_000
const OUTLINE_TIMEOUT_MS = 10_000
const MAX_TEXT_CHARS = 12_000
const MAX_ELEMENTS = 200
/** 640 wide keeps a 16:9 frame near 40 KB of JPEG and 0.9 MB of RGBA if it is ever decoded. */
const CAPTURE_WIDTH = 640
const JPEG_QUALITY = 60
const FLIPBOOK_CELL_WIDTH = 480

export class AgenticBrowser {
  #window: BrowserWindow | null = null
  #ring: FrameRing
  #sequence = 0
  #lastHash: number | null = null
  readonly #options: Required<Omit<AgenticBrowserOptions, "ring">>

  constructor(options: AgenticBrowserOptions = {}) {
    this.#options = {
      partition: options.partition ?? "persist:agentic",
      width: options.width ?? 1280,
      height: options.height ?? 800,
      framesPerSecond: options.framesPerSecond ?? 30,
    }
    this.#ring = new FrameRing(options.ring)
  }

  get window() {
    return this.#window
  }

  get open() {
    return this.#window !== null && !this.#window.isDestroyed()
  }

  captureStats() {
    return this.#ring.stats()
  }

  create(): void {
    if (this.open) return

    const window = new BrowserWindow({
      show: false,
      width: this.#options.width,
      height: this.#options.height,
      webPreferences: {
        partition: this.#options.partition,
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    })

    window.webContents.setFrameRate(this.#options.framesPerSecond)
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event, url) => {
      if (!isWebUrl(url)) event.preventDefault()
    })

    // Offscreen windows deliver frames here and nowhere else; beginFrameSubscription is a
    // visible-window API and never fires for an offscreen surface.
    window.webContents.on("paint", (_event, _dirty, image) => this.#capture(image))

    this.#window = window
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const window = this.#require()

    if (!isWebUrl(url)) throw new CaptureError("navigation", `Refusing ${url}: only http(s) is navigable.`)

    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new CaptureError("navigation", `Timed out loading ${url} after ${NAVIGATION_TIMEOUT_MS} ms.`))
      }, NAVIGATION_TIMEOUT_MS)

      const onFinish = () => {
        cleanup()
        resolve()
      }
      const onFail = (_event: unknown, code: number, description: string, validated: string) => {
        cleanup()
        reject(new CaptureError("navigation", `${description} (${code}) for ${validated || url}`))
      }
      const cleanup = () => {
        clearTimeout(timer)
        window.webContents.off("did-finish-load", onFinish)
        window.webContents.off("did-fail-load", onFail)
      }

      window.webContents.once("did-finish-load", onFinish)
      window.webContents.once("did-fail-load", onFail)
    })

    // A frame clock is what makes the ring live; without it the window is a static render.
    window.webContents.invalidate()

    await window.loadURL(url)
    await loaded

    return { url: window.webContents.getURL(), title: window.webContents.getTitle() }
  }

  async click(x: number, y: number): Promise<void> {
    const window = this.#require()
    const point = { x: Math.round(x), y: Math.round(y) }

    window.webContents.sendInputEvent({ type: "mouseMove", ...point })
    window.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 })
    window.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 })
  }

  async type(text: string): Promise<void> {
    const window = this.#require()

    for (const character of text) {
      window.webContents.sendInputEvent({ type: "char", keyCode: character })
      // Chromium coalesces characters delivered in one tick into a single composition event.
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  async key(name: string): Promise<void> {
    const window = this.#require()
    const keyCode = KEY_CODES[name.toLowerCase()]
    if (!keyCode) throw new CaptureError("input", `Unknown key "${name}".`)

    window.webContents.sendInputEvent({ type: "keyDown", keyCode })
    window.webContents.sendInputEvent({ type: "keyUp", keyCode })
  }

  async scroll(deltaX: number, deltaY: number, at?: { x: number; y: number }): Promise<void> {
    const window = this.#require()
    const point = at ?? { x: Math.round(this.#options.width / 2), y: Math.round(this.#options.height / 2) }

    window.webContents.sendInputEvent({
      type: "mouseWheel",
      x: point.x,
      y: point.y,
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY),
      canScroll: true,
    })
  }

  /** The page as text plus the coordinates of everything clickable. */
  async outline(): Promise<PageOutline> {
    const window = this.#require()
    const raw = await withTimeout(window.webContents.executeJavaScript(OUTLINE_SCRIPT, false), OUTLINE_TIMEOUT_MS)

    return {
      url: window.webContents.getURL(),
      title: window.webContents.getTitle(),
      text: String(raw.text ?? "").slice(0, MAX_TEXT_CHARS),
      elements: Array.isArray(raw.elements) ? raw.elements.slice(0, MAX_ELEMENTS) : [],
      truncated: String(raw.text ?? "").length > MAX_TEXT_CHARS,
    }
  }

  /** Reads the ring dry. The buffers leave here and the ring keeps none of them. */
  frames(): CapturedFrame[] {
    return this.#ring.drain()
  }

  /**
   * Stacks the last `count` frames into one grid. Decoded one at a time and released, so the peak
   * cost is one cell rather than the whole run.
   */
  flipbook(count = 9, quality = 70): { jpeg: Buffer; columns: number; rows: number; frames: number } | null {
    const frames = this.#ring.peek(count)
    if (frames.length === 0) return null

    const cells: RgbaFrame[] = []

    for (const frame of frames) {
      const decoded = nativeImage.createFromBuffer(frame.jpeg)
      if (decoded.isEmpty()) continue

      const scaled = decoded.resize({ width: FLIPBOOK_CELL_WIDTH, quality: "good" })
      const size = scaled.getSize()

      cells.push({ width: size.width, height: size.height, data: scaled.toBitmap() })
    }

    if (cells.length === 0) return null

    const grid = tileRgba(cells)
    const image = nativeImage.createFromBitmap(grid.data, { width: grid.width, height: grid.height })

    return { jpeg: image.toJPEG(quality), columns: grid.columns, rows: grid.rows, frames: cells.length }
  }

  dispose(): void {
    const window = this.#window
    if (!window || window.isDestroyed()) return

    this.#window = null
    // No `endFrameSubscription` here: capture rides the `paint` event, and destroy removes it.
    window.destroy()
    this.#ring.drain()
  }

  #capture(image: NativeImage) {
    if (image.isEmpty()) return

    const scaled = image.resize({ width: CAPTURE_WIDTH, quality: "good" })
    const size = scaled.getSize()
    if (size.width === 0 || size.height === 0) return

    const hash = frameHash(scaled.toBitmap())
    // A cursor blink and a clock tick would otherwise fill the ring with the same frame.
    if (hash === this.#lastHash) return
    this.#lastHash = hash

    this.#ring.push({ sequence: (this.#sequence += 1), at: Date.now(), jpeg: scaled.toJPEG(JPEG_QUALITY) })
  }

  #require() {
    if (!this.open) throw new CaptureError("lifecycle", "The agentic browser is not open. Call create() first.")
    return this.#window!
  }
}

function isWebUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CaptureError("timeout", `Page did not answer within ${ms} ms.`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const KEY_CODES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  space: "Space",
}

/**
 * Runs in the page. Returns text plus a numbered list of things a click can land on, which is the
 * reference surface the model clicks by — coordinates come from the same rect the outline reported,
 * so a click cannot drift from the label the model chose.
 */
const OUTLINE_SCRIPT = `(() => {
  const SELECTOR = 'a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable=""],[contenteditable="true"]'
  const seen = new Set()
  const elements = []

  for (const node of document.querySelectorAll(SELECTOR)) {
    const rect = node.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    if (rect.bottom < 0 || rect.right < 0) continue
    if (rect.top > innerHeight * 3) continue
    if (seen.has(node)) continue
    seen.add(node)

    const label = (node.getAttribute('aria-label') || node.innerText || node.value || node.getAttribute('placeholder') || node.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 120)

    elements.push({
      index: elements.length,
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') || '',
      label,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true',
    })

    if (elements.length >= ${MAX_ELEMENTS}) break
  }

  const body = document.body
  const text = body ? body.innerText.replace(/\\n{3,}/g, '\\n\\n').trim() : ''

  return { text, elements }
})()`
