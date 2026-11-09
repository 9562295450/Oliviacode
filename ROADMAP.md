# Roadmap

What is in the app, what is on `main` and unreleased, and what is next. Anything listed here as
unreleased does not appear in the download page copy or the release notes.

## Released — 2.2.8

- **Provider-agnostic shell.** No endpoint, key or model in the source; the window opens with
  nothing configured.
- **Egress lanes.** Direct, Cloudflare WARP, Tor and HTTP proxy, each with health, latency and
  rotation that is only recorded after the provider reports the new address.
- **Isolated sessions.** Every session keeps its own workspace, model and agent; state lives in
  local SQLite under the app profile.
- **Compatibility-gated engine updates.** A newer CLI engine is adopted only after it proves it
  serves every operation the window calls, and a launch that never reaches its sidecar rolls back.
- **Local web tools.** An MCP server shipped with the app exposes `web_search` and `web_fetch`;
  the search backend is a user-supplied URL and key, never a bundled endpoint.

## Unreleased on `main`

### Agentic browser

A real offscreen Chromium the agent drives: navigate, click, type, press keys, scroll, read the
page. Persistent partition, so a sign-in survives a restart. This is what makes account-gated work
— posting, filling a form, checking a dashboard — something the model can do instead of describe.

- `src/main/browser/agent.ts` — the controller. Input goes through `sendInputEvent`, so it is
  Chromium's own event pipeline and not a synthetic DOM event a site can detect.
- `outline()` returns the page as text: readable body plus every interactive element with its
  label, role and centre point. The model clicks by the coordinates it was given, so a click cannot
  drift from the label it chose.
- Navigation is http(s) only. `will-navigate`, `setWindowOpenHandler` and the loader all refuse
  everything else.

**Not done yet:** the tool surface that exposes this to the engine, per-site permission prompts,
and the visible-window mode for a human to take over mid-task.

### DX capture — frames in RAM, read-and-delete

The window paints; dirty frames are hashed, identical paints are dropped, and what survives is
encoded to JPEG and pushed into a ring that lives only in process memory. Reading drains the ring,
so the buffer exists between the paint and the read and nowhere else. No temp files, no screenshots
directory, no PNG trail of somebody's inbox.

- `src/main/browser/frames.ts` — the ring. Bounded by count, by bytes and by age; eviction is
  oldest-first and counted, so "nothing changed" is distinguishable from "the buffer ate it".
- `src/main/browser/flipbook.ts` — stacks the last N frames into one grid. A single screenshot says
  where the page is; a grid says that the menu opened, the spinner finished and the form rejected
  the input, in one image.
- Budget: 640×360 JPEG at quality 60 is roughly 40 KB, so the 48 MB default ring holds about 1,200
  frames — several minutes of an active page — while the RGBA peak stays at one 480-wide cell.

**Not done yet:** wiring `flipbook()` into the tool result, and a frame-subscription mode for
sites that animate without marking the surface dirty.

### Captcha reality — measured, not assumed

Run against `2captcha.com/demo` from a headless Chromium, 2026-11-09. The split is not "captchas are
hard"; it is "captchas with an image are readable, captchas that score the client are not".

| Demo | What it asks | Result |
|---|---|---|
| `/demo/normal` | distorted text | passed, first attempt |
| `/demo/text` | a written question | passed, first attempt |
| `/demo/clickcaptcha` | click icons in a stated order | passed, first attempt |
| `/demo/rotatecaptcha` | rotate an image upright | passed, third angle |
| `/demo/recaptcha-v2` | image grid | four rounds selected correctly, then the widget refused the token |
| `/demo/recaptcha-v3` | nothing visible | token issued, score 0.1 |
| `/demo/cloudflare-turnstile` | nothing visible | widget never rendered, no token |

The lesson for the product: reading pixels is solved by handing the model a frame from the ring.
The remaining gate is client reputation, and the lever for that is the browser itself — a visible,
persistent Chromium profile, not a fresh headless context per run.

- Captchas inside the agentic browser need no solver service: `frames()` returns the image, the
  model reads it, `click()`/`type()` answer it. Add the retry loop, not an API key.
- Turnstile/reCAPTCHA v3 have no image to read. Those are answered by the profile's history, so
  sign-up flows must run in a window with a stable partition rather than a throwaway context.

**Not done yet:** the solve loop (detect challenge frame → read → act → verify).

## Ghost — a real browser that draws where nobody is looking

The headless result above was measured on the wrong instrument. `scripts/ghost/` launches a normal
headful Chromium onto a private Win32 desktop inside the interactive window station: real GPU, real
fonts, real window, real profile, no automation switches, and no monitor attached to that desktop —
so nothing appears, nothing takes focus, nothing lands in the taskbar. Driving it over CDP gives
trusted input events, which is the other half of looking like a person.

Same machine, same adapter, same minute, identical argument list, ghost versus `--headless=new`:

| Signal | Ghost | Headless |
|---|---|---|
| user agent | `Chrome/157.0.0.0 … Edg/157.0.0.0` | `HeadlessChrome/157.0.0.0 …` |
| screen | 1920×1080 | 800×600 |
| WebGL renderer | `ANGLE (AMD … D3D11)` | same |
| `navigator.webdriver` | `false` | `false` |
| Turnstile demo | token issued | token issued |
| 2captcha v3, 4 runs | 0.7, 0.9, 0.7, 0.9 | 0.1, 0.3, 0.1, 0.9 |
| Google v3 demo | 0.9 | 0.9 |

Turnstile's demo page mounts test-key widgets, which pass in any browser — that row proves the click
path, not trust. The v3 numbers overlap once the headless control warms up, so v3 is not the
discriminator. The user agent and the screen geometry are what actually differ; the profile is what
carries reputation, and ghost is what lets that profile be a real one.

- The widget's iframe lives in a closed shadow root, so the host page cannot see it. It is a real
  out-of-process target with its own debugging socket — read it from inside the frame.
- The checkbox is 19px in from the widget's left edge. A click at the container edge hits nothing
  and reports nothing.

**Not done yet:** one profile per posting account, warmed, and the staggered launch.

## Next

- **Connector directory.** Curated MCP entries with one-click install, the way a host lists apps.
- **OAuth for remote MCP servers**, so a connector gets a token without the user pasting one.
- **MCP Apps widget host.** Render a server's `ui://` resource in a sandboxed iframe and speak the
  `ui/*` JSON-RPC bridge, so a connector can draw instead of only answer.
- **Accessibility-tree outline** to replace the DOM outline when the tree is smaller.

## Not planned

- A bundled provider, endpoint, key or default model.
- Telemetry, analytics or an account system.
- Anything that phones home without being asked.
