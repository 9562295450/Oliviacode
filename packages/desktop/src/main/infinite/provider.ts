/**
 * The provider check.
 *
 * A new exit address is only worth keeping if the provider that refused the last
 * request accepts the next one from it. This module asks exactly that question with the
 * smallest request the free lane allows: one token, no stream, through the lane's own
 * proxy. The answer is one of three: the address works, the address is still limited, or
 * the probe could not tell — and only the middle answer costs the address.
 */
import { run } from "./exec"

/** What one probe of the provider concluded about the address it left from. */
export type ProviderStatus = "ok" | "limited" | "unknown"

export type ProviderVerdict = {
  readonly status: ProviderStatus
  readonly ip: string
  readonly model: string
  /** The HTTP status the provider answered, or 0 when the request never landed. */
  readonly code: number
  readonly at: number
  /** The provider's own words when it refused; empty when it accepted. */
  readonly detail: string
}

/** Probe target — empty means no provider is configured and verification is skipped. */
export type ProviderConfig = {
  readonly endpoint: string
  readonly key: string
  readonly model: string
}

/** A configured probe; empty strings mean the provider lane is off. */
export type ProviderOptions = {
  readonly timeoutMs: number
  readonly model: string
  readonly key: string
}

const AGENT = "oliviacode/1.0 (+egress provider probe)"
/** One token is enough to be told a limit applies. */
const MAX_TOKENS = 1
/** A body longer than this is truncated; only the error type at the front matters. */
const MAX_BODY = 4_000

/**
 * Wording that means this address is refused rather than the request being wrong.
 *
 * The typed error names come first: the free lane answers 429 with
 * `FreeUsageLimitError`, and the Go and workspace caps travel the same way. The prose
 * patterns catch gateways that flatten the body.
 */
const LIMITED_PATTERNS: readonly RegExp[] = [
  /FreeUsageLimitError/i,
  /GoUsageLimitError/i,
  /BudgetLimitError/i,
  /free usage limit/i,
  /usage limit/i,
  /rate[ _-]?limit(?:ed)?/i,
  /too many requests/i,
]

/**
 * Read an answer as a verdict.
 *
 * Order matters: a 429 with `FreeUsageLimitError` is limited, a 429 with nothing is
 * still limited, and a 200 that is not a completion (a captive portal, a challenge page)
 * is unknown — accepting it would spend a rotation on an address that cannot serve a
 * request, and scrapping it would throw away an address that might be fine.
 */
export function parseProviderVerdict(input: {
  readonly status: number
  readonly body: string
  readonly ip: string
  readonly model: string
  readonly at?: number
}): ProviderVerdict {
  const at = input.at ?? Date.now()
  const body = input.body.slice(0, MAX_BODY)
  const detail = firstLine(body)
  const accepted = input.status >= 200 && input.status < 300

  // Only a refusal can name a limit. A 200 completion is one token of the model's output,
  // and that output may itself contain the words "usage limit" — reading it as a refusal
  // would scrap an address the provider just served.
  if (!accepted && LIMITED_PATTERNS.some((pattern) => pattern.test(body))) {
    return { status: "limited", ip: input.ip, model: input.model, code: input.status, at, detail }
  }

  if (input.status === 429) {
    return { status: "limited", ip: input.ip, model: input.model, code: input.status, at, detail: detail || "429" }
  }

  if (accepted) {
    // A completion carries `choices` on chat routes and `output` on responses routes.
    if (/"choices"|"output"|"id"\s*:/.test(body)) {
      return { status: "ok", ip: input.ip, model: input.model, code: input.status, at, detail: "" }
    }
    return { status: "unknown", ip: input.ip, model: input.model, code: input.status, at, detail: "unexpected body" }
  }

  if (input.status === 401 || input.status === 403) {
    return {
      status: "unknown",
      ip: input.ip,
      model: input.model,
      code: input.status,
      at,
      detail: `provider rejected the probe credentials (${input.status})`,
    }
  }

  return {
    status: "unknown",
    ip: input.ip,
    model: input.model,
    code: input.status,
    at,
    detail: input.status === 0 ? detail || "request did not land" : `HTTP ${input.status}: ${detail}`,
  }
}

function firstLine(body: string) {
  return body.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 200) ?? ""
}

function payload(model: string) {
  return JSON.stringify({
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: MAX_TOKENS,
    stream: false,
  })
}

/**
 * Ask the provider whether this address may use it.
 *
 * `config.endpoint` is the provider URL and `options.proxy` is the lane's local proxy — two
 * different things that both look like a URL. The lane goes in `--proxy` and the provider goes
 * in the request line; swapping them makes every probe dial the provider as a proxy and answer
 * `unknown`, which is the same as having no check at all.
 *
 * Never rejects: a probe that cannot answer is a verdict of `unknown`, not an exception the
 * rotation loop has to catch.
 */
export async function providerProbe(
  config: ProviderConfig,
  ip: string,
  options: { readonly timeoutMs: number; readonly model: string; readonly key: string; readonly proxy?: string },
): Promise<ProviderVerdict> {
  const model = options.model || config.model || ""
  const body = payload(model)
  // A generation is slower than a trace fetch; the probe gets twice the lane's budget so a
  // healthy Tor circuit is not called broken for being Tor.
  const timeoutMs = Math.min(30_000, Math.max(5_000, options.timeoutMs * 2))

  const answer = options.proxy
    ? await postViaCurl(options.proxy, config.endpoint, body, options.key || config.key, timeoutMs)
    : await postDirect(config.endpoint, body, options.key || config.key, timeoutMs)

  return parseProviderVerdict({ status: answer.status, body: answer.body, ip, model })
}

type Answer = { readonly status: number; readonly body: string }

/**
 * curl is the one HTTP client that speaks both HTTP and SOCKS proxies without a
 * dispatcher, and it is what the trace probe already uses on a lane.
 */
async function postViaCurl(proxy: string, endpoint: string, body: string, key: string, timeoutMs: number): Promise<Answer> {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  const result = await run(
    process.platform === "win32" ? "curl.exe" : "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      String(seconds),
      // An empty no-proxy list keeps loopback out of the bypass, so the lane is used.
      "--noproxy",
      "",
      "--proxy",
      proxy,
      "--request",
      "POST",
      "--header",
      "content-type: application/json",
      "--header",
      `authorization: Bearer ${key || ""}`,
      "--header",
      "accept: application/json",
      "--header",
      `user-agent: ${AGENT}`,
      "--data-raw",
      body,
      // The status is appended after a newline the body cannot fake at the end.
      "--write-out",
      "\n%{http_code}",
      endpoint,
    ],
    { timeoutMs: timeoutMs + 2_000 },
  )

  if (result.code !== 0) {
    return {
      status: 0,
      body: result.timedOut ? `timed out after ${seconds}s` : result.stderr.trim() || `curl exit ${result.code}`,
    }
  }
  return splitStatus(result.stdout)
}

async function postDirect(endpoint: string, body: string, key: string, timeoutMs: number): Promise<Answer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key || ""}`,
        accept: "application/json",
        "user-agent": AGENT,
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    })
    return { status: response.status, body: (await response.text()).slice(0, MAX_BODY) }
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** Separate the body from the status curl appended after the final newline. */
export function splitStatus(stdout: string): Answer {
  const index = stdout.lastIndexOf("\n")
  if (index < 0) return { status: 0, body: stdout }
  const status = Number(stdout.slice(index + 1).trim())
  return {
    status: Number.isFinite(status) ? status : 0,
    body: stdout.slice(0, index).slice(0, MAX_BODY),
  }
}
