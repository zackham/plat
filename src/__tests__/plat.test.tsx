// Mount-level roundtrip against a mock PlatHost — proves the adapter seam:
// the same component loads/saves/renders measures purely through the host.
// Also pins the load-failure semantics: a rejected loadDoc must render an
// error screen and NEVER autosave (treating a failed load as "empty canvas"
// would clobber the stored doc on the next save).

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Plat } from "../Plat"
import type { PlatDoc, PlatHost, PlatHandle, MeasureData, SaveDocOptions } from "../index"

const mockSaveDoc = () => vi.fn(async (_doc: PlatDoc, _opts?: SaveDocOptions) => {})

afterEach(cleanup)

const textDoc: PlatDoc = {
  format: "plat",
  version: 1,
  nodes: [
    {
      id: "t1",
      type: "text",
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      index: "a0",
      text: "hello from the host",
      fontSize: 16,
    },
  ],
}

describe("Plat + PlatHost", () => {
  it("renders a doc loaded through the host", async () => {
    const host: PlatHost = { loadDoc: async () => textDoc }
    render(<Plat host={host} />)
    expect(await screen.findByText("hello from the host")).toBeInTheDocument()
  })

  it("a failed load shows an error and never saves (no clobber)", async () => {
    const saveDoc = mockSaveDoc()
    const host: PlatHost = {
      loadDoc: async () => {
        throw new Error("api unreachable")
      },
      saveDoc,
    }
    render(<Plat host={host} />)
    expect(await screen.findByText(/Failed to load canvas/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(saveDoc).not.toHaveBeenCalled()
  })

  it("a null doc (brand-new canvas) creates and persists an empty doc", async () => {
    const saveDoc = mockSaveDoc()
    const host: PlatHost = { loadDoc: async () => null, saveDoc }
    render(<Plat host={host} />)
    await waitFor(() => expect(saveDoc).toHaveBeenCalledTimes(1))
    const [doc] = saveDoc.mock.calls[0]
    expect(doc).toEqual({ format: "plat", version: 1, nodes: [] })
  })

  it("a host without saveDoc is view-only (no edit toolbar)", async () => {
    const host: PlatHost = { loadDoc: async () => textDoc }
    render(<Plat host={host} />)
    await screen.findByText("hello from the host")
    expect(screen.queryByTitle("Select (V)")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Copy public read-only link")).not.toBeInTheDocument()
  })

  it("an editable host shows the toolbar; share button only with host.share", async () => {
    const host: PlatHost = {
      loadDoc: async () => textDoc,
      saveDoc: async () => {},
    }
    render(<Plat host={host} />)
    await screen.findByText("hello from the host")
    expect(screen.getByTitle("Select (V)")).toBeInTheDocument()
    expect(screen.queryByTitle("Copy public read-only link")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Insert image")).not.toBeInTheDocument() // no uploadAsset
  })

  it("measure nodes render through host.measures.get", async () => {
    const measure: MeasureData = {
      id: "m_ab12cd34",
      name: "signup conversion",
      latest: {
        result: { value: 0.42, label: "last 30d" },
        error: null,
        refreshed_at: "2026-07-06T00:00:00Z",
      },
    }
    const doc: PlatDoc = {
      format: "plat",
      version: 1,
      nodes: [
        {
          id: "m1",
          type: "measure",
          x: 0,
          y: 0,
          w: 240,
          h: 160,
          index: "a0",
          measureId: "m_ab12cd34",
        },
      ],
    }
    const host: PlatHost = {
      loadDoc: async () => doc,
      measures: { get: async () => measure },
    }
    render(<Plat host={host} readOnly />)
    expect(await screen.findByText("signup conversion")).toBeInTheDocument()
    expect(await screen.findByText("42.0%")).toBeInTheDocument()
    expect(screen.getByText("last 30d")).toBeInTheDocument()
  })

  it("onReady hands out a working handle (insertMeasure → saveDoc)", async () => {
    let handle: PlatHandle | null = null
    const saveDoc = mockSaveDoc()
    const host: PlatHost = {
      loadDoc: async () => textDoc,
      saveDoc,
      measures: { get: async (id) => ({ id, name: "m", latest: null }) },
    }
    render(<Plat host={host} onReady={(h) => (handle = h)} />)
    await screen.findByText("hello from the host")
    expect(handle).not.toBeNull()

    handle!.insertMeasure("m_ff00ff00")
    // debounced autosave (700ms) — the inserted node must reach the host doc
    await waitFor(
      () => {
        const call = saveDoc.mock.calls.at(-1)
        const nodes = call?.[0]?.nodes ?? []
        expect(nodes.some((n) => n.type === "measure")).toBe(true)
      },
      { timeout: 2500 },
    )
  })
})
