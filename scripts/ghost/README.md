# Ghost

A real Chromium that renders on a desktop nobody is looking at.

Headless Chrome is not a hidden browser; it is a different browser. It reports `HeadlessChrome` in
the user agent, draws through a software rasteriser on some builds, has no window geometry and no
session history, and every one of those is a signal a risk engine reads. Ghost takes the opposite
route: launch a normal, headful Chromium with no automation switches, put its window on a private
Win32 desktop inside the interactive window station, and drive it over the DevTools protocol.

The browser renders, composites and paints exactly as it would on the visible desktop. It keeps the
user's GPU adapter, fonts, locale, codecs and display. There is simply no monitor attached to that
desktop, so nothing appears, nothing takes focus, and nothing lands in the taskbar.

## Commands

```powershell
# one time: download Chrome for Testing to %LOCALAPPDATA%\Oliviacode\ghost\chrome
.\ghost.ps1 -Command install

# launch on a private desktop; prints one JSON line with the CDP endpoint
.\ghost.ps1 -Command launch -Name reddit-a -Port 9333 -Url about:blank

# is it up
.\ghost.ps1 -Command status -Name reddit-a -Port 9333

# stop every process holding that profile
.\ghost.ps1 -Command kill -Name reddit-a

# everything currently running
.\ghost.ps1 -Command list
```

`-Browser auto` prefers the installed Chrome for Testing, then system Chrome, Edge, Brave. On this
machine only Edge is installed, so `auto` resolves to Edge until `install` runs.

`-Headless` launches the same binary with `--headless=new` — the A/B control, not a product mode.
`-Visible` puts the window on the real desktop so a human can sign in by hand; same profile.

Launch prints:

```json
{"ok":true,"mode":"hidden-desktop","pid":9016,"port":9333,
 "profile":"C:\\Users\\MARL\\AppData\\Local\\Oliviacode\\ghost\\profiles\\bench",
 "desktop":"OliviacodeGhost-bench","browserVersion":"Edg/157.0.4341.42",
 "webSocketDebuggerUrl":"ws://127.0.0.1:9333/devtools/browser/..."}
```

## Profiles

One name is one persistent identity: cookies, history, localStorage, cache, indexedDB.

```
%LOCALAPPDATA%\Oliviacode\ghost\profiles\<name>
```

Use a different name per account and reuse the name to stay signed in. The profile is the thing a
risk engine scores — a fresh profile with no history is the tell, not the window mode. Warm it by
using it: load the site, accept the cookie banner, read a page, come back tomorrow.

## Measured fingerprint

Same machine, same adapter, same minute. Ghost on the hidden desktop versus `--headless=new` with
an identical argument list:

| Signal | Ghost | Headless control |
|---|---|---|
| `navigator.userAgent` | `Chrome/157.0.0.0 … Edg/157.0.0.0` | `HeadlessChrome/157.0.0.0 …` |
| `navigator.webdriver` | `false` | `false` |
| `screen` | 1920×1080 | 800×600 |
| `outerWidth × outerHeight` | 1280×900 | 1280×900 |
| WebGL renderer | `ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001636) Direct3D11 vs_5_0 ps_5_0, D3D11)` | same |
| `navigator.gpu` | present | present |
| plugins | 5 PDF viewers | 5 PDF viewers |
| timezone | Asia/Singapore | Asia/Singapore |
| `document.hasFocus()` | `false` | `false` |

New headless on this build keeps the GPU, so the user agent and the screen geometry are the tells
that survive, plus the missing history. Ghost fixes the first two.

After `install`, ghost reports the plain Chrome user agent — `Chrome/157.0.8103.38`, no `Edg`, no
`HeadlessChrome` — which is the least interesting thing a browser can say about itself.

## Captcha A/B

`probe.mjs` drives the page over raw CDP — no automation library, so no library tells — reads the
fingerprint, clicks a Turnstile widget and runs the reCAPTCHA v3 demo. Same target URLs, same
network, back to back:

| Mode | Turnstile demo | 2captcha v3 (4 runs) | Google v3 demo |
|---|---|---|---|
| ghost | token issued | 0.7, 0.9, 0.7, 0.9 | 0.9 |
| headless | token issued | 0.1, 0.3, 0.1, 0.9 | 0.9 |

The first three headless runs sat at 0.1–0.3 and the fourth came back 0.9, which is the honest
finding: reCAPTCHA v3 is not a reliable discriminator between the two modes, and a single run in
either column proves nothing. Google's own demo gave both modes 0.9 in the same minute. Walmart and
Instagram also rendered normally in both.

So what does ghost actually buy?

- **No `HeadlessChrome` in the user agent.** That string is still the cheapest bot check in
  middleware, and it is the one hard tell new headless has not shed.
- **Real screen geometry.** 1920×1080 reported by a browser whose window is 1280×900 matches the
  machine; the headless default of 800×600 does not.
- **A profile that can be warmed.** Cookies, history and localStorage survive across launches
  because the profile is a directory, not a fresh context per run.
- **No window, no focus theft.** The work runs on a desktop with no monitor attached.

```powershell
node .\probe.mjs --port 9333              # fingerprint + turnstile + v3
node .\probe.mjs --port 9333 --warm       # visit four sites first, then the above
node .\probe.mjs --port 9333 --skip-captcha
node .\probe.mjs --port 9333 --turnstile-url https://nopecha.com/demo/turnstile
```

## Attaching

### Playwright

```js
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const context = browser.contexts()[0]
const page = context.pages()[0] ?? (await context.newPage())

await page.goto('https://example.com')
```

`connectOverCDP` reuses the running browser, so the profile, the GPU and the window all stay
whatever ghost made them. Do not pass `userAgent`, `viewport`, `locale` or `timezoneId` — those
overrides are themselves a signal, and they contradict the real surface underneath.

### Raw CDP

`/json/new?<url>` (PUT) opens a tab, `/json/list` enumerates page and iframe targets, and each
target's `webSocketDebuggerUrl` accepts `Runtime.evaluate`, `Input.dispatchMouseEvent` and
`Page.captureScreenshot`. `Input` events dispatched this way are trusted by the renderer — they are
the same path a real mouse takes.

## Gotchas

- **Turnstile's iframe is in a closed shadow root.** `document.querySelectorAll('iframe')` on the
  host page returns nothing. The frames are real out-of-process targets though: `/json/list` shows
  them as `type: "iframe"` with a `challenges.cloudflare.com` URL, and each one has its own
  debugging socket. Read the widget from inside the frame, not from the page.
- **The checkbox is 19px in from the widget's left edge.** The visible mount is 300×65; a click at
  `x + 30` lands on the container edge and never reaches the challenge handler, so no token is
  issued and nothing errors. `x + 19`, vertically centred, works.
- **Widget candidates need a size filter.** Wrappers around the mount report `128×161` or `0×0`.
  The mount is the one between 200 and 400 wide and 40 to 120 tall.
- **A token does not mean the sitekey is real.** The test key `3x00000000000000000000FF` always
  passes. A mismatched real key fails with `400070` inside the frame, in every browser.
- **Fallback mode.** If a machine policy forbids `CreateDesktop`, the launcher parks the window at
  `-32000,-32000` instead. Still headful, still real GPU, still no visible window; it appears in the
  taskbar, so prefer the hidden desktop where it works.
- **`ghost.ps1 launch` keeps the shell attached** to the browser process. If your tooling times out
  the command, the JSON line has already been printed and the browser is up — check `status`.
- **One port per running profile.** Two profiles cannot share a debugging port.
