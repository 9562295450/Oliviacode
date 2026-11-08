/**
 * The free-proxy lane.
 *
 * A scraped list is mostly dead addresses and a few that work for a minute. Instead of
 * taking the next line in the file, every address carries a score: a success promotes it,
 * a failure demotes it and parks it for a while. Selection takes the highest score that
 * is not parked, so a good address keeps being used until it dies.
 */
import { probe, type Trace } from "./trace"

const SOURCES = [
  "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=protocolipport&format=text",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
]

/** Dead proxies are parked this long, doubling per consecutive failure up to the cap. */
const PARK_BASE_MS = 60_000
const PARK_MAX_MS = 30 * 60_000
/** Addresses beyond this are dropped; a list that returns thousands is mostly noise. */
const POOL_LIMIT = 400

export type ProxyEntry = {
  readonly url: string
  score: number
  failures: number
  parkedUntil: number
  lastSeen: number
}

export class ProxyPool {
  #entries = new Map<string, ProxyEntry>()
  #loadedAt = 0
  #loading: Promise<string> | null = null

  get size() {
    return this.#entries.size
  }

  get updatedAt() {
    return this.#loadedAt
  }

  /** Refresh the list from every source. Cached for five minutes. */
  async refresh(force = false): Promise<string> {
    if (!force && this.#entries.size > 0 && Date.now() - this.#loadedAt < 5 * 60_000) return ""
    if (this.#loading) return this.#loading

    this.#loading = this.#load()
    const result = await this.#loading
    this.#loading = null
    return result
  }

  async #load(): Promise<string> {
    const found = new Set<string>()

    await Promise.all(
      SOURCES.map(async (source) => {
        try {
          const response = await fetch(source, {
            signal: AbortSignal.timeout(20_000),
            headers: { "user-agent": "oliviacode/1.0 (+egress pool)" },
          })
          if (!response.ok) return
          for (const line of (await response.text()).split(/\r?\n/)) {
            const url = normalize(line)
            if (url) found.add(url)
            if (found.size >= POOL_LIMIT) break
          }
        } catch {
          // A dead source is not a failure: the other two still carry the pool.
        }
      }),
    )

    if (found.size === 0) return this.#entries.size > 0 ? "" : "every proxy source was empty"

    for (const url of found) {
      if (!this.#entries.has(url)) {
        this.#entries.set(url, { url, score: 0, failures: 0, parkedUntil: 0, lastSeen: Date.now() })
      }
    }
    this.#loadedAt = Date.now()
    return ""
  }

  /** The best unparked address, or null when every one is parked. */
  pick(exclude: readonly string[] = []): ProxyEntry | null {
    const now = Date.now()
    const blocked = new Set(exclude)
    let best: ProxyEntry | null = null

    for (const entry of this.#entries.values()) {
      if (entry.parkedUntil > now) continue
      if (blocked.has(entry.url)) continue
      if (!best || entry.score > best.score) best = entry
    }
    return best
  }

  get(url: string) {
    return this.#entries.get(url) ?? null
  }

  succeeded(url: string) {
    const entry = this.#entries.get(url)
    if (!entry) return
    entry.score = Math.min(20, entry.score + 2)
    entry.failures = 0
    entry.parkedUntil = 0
  }

  failed(url: string) {
    const entry = this.#entries.get(url)
    if (!entry) return
    entry.failures += 1
    entry.score = Math.max(-20, entry.score - 3)
    entry.parkedUntil = Date.now() + Math.min(PARK_MAX_MS, PARK_BASE_MS * 2 ** (entry.failures - 1))
  }

  /**
   * Walk the pool until an address answers the trace, returning the first that does.
   * `tries` bounds the walk so a fully dead list costs a known amount of time.
   */
  async findWorking(
    tries: number,
    timeoutMs: number,
    onAttempt?: (url: string, index: number) => void,
  ): Promise<{ entry: ProxyEntry; trace: Trace } | { entry: null }> {
    const skipped: string[] = []

    for (let attempt = 0; attempt < tries; attempt += 1) {
      const entry = this.pick(skipped)
      if (!entry) return { entry: null }
      skipped.push(entry.url)
      onAttempt?.(entry.url, attempt)

      const result = await probe(entry.url, timeoutMs)
      if (result.ok) {
        this.succeeded(entry.url)
        return { entry, trace: result.trace }
      }
      this.failed(entry.url)
    }

    return { entry: null }
  }

  /** A snapshot for the panel: the best few, newest first. */
  top(limit: number) {
    return [...this.#entries.values()]
      .toSorted((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => ({ url: entry.url, score: entry.score, failures: entry.failures, parked: entry.parkedUntil > Date.now() }))
  }
}

/**
 * Accept the several shapes a list uses — `1.2.3.4:8080`, `http://1.2.3.4:8080`,
 * `1.2.3.4:8080/` — and emit one canonical HTTP proxy URL.
 */
export function normalize(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  const match = /^(?:https?:\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\/?$/.exec(trimmed)
  if (!match) return null

  const host = match[1]
  const port = Number(match[2])
  if (!host || port < 1 || port > 65_535) return null

  for (const octet of host.split(".")) {
    if (Number(octet) > 255) return null
  }
  // A private or loopback address in a public list is a misconfiguration, not an exit.
  if (/^(?:10\.|127\.|0\.|169\.254\.|192\.168\.)/.test(host)) return null
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null

  return `http://${host}:${port}`
}
