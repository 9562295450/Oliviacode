/**
 * Flipbook assembly.
 *
 * A single screenshot says where the page is; it does not say that a menu opened, a spinner
 * finished or a form rejected the input. Stacking the last N frames into one grid says all three in
 * one image, which is exactly the payload a vision model can actually read. The grid is built from
 * raw RGBA in memory and encoded once: no intermediate file, no image library, no canvas.
 */

export type RgbaFrame = {
  readonly width: number
  readonly height: number
  /** Tightly packed RGBA, `width * height * 4` bytes. */
  readonly data: Buffer
}

export type Flipbook = {
  readonly width: number
  readonly height: number
  readonly columns: number
  readonly rows: number
  readonly data: Buffer
}

/** Squarest grid that fits `count`, so a 9-frame flipbook is 3×3 rather than 9×1. */
export function columnsFor(count: number): number {
  if (count <= 0) return 0
  return Math.ceil(Math.sqrt(count))
}

/**
 * Tiles equally sized frames left to right, top to bottom. The caller normalises each frame to one
 * size first; this refuses a mismatch rather than painting a torn grid.
 */
export function tileRgba(frames: readonly RgbaFrame[], gap = 2, background = 0x0b): Flipbook {
  if (frames.length === 0) return { width: 0, height: 0, columns: 0, rows: 0, data: Buffer.alloc(0) }

  const first = frames[0]!
  const width = first.width
  const height = first.height

  if (width <= 0 || height <= 0) throw new Error("Flipbook frames need a positive size.")
  if (first.data.byteLength !== width * height * 4) throw new Error("Flipbook frame data does not match its size.")

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) throw new Error("Flipbook frames must share one size.")
    if (frame.data.byteLength !== width * height * 4) throw new Error("Flipbook frame data does not match its size.")
  }

  const columns = columnsFor(frames.length)
  const rows = Math.ceil(frames.length / columns)
  const outWidth = columns * width + (columns - 1) * gap
  const outHeight = rows * height + (rows - 1) * gap
  const data = Buffer.alloc(outWidth * outHeight * 4, background)

  // Alpha stays opaque; a transparent gap would read as a rendering bug in the model's copy.
  for (let index = 3; index < data.length; index += 4) data[index] = 0xff

  const rowBytes = width * 4

  frames.forEach((frame, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const originX = column * (width + gap)
    const originY = row * (height + gap)

    for (let y = 0; y < height; y += 1) {
      const source = y * rowBytes
      const target = ((originY + y) * outWidth + originX) * 4
      frame.data.copy(data, target, source, source + rowBytes)
    }
  })

  return { width: outWidth, height: outHeight, columns, rows, data }
}

/**
 * Cheap change detector: FNV-1a over every 97th byte (prime, so it walks all four channels and
 * every pixel modulo the sampling stride). Two identical paints hash the same, and a page that
 * only changed a cursor or a clock tick costs one 64-bit compare instead of a JPEG encode and a
 * slot in the ring.
 */
export function frameHash(data: Buffer): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < data.length; index += 97) {
    hash ^= data[index]!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}
