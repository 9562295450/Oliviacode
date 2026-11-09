import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { adopting, file, read, write } from "./engine-adoption"
import { channelFor, confirmBoot, preferred, stageBinary, stageDirectory } from "./engine-update"

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "engine-update-"))
}

function stage(userData: string, version: string) {
  const binary = stageBinary(userData, version)
  mkdirSync(path.dirname(binary), { recursive: true })
  writeFileSync(binary, "binary")

  return binary
}

describe("channelFor", () => {
  test("prod follows latest, beta follows minor, dev and local stay bundled", () => {
    expect(channelFor("prod")).toBe("latest")
    expect(channelFor("beta")).toBe("minor")
    expect(channelFor("dev")).toBe("bundled")
    expect(channelFor("local")).toBe("bundled")
  })
})

describe("stage paths", () => {
  test("a stage is keyed by version and architecture, like the bundled one", () => {
    const directory = stageDirectory("C:/userData", "2.3.0", "x64")

    expect(directory).toContain(path.join("cli", "2.3.0-x64"))
    expect(stageBinary("C:/userData", "2.3.0", "x64").startsWith(directory)).toBe(true)
  })

  test("a version that is not a plain semver stays one directory name", () => {
    // Separators are replaced, so no crafted version can walk out of the cli root.
    const directory = stageDirectory("C:/userData", "2.3.0/../../evil", "x64")

    expect(path.dirname(directory)).toBe(path.join("C:/userData", "cli"))
  })
})

describe("preferred", () => {
  test("no adoption runs the bundled engine", () => {
    const userData = workspace()

    try {
      expect(preferred({ userData, bundledVersion: "2.2.6" })).toEqual({})
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test("a pending adoption runs and is marked attempting before the engine starts", () => {
    const userData = workspace()

    try {
      const binary = stage(userData, "2.3.0")
      write(file(userData), adopting({ version: "2.3.0", channel: "latest", from: "2.2.6" }))

      expect(preferred({ userData, bundledVersion: "2.2.6" })).toEqual({ version: "2.3.0", binary })
      expect(read(file(userData)).adopted?.boot).toBe("attempting")
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test("a confirmed adoption runs again untouched", () => {
    const userData = workspace()

    try {
      const binary = stage(userData, "2.3.0")
      write(file(userData), adopting({ version: "2.3.0", channel: "latest", from: "2.2.6" }))
      confirmBoot(userData, "2.3.0")

      expect(preferred({ userData, bundledVersion: "2.2.6" })).toEqual({ version: "2.3.0", binary })
      expect(read(file(userData)).adopted?.boot).toBe("ok")
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test("an unconfirmed adoption reverts and is not retried", () => {
    const userData = workspace()

    try {
      stage(userData, "2.3.0")
      write(file(userData), adopting({ version: "2.3.0", channel: "latest", from: "2.2.6" }))

      // First launch takes the adoption and marks it attempting…
      expect(preferred({ userData, bundledVersion: "2.2.6" }).version).toBe("2.3.0")
      // …and a launch that never confirms the boot reverts to bundled on the next one.
      expect(preferred({ userData, bundledVersion: "2.2.6" })).toEqual({})
      expect(read(file(userData)).rejected?.version).toBe("2.3.0")
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test("a record whose stage is gone reverts instead of failing to spawn", () => {
    const userData = workspace()

    try {
      write(file(userData), adopting({ version: "2.3.0", channel: "latest", from: "2.2.6" }))

      expect(preferred({ userData, bundledVersion: "2.2.6" })).toEqual({})
      expect(read(file(userData)).rejected?.reason).toContain("missing")
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test("an app update that ships the adopted version clears the adoption", () => {
    const userData = workspace()

    try {
      stage(userData, "2.3.0")
      write(file(userData), adopting({ version: "2.3.0", channel: "latest", from: "2.2.6" }))

      expect(preferred({ userData, bundledVersion: "2.3.0" })).toEqual({})
      expect(read(file(userData))).toEqual({})
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})

describe("confirmBoot", () => {
  test("confirms only the version that is actually adopted", () => {
    const userData = workspace()

    try {
      write(file(userData), adopting({ version: "2.3.0", channel: "latest", from: "2.2.6" }))

      expect(confirmBoot(userData, "2.2.6")).toBe(false)
      expect(confirmBoot(userData, "2.3.0")).toBe(true)
      expect(confirmBoot(userData, "2.3.0")).toBe(false)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
