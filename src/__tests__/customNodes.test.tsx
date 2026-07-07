// Custom node types + the interactive-content protocol, mounted end to end.

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Plat } from "../Plat"
import { definePlatNodeType, platInteractive } from "../nodeTypes"
import { usePlatApi } from "../api"
import type { PlatDoc, PlatHost } from "../index"

afterEach(cleanup)

const cardType = definePlatNodeType({
  type: "test.card",
  defaultProps: { label: "fresh" },
  defaultSize: { w: 300, h: 120 },
  render: ({ node }) => {
    const props = (node as { props?: Record<string, unknown> }).props ?? {}
    return (
      <div>
        <span>card:{String(props.label)}</span>
        <div {...platInteractive}>
          <input aria-label="card-input" defaultValue="type here" />
          <button type="button">card-action</button>
        </div>
      </div>
    )
  },
})

const docWith = (nodes: PlatDoc["nodes"]): PlatDoc => ({
  format: "plat",
  version: 1,
  nodes,
})

const host = (doc: PlatDoc, saveDoc = vi.fn(async () => {})): PlatHost => ({
  loadDoc: async () => doc,
  saveDoc,
})

describe("custom node types", () => {
  it("renders a registered custom node via its renderer", async () => {
    const doc = docWith([
      { id: "c1", type: "test.card", x: 0, y: 0, w: 300, h: 120, index: "", props: { label: "hello" } },
    ])
    render(<Plat host={host(doc)} nodeTypes={[cardType]} />)
    expect(await screen.findByText("card:hello")).toBeInTheDocument()
  })

  it("renders a legible fallback for unregistered types (never crashes, never drops)", async () => {
    const doc = docWith([
      { id: "x1", type: "someapp.widget", x: 0, y: 0, w: 200, h: 100, index: "", props: {} },
    ])
    render(<Plat host={host(doc)} />)
    expect(await screen.findByText("someapp.widget")).toBeInTheDocument()
    expect(screen.getByText("unregistered node type")).toBeInTheDocument()
  })

  it("rejects un-namespaced type ids at definition time", () => {
    expect(() =>
      definePlatNodeType({
        // @ts-expect-error — the type system also rejects this
        type: "card",
        render: () => null,
      }),
    ).toThrow(/namespaced/)
  })

  it("rejects redefining structural types", () => {
    expect(() =>
      // @ts-expect-error — structural ids are not CustomNodeTypeIds
      definePlatNodeType({ type: "frame", render: () => null }),
    ).toThrow(/structural/)
  })

  it("interactive regions: pointerdown selects the node but starts no drag, and shortcuts defer to focused content", async () => {
    const doc = docWith([
      { id: "c1", type: "test.card", x: 10, y: 10, w: 300, h: 120, index: "", props: { label: "a" } },
    ])
    let api: import("../api").PlatApi | null = null
    render(<Plat host={host(doc)} nodeTypes={[cardType]} onReady={(a) => (api = a)} />)
    const input = await screen.findByLabelText("card-input")

    // pointerdown inside the interactive region → node selected, no crash/drag
    fireEvent.pointerDown(input, { button: 0, clientX: 20, clientY: 20 })
    expect(api!.getSelection()).toEqual(["c1"])

    // Delete pressed while typing in the input must NOT delete the node
    input.focus()
    fireEvent.keyDown(input, { key: "Backspace" })
    fireEvent.keyDown(window, { key: "Backspace" })
    expect(api!.getNode("c1")).toBeDefined()
  })

  it("api.create fills defaults from the node type", async () => {
    const doc = docWith([])
    let api: import("../api").PlatApi | null = null
    render(<Plat host={host(doc)} nodeTypes={[cardType]} onReady={(a) => (api = a)} />)
    await screen.findByTitle("Select (V)") // toolbar = ready

    const [made] = api!.create({ type: "test.card", x: 50, y: 60 })
    expect(made.type).toBe("test.card")
    const box = made as { w: number; h: number; props: Record<string, unknown> }
    expect(box.w).toBe(300)
    expect(box.h).toBe(120)
    expect(box.props.label).toBe("fresh")
    expect(await screen.findByText("card:fresh")).toBeInTheDocument()
  })
})

describe("usePlatApi inside renderers", () => {
  it("a renderer can mutate the doc through the api", async () => {
    const spawnType = definePlatNodeType({
      type: "test.spawner",
      defaultSize: { w: 100, h: 40 },
      render: ({ node }) => {
        const api = usePlatApi()
        return (
          <div {...platInteractive}>
            <button
              type="button"
              onClick={() => {
                const n = node as { x: number; y: number; w: number }
                api.create({ type: "text", x: n.x + n.w + 40, y: n.y, text: "spawned", fontSize: 14 })
              }}
            >
              spawn
            </button>
          </div>
        )
      },
    })
    const doc = docWith([
      { id: "s1", type: "test.spawner", x: 0, y: 0, w: 100, h: 40, index: "", props: {} },
    ])
    render(<Plat host={host(doc)} nodeTypes={[spawnType]} />)
    fireEvent.click(await screen.findByText("spawn"))
    expect(await screen.findByText("spawned")).toBeInTheDocument()
  })
})
