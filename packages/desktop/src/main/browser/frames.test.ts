import { describe, expect, test } from "bun:test"
import { FrameRing, FRAME_LIMITS, type CapturedFrame } from "./frames"

const frame = (sequence: number, bytes: number, at = Date.now()): CapturedFrame => ({
  sequence,
  at,
  jpeg: Buffer.alloc(bytes, sequence & 0xff),
})

describe("FrameRing", () => {
  test("a read drains the ring and leaves nothing behind", () => {
    const ring = new FrameRing()
    ring.push(frame(1, 100))
    ring.push(frame(2, 100))

    const taken = ring.drain()

    expect(taken.map((item) => item.sequence)).toEqual([1, 2])
    expect(ring.length).toBe(0)
    expect(ring.bytes).toBe(0)
    expect(ring.drain()).toEqual([])
  })

  test("the frame cap evicts oldest first and counts what it lost", () => {
    const ring = new FrameRing({ maxFrames: 3 })
    for (let index = 1; index <= 5; index += 1) ring.push(frame(index, 10))

    expect(ring.peek().map((item) => item.sequence)).toEqual([3, 4, 5])
    expect(ring.stats().dropped).toBe(2)
  })

  test("the byte cap keeps the newest frame even when it alone is over budget", () => {
    const ring = new FrameRing({ maxBytes: 250 })
    ring.push(frame(1, 100))
    ring.push(frame(2, 100))
    ring.push(frame(3, 100))
    expect(ring.length).toBe(2)

    ring.push(frame(4, 500))
    expect(ring.length).toBe(1)
    expect(ring.peek()[0]!.sequence).toBe(4)
    expect(ring.bytes).toBe(500)
  })

  test("a frame older than the window never enters the ring", () => {
    const ring = new FrameRing({ maxAgeMs: 1_000 })
    const now = Date.now()

    ring.push(frame(1, 10, now - 5_000))
    ring.push(frame(2, 10, now - 500))

    expect(ring.peek().map((item) => item.sequence)).toEqual([2])
    expect(ring.stats().dropped).toBe(1)
  })

  test("an explicit prune clears a ring that has gone quiet", () => {
    const ring = new FrameRing({ maxAgeMs: 1_000 })
    const now = Date.now()

    ring.push(frame(1, 10, now))
    expect(ring.length).toBe(1)

    ring.prune(now + 1_500)
    expect(ring.length).toBe(0)
  })

  test("peek never takes ownership and clamps to what exists", () => {
    const ring = new FrameRing()
    ring.push(frame(1, 10))
    ring.push(frame(2, 10))

    expect(ring.peek(9).map((item) => item.sequence)).toEqual([1, 2])
    expect(ring.peek(0)).toEqual([])
    expect(ring.length).toBe(2)
  })

  test("defaults match the exported limits", () => {
    const ring = new FrameRing()
    for (let index = 0; index < FRAME_LIMITS.maxFrames + 5; index += 1) ring.push(frame(index, 1))

    expect(ring.length).toBe(FRAME_LIMITS.maxFrames)
  })
})
