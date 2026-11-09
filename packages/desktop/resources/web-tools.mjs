#!/usr/bin/env node
/**
 * Oliviacode web tools — a local MCP server the bundled engine launches at startup.
 *
 * ChatGPT gives its model a search/fetch pair and lets any MCP host add more; this is the same
 * shape, local, so the engine gains web research without a hosted service in the path. The
 * server names no endpoint of its own: the search backend arrives in `web-tools.json`, which is
 * a user file next to this script.
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdio. stdout carries protocol frames only;
 * diagnostics go to stderr, because one stray stdout write corrupts the stream.
 */

import { promises as dns } from "node:dns"
import { readFileSync } from "node:fs"
import { isIP } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]

/** Hard ceilings. A hostile or broken upstream must fail, not hang the engine's tool call. */
const LIMITS = {
  searchTimeoutMs: 15_000,
  fetchTimeoutMs: 20_000,
  maxResults: 10,
  maxBytes: 1_048_576,
  maxChars: 20_000,
  maxRedirects: 5,
  maxQueryChars: 400,
}

const DEFAULT_CONFIG = {
  search: { provider: "none", baseUrl: "", apiKey: "", maxResults: 8 },
  fetch: { maxBytes: LIMITS.maxBytes, maxChars: LIMITS.maxChars },
}

function log(message, detail) {
  process.stderr.write(`[web-tools] ${message}${detail ? ` ${JSON.stringify(detail)}` : ""}\n`)
}

function configPath() {
  if (process.env.OLIVIACODE_WEB_TOOLS_CONFIG) return process.env.OLIVIACODE_WEB_TOOLS_CONFIG
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "web-tools.json")
}

function loadConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"))
    const search = { ...DEFAULT_CONFIG.search, ...(parsed.search ?? {}) }
    const fetch = { ...DEFAULT_CONFIG.fetch, ...(parsed.fetch ?? {}) }

    return {
      search: {
        provider: typeof search.provider === "string" ? search.provider : "none",
        baseUrl: typeof search.baseUrl === "string" ? search.baseUrl.replace(/\/+$/, "") : "",
        apiKey: typeof search.apiKey === "string" ? search.apiKey : "",
        maxResults: clampInt(search.maxResults, 1, LIMITS.maxResults, 8),
      },
      fetch: {
        maxBytes: clampInt(fetch.maxBytes, 1_024, LIMITS.maxBytes, LIMITS.maxBytes),
        maxChars: clampInt(fetch.maxChars, 1_000, LIMITS.maxChars, LIMITS.maxChars),
      },
    }
  } catch (error) {
    log("config unreadable, web tools stay off", { path: configPath(), error: String(error) })
    return structuredClone(DEFAULT_CONFIG)
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

/* --------------------------------------------------------------------------------------------
 * Address guard
 *
 * `web_fetch` is reachable from a model, so it must not become a localhost/metadata proxy. Every
 * hostname is resolved and every answer checked; a name that resolves to more than one address is
 * refused if any of them is private, because the fetch would land on whichever one wins the race.
 * ------------------------------------------------------------------------------------------ */

const BLOCKED_V4 = [
  [/^0\./, "this network"],
  [/^10\./, "private"],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, "carrier-grade NAT"],
  [/^127\./, "loopback"],
  [/^169\.254\./, "link-local"],
  [/^172\.(1[6-9]|2\d|3[01])\./, "private"],
  [/^192\.168\./, "private"],
  [/^198\.1[89]\./, "benchmarking"],
  [/^22[4-9]\./, "multicast"],
  [/^2[3-5]\d\./, "multicast/reserved"],
]

function isBlockedV4(address) {
  return BLOCKED_V4.some(([pattern]) => pattern.test(address))
}

function isBlockedV6(address) {
  const lower = address.toLowerCase()

  if (lower === "::" || lower === "::1") return true
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true
  if (lower.startsWith("ff")) return true
  // IPv4-mapped (::ffff:127.0.0.1) and NAT64 (64:ff9b::/96) reach v4 space through a v6 literal.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedV4(mapped[1])
  if (lower.startsWith("64:ff9b::")) return true

  return false
}

async function assertPublicHost(hostname) {
  const literal = isIP(hostname)
  if (literal === 4) {
    if (isBlockedV4(hostname)) throw new Error(`Refusing ${hostname}: non-public address.`)
    return
  }
  if (literal === 6) {
    if (isBlockedV6(hostname)) throw new Error(`Refusing ${hostname}: non-public address.`)
    return
  }

  let answers
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error(`Cannot resolve ${hostname}.`)
  }
  if (answers.length === 0) throw new Error(`Cannot resolve ${hostname}.`)

  for (const { address, family } of answers) {
    const blocked = family === 6 ? isBlockedV6(address) : isBlockedV4(address)
    if (blocked) throw new Error(`Refusing ${hostname}: resolves to a non-public address (${address}).`)
  }
}

/* --------------------------------------------------------------------------------------------
 * HTML → text
 * ------------------------------------------------------------------------------------------ */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·",
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    const named = ENTITIES[body.toLowerCase()]
    return named ?? match
  })
}

function htmlToText(html) {
  const withoutHead = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")

  const block = withoutHead
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|ul|ol|dl)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")

  return decodeEntities(block.replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function titleOf(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]{1,300}?)<\/title>/i)
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : ""
}

/* --------------------------------------------------------------------------------------------
 * Fetch with redirects handled by hand, so every hop goes through the address guard
 * ------------------------------------------------------------------------------------------ */

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Response is ${declared} bytes; limit is ${maxBytes}.`)

  if (!response.body) return ""

  const reader = response.body.getReader()
  const chunks = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error(`Response exceeded ${maxBytes} bytes.`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
}

async function fetchDocument(rawUrl, limits) {
  let target = new URL(rawUrl)

  for (let hop = 0; hop <= LIMITS.maxRedirects; hop += 1) {
    if (target.protocol !== "https:" && target.protocol !== "http:")
      throw new Error(`Refusing ${target.protocol} URLs; only http and https are fetched.`)

    await assertPublicHost(target.hostname)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LIMITS.fetchTimeoutMs)

    try {
      const response = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Identify honestly; a site that blocks this is entitled to.
          "user-agent": "Oliviacode-WebTools/1.0 (+https://github.com/9562295450/Oliviacode)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
      })

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location")
        if (!location) throw new Error(`HTTP ${response.status} without a Location header.`)
        target = new URL(location, target)
        continue
      }

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
      const body = await readCapped(response, limits.maxBytes)
      const isHtml = contentType.includes("html") || (!contentType && /<\/?(html|body|div|p)\b/i.test(body))

      return {
        url: target.toString(),
        status: response.status,
        contentType: contentType || "unknown",
        title: isHtml ? titleOf(body) : "",
        text: isHtml ? htmlToText(body) : body.trim(),
        truncated: false,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(`More than ${LIMITS.maxRedirects} redirects.`)
}

/* --------------------------------------------------------------------------------------------
 * Search adapters. Each one names a response shape, not a vendor URL: baseUrl is config.
 * ------------------------------------------------------------------------------------------ */

function requireBaseUrl(search) {
  if (!search.baseUrl) throw new Error(`web-tools.json sets search.provider to "${search.provider}" but has no search.baseUrl.`)
  let parsed
  try {
    parsed = new URL(search.baseUrl)
  } catch {
    throw new Error(`search.baseUrl is not a URL: ${search.baseUrl}`)
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("search.baseUrl must be http(s).")
  return parsed
}

async function requestJson(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIMITS.searchTimeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`Search backend returned HTTP ${response.status}.`)
    const text = await readCapped(response, LIMITS.maxBytes)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

function normaliseResults(rows, limit) {
  return rows
    .map((row) => ({
      title: String(row.title ?? row.name ?? "").trim().slice(0, 300),
      url: String(row.url ?? row.link ?? "").trim(),
      snippet: String(row.content ?? row.description ?? row.snippet ?? row.text ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    }))
    .filter((row) => row.url)
    .slice(0, limit)
}

const ADAPTERS = {
  async searxng(search, query, limit) {
    const base = requireBaseUrl(search)
    const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}/search`)
    url.searchParams.set("q", query)
    url.searchParams.set("format", "json")
    const body = await requestJson(url, { headers: { accept: "application/json" } })
    return normaliseResults(body.results ?? [], limit)
  },

  async brave(search, query, limit) {
    const base = requireBaseUrl(search)
    const url = new URL(`${base.origin}/res/v1/web/search`)
    url.searchParams.set("q", query)
    url.searchParams.set("count", String(limit))
    const body = await requestJson(url, {
      headers: { accept: "application/json", "x-subscription-token": search.apiKey },
    })
    return normaliseResults(body.web?.results ?? [], limit)
  },

  async tavily(search, query, limit) {
    const base = requireBaseUrl(search)
    const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "") || ""}/search`)
    const body = await requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, max_results: limit, api_key: search.apiKey }),
    })
    return normaliseResults(body.results ?? [], limit)
  },

  async exa(search, query, limit) {
    const base = requireBaseUrl(search)
    const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "") || ""}/search`)
    const body = await requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-api-key": search.apiKey },
      body: JSON.stringify({ query, numResults: limit, contents: { text: { maxCharacters: 600 } } }),
    })
    return normaliseResults(body.results ?? [], limit)
  },
}

/* --------------------------------------------------------------------------------------------
 * Tools
 * ------------------------------------------------------------------------------------------ */

const TOOLS = [
  {
    name: "web_search",
    title: "Search the web",
    description:
      "Search the open web and return ranked results with title, URL and snippet. Use it first for anything current; follow up with web_fetch on the URLs worth reading.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: LIMITS.maxQueryChars, description: "Search terms." },
        count: { type: "integer", minimum: 1, maximum: LIMITS.maxResults, description: "Results to return. Default 8." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "web_fetch",
    title: "Fetch a page",
    description:
      "Fetch one http(s) page and return its readable text with the title and final URL. Private, loopback and link-local addresses are refused. Long pages are capped.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 1, maxLength: 2048, description: "Absolute http(s) URL." },
        maxChars: { type: "integer", minimum: 500, maximum: LIMITS.maxChars, description: "Characters of text to return." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
]

function textResult(text) {
  return { content: [{ type: "text", text }] }
}

function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true }
}

async function callTool(name, args) {
  const config = loadConfig()

  if (name === "web_search") {
    const query = typeof args.query === "string" ? args.query.trim() : ""
    if (!query) return errorResult("web_search needs a query.")
    if (query.length > LIMITS.maxQueryChars) return errorResult(`Query longer than ${LIMITS.maxQueryChars} characters.`)

    const provider = config.search.provider
    const adapter = ADAPTERS[provider]
    if (!adapter)
      return errorResult(
        provider === "none"
          ? "Web search is not configured. Fill in search.provider and search.baseUrl in web-tools.json, then restart the app."
          : `Unknown search.provider "${provider}". Supported: ${Object.keys(ADAPTERS).join(", ")}.`,
      )

    const limit = clampInt(args.count, 1, LIMITS.maxResults, config.search.maxResults)

    try {
      const results = await adapter(config.search, query, limit)
      if (results.length === 0) return textResult(`No results for "${query}".`)
      const body = results
        .map((row, index) => `${index + 1}. ${row.title || row.url}\n   ${row.url}\n   ${row.snippet}`)
        .join("\n\n")
      return textResult(`${results.length} result${results.length === 1 ? "" : "s"} for "${query}" via ${provider}:\n\n${body}`)
    } catch (error) {
      return errorResult(`Search failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (name === "web_fetch") {
    const url = typeof args.url === "string" ? args.url.trim() : ""
    if (!url) return errorResult("web_fetch needs a url.")
    if (url.length > 2048) return errorResult("URL longer than 2048 characters.")

    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return errorResult(`Not an absolute URL: ${url}`)
    }

    try {
      const page = await fetchDocument(parsed.toString(), config.fetch)
      const limit = clampInt(args.maxChars, 500, config.fetch.maxChars, config.fetch.maxChars)
      const text = page.text.length > limit ? `${page.text.slice(0, limit)}\n\n[truncated at ${limit} characters]` : page.text

      const header = [`# ${page.title || "(untitled)"}`, page.url, `${page.contentType} · ${page.status}`].join("\n")
      return textResult(`${header}\n\n${text || "(no readable text)"}`)
    } catch (error) {
      return errorResult(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return errorResult(`Unknown tool: ${name}`)
}

/* --------------------------------------------------------------------------------------------
 * JSON-RPC over stdio
 * ------------------------------------------------------------------------------------------ */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

async function handle(message) {
  const { id, method, params } = message
  const isRequest = id !== undefined && id !== null

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "oliviacode-web-tools", version: "1.0.0" },
        instructions:
          "Search and read the open web. Call web_search first, then web_fetch on the two or three best URLs. Quote the URL you relied on.",
      })
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return

    case "ping":
      return reply(id, {})

    case "tools/list":
      return reply(id, { tools: TOOLS })

    case "tools/call": {
      const name = params?.name
      const args = params?.arguments ?? {}
      if (typeof name !== "string") return fail(id, -32602, "tools/call needs a name.")
      const result = await callTool(name, args)
      return reply(id, result)
    }

    default:
      if (isRequest) return fail(id, -32601, `Method not found: ${method}`)
  }
}

let buffer = ""

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk

  let newline
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue

    let message
    try {
      message = JSON.parse(line)
    } catch {
      fail(null, -32700, "Parse error.")
      continue
    }

    Promise.resolve()
      .then(() => handle(message))
      .catch((error) => {
        log("handler threw", { error: String(error) })
        if (message?.id !== undefined) fail(message.id, -32603, "Internal error.")
      })
  }
})

process.stdin.on("end", () => process.exit(0))
process.on("SIGTERM", () => process.exit(0))
log("ready", { config: configPath() })
