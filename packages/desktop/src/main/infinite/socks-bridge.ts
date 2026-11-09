/**
 * A local HTTP proxy in front of a SOCKS5 endpoint.
 *
 * The bundled CLI talks HTTP(S) through `HTTP_PROXY` and has no SOCKS support, while Tor
 * only offers SOCKS. This sits in between: it accepts an HTTP proxy request, opens the
 * SOCKS5 connection itself, and pipes bytes. `CONNECT` becomes a raw tunnel; an absolute
 * URI request is forwarded with the headers rewritten.
 *
 * Bound to loopback only, and closed by `stop()` so a lane switch leaves no listener.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { connect as netConnect, type Socket } from "node:net"
import type { Duplex } from "node:stream"

export type BridgeOptions = {
  readonly socksHost: string
  readonly socksPort: number
  readonly port: number
  /** Deadline for the SOCKS handshake and the upstream connect together. */
  readonly connectTimeoutMs?: number
}

export type Bridge = {
  readonly port: number
  readonly url: string
  stop(): Promise<void>
}

/** The SOCKS5 reply codes, named so a failure log says what the far end said. */
const SOCKS_ERRORS: Record<number, string> = {
  1: "general SOCKS server failure",
  2: "connection not allowed by ruleset",
  3: "network unreachable",
  4: "host unreachable",
  5: "connection refused",
  6: "TTL expired",
  7: "command not supported",
  8: "address type not supported",
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const timeoutMs = options.connectTimeoutMs ?? 20_000
  const sockets = new Set<Duplex>()

  const track = (socket: Duplex) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => sockets.delete(socket))
    return socket
  }

  const server: Server = createServer((request, response) => {
    handle(request, response, options, timeoutMs, track).catch(() => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
  })

  // A CONNECT that reaches the server without a listener would hang the client.
  server.on("connect", (request, clientSocket, head) => {
    track(clientSocket)
    clientSocket.on("error", () => clientSocket.destroy())

    openSocks(options.socksHost, options.socksPort, request.url ?? "", timeoutMs)
      .then((upstream) => {
        track(upstream)
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length > 0) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
        upstream.on("close", () => clientSocket.destroy())
        clientSocket.on("close", () => upstream.destroy())
      })
      .catch(() => {
        if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
      })
  })

  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  // `port: 0` asks the OS for a free port; report the one it bound, not the request.
  const bound = server.address()
  const port = typeof bound === "object" && bound !== null ? bound.port : options.port

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: BridgeOptions,
  timeoutMs: number,
  track: (socket: Duplex) => Duplex,
) {
  // `request.url` is absolute for a proxy request and a bare path for a direct one.
  const target = request.url ?? ""
  const url = URL.canParse(target) ? new URL(target) : null

  if (!url) {
    response.writeHead(400, { "content-type": "text/plain" })
    response.end("expected an absolute-form request URI")
    return
  }

  const authority = `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`
  const upstream = track(await openSocks(options.socksHost, options.socksPort, authority, timeoutMs))

  const headers: string[] = [`${request.method ?? "GET"} ${url.pathname}${url.search} HTTP/1.1`]
  for (const [name, value] of Object.entries(request.headers)) {
    // Hop-by-hop headers belong to the client connection, not the forwarded request.
    if (name === "proxy-connection" || name === "connection" || name === "host") continue
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.push(`${name}: ${item}`)
  }
  headers.push(`host: ${url.host}`)
  headers.push("connection: close")

  upstream.write(headers.join("\r\n") + "\r\n\r\n")
  request.pipe(upstream)
  upstream.pipe(response)

  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502)
    response.end()
  })
  response.on("close", () => upstream.destroy())
}

/** Open a SOCKS5 tunnel to `authority` (`host:port`) and hand back the raw socket. */
function openSocks(host: string, port: number, authority: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const parsed = splitAuthority(authority)
    if (!parsed) {
      reject(new Error(`unusable target: ${authority}`))
      return
    }

    const socket = netConnect({ host, port })
    socket.setNoDelay(true)

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("SOCKS handshake timed out"))
    }, timeoutMs)

    const fail = (error: Error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    }

    // Greeting: version 5, one method, "no authentication".
    socket.once("connect", () => socket.write(Buffer.from([0x05, 0x01, 0x00])))

    let stage: "greeting" | "reply" = "greeting"
    let buffered = Buffer.alloc(0)

    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])

      if (stage === "greeting") {
        if (buffered.length < 2) return
        if (buffered[0] !== 0x05) return fail(new Error("not a SOCKS5 server"))
        if (buffered[1] !== 0x00) return fail(new Error("SOCKS5 server requires authentication"))
        buffered = buffered.subarray(2)
        stage = "reply"
        socket.write(connectRequest(parsed.host, parsed.port))
      }

      if (stage !== "reply") return
      if (buffered.length < 4) return

      const reply = buffered[1] ?? 0xff
      if (reply !== 0x00) {
        return fail(new Error(SOCKS_ERRORS[reply] ?? `SOCKS5 reply ${reply}`))
      }

      // Consume the bound address before the socket is handed over as a raw tunnel.
      const addressType = buffered[3]
      const addressLength = addressType === 0x01 ? 4 : addressType === 0x04 ? 16 : (buffered[4] ?? 0) + 1
      const total = 4 + addressLength + 2
      if (buffered.length < total) return

      clearTimeout(timer)
      socket.off("data", onData)
      const rest = buffered.subarray(total)
      socket.pause()
      if (rest.length > 0) socket.unshift(rest)
      resolve(socket)
    }

    socket.on("data", onData)
    socket.once("error", fail)
  })
}

function connectRequest(host: string, port: number) {
  const portBytes = Buffer.from([(port >> 8) & 0xff, port & 0xff])

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const octets = Buffer.from(host.split(".").map((part) => Number(part)))
    return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), octets, portBytes])
  }

  // A hostname is sent as a domain so the SOCKS server resolves it — which for Tor
  // means the lookup happens at the exit, never on this machine.
  const name = Buffer.from(host, "utf8")
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, portBytes])
}

function splitAuthority(authority: string): { host: string; port: number } | null {
  const index = authority.lastIndexOf(":")
  if (index <= 0) return null
  const host = authority.slice(0, index).replace(/^\[|\]$/g, "")
  const port = Number(authority.slice(index + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  return { host, port }
}
