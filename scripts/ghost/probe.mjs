#!/usr/bin/env node
/**
 * Fingerprint + captcha probe for a running browser.
 *
 * Speaks CDP directly over the debugging port, so it makes no assumptions about which automation
 * library started the browser and adds no library tells of its own. Everything it reports is read
 * back out of the page: the UA, whether the runtime says it is automated, which GPU renderer the
 * WebGL context got, whether the window has real geometry â€” and then the two captchas that do not
 * show a picture, because those are the ones that grade the client rather than the answer.
 *
 *   node probe.mjs --port 9333            fingerprint + turnstile + v3
 *   node probe.mjs --port 9333 --warm     visit a few sites first, then the above
 */

const args = process.argv.slice(2)

function flag(name) {
  return args.includes(`--${name}`)
}

function option(name, fallback) {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

const PORT = Number(option('port', '9333'))
const BASE = `http://127.0.0.1:${PORT}`

class Cdp {
  #socket
  #nextId = 0
  #pending = new Map()
  #listeners = new Map()

  static async connect(url) {
    const client = new Cdp()
    await client.#open(url)
    return client
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      this.#socket = socket

      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error(`CDP socket refused ${url}`))
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }

        if (message.id !== undefined && this.#pending.has(message.id)) {
          const entry = this.#pending.get(message.id)
          this.#pending.delete(message.id)
          if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`))
          else entry.resolve(message.result)
          return
        }

        if (message.method) {
          for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params)
        }
      }
    })
  }

  send(method, params = {}) {
    const id = (this.#nextId += 1)
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try {
      this.#socket.close()
    } catch {
      /* already gone */
    }
  }
}

async function openTab(url) {
  const response = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!response.ok) throw new Error(`/json/new answered ${response.status}`)
  return response.json()
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'page threw during evaluate')
  }

  return result.result.value
}

async function navigate(client, url, timeoutMs = 45_000) {
  await client.send('Page.navigate', { url })

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const state = await evaluate(client, 'document.readyState')
      if (state === 'complete') return
    } catch {
      /* navigation tore the context down; retry */
    }
    await sleep(300)
  }

  throw new Error(`navigation to ${url} never completed`)
}

async function clickPoint(client, x, y) {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await sleep(60)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}

async function clickSelector(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
    })()`,
  )

  if (!point) return false
  await clickPoint(client, point.x, point.y)
  return true
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const FINGERPRINT = `(() => {
  const out = {}
  const nav = navigator

  out.userAgent = nav.userAgent
  out.webdriver = nav.webdriver
  out.platform = nav.platform
  out.vendor = nav.vendor
  out.languages = nav.languages
  out.hardwareConcurrency = nav.hardwareConcurrency
  out.deviceMemory = nav.deviceMemory ?? null
  out.plugins = Array.from(nav.plugins).map((p) => p.name)
  out.pdfViewerEnabled = nav.pdfViewerEnabled ?? null
  out.chrome = typeof window.chrome === 'object' ? Object.keys(window.chrome) : null
  out.outerWidth = window.outerWidth
  out.outerHeight = window.outerHeight
  out.innerWidth = window.innerWidth
  out.innerHeight = window.innerHeight
  out.screen = {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
  }
  out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  out.offsetMinutes = new Date().getTimezoneOffset()

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 220
    canvas.height = 60
    const ctx = canvas.getContext('2d')
    ctx.textBaseline = 'top'
    ctx.font = '16px "Arial"'
    ctx.fillStyle = '#f60'
    ctx.fillRect(10, 10, 80, 30)
    ctx.fillStyle = '#069'
    ctx.fillText('ghost bench 6767', 12, 14)
    out.canvas = canvas.toDataURL().slice(-64)

    // A canvas that already owns a 2d context cannot hand out a webgl one, so the GPU probe
    // gets its own surface.
    const surface = document.createElement('canvas')
    surface.width = 64
    surface.height = 64
    const gl = surface.getContext('webgl') || surface.getContext('experimental-webgl')
    const debug = gl && gl.getExtension('WEBGL_debug_renderer_info')
    out.webglVendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null
    out.webglRenderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null
    out.webglMaxTexture = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null
  } catch (error) {
    out.webglError = String(error)
  }

  out.webgpu = typeof nav.gpu === 'object'
  out.connection = nav.connection ? { type: nav.connection.effectiveType, downlink: nav.connection.downlink } : null
  out.notificationPermission = typeof Notification === 'object' ? Notification.permission : null
  out.sessionStorage = (() => { try { sessionStorage.setItem('probe', '1'); return true } catch { return false } })()
  out.cookieEnabled = nav.cookieEnabled
  out.hasFocus = document.hasFocus()

  return out
})()`

const WARM_SITES = [
  'https://en.wikipedia.org/wiki/Special:Random',
  'https://www.bing.com/',
  'https://github.com/explore',
  'https://news.ycombinator.com/',
]

async function turnstile(client) {
  await navigate(client, option('turnstile-url', 'https://nopecha.com/demo/turnstile'))
  await sleep(8000)

  // Turnstile mounts its iframe inside a closed shadow root, so document.querySelectorAll('iframe')
  // cannot see it. What the page can see is the container and the hidden response input, and that
  // pair is enough: container coordinates for the click, input length for the verdict.
  const widget = await evaluate(
    client,
    `(() => {
      const mount = Array.from(document.querySelectorAll('[id^="example-container"], cf-turnstile'))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { el, rect: { x: r.x, y: r.y, w: Math.round(r.width), h: Math.round(r.height) } }
        })
        // The widget is the 300x65 mount; the wrappers around it are taller and empty.
        .filter((entry) => entry.rect.w >= 200 && entry.rect.w <= 400 && entry.rect.h >= 40 && entry.rect.h <= 120)[0]

      if (!mount) return { present: false, tokenLength: -1 }

      // The response input is a sibling of the mount inside the widget wrapper.
      const wrapper = mount.el.closest('.turnstile') || mount.el.parentElement
      const input = wrapper.querySelector('input[name="cf-turnstile-response"]')

      return {
        present: true,
        rect: mount.rect,
        tokenLength: input ? String(input.value).length : -1,
      }
    })()`,
  )

  if (!widget.present) return { rendered: false, clicked: false, verdict: 'no container on page' }

  // The checkbox glyph sits 19px in from the widget's left edge. A click at the edge of the box
  // lands on the container instead of the box and never reaches the challenge handler.
  await clickPoint(client, widget.rect.x + 19, widget.rect.y + widget.rect.h / 2)
  await sleep(9000)

  const token = await evaluate(
    client,
    `(() => {
      const mount = Array.from(document.querySelectorAll('[id^="example-container"], cf-turnstile'))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { el, rect: { w: r.width, h: r.height } }
        })
        .filter((entry) => entry.rect.w >= 200 && entry.rect.w <= 400 && entry.rect.h >= 40 && entry.rect.h <= 120)[0]
      if (!mount) return -1
      const wrapper = mount.el.closest('.turnstile') || mount.el.parentElement
      const input = wrapper.querySelector('input[name="cf-turnstile-response"]')
      return input ? String(input.value).length : -1
    })()`,
  )

  return {
    rendered: true,
    clicked: true,
    geometry: widget.rect,
    tokenBefore: widget.tokenLength,
    tokenAfter: token,
    verdict: token > 0 ? 'token issued' : 'no token issued',
  }
}

async function recaptchaV3(client) {
  await navigate(client, 'https://2captcha.com/demo/recaptcha-v3')
  await sleep(5000)

  await clickSelector(client, '[data-action=demo_action]')
  await sleep(5000)

  const report = await evaluate(client, `(() => {
    const text = document.body.innerText
    const passed = /Captcha is passed successfully/.test(text)
    const score = text.match(/"score":\\s*([0-9.]+)/)
    const success = text.match(/"success":\\s*(true|false)/)
    const host = text.match(/"hostname":\\s*"([^"]+)"/)
    return {
      passed,
      success: success ? success[1] === 'true' : null,
      score: score ? Number(score[1]) : null,
      hostname: host ? host[1] : null,
    }
  })()`)

  return report
}

async function main() {
  const version = await (await fetch(`${BASE}/json/version`)).json()
  const tab = await openTab('about:blank')
  const client = await Cdp.connect(tab.webSocketDebuggerUrl)

  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')

    const report = {
      endpoint: BASE,
      browser: version.Browser,
      browserProtocol: version['Protocol-Version'],
      userAgentHeader: version['User-Agent'],
      warmed: flag('warm'),
    }

    if (flag('warm')) {
      for (const site of WARM_SITES) {
        try {
          await navigate(client, site, 30_000)
          await sleep(1200)
        } catch (error) {
          report.warmError = String(error.message)
        }
      }
    }

    await navigate(client, 'https://example.com/')
    report.fingerprint = await evaluate(client, FINGERPRINT)

    if (!flag('skip-captcha')) {
      report.turnstile = await turnstile(client)
      report.recaptchaV3 = await recaptchaV3(client)
    }

    console.log(JSON.stringify(report, null, 2))
  } finally {
    client.close()
    try {
      await fetch(`${BASE}/json/close/${tab.id}`)
    } catch {
      /* target already gone */
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack ?? error) }, null, 2))
  process.exitCode = 1
})


