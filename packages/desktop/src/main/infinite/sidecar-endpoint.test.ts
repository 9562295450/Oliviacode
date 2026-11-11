import { describe, expect, test } from "bun:test"
import { SidecarEndpoint } from "./sidecar-endpoint"

describe("SidecarEndpoint", () => {
  test("a fresh service needs no restart while the app is direct", () => {
    expect(new SidecarEndpoint().moved("")).toBeFalse()
  })

  test("a moved bridge port needs a restart", () => {
    const service = new SidecarEndpoint()
    service.adopt("http://127.0.0.1:41234")
    expect(service.moved("http://127.0.0.1:51234")).toBeTrue()
  })

  test("the same endpoint twice needs no restart", () => {
    const service = new SidecarEndpoint()
    service.adopt("http://127.0.0.1:41234")
    expect(service.moved("http://127.0.0.1:41234")).toBeFalse()
  })

  test("a failed restart leaves the move pending until the next attempt adopts it", () => {
    const service = new SidecarEndpoint()
    service.adopt("http://127.0.0.1:41234")
    // The restart for 51234 failed, so nothing was adopted and the move is still owed.
    expect(service.moved("http://127.0.0.1:51234")).toBeTrue()
    expect(service.moved("http://127.0.0.1:51234")).toBeTrue()
    service.adopt("http://127.0.0.1:51234")
    expect(service.moved("http://127.0.0.1:51234")).toBeFalse()
  })

  test("going back to direct restarts the sidecar off the lane", () => {
    const service = new SidecarEndpoint()
    service.adopt("http://127.0.0.1:41234")
    expect(service.moved("")).toBeTrue()
    service.adopt("")
    expect(service.moved("")).toBeFalse()
  })
})
