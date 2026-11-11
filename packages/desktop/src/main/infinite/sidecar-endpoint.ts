/**
 * What the running sidecar is pointed at.
 *
 * The sidecar inherits `HTTP_PROXY` from this process and reads it once, at spawn. The
 * engine's own `endpoint` moves the moment a rotation lands, so the two drift: a Tor bridge
 * that comes back on a different port leaves the sidecar dialling the old one, and every
 * request fails with a refused connect that names no address.
 *
 * Holding the started-with endpoint apart from the wanted one is what makes the restart
 * decision correct: a failed restart leaves the record behind, so the next rotation or lane
 * switch tries again instead of believing the move already happened.
 */
export class SidecarEndpoint {
  /** `null` until something was applied; a fresh sidecar is started with no proxy. */
  #applied: string | null = null

  /** The endpoint the sidecar was last started with. */
  get applied() {
    return this.#applied
  }

  /** Record the endpoint a sidecar started with, at boot or after a successful restart. */
  adopt(endpoint: string) {
    this.#applied = endpoint
  }

  /** Whether the sidecar has to be started again before `endpoint` takes effect. */
  moved(endpoint: string) {
    return endpoint !== (this.#applied ?? "")
  }
}
