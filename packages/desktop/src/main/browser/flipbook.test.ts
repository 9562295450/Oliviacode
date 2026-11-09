import { describe, expect, test } from "bun:test"
import { columnsFor, frameHash, tileRgba, type RgbaFrame } from "./flipbook"

/** A frame filled with one colour, so a tile's position is readable from any pixel in it. */
function solid(width: number, height: number, rgba: [number, number, number]): RgbaFrame {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = rgba[0]
    data[index + 1] = rgba[1]
    data[index + 2] = rgba[2]
    data[index + 3] = 0xff
  }
  return { width, height, data }
}

function pixelAt(frame: { width: number; data: Buffer }, x: number, y: number) {
  const offset = (y * frame.width + x) * 4
  return [frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]]
}

describe("columnsFor", () => {
  test("picks the squarest grid", () => {
    expect(columnsFor(0)).toBe(0)
    expect(columnsFor(1)).toBe(1)
    expect(columnsFor(4)).toBe(2)
    expect(columnsFor(5)).toBe(3)
    expect(columnsFor(9)).toBe(3)
  })
})

describe("tileRgba", () => {
  test("lays frames left to right, top to bottom, with an opaque gap", () => {
    const frames = [
      solid(2, 2, [255, 0, 0]),
      solid(2, 2, [0, 255, 0]),
      solid(2, 2, [0, 0, 255]),
      solid(2, 2, [255, 255, 0]),
    ]

    const grid = tileRgba(frames, 2, 0x0b)

    expect(grid.columns).toBe(2)
    expect(grid.rows).toBe(2)
    expect(grid.width).toBe(6)
    expect(grid.height).toBe(6)

    expect(pixelAt(grid, 0, 0)).toEqual([255, 0, 0])
    expect(pixelAt(grid, 4, 0)).toEqual([0, 255, 0])
    expect(pixelAt(grid, 0, 4)).toEqual([0, 0, 255])
    expect(pixelAt(grid, 4, 4)).toEqual([255, 255, 0])

    // The gap column at x=2 and gap row at y=2 carry the background, fully opaque.
    expect(grid.data[(0 * 6 + 2) * 4 + 3]).toBe(0xff)
    expect(pixelAt(grid, 2, 0)).toEqual([0x0b, 0x0b, 0x0b])
  })

  test("a three-frame book leaves the last cell as background", () => {
    const grid = tileRgba([solid(2, 2, [1, 1, 1]), solid(2, 2, [2, 2, 2]), solid(2, 2, [3, 3, 3])], 0)

    expect(grid.columns).toBe(2)
    expect(grid.rows).toBe(2)
    expect(grid.width).toBe(4)
    expect(grid.height).toBe(4)
    expect(pixelAt(grid, 0, 2)).toEqual([3, 3, 3])
    expect(pixelAt(grid, 2, 2)).toEqual([0x0b, 0x0b, 0x0b])
  })

  test("refuses mismatched sizes rather than painting a torn grid", () => {
    expect(() => tileRgba([solid(2, 2, [0, 0, 0]), solid(2, 3, [0, 0, 0])])).toThrow("one size")
    expect(() => tileRgba([{ width: 2, height: 2, data: Buffer.alloc(3) }])).toThrow("does not match")
    expect(tileRgba([])).toEqual({ width: 0, height: 0, columns: 0, rows: 0, data: Buffer.alloc(0) })
  })
})

describe("frameHash", () => {
  test("is stable for identical paints and separates a one-pixel change", () => {
    const a = solid(40, 40, [10, 20, 30])
    const b = solid(40, 40, [10, 20, 30])
    const c = solid(40, 40, [10, 20, 30])
    c.data[97 * 1] = 0xff

    expect(frameHash(a.data)).toBe(frameHash(b.data))
    expect(frameHash(a.data)).not.toBe(frameHash(c.data))
  })
})
