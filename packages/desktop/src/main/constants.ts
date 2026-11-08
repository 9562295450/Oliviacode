import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "oliviacode Dev",
  beta: "oliviacode Beta",
  prod: "oliviacode",
}

const appIDs: Record<string, string> = {
  dev: "ai.oliviacode.desktop.dev",
  beta: "ai.oliviacode.desktop.beta",
  prod: "ai.oliviacode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "oliviacode Dev"

// An unpackaged build derives its profile from this id. Setting OLIVIACODE_APP_ID keeps two
// checkouts (or a private and a public tree) from sharing one userData directory, one cache,
// and one single-instance lock.
const DEVELOPMENT_APP_ID = process.env.OLIVIACODE_APP_ID?.trim() || "ai.oliviacode.desktop.dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : DEVELOPMENT_APP_ID
