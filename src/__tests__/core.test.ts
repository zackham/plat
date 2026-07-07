import { describe, it, expect } from "vitest"
import { PlatStore } from "../store"
import { align, distribute, group, ungroup } from "../commands"
import { resizeBox, computeSnap, unionBoxes } from "../geometry"
import { anchorForPoint, getArrowInfo } from "../arrows/arrow"
import type { AnyNode, ArrowNode } from "../types"

const img = (id: string, x: number, y: number, w = 100, h = 100): AnyNode => ({
  id,
  type: "image",
  x,
  y,
  w,
  h,
  index: "",
  parentId: null,
  src: "",
})

const makeStore = (nodes: AnyNode[]) =>
  new PlatStore({ format: "plat", version: 1, nodes }, { x: 0, y: 0, z: 1 })

describe("geometry: resizeBox (no flip)", () => {
  const init = { x: 0, y: 0, w: 100, h: 100 }
  it("shrinks from SE handle", () => {
    const b = resizeBox(init, "se", { x: 60, y: 40 })
    expect(b).toMatchObject({ x: 0, y: 0, w: 60, h: 40 })
  })
  it("clamps to min size instead of flipping (SE dragged past NW)", () => {
    const b = resizeBox(init, "se", { x: -50, y: -50 }, { minSize: 8 })
    expect(b.w).toBe(8)
    expect(b.h).toBe(8)
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
  })
  it("NW handle keeps SE pinned", () => {
    const b = resizeBox(init, "nw", { x: 30, y: 20 })
    expect(b.x).toBe(30)
    expect(b.y).toBe(20)
    expect(b.x + b.w).toBe(100)
    expect(b.y + b.h).toBe(100)
  })
})

describe("geometry: snapping", () => {
  it("snaps a moving box edge to a nearby static edge", () => {
    const moving = { x: 0, y: 0, w: 100, h: 100 }
    const statics = [{ x: 104, y: 0, w: 100, h: 100 }] // 4px gap on the right
    const r = computeSnap(moving, statics, 1, { x: false, y: false })
    expect(Math.abs(r.dx)).toBeLessThanOrEqual(6)
    expect(r.dx).not.toBe(0)
  })
  it("does not snap when far", () => {
    const moving = { x: 0, y: 0, w: 100, h: 100 }
    const statics = [{ x: 500, y: 500, w: 100, h: 100 }]
    const r = computeSnap(moving, statics, 1, { x: false, y: false })
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
  })
})

describe("geometry: unionBoxes", () => {
  it("computes the bounding box", () => {
    const u = unionBoxes([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 5, w: 10, h: 30 },
    ])
    expect(u).toEqual({ x: 0, y: 0, w: 30, h: 35 })
  })
})

describe("store: setReadonly", () => {
  it("flips the mutation guard live and clears selection on lock", () => {
    const s = makeStore([img("a", 0, 0), img("b", 50, 0)])
    s.setSelection(["a", "b"])
    expect(s.readonly).toBe(false)

    s.setReadonly(true)
    expect(s.readonly).toBe(true)
    // entering read-only drops the selection so no stale handles linger
    expect(s.getState().selectedIds).toEqual([])

    // mutations are now blocked
    s.commit(() => s.addNodes([img("c", 100, 0)]))
    expect(s.getState().nodes.c).toBeUndefined()

    // unlocking restores mutability
    s.setReadonly(false)
    s.commit(() => s.addNodes([img("c", 100, 0)]))
    expect(s.getState().nodes.c).toBeDefined()
  })

  it("is a no-op when the value is unchanged (keeps selection)", () => {
    const s = makeStore([img("a", 0, 0)])
    s.setSelection(["a"])
    s.setReadonly(false)
    expect(s.getState().selectedIds).toEqual(["a"])
  })
})

describe("commands: align", () => {
  it("aligns left", () => {
    const s = makeStore([img("a", 0, 0), img("b", 50, 0), img("c", 100, 0)])
    s.setSelection(["a", "b", "c"])
    align(s, "left")
    const n = s.getState().nodes
    expect(n.a.type !== "arrow" && (n.a as { x: number }).x).toBe(0)
    expect((n.b as { x: number }).x).toBe(0)
    expect((n.c as { x: number }).x).toBe(0)
  })
  it("aligns center-x", () => {
    const s = makeStore([img("a", 0, 0, 100, 100), img("b", 200, 0, 100, 100)])
    s.setSelection(["a", "b"])
    align(s, "center-x")
    const n = s.getState().nodes as Record<string, { x: number }>
    expect(n.a.x + 50).toBeCloseTo(n.b.x + 50)
  })
})

describe("commands: distribute", () => {
  it("distributes horizontally with equal gaps", () => {
    const s = makeStore([
      img("a", 0, 0, 50, 50),
      img("b", 60, 0, 50, 50),
      img("c", 300, 0, 50, 50),
    ])
    s.setSelection(["a", "b", "c"])
    distribute(s, "x")
    const n = s.getState().nodes as Record<string, { x: number }>
    const gap1 = n.b.x - (n.a.x + 50)
    const gap2 = n.c.x - (n.b.x + 50)
    expect(gap1).toBeCloseTo(gap2)
  })
})

describe("commands: group / ungroup", () => {
  it("groups and ungroups", () => {
    const s = makeStore([img("a", 0, 0), img("b", 200, 0)])
    s.setSelection(["a", "b"])
    group(s)
    const sel = s.getState().selectedIds
    expect(sel.length).toBe(1)
    const gid = sel[0]
    expect(s.getState().nodes[gid].type).toBe("group")
    expect((s.getState().nodes.a as { parentId?: string }).parentId).toBe(gid)
    s.setSelection([gid])
    ungroup(s)
    expect((s.getState().nodes.a as { parentId?: string | null }).parentId).toBeNull()
    expect(s.getState().nodes[gid]).toBeUndefined()
  })
})

describe("store: history", () => {
  it("undo/redo restores positions", () => {
    const s = makeStore([img("a", 0, 0)])
    s.commit(() => s.replaceNode({ ...(s.getState().nodes.a as AnyNode), x: 100 } as AnyNode))
    expect((s.getState().nodes.a as { x: number }).x).toBe(100)
    s.undo()
    expect((s.getState().nodes.a as { x: number }).x).toBe(0)
    s.redo()
    expect((s.getState().nodes.a as { x: number }).x).toBe(100)
  })
  it("removing a bound node bakes the arrow to flat coords", () => {
    const arrow: ArrowNode = {
      id: "arr",
      type: "arrow",
      index: "",
      parentId: null,
      start: { x: 10, y: 10, binding: { nodeId: "a", anchor: { x: 0.5, y: 0.5 } } },
      end: { x: 200, y: 200, binding: null },
    }
    const s = makeStore([img("a", 0, 0), arrow])
    s.removeNodes(["a"])
    const arr = s.getState().nodes.arr as ArrowNode
    expect(arr.start.binding).toBeNull()
    // baked at the RESOLVED anchor (node center 50,50), not stale flat coords
    expect(arr.start.x).toBe(50)
    expect(arr.start.y).toBe(50)
  })
})

describe("arrows: binding & geometry", () => {
  it("snaps anchor to center / corner", () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    expect(anchorForPoint({ x: 50, y: 50 }, box)).toMatchObject({
      anchor: { x: 0.5, y: 0.5 },
      isPrecise: false,
    })
    expect(anchorForPoint({ x: 2, y: 2 }, box)).toMatchObject({
      anchor: { x: 0, y: 0 },
      isPrecise: true,
    })
  })
  it("straight arrow between free points returns the two points", () => {
    const arrow: ArrowNode = {
      id: "a",
      type: "arrow",
      index: "",
      parentId: null,
      start: { x: 0, y: 0, binding: null },
      end: { x: 100, y: 0, binding: null },
      kind: "straight",
    }
    const info = getArrowInfo(arrow, new Map())
    expect(info.points).toHaveLength(2)
    expect(info.end).toEqual({ x: 100, y: 0 })
  })
})

