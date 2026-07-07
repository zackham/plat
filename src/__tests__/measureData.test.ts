import { describe, expect, it, vi } from "vitest"
import { MeasureDataStore } from "../measureData"
import type { MeasureData, MeasureSource } from "../host"

const md = (id: string, value: number): MeasureData => ({
  id,
  name: `measure ${id}`,
  latest: { result: { value }, error: null, refreshed_at: "2026-07-06T00:00:00Z" },
})

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("MeasureDataStore", () => {
  it("fetches once per id and notifies subscribers", async () => {
    const get = vi.fn(async (id: string) => md(id, 1))
    const store = new MeasureDataStore({ get })
    const cb = vi.fn()

    store.subscribe("m_a", cb)
    store.subscribe("m_a", cb) // second subscriber, same id
    await tick()

    expect(get).toHaveBeenCalledTimes(1)
    expect(store.entry("m_a").data?.name).toBe("measure m_a")
    expect(store.entry("m_a").loading).toBe(false)
    expect(cb).toHaveBeenCalled()
  })

  it("records a load failure as entry.error (not a throw)", async () => {
    const store = new MeasureDataStore({
      get: async () => {
        throw new Error("backend down")
      },
    })
    store.subscribe("m_x", () => {})
    await tick()
    expect(store.entry("m_x").error).toBe("backend down")
    expect(store.entry("m_x").loading).toBe(false)
  })

  it("refresh() swaps in fresh data and keeps stale data visible meanwhile", async () => {
    let value = 1
    const source: MeasureSource = {
      get: async (id) => md(id, value),
      refresh: async (id) => md(id, ++value),
    }
    const store = new MeasureDataStore(source)
    store.subscribe("m_a", () => {})
    await tick()
    expect(store.entry("m_a").data?.latest?.result?.value).toBe(1)

    const p = store.refresh("m_a")
    expect(store.entry("m_a").refreshing).toBe(true)
    expect(store.entry("m_a").data?.latest?.result?.value).toBe(1) // stale visible
    await p
    expect(store.entry("m_a").refreshing).toBe(false)
    expect(store.entry("m_a").data?.latest?.result?.value).toBe(2)
  })

  it("canRefresh reflects the host capability", () => {
    expect(new MeasureDataStore({ get: async (id) => md(id, 0) }).canRefresh).toBe(false)
    expect(
      new MeasureDataStore({ get: async (id) => md(id, 0), refresh: async (id) => md(id, 0) })
        .canRefresh,
    ).toBe(true)
  })

  it("refetchAll re-fetches every cached id", async () => {
    const get = vi.fn(async (id: string) => md(id, 1))
    const store = new MeasureDataStore({ get })
    store.subscribe("m_a", () => {})
    store.subscribe("m_b", () => {})
    await tick()
    expect(get).toHaveBeenCalledTimes(2)

    store.refetchAll()
    await tick()
    expect(get).toHaveBeenCalledTimes(4)
  })

  it("no source ⇒ entries resolve to an unavailable error", async () => {
    const store = new MeasureDataStore(undefined)
    store.subscribe("m_a", () => {})
    await tick()
    expect(store.entry("m_a").error).toBe("no measure source")
  })
})
