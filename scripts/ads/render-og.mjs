/**
 * Re-render the social card from docs/design/og.html.
 *
 * The card is a fixed 1280x640 HTML canvas. ghost's browser renders it on the hidden
 * desktop and the screenshot is clipped to the canvas, so the PNG is exactly the size the
 * OG/Twitter tags advertise.
 */
import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { openTab } from "./lib/cdp.mjs"

const port = Number(process.argv[2] ?? 9333)
const source = resolve("docs/design/og.html")
const target = resolve("docs/og.png")

const session = await openTab(port)
try {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.goto(pathToFileURL(source).href)
  await new Promise((done) => setTimeout(done, 1200))

  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 1280, height: 640, scale: 1 },
  })
  await writeFile(target, Buffer.from(shot.data, "base64"))
  console.log(`rendered ${target}`)
} finally {
  await session.send("Emulation.clearDeviceMetricsOverride", {}).catch(() => undefined)
  await session.close()
}
