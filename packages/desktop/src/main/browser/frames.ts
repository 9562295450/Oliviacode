/**
 * The capture ring behind the agentic browser.
 *
 * Frames are held as encoded JPEGs in process memory and never touch the filesystem. A reader
 * drains them and the ring keeps no copy: the buffers leave with the caller and become garbage the
 * moment it drops them, which is the whole point of not writing a flipbook of somebody's inbox to
 * a temp directory.
 *
 * Bounds are the safety property. A browser left running for an hour paints thousands of frames;
 * an unread ring would walk the heap until the app died. Every push evicts for count, for bytes and
 * for age, oldest first, and counts what it lost so a caller can tell "nothing changed" apart from
 * "the buffer ate it".
 */

export type CapturedFrame = {
  readonly sequence: number
  /** `performance.timeOrigin + performance.now()`, so frames and logs share a clock. */
  readonly at: number
  readonly jpeg: Buffer
}

export type FrameRingOptions = {
  readonly maxFrames?: number
  readonly maxBytes?: number
  readonly maxAgeMs?: number
}

export const FRAME_LIMITS = {
  maxFrames: 240,
  /** 48 MB is roughly 1,200 640×360 JPEGs at quality 60, or six minutes of a chatty page. */
  maxBytes: 48 * 1024 * 1024,
  maxAgeMs: 120_000,
} as const

export class FrameRing {
  #frames: CapturedFrame[] = []
  #bytes = 0
  #dropped = 0
  #read = 0
  readonly #maxFrames: number
  readonly #maxBytes: number
  readonly #maxAgeMs: number

  constructor(options: FrameRingOptions = {}) {
    this.#maxFrames = positive(options.maxFrames, FRAME_LIMITS.maxFrames)
    this.#maxBytes = positive(options.maxBytes, FRAME_LIMITS.maxBytes)
    this.#maxAgeMs = positive(options.maxAgeMs, FRAME_LIMITS.maxAgeMs)
  }

  get length() {
    return this.#frames.length
  }

  get bytes() {
    return this.#bytes
  }

  push(frame: CapturedFrame): void {
    this.#frames.push(frame)
    this.#bytes += frame.jpeg.byteLength
    this.#evict(Date.now())
  }

  /** Read-and-delete. The ring is empty afterwards and the caller owns every buffer. */
  drain(): CapturedFrame[] {
    if (this.#frames.length === 0) return []

    const taken = this.#frames
    this.#frames = []
    this.#bytes = 0
    this.#read += taken.length
    return taken
  }

  /** The most recent `count` frames, still owned by the ring. */
  peek(count = this.#frames.length): CapturedFrame[] {
    if (count <= 0) return []
    return this.#frames.slice(Math.max(0, this.#frames.length - count))
  }

  /** Age-based eviction for a ring that goes quiet: nothing pushes, so nothing else would prune it. */
  prune(now = Date.now()): void {
    this.#evict(now)
  }

  stats() {
    return {
      frames: this.#frames.length,
      bytes: this.#bytes,
      dropped: this.#dropped,
      read: this.#read,
      oldest: this.#frames[0]?.at ?? null,
      newest: this.#frames.at(-1)?.at ?? null,
    }
  }

  #evict(now: number) {
    const cutoff = now - this.#maxAgeMs

    while (this.#frames.length > 0 && this.#frames[0]!.at < cutoff) this.#drop()

    while (this.#frames.length > this.#maxFrames) this.#drop()

    // Byte eviction runs last so a single oversized frame cannot empty the ring; it still leaves
    // the newest frame in place, and an empty ring is the correct answer if that one frame alone
    // is over budget.
    while (this.#bytes > this.#maxBytes && this.#frames.length > 1) this.#drop()
  }

  #drop() {
    const removed = this.#frames.shift()
    if (!removed) return
    this.#bytes -= removed.jpeg.byteLength
    this.#dropped += 1
  }
}

function positive(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.trunc(value)
}
