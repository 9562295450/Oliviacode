/**
 * Live smoke for the error copy on the path a user actually reads.
 *
 * Runs the real request executor against two endpoints it cannot read: a closed port, and a server
 * that answers with Google's array-wrapped 503. Both shapes reached users in 2.2.14, one as a bare
 * `ECONNREFUSED` and the other as the raw payload. The smoke fails if either shape comes back
 * without an address or with JSON in the message.
 *
 *   bun packages/ai/test/error-copy.smoke.ts
 */
import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient, HttpClientRequest } from "effect/http"
import { RequestExecutorService } from "../src/route/executor-service.js"
import * as Executor from "../src/route/executor.js"
import { AIError } from "../src/schema/index.js"

const call = (url: string) =>
  Effect.gen(function* () {
    const executor = yield* RequestExecutorService
    const request = HttpClientRequest.post(url).pipe(HttpClientRequest.bodyText("{}", "application/json"))

    return yield* Executor.stream(executor, request).pipe(Stream.runDrain, Effect.flip)
  }).pipe(Effect.provide(Executor.layer.pipe(Layer.provide(FetchHttpClient.layer))))

const failures: string[] = []

const check = (name: string, condition: boolean, detail: string) => {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}`)
  if (!condition) failures.push(`${name}: ${detail}`)
}

const messageOf = (cause: unknown) => (cause instanceof AIError ? cause.message : String(cause))

const refusedMessage = messageOf(await Effect.runPromise(call("http://127.0.0.1:9/v1/chat/completions")))

check("refused connect names the dialled address", refusedMessage.includes("127.0.0.1:9"), refusedMessage)
check("refused connect does not leak a payload", !refusedMessage.includes('{"'), refusedMessage)

const busyBody = JSON.stringify([
  {
    error: {
      code: 503,
      message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
      status: "UNAVAILABLE",
    },
  },
])

const server = Bun.serve({
  port: 0,
  fetch: () => new Response(busyBody, { status: 503, headers: { "content-type": "application/json" } }),
})

const busyMessage = messageOf(await Effect.runPromise(call(`http://127.0.0.1:${server.port}/v1/chat/completions`)))
server.stop(true)

check(
  "array-wrapped error body reads as the provider's sentence",
  busyMessage === "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
  busyMessage,
)
check("array-wrapped error body does not leak a payload", !busyMessage.includes('{"'), busyMessage)

if (failures.length > 0) {
  console.error(`\n${failures.length} error-copy check(s) failed`)
  process.exit(1)
}

console.log("\nerror copy is safe to ship")
