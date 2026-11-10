/**
 * A minimal CDP client for ghost's hidden Chrome.
 *
 * No automation library: the socket is the browser's own debugging interface, and input
 * goes through `Input.dispatchMouseEvent` / `Input.insertText`, which the renderer treats
 * as trusted. That is the same path a real mouse and keyboard take, minus the library
 * tells (`navigator.webdriver`, CDP-specific globals, Playwright's injected script).
 */
import { writeFile } from "node:fs/promises"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function json(url, method = "GET") {
  const response = await fetch(url, { method })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

/** Open a tab on a running ghost instance and return a session bound to it. */
export async function openTab(port, url = "about:blank") {
  const target = await json(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, "PUT")
  const session = new Session(target.webSocketDebuggerUrl)
  await session.init()
  return session
}

export class Session {
  #ws
  #id = 0
  #pending = new Map()
  #listeners = new Map()

  constructor(wsUrl) {
    this.#ws = new WebSocket(wsUrl)
    this.ready = new Promise((resolve, reject) => {
      this.#ws.addEventListener("open", () => resolve())
      this.#ws.addEventListener("error", () => reject(new Error("cdp socket error")))
    })

    this.#ws.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : "")
      if (message.id !== undefined && this.#pending.has(message.id)) {
        const entry = this.#pending.get(message.id)
        this.#pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message))
        else entry.resolve(message.result)
        return
      }
      if (!message.method) return
      for (const handler of this.#listeners.get(message.method) ?? []) handler(message.params)
    })
  }

  async init() {
    await this.ready
    await this.send("Page.enable")
    await this.send("Runtime.enable")
    return this
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, handler) {
    const handlers = this.#listeners.get(method) ?? []
    handlers.push(handler)
    this.#listeners.set(method, handlers)
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.#listeners.set(
          method,
          (this.#listeners.get(method) ?? []).filter((h) => h !== handler),
        )
        resolve(params)
      }
      this.on(method, handler)
    })
  }

  async goto(url, { timeoutMs = 60_000 } = {}) {
    await this.ready
    const loaded = this.once("Page.loadEventFired")
    await this.send("Page.navigate", { url })
    await Promise.race([loaded, sleep(timeoutMs)])
    await this.waitFor("document.readyState === 'complete'", Math.min(timeoutMs, 30_000)).catch(() => undefined)
    return this
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(`eval failed: ${detail}`)
    }
    return result.result?.value
  }

  async waitFor(expression, timeoutMs = 20_000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        if (await this.eval(`Boolean(${expression})`)) return true
      } catch {
        // The document is mid-navigation and has no execution context yet; poll again.
      }
      await sleep(intervalMs)
    }
    throw new Error(`timed out waiting for ${expression}`)
  }

  async text() {
    return this.eval("document.body.innerText")
  }

  async url() {
    return this.eval("location.href")
  }

  /** Move to a point, settle, then press and release — not one frame. */
  async clickAt(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
    })
    await this.pause(120, 320)
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
    await this.pause(60, 140)
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
  }

  /** Click the centre of the first element matching `selector`. */
  async click(selector) {
    const rect = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: "center", inline: "center" })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
    })()`)
    if (!rect || rect.w === 0 || rect.h === 0) throw new Error(`cannot click ${selector}`)
    await this.pause(400, 1100)
    await this.clickAt(rect.x, rect.y)
  }

  /** Click the first element matching `selector` whose text contains `text`. */
  async clickByText(selector, text) {
    const rect = await this.eval(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = nodes.find((node) => (node.innerText || node.textContent || node.value || "").trim().includes(${JSON.stringify(text)}))
      if (!el) return null
      el.scrollIntoView({ block: "center", inline: "center" })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
    })()`)
    if (!rect || rect.w === 0 || rect.h === 0) throw new Error(`cannot click "${text}" in ${selector}`)
    await this.pause(400, 1100)
    await this.clickAt(rect.x, rect.y)
  }

  async clickAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
  }

  /** A pause with human variance, for the gaps between actions. */
  async pause(min = 400, max = 1200) {
    const ms = Math.round(min + Math.random() * Math.max(0, max - min))
    await sleep(ms)
    return ms
  }

  /** Focus `selector`, optionally clearing it first. */
  async focus(selector, clear = true) {
    const focused = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      el.focus()
      if (${clear}) {
        if (el.isContentEditable) el.textContent = ""
        else {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "")
        }
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
      return true
    })()`)
    if (!focused) throw new Error(`no element ${selector}`)
  }

  /** Focus `selector` and insert text as a real keyboard would. */
  async type(selector, text, { clear = true } = {}) {
    await this.focus(selector, clear)
    if (text) await this.send("Input.insertText", { text })
    await this.eval(`document.activeElement?.dispatchEvent(new Event("change", { bubbles: true }))`)
  }

  /**
   * Type one character at a time with human inter-key timing.
   *
   * A form filled in one insertText lands in a single frame, which no person has ever done.
   * Field-by-field character entry with a variable beat costs a few seconds and looks like
   * someone at a keyboard.
   */
  async typeHuman(selector, text, { min = 55, max = 165, clear = true } = {}) {
    await this.focus(selector, clear)
    for (const char of text) {
      await this.send("Input.insertText", { text: char })
      // Now and then a longer beat, as if reading the next bit of the label.
      const beat = Math.random() < 0.08 ? 260 + Math.random() * 420 : min + Math.random() * (max - min)
      await sleep(Math.round(beat))
    }
    await this.eval(`document.activeElement?.dispatchEvent(new Event("change", { bubbles: true }))`)
  }

  async press(key) {
    const keys = {
      Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" },
      Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
      Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
    }
    const spec = keys[key]
    if (!spec) throw new Error(`unmapped key ${key}`)
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...spec })
    if (spec.text) await this.send("Input.dispatchKeyEvent", { type: "char", ...spec })
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...spec })
  }

  /** Set a select/radio and fire the events a framework listens for. */
  async select(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      el.value = ${JSON.stringify(value)}
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    })()`)
    if (!ok) throw new Error(`no element ${selector}`)
  }

  async screenshot(path) {
    const shot = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
    await writeFile(path, Buffer.from(shot.data, "base64"))
    return path
  }

  async close() {
    try {
      await this.send("Page.close")
    } catch {
      // The tab may already be gone.
    }
    try {
      this.#ws.close()
    } catch {
      // Socket already dropped.
    }
  }
}

/** Wait until the tab's location matches, then return the session. */
export async function waitForUrl(session, pattern, timeoutMs = 30_000) {
  await session.waitFor(
    `new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)}).test(location.href)`,
    timeoutMs,
  )
  return session.url()
}
