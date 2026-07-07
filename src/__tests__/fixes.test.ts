import { describe, it, expect } from "vitest"
import { PlatStore } from "../store"
import { frameSelection } from "../commands"
import { groupBox, hitTest, nodeBox } from "../geometry"
import { getElbowRoute, type ElbowTerm } from "../arrows/elbow"
import { anchorForPoint } from "../arrows/arrow"
import type { AnyNode, BoxNode } from "../types"

const img = (id: string, x: number, y: number, w = 100, h = 100, parentId: string | null = null): AnyNode => ({
  id,
  type: "image",
  x,
  y,
  w,
  h,
  index: "",
  parentId,
  src: "",
})

describe("fix: live group bounds (P0-4)", () => {
  it("groupBox unions members, ignoring the stale stored box", () => {
    const group: BoxNode = { id: "g", type: "group", x: 0, y: 0, w: 10, h: 10, index: "", parentId: null }
    const m1 = img("m1", 100, 100, 50, 50, "g")
    const m2 = img("m2", 300, 300, 50, 50, "g")
    const byId = new Map<string, AnyNode>([
      ["g", group],
      ["m1", m1],
      ["m2", m2],
    ])
    const b = groupBox(group, byId)
    expect(b).toEqual({ x: 100, y: 100, w: 250, h: 250 })
    // nodeBox for a group also returns the live union
    expect(nodeBox(group, byId)).toEqual(b)
  })
})

describe("fix: read-only store enforcement (P1-11)", () => {
  const doc = { format: "plat" as const, version: 1 as const, nodes: [img("a", 0, 0)] }
  it("blocks mutations when readonly", () => {
    const s = new PlatStore(doc, { x: 0, y: 0, z: 1 }, true)
    s.addNodes([img("b", 10, 10)])
    expect(s.getState().nodes.b).toBeUndefined()
    s.removeNodes(["a"])
    expect(s.getState().nodes.a).toBeDefined()
    s.commit(() => s.replaceNode({ ...(s.getState().nodes.a as AnyNode), x: 999 } as AnyNode))
    expect((s.getState().nodes.a as { x: number }).x).toBe(0)
  })
  it("allows mutations when editable", () => {
    const s = new PlatStore(doc, { x: 0, y: 0, z: 1 }, false)
    s.addNodes([img("b", 10, 10)])
    expect(s.getState().nodes.b).toBeDefined()
  })
})

describe("frames", () => {
  it("frameSelection wraps the selection in a titled frame behind it", () => {
    const s = new PlatStore(
      { format: "plat", version: 1, nodes: [img("a", 0, 0, 100, 100), img("b", 200, 0, 100, 100)] },
      { x: 0, y: 0, z: 1 },
    )
    s.setSelection(["a", "b"])
    frameSelection(s, "Exp")
    const sel = s.getState().selectedIds
    expect(sel).toHaveLength(1)
    const f = s.getState().nodes[sel[0]] as BoxNode & { name: string }
    expect(f.type).toBe("frame")
    expect(f.name).toBe("Exp")
    // members reparented to the frame
    expect((s.getState().nodes.a as BoxNode).parentId).toBe(sel[0])
    // frame bounds = union (0..300 × 0..100) + 24 pad, behind members in z-order
    expect(f.x).toBe(-24)
    expect(f.w).toBe(348)
    expect(s.getState().order[0]).toBe(sel[0])
  })
})

describe("fix: elbow handles overlapping/degenerate boxes without crashing", () => {
  const term = (x: number, y: number, w = 100, h = 100): ElbowTerm => ({
    box: { x, y, w, h },
    isPoint: false,
    anchor: { x: x + w / 2, y: y + h / 2 },
  })
  it("overlapping boxes still yield an orthogonal route", () => {
    const r = getElbowRoute(term(0, 0), term(40, 40), 0.5)
    expect(r.points.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < r.points.length - 1; i++) {
      const dx = Math.abs(r.points[i + 1].x - r.points[i].x)
      const dy = Math.abs(r.points[i + 1].y - r.points[i].y)
      expect(dx < 0.5 || dy < 0.5).toBe(true)
    }
  })
})

describe("anchorForPoint: zoom-dependent screen-pixel snapping", () => {
  const box = { x: 0, y: 0, w: 1000, h: 1000 }
  const corner = { x: 0, y: 0 }

  it("snaps to a corner when within ~12px (screen) of it", () => {
    // 8px away at zoom 1 → within the 12px radius → snaps precise to (0,0)
    const r = anchorForPoint({ x: 8, y: 0 }, box, 1)
    expect(r.anchor).toEqual(corner)
    expect(r.isPrecise).toBe(true)
  })

  it("does NOT snap when farther than the screen radius", () => {
    const r = anchorForPoint({ x: 40, y: 0 }, box, 1)
    expect(r.anchor.x).toBeCloseTo(0.04, 5) // raw normalized, no snap
  })

  it("zooming in shrinks the page-space snap radius (place closer to a corner)", () => {
    // 8px away at zoom 4 → effective radius 12/4 = 3px → NO snap
    const r = anchorForPoint({ x: 8, y: 0 }, box, 4)
    expect(r.anchor).not.toEqual(corner)
    expect(r.isPrecise).toBe(true)
  })

  it("center is an imprecise anchor", () => {
    const r = anchorForPoint({ x: 500, y: 500 }, box, 1)
    expect(r.anchor).toEqual({ x: 0.5, y: 0.5 })
    expect(r.isPrecise).toBe(false)
  })
})

describe("hitTest: frames are container fallbacks (click child, not frame)", () => {
  const frame = { id: "f1", type: "frame", x: 0, y: 0, w: 300, h: 300, index: "", parentId: null, name: "F" } as unknown as AnyNode
  const child = img("c1", 50, 50, 100, 100, "f1")
  const byId = new Map<string, AnyNode>([["f1", frame], ["c1", child]])

  it("clicking a child inside a frame selects the child — even when the frame is on top", () => {
    expect(hitTest({ x: 100, y: 100 }, [frame, child], byId, 0)).toBe("c1") // frame scanned first
    expect(hitTest({ x: 100, y: 100 }, [child, frame], byId, 0)).toBe("c1") // child scanned first
  })

  it("clicking the frame's empty interior selects the frame", () => {
    expect(hitTest({ x: 280, y: 280 }, [frame, child], byId, 0)).toBe("f1")
  })

  it("clicking outside everything returns null", () => {
    expect(hitTest({ x: 999, y: 999 }, [frame, child], byId, 0)).toBe(null)
  })
})
