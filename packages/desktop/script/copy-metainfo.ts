import { resolveChannel } from "./utils"

const arg = process.argv[2]

const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const APP_IDS = {
  dev: "ai.oliviacode.desktop.dev",
  beta: "ai.oliviacode.desktop.beta",
  prod: "ai.oliviacode.desktop",
} as const

const PRODUCT_NAMES = {
  dev: "oliviacode Dev",
  beta: "oliviacode Beta",
  prod: "oliviacode",
} as const

const appId = APP_IDS[channel]

const productName = PRODUCT_NAMES[channel]

const summary = `AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ai.oliviacode">
    <name>oliviacode</name>
  </developer>

  <description>
    <p>
      oliviacode is a fork of OpenCode, the open source agent that helps you write and run code with any AI model.
      It adds a sidebar egress manager for direct, WARP, Tor and proxy lanes with rotation, and a theme engine.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="homepage">https://opencode.ai</url>
  <url type="vcs-browser">https://github.com/anomalyco/opencode</url>

  <screenshots>
    <screenshot type="default">
      <image>https://raw.githubusercontent.com/anomalyco/opencode/b75d4d1c5ec449585d515c756fc81f080a157a9a/packages/web/src/assets/lander/screenshot.png</image>
    </screenshot>
  </screenshots>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)

console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
