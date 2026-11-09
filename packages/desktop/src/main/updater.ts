import { existsSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater"
import type { UpdateStatus } from "../shared/ipc-rpc/updates"
import { UpdateChanged } from "../shared/ipc-rpc/events"
import { emitIpcEvent } from "./ipc-events"
import { getMainWindows } from "./windows"

// The shell updates from this repository's own GitHub releases. The bundled CLI keeps updating through
// OpenCode on its own schedule: this feed carries packages/desktop only, never the engine.
//
// electron-updater reads its feed from resources/app-update.yml, which pack.ts writes only when
// OLIVIACODE_UPDATE_REPO names a repository. No file, no updater: a dev checkout or a fork that never set
// the variable stays silent instead of polling someone else's release page.
const POLL_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_MS = 5_000

let status: UpdateStatus = { state: "idle" }
let started = false

export function updaterState() {
  return status
}

function publish(next: UpdateStatus) {
  status = next

  for (const win of getMainWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    emitIpcEvent(win.webContents, new UpdateChanged({ status: next }))
  }
}

function feedPresent() {
  return app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml"))
}

/** Short plain-text release notes: electron-updater hands over markdown, sometimes as per-version entries. */
function releaseNotes(info: UpdateInfo) {
  const value = info.releaseNotes

  if (!value) return undefined

  const text =
    typeof value === "string"
      ? value
      : value
          .map((entry) => entry.note ?? "")
          .filter(Boolean)
          .join("\n\n")

  const trimmed = text.replace(/<[^>]+>/g, "").trim()

  return trimmed ? trimmed.slice(0, 4_000) : undefined
}

function available(info: UpdateInfo): UpdateStatus {
  return { state: "available", version: info.version, notes: releaseNotes(info) }
}

export function startUpdater() {
  if (started) return

  started = true

  if (!feedPresent()) {
    publish({ state: "unsupported" })
    return
  }

  // A check never downloads on its own: the user sees the version and asks for it. An install that was
  // downloaded and deferred lands on the next quit.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }))
  autoUpdater.on("update-available", (info) => publish(available(info)))
  autoUpdater.on("update-not-available", () => publish({ state: "up-to-date", checkedAt: Date.now() }))
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    const version = status.version

    publish({
      state: "downloading",
      version,
      percent: Math.max(0, Math.min(100, progress.percent)),
    })
  })
  autoUpdater.on("update-downloaded", (info) =>
    publish({ state: "ready", version: info.version, notes: releaseNotes(info) }),
  )
  autoUpdater.on("error", (cause) =>
    publish({
      state: "error",
      version: status.version,
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  )

  publish({ state: "idle" })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(), POLL_MS).unref()
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!feedPresent()) {
    publish({ state: "unsupported" })

    return status
  }

  if (status.state === "downloading") return status

  publish({ state: "checking" })

  try {
    await autoUpdater.checkForUpdates()
  } catch (cause) {
    publish({
      state: "error",
      version: status.version,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }

  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!feedPresent()) {
    publish({ state: "unsupported" })

    return status
  }

  if (status.state === "downloading" || status.state === "ready") return status

  if (status.state !== "available") await checkForUpdates()

  if (status.state !== "available") return status

  publish({ state: "downloading", version: status.version, percent: 0 })

  try {
    await autoUpdater.downloadUpdate()
  } catch (cause) {
    publish({
      state: "error",
      version: status.version,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }

  return status
}

/**
 * Starts the downloaded installer. NSIS runs it silently and relaunches the app; electron-updater never
 * resolves the call, so nothing here waits for one.
 */
export function installUpdate() {
  if (status.state !== "ready") return

  autoUpdater.quitAndInstall(false, true)
}
