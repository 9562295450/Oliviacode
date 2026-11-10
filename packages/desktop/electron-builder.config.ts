import { copyFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Arch, type Configuration } from "electron-builder"
import { NativeArch } from "../../script/native-arch"
import { DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { CLI_BINARIES, getCurrentCli, nodePtyPackage } from "./script/utils"

const packageDir = path.dirname(fileURLToPath(import.meta.url))

// A hidden launcher kept alongside the generated one so GNOME/KDE pins made
// against the pre-rename app id still resolve to the same binary and icon.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "oliviacode-desktop.desktop")

const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/oliviacode-desktop.desktop`

// rpmbuild adds /usr/lib/.build-id links for every ELF file. The bundled Electron
// binaries are byte-identical across apps on the same Electron version, so those
// links collide with other Electron RPMs (Slack, Unity Hub, ...) and rpm/zypper
// refuse to install or update. They only serve debuginfo lookup, so skip them.
// fpm only accepts flags before the first src=dest mapping, so keep this first.
const rpmNoBuildIdLinksFpm = "--rpm-rpmbuild-define=_build_id_links none"

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

// Dev and beta package every commit, so they trade about 5% (deb) and 17% (rpm) larger files for xz -1, which
// compresses the payload about 3x faster than the deb default (-3) and 5x faster than the rpm default (-9).
const previewCompressionFpm = (target: "deb" | "rpm") => [`--${target}-compression-level`, "1"]

function resolveChannel() {
  const raw = process.env.OPENCODE_CHANNEL

  if (raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (raw === "latest") return "prod"

  return "dev"
}

const APP_IDS = {
  dev: "ai.oliviacode.desktop.dev",
  beta: "ai.oliviacode.desktop.beta",
  prod: "ai.oliviacode.desktop",
} as const

// Auto-update is opt-in and can only ever read this project's own releases.
// Unset, `publish` is null, `pack.ts` writes no app-update.yml, and electron-updater
// stays quiet — a fresh clone never contacts any update server.
function resolvePublish(): Configuration["publish"] {
  const repo = process.env.OLIVIACODE_UPDATE_REPO?.trim()

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null

  return {
    provider: "generic",
    url: `https://github.com/${repo}/releases/latest/download`,
    channel: process.env.OLIVIACODE_UPDATE_CHANNEL ?? "latest",
  }
}

// libappimage (used by AppImageLauncher) resolves the .desktop entry inside an
// AppImage by globbing `*.desktop` at the squashfs root. If the main
// executable itself ends in `.desktop` (prod appId `ai.opencode.desktop`), the
// ELF binary matches the glob and is parsed as a desktop entry, so
// integration fails with `Malformed desktop entry: Unexpected char '\x7f' at 0`
// (0x7F is the first byte of the ELF magic).
// https://github.com/anomalyco/opencode/issues/51867
// Strip a trailing `.desktop` so the executable can never collide with the
// desktop-entry glob. Beta/dev appIds end in `.beta`/`.dev` and are unaffected.
function linuxExecutableName(appId: string): string {
  return appId.replace(/\.desktop$/, "")
}

const getBase = (appId: string): Configuration => {
  const target = getCurrentCli()
  const desktopName = `${appId}.desktop`

  return {
    artifactName: "oliviacode-desktop-${os}-${arch}.${ext}",
    // File properties on Windows and the maintainer field in deb/rpm read these. The upstream
    // copyright travels in LICENSE and NOTICE; this names who publishes this build.
    copyright: "Copyright © 2026 Malbe and oliviacode contributors",
    publish: resolvePublish(),
    directories: {
      output: "dist",
      buildResources: "resources",
    },
    // Linux launchers are .desktop files, so this is the desktop file name,
    // not just the app id. For prod, app id "ai.opencode.desktop" becomes
    // "ai.opencode.desktop.desktop".
    // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
    // https://www.electron.build/docs/linux/
    // Release builds take their version from OPENCODE_VERSION instead of rewriting package.json.
    extraMetadata: process.env.OPENCODE_VERSION
      ? { desktopName, version: process.env.OPENCODE_VERSION }
      : { desktopName },
    files: [
      "out/**/*",
      // Source maps are development-only: they are never read by the running app, and shipping
      // them costs tens of megabytes of install size plus one asar header entry per map.
      "!out/**/*.map",
      "resources/**/*",
      "!resources/opencode-cli*",
      // Keep only the target platform's node-pty prebuild when cross-packaging with --cpu=*.
      ...CLI_BINARIES.filter((item) => item.os !== target.os || item.cpu !== target.cpu).map(
        (item) => `!**/node_modules/@lydell/node-pty-${item.os}-${item.cpu}{,/**/*}`,
      ),
      // Log export imports Zip.js as ESM. Keep index.js and lib, including its inline worker.
      "!**/node_modules/@zip.js/zip.js/dist{,/**/*}",
      "!**/node_modules/@zip.js/zip.js/{index.cjs,index.min.js,index-fflate.js,deno.json,eslint.config.mjs}",
      // Nothing executes type declarations or source maps, and every entry costs startup time: the
      // main process parses the whole asar header before it runs any JavaScript.
      "!**/node_modules/**/*.d.{ts,cts,mts}",
      "!**/node_modules/**/*.d.{ts,cts,mts}.map",
      "!**/node_modules/**/*.{js,cjs,mjs}.map",
      // These packages execute compiled JavaScript, not their sources.
      "!**/node_modules/ajv/lib{,/**/*}",
      "!**/node_modules/ajv-formats/src{,/**/*}",
      // Keep js-yaml's CommonJS sources and dist/js-yaml.mjs ESM entry, not browser bundles or its CLI.
      "!**/node_modules/js-yaml/dist/{js-yaml.js,js-yaml.min.js,*.map}",
      "!**/node_modules/js-yaml/bin{,/**/*}",
    ],
    extraResources: [
      {
        from: "resources/",
        to: "",
        filter: ["opencode-cli", "opencode-cli.exe", "opencode-cli.version", "web-tools.mjs"],
      },
      // Inert local preset data. Empty by default; entries are user-supplied.
      {
        from: "../../presets.json",
        to: "presets.json",
      },
      // Starter add-on template. Offered in the add-ons dialog; nothing is installed until the user
      // presses Use, and the file contains URLs only.
      {
        from: "../../community-presets.json",
        to: "community-presets.json",
      },
    ],
    afterPack: async (context) => {
      const arch = Arch[context.arch]

      // The --arm64 flag picks Electron while OPENCODE_TARGET picks the CLI and node-pty, so they can disagree.
      if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported desktop architecture: ${arch}`)

      if (arch !== target.cpu) throw new Error(`Packaging ${arch} Electron with the ${target.target} CLI`)
      const resources = context.packager.getResourcesDir(context.appOutDir)
      const cli = path.join(resources, context.electronPlatformName === "win32" ? "opencode-cli.exe" : "opencode-cli")

      const file = await stat(cli)

      if (!file.isFile() || file.size === 0) throw new Error(`Bundled CLI must be a non-empty file: ${cli}`)
      await NativeArch.verify(cli, arch)
      const version = path.join(path.dirname(cli), "opencode-cli.version")

      if ((await stat(version)).size === 0) throw new Error(`Bundled CLI version must be a non-empty file: ${version}`)

      // With an Icon Composer mac.icon, electron-builder bundles the ICNS that actool generates as the pre-macOS 26
      // fallback. That one tops out at 256px and draws a light ring around the squircle, so ship ours instead.
      if (context.electronPlatformName === "darwin")
        await copyFile(path.join(packageDir, "resources/icons/icon.icns"), path.join(resources, "icon.icns"))

      if (context.electronPlatformName !== "win32") return

      const prebuilds = path.join(
        resources,
        "app.asar.unpacked/node_modules",
        nodePtyPackage(target.target),
        "prebuilds",
        `${target.os}-${target.cpu}`,
      )

      const addon = path.join(prebuilds, "conpty.node")

      if ((await stat(addon)).size === 0) throw new Error(`Bundled node-pty must be a non-empty file: ${addon}`)
      const entries = await readdir(prebuilds, { recursive: true, withFileTypes: true })

      await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const file = path.join(entry.parentPath, entry.name)

            if (await NativeArch.isNative(file)) await NativeArch.verify(file, arch)
          }),
      )
    },
    mac: {
      category: "public.app-category.developer-tools",
      icon: `resources/icons/icon.icns`,
      // Both architectures are released side by side, so the arch has to be in the file name.
      artifactName: "Oliviacode-${version}-${arch}.${ext}",
      extendInfo: {
        NSMicrophoneUsageDescription: DESKTOP_NATIVE_ENGLISH["desktop.microphoneUsage"],
        // The CLI server and its terminals run as children of the app, so macOS asks for their access to
        // these protected locations in the app's name. The prompt shows the description (#56479).
        NSDocumentsFolderUsageDescription: DESKTOP_NATIVE_ENGLISH["desktop.documentsFolderUsage"],
        NSDesktopFolderUsageDescription: DESKTOP_NATIVE_ENGLISH["desktop.desktopFolderUsage"],
        NSDownloadsFolderUsageDescription: DESKTOP_NATIVE_ENGLISH["desktop.downloadsFolderUsage"],
        NSNetworkVolumesUsageDescription: DESKTOP_NATIVE_ENGLISH["desktop.networkVolumesUsage"],
        NSRemovableVolumesUsageDescription: DESKTOP_NATIVE_ENGLISH["desktop.removableVolumesUsage"],
        NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
      },
      target: ["dmg", "zip"],
    },
    protocols: {
      name: "oliviacode",
      schemes: ["opencode"],
    },
    win: {
      icon: `resources/icons/icon.ico`,
      target: ["nsis"],
      verifyUpdateCodeSignature: false,
    },
    nsis: {
      include: path.join(packageDir, "resources", "windows", "installer.nsh"),
      // Assisted install: one page for the license, one for the progress bar, one for Finish.
      // The license page carries the disclaimer, so it is not skippable by a silent flag.
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: false,
      // "always" also recreates the icon after an update if the user removed the first one, so
      // the app is never left without a way in from the desktop.
      createDesktopShortcut: "always",
      createStartMenuShortcut: true,
      shortcutName: "Oliviacode",
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      installerIcon: `resources/icons/icon.ico`,
      installerHeaderIcon: `resources/icons/icon.ico`,
      installerHeader: path.join(packageDir, "resources", "windows", "installerHeader.bmp"),
      installerSidebar: path.join(packageDir, "resources", "windows", "installerSidebar.bmp"),
      uninstallerSidebar: path.join(packageDir, "resources", "windows", "installerSidebar.bmp"),
      license: path.join(packageDir, "resources", "license.txt"),
      artifactName: "Oliviacode-Setup-${version}.${ext}",
    },
    linux: {
      icon: `resources/icons`,
      category: "Development",
      // The workflow publishes x64 Linux only. electron-builder expands ${arch} to x86_64/amd64 for
      // AppImage and deb, while the release notes and workflow use x64, so pin the label.
      artifactName: "Oliviacode-${version}-x64.${ext}",
      executableName: linuxExecutableName(appId),
      // Derive the installed `.desktop` filename from `desktopName`
      // (`ai.opencode.desktop.desktop` for prod) instead of `executableName`,
      // so window association is unaffected by the executable rename above.
      syncDesktopName: true,
      desktop: {
        entry: {
          // Match the installed .desktop file and hicolor icon basename so
          // Linux shells can associate the running Electron window with its launcher.
          StartupWMClass: appId,
        },
      },
      target: ["AppImage", "deb", "rpm"],
    },
  }
}

export function getConfig() {
  const channel = resolveChannel()
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "oliviacode Dev",
        deb: { fpm: [...previewCompressionFpm("deb"), metainfoFpm(appId)] },
        rpm: {
          packageName: "oliviacode-dev",
          fpm: [rpmNoBuildIdLinksFpm, ...previewCompressionFpm("rpm"), metainfoFpm(appId)],
        },
      }
    }

    case "beta": {
      return {
        ...base,
        appId,
        productName: "oliviacode Beta",
        protocols: { name: "oliviacode Beta", schemes: ["opencode"] },
        deb: { fpm: [...previewCompressionFpm("deb"), metainfoFpm(appId)] },
        rpm: {
          packageName: "oliviacode-beta",
          fpm: [rpmNoBuildIdLinksFpm, ...previewCompressionFpm("rpm"), metainfoFpm(appId)],
        },
      }
    }

    case "prod": {
      return {
        ...base,
        appId,
        productName: "Oliviacode",
        protocols: { name: "oliviacode", schemes: ["opencode"] },
        // An Icon Composer package compiles to Assets.car, which macOS 26 and later draw the app icon from
        // (Dock, Finder, system dialogs and the system icon styles). Older macOS keeps using the ICNS.
        // The compiler is actool 26, which the Intel runner does not have, so only the arm64 build uses it.
        mac: {
          ...base.mac,
          icon: process.arch === "arm64" ? "resources/icons/icon.icon" : "resources/icons/icon.icns",
        },
        // The DMG volume icon would otherwise use the same actool-generated ICNS.
        dmg: { icon: "resources/icons/icon.icns" },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "oliviacode", fpm: [rpmNoBuildIdLinksFpm, metainfoFpm(appId), legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
