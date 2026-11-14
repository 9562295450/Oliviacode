export * as SessionTitle from "./title.js"

import { isDeepStrictEqual } from "node:util"
import { LLMClient, LLMEvent, Message, SystemPart } from "@opencode/ai/effect"
import type { Agent } from "@opencode/schema/agent"
import { Context, DateTime, Effect, Layer, Schema, Stream } from "effect"
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm"
import { Database } from "../database/database.js"
import { Bus } from "../bus.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { isExactRootFallback } from "@opencode/util/session-title-fallback"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionHistory } from "./history.js"
import type { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionUsage } from "./usage.js"
import { SessionStore } from "./store.js"
import { SessionMessageTable, SessionTable } from "./sql.js"

const MAX_LENGTH = 100
const MAX_PROVISIONAL_LENGTH = 60
const MAX_CONTEXT_LENGTH = 8_000
const MAX_FIRST_MESSAGE_LENGTH = 2_000
/**
 * How many untitled sessions one backfill pass will name.
 *
 * The pass costs one indexed read per session and no model calls, so the ceiling only exists
 * to keep a first launch after an import from doing unbounded work before the window paints.
 */
const BACKFILL_LIMIT = 500
/**
 * How far into a session the backfill reads looking for a usable name.
 *
 * A first message is often a greeting, and a list of rows all reading "hi" is no better than a
 * list of rows all reading "Untitled session". The pass takes the first message that carries
 * enough text to identify the work, and falls back to the first message when none does.
 */
const BACKFILL_PROBE = 10
const BACKFILL_MIN_CHARS = 12
const titleChanged = Symbol("Session title changed")

/**
 * A session should have a name as soon as it has a message, not when a model gets around to
 * naming it. This is the first line of the prompt, collapsed and clipped, and it is replaced by
 * the generated title when that lands.
 */
export function provisionalTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim()
  if (!line) return undefined

  return line.length <= MAX_PROVISIONAL_LENGTH
    ? line
    : `${line.slice(0, MAX_PROVISIONAL_LENGTH - 3).trimEnd()}...`
}

export interface Interface {
  /** Generates an initial title or regenerates one from bounded conversation history. */
  readonly generate: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /**
   * Names every session that still has no title from its own first user message.
   *
   * Costs no model call: the name is the provisional title, which is the first line of the
   * prompt, collapsed and clipped. A session that has never been prompted is left alone.
   */
  readonly backfill: Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTitle") {}

const truncate = (value: string) => (value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 3)}...`)
// Framing the input as text to name keeps models from answering or carrying out the request instead.
const messagePrompt = (text: string) =>
  `Here is the first message of the conversation:\n\n<message>\n${text}\n</message>\n\nReply with only the title.`
const conversationPrompt = (text: string) =>
  `Here is the conversation so far:\n\n<conversation>\n${text}\n</conversation>\n\nReply with only the title.`
export const isUntitled = (session: SessionSchema.Info) =>
  isExactRootFallback({
    title: session.title,
    time: { created: DateTime.toEpochMillis(session.time.created) },
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const context = yield* SessionContext.Service
    const store = yield* SessionStore.Service
    const db = (yield* Database.Service).db

    const attempt = Effect.fn("SessionTitle.attempt")(function* (input: {
      readonly session: SessionSchema.Info
      readonly agent: Agent.Info
      readonly text: string
      readonly model: SessionRunnerModel.Resolved
    }) {
      const chunks: string[] = []
      let failed = false
      let usage: SessionUsage.Recorded | undefined
      const recordUsage = Effect.suspend(() =>
        usage
          ? bus.publish(SessionEvent.UsageRecorded, {
              sessionID: input.session.id,
              source: "title",
              ...usage,
            })
          : Effect.void,
      )
      const prepared = yield* context.request.title({
        session: input.session,
        agent: input.agent.id,
        model: input.model,
        system: input.agent.system ? [SystemPart.make(input.agent.system)] : [],
        messages: [Message.user(input.text)],
      })
      if (prepared.event.result !== undefined) return prepared.event.result
      yield* llm.stream(prepared.request, prepared.options).pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          if (LLMEvent.is.stepFinish(event)) {
            const step = SessionUsage.record(event.usage, input.model.cost)
            usage = usage ? SessionUsage.add(usage, step) : step
          }
          return Effect.void
        }),
        Effect.catchTag("AI.Error", () =>
          Effect.sync(() => {
            failed = true
          }),
        ),
        Effect.onInterrupt(() => recordUsage.pipe(Effect.asVoid)),
      )
      yield* recordUsage
      if (failed) return
      return chunks
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
    })

    const generate = Effect.fn("SessionTitle.generate")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return
      const firstUser = yield* SessionHistory.firstUserMessage(db, session.id)
      if (!firstUser) return

      // Name the session before the model call, so a missing title agent, an unreachable provider
      // or a slow model still leaves a list of sessions a person can tell apart.
      const provisional = isUntitled(session) ? provisionalTitle(firstUser.text) : undefined
      if (provisional) {
        yield* bus.publish(SessionEvent.Renamed, { sessionID: session.id, title: provisional })
      }

      const text = !isUntitled(session)
        ? yield* store.context(session.id).pipe(
            Effect.map((messages) => {
              const original = `Original request:\n${firstUser.text.slice(0, MAX_FIRST_MESSAGE_LENGTH)}`
              const recent = messages
                .flatMap((message) => {
                  if (message.type === "user" && message.id !== firstUser.id) return [`User: ${message.text.trim()}`]
                  if (message.type !== "assistant") return []
                  const text = message.content
                    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
                    .filter(Boolean)
                    .join("\n")
                  return text ? [`Assistant: ${text}`] : []
                })
                .join("\n\n")
              if (!recent) return conversationPrompt(original)
              const prefix = `${original}\n\nRecent conversation:\n`
              const budget = MAX_CONTEXT_LENGTH - conversationPrompt("").length - prefix.length
              return conversationPrompt(`${prefix}${recent.slice(-budget)}`)
            }),
            Effect.orElseSucceed(() => messagePrompt(firstUser.text)),
          )
        : messagePrompt(firstUser.text)
      const selection = yield* context.selectTitle(session)
      if (!selection) return
      const title =
        (yield* attempt({ session, agent: selection.agent, text, model: selection.selected })) ??
        (selection.primary && !isDeepStrictEqual(selection.selected.ref, selection.primary.ref)
          ? yield* attempt({ session, agent: selection.agent, text, model: selection.primary })
          : undefined)
      if (!title) return
      const expectedSequence = (yield* Bus.latestSequence(db, sessionID)) + 1
      const current = yield* store.get(sessionID)
      const base = provisional ?? session.title
      if (!current || current.title !== base || current.title === truncate(title)) return
      yield* bus
        .publish(
          SessionEvent.Renamed,
          {
            sessionID: session.id,
            title: truncate(title),
          },
          { commit: (sequence) => (sequence === expectedSequence ? Effect.void : Effect.die(titleChanged)) },
        )
        .pipe(Effect.catchDefect((defect) => (defect === titleChanged ? Effect.void : Effect.die(defect))))
    })

    // A session is named the moment it is prompted, but a session created before that naming
    // existed — an older install, an import, a client that posts its own title — keeps a null
    // in the column and reads "Untitled session" in every list for the rest of its life. One
    // pass at startup names them from the message the person already typed. No model call, so
    // this is safe to run before the network is even up.
    const backfill = Effect.gen(function* () {
      const rows = yield* db
        .select({ id: SessionTable.id, title: SessionTable.title, created: SessionTable.time_created })
        .from(SessionTable)
        .where(
          and(
            isNull(SessionTable.parent_id),
            or(isNull(SessionTable.title), like(SessionTable.title, "New session - %")),
          ),
        )
        .orderBy(desc(SessionTable.time_created))
        .limit(BACKFILL_LIMIT)
        .pipe(Effect.orDie)

      let named = 0
      for (const row of rows) {
        if (!isExactRootFallback({ title: row.title ?? undefined, time: { created: row.created } })) continue
        const sessionID = SessionSchema.ID.make(row.id)
        const said = yield* db
          .select({ text: sql<unknown>`json_extract(${SessionMessageTable.data}, '$.text')` })
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user")))
          .orderBy(asc(SessionMessageTable.seq))
          .limit(BACKFILL_PROBE)
          .pipe(Effect.orDie)
        const texts = said.flatMap((entry) => (Schema.is(Schema.String)(entry.text) ? [entry.text] : []))
        const substantive = texts.find((text) => text.replace(/\s+/g, " ").trim().length >= BACKFILL_MIN_CHARS)
        const provisional = provisionalTitle(substantive ?? texts[0] ?? "")
        if (!provisional || provisional === row.title) continue
        // "hi" is a real first message and a useless name. A timestamp keeps a dozen rows of
        // "hi" apart without pretending the session said something it did not.
        const stamp =
          substantive === undefined && typeof row.created === "number"
            ? new Date(row.created).toISOString().slice(0, 16).replace("T", " ")
            : ""
        const title = stamp ? `${provisional} · ${stamp}` : provisional
        yield* bus.publish(SessionEvent.Renamed, { sessionID, title })
        named += 1
      }
      return named
    }).pipe(Effect.catch(() => Effect.succeed(0)))

    return Service.of({ generate, backfill })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, llmClient, SessionContext.node, SessionStore.node, Database.node],
})
