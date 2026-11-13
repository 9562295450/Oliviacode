import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Switch } from "@opencode/ui/switch"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { usePlatform } from "@/runtime/platform/platform"
import {
  infiniteDefaults,
  infiniteLanes,
  laneLabel,
  phaseLabel,
  type InfiniteLane,
  type InfiniteSettings,
  type ProviderVerdict,
} from "@/egress"
import { Linkified } from "@/shell/egress/linkified"
import "./egress.css"

type Notice = { tone: "ok" | "bad"; text: string }

/**
 * Everything the strip cannot fit: what each lane costs, what the last rotations actually
 * did, and the numbers that decide when the engine moves by itself.
 *
 * The form is a draft. Nothing reaches the engine until Save, so a half-typed timeout never
 * becomes a running configuration, and a save that is refused leaves the draft on screen.
 */
export function EgressPanel() {
  const platform = usePlatform()
  const engine = () => platform.egress
  const state = () => engine()?.state()
  const saved = () => engine()?.settings()

  const [draft, setDraft] = createSignal<InfiniteSettings>({ ...infiniteDefaults })
  const [dirty, setDirty] = createSignal(false)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [notice, setNotice] = createSignal<Notice | null>(null)
  // Rotation rows and the session clock read as relative time; a slow tick keeps them honest
  // without re-running the engine or re-rendering on every frame.
  const [tick, setTick] = createSignal(0)

  const timer = setInterval(() => setTick((value) => value + 1), 5_000)
  onCleanup(() => clearInterval(timer))

  // Every relative time reads this, so one signal wakes all of them together.
  const clock = createMemo(() => (tick(), Date.now()))

  // A settings change from another window replaces the draft only when the reader has not
  // started editing: a save elsewhere must not overwrite a half-typed value here.
  createEffect(() => {
    const next = saved()
    if (next && !dirty()) setDraft(next)
  })

  const patch = (part: Partial<InfiniteSettings>) => {
    setDirty(true)
    setDraft((previous) => ({ ...previous, ...part }))
  }

  const run = async (key: string, work: () => Promise<Notice | null>) => {
    if (busy()) return
    setBusy(key)
    setNotice(null)
    try {
      setNotice(await work())
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  const rotate = (lane?: InfiniteLane) =>
    run(lane ?? "rotate", async () => {
      const result = await engine()!.rotate(lane)
      if (!result.ok) return { tone: "bad", text: result.error ?? "rotation failed" }
      const from = result.from ?? "new route"
      return { tone: "ok", text: `${laneLabel((result.lane ?? lane ?? "direct") as InfiniteLane)}: ${from} → ${result.to ?? ""} in ${duration(result.ms ?? 0)}` }
    })

  const activate = (lane: InfiniteLane) =>
    run(lane, async () => {
      await engine()!.setLane(lane)
      return { tone: "ok", text: `Routing through ${laneLabel(lane)}` }
    })

  const check = () =>
    run("check", async () => {
      await engine()!.check()
      return { tone: "ok", text: "Lane health refreshed" }
    })

  const save = () =>
    run("save", async () => {
      await engine()!.save(draft())
      setDirty(false)
      return { tone: "ok", text: "Settings applied" }
    })

  const [updateInfo, setUpdateInfo] = createSignal<{ available: boolean; version: string } | null>(null)

  const checkUpdate = async () => {
    const result = await engine()!.checkUpdate()
    setUpdateInfo(result)
  }

  // Check once when the panel opens; the button hides when nothing is newer.
  createEffect(() => {
    const s = state()
    if (s && !updateInfo()) void checkUpdate()
  })

  return (
    <Dialog size="large" fit>
      <DialogHeader>
        <DialogTitleGroup
          title="Routes"
          description="Where this app's traffic leaves from, and how quickly it can change."
        />
      </DialogHeader>

      <DialogBody class="egress-panel">
        <Show when={notice()}>
          {(current) => (
            <div data-slot="egress-notice" data-tone={current().tone} role="status">
              <Show when={current().tone === "bad"} fallback={<Icon name="check" />}>
                <Icon name="info" />
              </Show>
              <span>{current().text}</span>
            </div>
          )}
        </Show>

        <section data-slot="egress-section">
          <header data-slot="egress-section-head">
            <h3>Now</h3>
            <span data-slot="egress-phase-pill" data-phase={state()?.phase ?? "idle"}>
              {state() ? phaseLabel(state()!) : "loading"}
            </span>
          </header>

          <dl data-slot="egress-readout">
            <div>
              <dt>Lane</dt>
              <dd>{state() ? laneLabel(state()!.lane) : "—"}</dd>
            </div>
            <div>
              <dt>Exit</dt>
              <dd data-slot="egress-mono">{state()?.trace?.ip ?? "—"}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{state()?.trace?.loc || "—"}</dd>
            </div>
            <div>
              <dt>Colo</dt>
              <dd>{state()?.trace?.colo || "—"}</dd>
            </div>
            <div data-slot="egress-wide">
              <dt>Endpoint</dt>
              <dd data-slot="egress-mono">{state()?.endpoint || "direct"}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{state() ? since(state()!.since, clock()) : "—"}</dd>
            </div>
            <div>
              <dt>Rotations</dt>
              <dd>
                {state()?.rotations ?? 0}
                <Show when={state()?.recoveries}>{(count) => <span data-slot="egress-sub"> · {count()} auto</span>}</Show>
              </dd>
            </div>
            <div>
              <dt>Failures</dt>
              <dd data-tone={(state()?.failures ?? 0) > 0 ? "bad" : undefined}>{state()?.failures ?? 0}</dd>
            </div>
            <div data-slot="egress-wide">
              <dt>Provider</dt>
              <dd data-tone={providerTone(state()?.provider)}>{providerText(state()?.provider)}</dd>
            </div>
          </dl>

          <Show when={state()?.watch}>
            {(line) => (
              <p data-slot="egress-watch">
                <Icon name="status" />
                <span>{line()}</span>
              </p>
            )}
          </Show>

          <Show when={state()?.stuck}>
            {(notice) => (
              <p data-slot="egress-stuck" role="status">
                <Icon name="status" />
                <span>{notice()}</span>
              </p>
            )}
          </Show>

          <Show when={state()?.phase === "error" && state()?.lastError}>
            {(error) => <Linkified slot="egress-fault" tone="bad" text={error()} />}
          </Show>
        </section>

        <section data-slot="egress-section">
          <header data-slot="egress-section-head">
            <h3>Lanes</h3>
            <Button variant="ghost" size="small" icon="refresh" disabled={busy() === "check"} onClick={() => void check()}>
              {busy() === "check" ? "Checking" : "Check all"}
            </Button>
          </header>

          <div data-slot="egress-cards">
            <For each={infiniteLanes}>
              {(lane) => {
                const entry = () => state()?.health.find((item: { lane: InfiniteLane }) => item.lane === lane)
                const active = () => state()?.lane === lane
                return (
                  <article data-slot="egress-card" data-active={active() ? "" : undefined}>
                    <header>
                      <span data-slot="egress-dot" data-state={active() ? "current" : entry()?.alive ? "ok" : "down"} />
                      <strong>{laneLabel(lane)}</strong>
                      <Show when={active()}>
                        <span data-slot="egress-live">live</span>
                      </Show>
                    </header>
                    <p>
                      <Show when={entry()?.checkedAt} fallback="not probed">
                        {entry()!.alive ? `${entry()!.latencyMs} ms` : "unreachable"} · {ago(entry()!.checkedAt, clock())}
                      </Show>
                    </p>
                    <div data-slot="egress-card-actions">
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={busy() !== null || active()}
                        onClick={() => void activate(lane)}
                      >
                        {busy() === lane ? "Switching" : "Use"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="small"
                        icon="refresh"
                        disabled={busy() !== null || lane === "direct"}
                        onClick={() => void rotate(lane)}
                      >
                        Rotate
                      </Button>
                    </div>
                  </article>
                )
              }}
            </For>
          </div>
        </section>

        <section data-slot="egress-section">
          <header data-slot="egress-section-head">
            <h3>History</h3>
            <span data-slot="egress-sub">{state()?.history.length ?? 0} recorded</span>
          </header>

          <Show
            when={state()?.history.length}
            fallback={<p data-slot="egress-empty">No rotations yet. The strip's Rotate button writes the first one.</p>}
          >
            <ul data-slot="egress-history">
              <For each={state()!.history.slice(0, 12)}>
                {(record) => (
                  <li data-ok={record.ok ? "" : undefined}>
                    <span data-slot="egress-history-lane">{laneLabel(record.lane)}</span>
                    <span data-slot="egress-history-route">
                      {record.from || "new"} → {record.to || "none"}
                    </span>
                    <span data-slot="egress-history-meta">
                      {duration(record.ms)} · {ago(record.at, clock())}
                    </span>
                    <Show when={!record.ok}>
                      <span data-slot="egress-history-error">{record.error}</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section data-slot="egress-section">
          <header data-slot="egress-section-head">
            <h3>Behaviour</h3>
            <Show when={dirty()}>
              <span data-slot="egress-dirty">unsaved</span>
            </Show>
          </header>

          <div data-slot="egress-form">
            <Switch
              checked={draft().autoRecover}
              onChange={(checked) => patch({ autoRecover: checked })}
              description="When the sidecar reports a limit, rotate instead of stopping."
            >
              Recover automatically
            </Switch>

            <Switch
              checked={draft().watchLimits}
              onChange={(checked) => patch({ watchLimits: checked })}
              description="Read the sidecar's own log for 429s, quota and reset wording."
            >
              Watch the log
            </Switch>

            <Switch
              checked={draft().resume}
              onChange={(checked) => patch({ resume: checked })}
              description="Restart the sidecar after a rotation so the session continues on the new route."
            >
              Resume the session
            </Switch>

            <Switch
              checked={draft().quotaRotates}
              onChange={(checked) => patch({ quotaRotates: checked })}
              description="Spend a rotation when a quota line appears. Off by default: a free allowance is counted by the service, so a new exit reaches the same spent budget."
            >
              Rotate on quota
            </Switch>

            <Switch
              checked={draft().verifyProvider}
              onChange={(checked) => patch({ verifyProvider: checked })}
              description="Spend one token on the provider after each rotation, and scrap an exit it still refuses."
            >
              Verify the new exit
            </Switch>

            <label data-slot="egress-field">
              <span>Cooldown</span>
              <input
                type="number"
                min="0"
                max="600"
                step="1"
                value={Math.round(draft().cooldownMs / 1000)}
                onInput={(event) => patch({ cooldownMs: Number(event.currentTarget.value) * 1000 })}
              />
              <em>seconds between rotations</em>
            </label>

            <label data-slot="egress-field">
              <span>Attempts</span>
              <input
                type="number"
                min="1"
                max="40"
                step="1"
                value={draft().tries}
                onInput={(event) => patch({ tries: Number(event.currentTarget.value) })}
              />
              <em>addresses tried per rotation</em>
            </label>

            <label data-slot="egress-field">
              <span>Probe timeout</span>
              <input
                type="number"
                min="1"
                max="60"
                step="1"
                value={Math.round(draft().probeTimeoutMs / 1000)}
                onInput={(event) => patch({ probeTimeoutMs: Number(event.currentTarget.value) * 1000 })}
              />
              <em>seconds before a lane is called dead</em>
            </label>

            <label data-slot="egress-field" data-wide="">
              <span>Pinned proxy</span>
              <input
                type="text"
                spellcheck={false}
                placeholder="http://host:port — leave empty to pick from the pool"
                value={draft().pinnedProxy}
                onInput={(event) => patch({ pinnedProxy: event.currentTarget.value })}
              />
              <em>used by the proxy lane only</em>
            </label>

            <label data-slot="egress-field" data-wide="">
              <span>Provider endpoint</span>
              <input
                type="text"
                spellcheck={false}
                placeholder="https://your-provider.example.com/v1/chat/completions"
                value={draft().providerEndpoint}
                onInput={(event) => patch({ providerEndpoint: event.currentTarget.value })}
              />
              <em>verification target — empty uses the provider the app is configured with</em>
            </label>

            <label data-slot="egress-field" data-wide="">
              <span>Provider model</span>
              <input
                type="text"
                spellcheck={false}
                placeholder="no model selected"
                value={draft().providerModel}
                onInput={(event) => patch({ providerModel: event.currentTarget.value })}
              />
              <em>the model the verification spends one token on</em>
            </label>

            <label data-slot="egress-field" data-wide="">
              <span>Provider key</span>
              <input
                type="password"
                spellcheck={false}
                placeholder="leave empty for no key"
                value={draft().providerKey}
                onInput={(event) => patch({ providerKey: event.currentTarget.value })}
              />
              <em>sent by the verification only; never written to disk</em>
            </label>
          </div>
        </section>

        <section data-slot="egress-section">
          <header data-slot="egress-section-head">
            <h3>Updates</h3>
            <Show when={updateInfo()?.available ?? false}>
              <Button
                variant="contrast"
                size="small"
                disabled={busy() === "update"}
                onClick={() => {
                  setBusy("update")
                  void engine()!.applyUpdate().then((result: { ok: boolean; error?: string }) => {
                    setBusy(null)
                    if (!result.ok) {
                      setNotice({ tone: "bad", text: result.error ?? "update failed" })
                    }
                  })
                }}
              >
                {busy() === "update" ? "Updating" : "Update now"}
              </Button>
            </Show>
            <Show when={!updateInfo()?.available}>
              <span data-slot="egress-sub">No updates available</span>
            </Show>
          </header>
        </section>
      </DialogBody>

      <DialogFooter>
        <Show when={dirty()}>
          <span data-slot="egress-sub">Changes apply on save</span>
        </Show>
        <Button variant="ghost" onClick={() => setDraft({ ...infiniteDefaults })} disabled={busy() !== null}>
          Reset defaults
        </Button>
        <Button variant="neutral" disabled={!dirty() || busy() !== null} onClick={() => void save()}>
          {busy() === "save" ? "Saving" : "Save"}
        </Button>
        <Button variant="contrast" disabled={busy() !== null} onClick={() => void rotate()}>
          <Show when={busy() === "rotate"} fallback={<Icon name="refresh" />}>
            <Loader width={14} height={14} />
          </Show>
          Rotate now
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** A verdict is a status, so it reads in one word and explains itself in the title. */
function providerText(verdict: ProviderVerdict | null | undefined) {
  if (!verdict) return "not checked"
  if (verdict.status === "ok") return `accepted · ${verdict.model}`
  if (verdict.status === "limited") return `still limited · ${verdict.ip}`
  return `unverified · ${verdict.detail || "no answer"}`
}

function providerTone(verdict: ProviderVerdict | null | undefined) {
  if (!verdict) return undefined
  if (verdict.status === "ok") return "ok"
  if (verdict.status === "limited") return "bad"
  return undefined
}

/** Seconds, minutes, or an hour and change: the width a status row can afford. */
function duration(ms: number) {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`
  return `${Math.round(ms / 60_000)} min`
}

function ago(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1_000))
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3_600)}h ago`
}

function since(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1_000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m`
}
