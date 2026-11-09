import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  adopting,
  clear,
  confirmed,
  decide,
  empty,
  file,
  read,
  rejecting,
  write,
  type Record,
} from "./engine-adoption"

const at = 1_700_000_000_000

function pending(version = "2.3.0"): Record {
  return adopting({ version, channel: "latest", from: "2.2.6", at })
}

describe("decide", () => {
  test("no record means the bundled engine", () => {
    expect(decide(empty, "2.2.6")).toEqual({ action: "none", record: empty })
  })

  test("a pending adoption is taken and marked attempting in the same step", () => {
    const decision = decide(pending(), "2.2.6")

    expect(decision.action).toBe("use-adopted")
    expect(decision.version).toBe("2.3.0")
    expect(decision.record.adopted?.boot).toBe("attempting")
  })

  test("an attempting adoption is the previous launch's failure, so it reverts", () => {
    const record: Record = { adopted: { ...pending().adopted!, boot: "attempting" } }

    expect(decide(record, "2.2.6")).toEqual({ action: "demote", record: empty })
  })

  test("a confirmed adoption is used again without rewriting the record", () => {
    const record: Record = { adopted: { ...pending().adopted!, boot: "ok" } }
    const decision = decide(record, "2.2.6")

    expect(decision.action).toBe("use-adopted")
    expect(decision.version).toBe("2.3.0")
    expect(decision.record).toBe(record)
  })

  test("an app update that ships the adopted version clears the record", () => {
    expect(decide(pending("2.3.0"), "2.3.0")).toEqual({ action: "none", record: empty })
  })
})

describe("confirmed", () => {
  test("moves attempting to ok", () => {
    const record: Record = { adopted: { ...pending().adopted!, boot: "attempting" } }

    expect(confirmed(record, "2.3.0").adopted?.boot).toBe("ok")
  })

  test("ignores a different version and an already-confirmed record", () => {
    const record: Record = { adopted: { ...pending().adopted!, boot: "attempting" } }

    expect(confirmed(record, "2.2.6")).toBe(record)

    const ok: Record = { adopted: { ...pending().adopted!, boot: "ok" } }
    expect(confirmed(ok, "2.3.0")).toBe(ok)
  })

  test("no record is left alone", () => {
    expect(confirmed(empty, "2.3.0")).toBe(empty)
  })
})

describe("record file", () => {
  test("round trips and survives a corrupt file", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "engine-adoption-"))
    const target = file(directory)

    try {
      write(target, pending())
      expect(read(target).adopted?.version).toBe("2.3.0")

      writeFileSync(target, "{ truncated")
      expect(read(target)).toEqual(empty)

      writeFileSync(target, JSON.stringify({ adopted: { version: "2.3.0" } }))
      expect(read(target)).toEqual(empty)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("rejecting keeps the reason for the log, clear removes the file", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "engine-adoption-"))
    const target = file(directory)

    try {
      write(target, rejecting("2.4.0", "gate refused", at))
      expect(read(target)).toEqual({ rejected: { version: "2.4.0", reason: "gate refused", at } })

      clear(target)
      expect(read(target)).toEqual(empty)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("the file is written whole, never left half-written", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "engine-adoption-"))
    const target = file(directory)

    try {
      write(target, pending())
      expect(() => JSON.parse(readFileSync(target, "utf8"))).not.toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
