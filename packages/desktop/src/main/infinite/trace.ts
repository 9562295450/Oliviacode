/**
 * Who the far end sees. Every rotation ends here: a probe that names the exit address,
 * or a probe that fails and says why. Nothing else in the engine is allowed to guess
 * whether an address changed.
 */
import { run } from "./exec"

export type Trace = {
  readonly ip: string
  readonly loc: string
  readonly colo: string
  readonly warp: string
  readonly at: number
}

export type ProbeOutcome =
  | { readonly ok: true; readonly trace: Trace; readonly latencyMs: number }
  | { readonly ok: false; readonly error: string; readonly latencyMs: number }

/**
 * Cloudflare's trace is the primary. The other two exist because a lane can be healthy and
 * still fail one of them: Tor exits are routinely blocked by `ip-api` (it rate-limits shared
 * addresses), and some proxies answer Cloudflare with a challenge page. A probe that only
 * knows one URL calls a working lane broken.
 */
const TRACE_URLS = [
  "https://www.cloudflare.com/cdn-cgi/trace",
  "https://api.ipify.org?format=json",
  "http://ip-api.com/json/?fields=status,countryCode,query",
]

/** Node itself, for the direct lane: no proxy, no curl, no dependency. */
async function fetchTrace(url: string, timeoutMs: number, proxy: string): Promise<string> {
  if (proxy) return fetchViaCurl(url, timeoutMs, proxy)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "oliviacode/1.0 (+egress probe)", accept: "*/*" },
      // A proxy would defeat the whole point of a direct probe.
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * curl is the one HTTP client guaranteed present on Windows 10+ and it speaks both
 * HTTP and SOCKS proxies without a dispatcher, which is why a proxy lane probes here.
 */
async function fetchViaCurl(url: string, timeoutMs: number, proxy: string): Promise<string> {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  const result = await run(
    process.platform === "win32" ? "curl.exe" : "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--location",
      "--max-time",
      String(seconds),
      "--noproxy",
      "",
      "--proxy",
      proxy,
      "--user-agent",
      "oliviacode/1.0 (+egress probe)",
      url,
    ],
    { timeoutMs: timeoutMs + 2_000 },
  )

  if (result.code !== 0) {
    const reason = result.timedOut ? "timed out" : result.stderr.trim() || `curl exit ${result.code}`
    throw new Error(reason)
  }
  return result.stdout
}

/** Parse either trace format into the one shape the engine uses. */
export function parseTrace(body: string, now = Date.now()): Trace | null {
  const text = body.trim()

  if (text.startsWith("{")) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      if (json.status && json.status !== "success") return null
      // `ip-api` names the address `query`, `ipify` names it `ip`; both are the same fact.
      const ip = typeof json.query === "string" ? json.query : typeof json.ip === "string" ? json.ip : ""
      if (!ip) return null
      const country = json.countryCode ?? json.country_code ?? json.country
      return {
        ip,
        loc: typeof country === "string" ? country : "",
        colo: "",
        warp: "unknown",
        at: now,
      }
    } catch {
      return null
    }
  }

  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=")
    if (index <= 0) continue
    fields.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }

  const ip = fields.get("ip") ?? ""
  if (!ip) return null

  return {
    ip,
    loc: fields.get("loc") ?? "",
    colo: fields.get("colo") ?? "",
    warp: fields.get("warp") ?? "unknown",
    at: now,
  }
}

/** Probe one endpoint through one proxy. `proxy` is empty for a direct route. */
export async function probe(proxy: string, timeoutMs: number): Promise<ProbeOutcome> {
  const started = Date.now()
  let lastError = "no trace endpoint answered"

  for (const url of TRACE_URLS) {
    try {
      const body = await fetchTrace(url, timeoutMs, proxy)
      const trace = parseTrace(body)
      if (trace) return { ok: true, trace, latencyMs: Date.now() - started }
      lastError = "trace body had no address"
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return { ok: false, error: lastError, latencyMs: Date.now() - started }
}
