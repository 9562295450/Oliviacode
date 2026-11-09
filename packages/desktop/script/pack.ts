#!/usr/bin/env bun
import { $ } from "bun"
import { createHash } from "node:crypto"
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { getConfig } from "../electron-builder.config"
import { getCurrentCli, resolveChannel } from "./utils"

// Packages the built app (out/) for OPENCODE_TARGET into dist/desktop at the repository root, unsigned:
// macOS: the .app as a tarball. Windows: the unpacked app in app/, or with OPENCODE_DESKTOP_APP, the NSIS
// installer around that (signed) app. Linux: AppImage, deb and rpm. The release workflow signs afterwards.
const dir = path.resolve(import.meta.dir, "..")

const out = path.resolve(dir, "../../dist/desktop")

const cli = getCurrentCli()

const os =
  new Map([
    ["darwin", "mac"],
    ["win32", "win"],
  ]).get(cli.os) ?? "linux"

const app = process.env.OPENCODE_DESKTOP_APP

const flags = [`--${os}`, `--${cli.cpu}`, "--publish", "never", "--config", "electron-builder.config.ts"]

process.chdir(dir)

await rm("dist", { recursive: true, force: true })

// The installer pass takes an already packed app as its input, so it must not delete the
// directory that input lives in. Only a fresh pack clears the output tree.
if (!app) await rm(out, { recursive: true, force: true })

await mkdir(out, { recursive: true })

if (app) {
  // The installer uses the channel's icons; the rest of the app is already built and signed.
  await $`bun ./script/copy-icons.ts ${resolveChannel()}`
  await $`bunx electron-builder ${flags} --prepackaged ${app}`
  const setup = (await readdir("dist")).find((file) => /^Oliviacode-Setup-.*\.exe$/.test(file))

  if (!setup) throw new Error("electron-builder produced no Oliviacode-Setup-*.exe")
  await cp(path.join("dist", setup), path.join(out, setup))
  // The blockmap serves differential downloads; the feed carries the installer and latest.yml.
  const blockmap = `${setup}.blockmap`
  if ((await readdir("dist")).includes(blockmap)) await cp(path.join("dist", blockmap), path.join(out, blockmap))
  await writeLatestYml(path.join(out, setup))
}

if (!app && os === "linux") {
  await $`bunx electron-builder ${flags}`
  const files = (await readdir("dist")).filter((file) => /\.(AppImage|deb|rpm)$/.test(file))
  await Promise.all(files.map((file) => cp(path.join("dist", file), path.join(out, file))))
}

if (!app && os === "mac") {
  await $`bunx electron-builder ${flags} --dir -c.mac.identity=null`
  const parent = path.join("dist", cli.cpu === "arm64" ? "mac-arm64" : "mac")
  const bundles = (await readdir(parent)).filter((file) => file.endsWith(".app"))

  if (bundles.length !== 1) throw new Error(`Expected one .app bundle in ${parent}, found ${bundles.join(", ")}`)
  await writeUpdateConfig(path.join(parent, bundles[0], "Contents", "Resources"))
  await $`tar -cf ${path.join(out, `opencode-desktop-mac-${cli.cpu}.app.tar`)} -C ${parent} ${bundles[0]}`
}

if (!app && os === "win") {
  await $`bunx electron-builder ${flags} --dir`
  const unpacked = path.join("dist", cli.cpu === "arm64" ? "win-arm64-unpacked" : "win-unpacked")
  await writeUpdateConfig(path.join(unpacked, "resources"))
  await cp(unpacked, path.join(out, "app"), { recursive: true })
}

await $`bun ./script/checksums.ts ${out}`

// electron-builder writes resources/app-update.yml only for dmg, zip and nsis targets, not for --dir builds.
// electron-updater reads its feed from that file, so write the one those targets would.
async function writeUpdateConfig(resources: string) {
  const publish = getConfig().publish

  // The fork ships without a feed: no app-update.yml means electron-updater stays quiet.
  if (!publish) return

  const name: string = (await Bun.file("package.json").json()).name
  await Bun.write(
    path.join(resources, "app-update.yml"),
    [
      `provider: ${publish.provider}`,
      `url: ${publish.url}`,
      `channel: ${publish.channel}`,
      `updaterCacheDirName: '${name.replace(/[/\\:*?"<>|]/g, "").toLowerCase()}-updater'`,
    ].join("\n") + "\n",
  )
}

// electron-updater's generic provider fetches latest.yml before any download and verifies the installer
// against it. electron-builder writes one only while publishing, and pack builds with --publish never,
// so the feed entry is written here from the same bytes the release uploads.
async function writeLatestYml(installer: string) {
  const bytes = Buffer.from(await Bun.file(installer).arrayBuffer())
  const sha512 = createHash("sha512").update(bytes).digest("base64")
  const { size } = await stat(installer)
  const version: string = (await Bun.file(path.join(dir, "package.json")).json()).version
  const name = path.basename(installer)

  await Bun.write(
    path.join(out, "latest.yml"),
    [
      `version: ${version}`,
      "files:",
      `  - url: ${name}`,
      `    sha512: ${sha512}`,
      `    size: ${size}`,
      `path: ${name}`,
      `sha512: ${sha512}`,
      `releaseDate: '${new Date().toISOString()}'`,
      "",
    ].join("\n"),
  )
}
