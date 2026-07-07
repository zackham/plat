import { describe, it, expect, beforeEach } from "vitest"
import { PlatStore } from "../store"
import {
  convertToLayout,
  removeLayout,
  setLayoutProps,
  reconcileLayout,
  DEFAULT_LAYOUT,
} from "../layoutCommands"
import { isLayoutContainer, type AnyNode, type BoxNode, type PlatDoc, type FrameNode } from "../types"

const img = (id: string, x: number, y: number, w: number, h: number, parentId: string): AnyNode =>
  ({ id, type: "image", x, y, w, h, index: "", parentId, src: "" } as AnyNode)

const doc = (...nodes: AnyNode[]): PlatDoc => ({ format: "plat", version: 1, nodes })

const newStore = (d: PlatDoc) => {
  const s = new PlatStore(d, { x: 0, y: 0, z: 1 })
  s.setReconciler(() => reconcileLayout(s))
  return s
}

const box = (s: PlatStore, id: string) => {
  const n = s.getState().nodes[id] as BoxNode
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

describe("convertToLayout", () => {
  let s: PlatStore
  beforeEach(() => {
    s = newStore(
      doc(
        { id: "F", type: "frame", x: 0, y: 0, w: 500, h: 500, index: "", parentId: null, name: "F" } as AnyNode,
        img("A", 300, 200, 100, 50, "F"),
        img("B", 50, 400, 60, 80, "F"),
        img("C", 999, 10, 40, 30, "F"),
      ),
    )
  })

  it("stamps layout, assigns ordinal flow indices, and settles coords (hug)", () => {
    convertToLayout(s, "F", ["A", "B", "C"], DEFAULT_LAYOUT)
    const F = s.getState().nodes.F as FrameNode
    expect(isLayoutContainer(F)).toBe(true)
    expect(F.layout).toMatchObject({ dir: "h", gap: 16 })
    // ordinal indices in given order
    expect((s.getState().nodes.A as BoxNode).index).toBe("000000")
    expect((s.getState().nodes.B as BoxNode).index).toBe("000001")
    expect((s.getState().nodes.C as BoxNode).index).toBe("000002")
    // settled: gap16 pad16, hug → F 264x112, children laid left-to-right at y=16
    expect(box(s, "F")).toMatchObject({ x: 0, y: 0, w: 264, h: 112 })
    expect(box(s, "A")).toMatchObject({ x: 16, y: 16 })
    expect(box(s, "B")).toMatchObject({ x: 132, y: 16 }) // 16+100+16
    expect(box(s, "C")).toMatchObject({ x: 208, y: 16 }) // +60+16
  })

  it("excludes non-selected members (layoutIgnore) and leaves them put", () => {
    convertToLayout(s, "F", ["A", "C"]) // skip B
    expect((s.getState().nodes.B as BoxNode).layoutIgnore).toBe(true)
    expect(box(s, "B")).toMatchObject({ x: 50, y: 400 }) // untouched
    // F hugs only A + C
    expect(box(s, "F")).toMatchObject({ w: 188, h: 82 }) // A100+C40+gap16 +32; cross max(50,30)=50 +32
    expect(box(s, "A")).toMatchObject({ x: 16, y: 16 })
    expect(box(s, "C")).toMatchObject({ x: 132, y: 16 })
  })

  it("is one undo step (layout + reflow revert together)", () => {
    const before = JSON.stringify(s.toDoc())
    convertToLayout(s, "F", ["A", "B", "C"])
    expect(isLayoutContainer(s.getState().nodes.F)).toBe(true)
    s.undo()
    expect(isLayoutContainer(s.getState().nodes.F)).toBe(false)
    expect(JSON.stringify(s.toDoc())).toBe(before)
  })
})

describe("reconcile fires on every commit (stale box impossible)", () => {
  it("re-hugs after a member is removed via a plain commit", () => {
    const s = newStore(
      doc(
        { id: "F", type: "frame", x: 0, y: 0, w: 0, h: 0, index: "", parentId: null, name: "F" } as AnyNode,
        img("A", 0, 0, 100, 50, "F"),
        img("B", 0, 0, 60, 80, "F"),
        img("C", 0, 0, 40, 30, "F"),
      ),
    )
    convertToLayout(s, "F", ["A", "B", "C"])
    expect(box(s, "F").w).toBe(264)
    // delete C through a normal commit path — reconciler must re-hug without it
    s.commit(() => s.removeNodes(["C"]))
    expect(box(s, "F").w).toBe(208) // A100+B60+gap16 +pad32
    expect(s.getState().nodes.C).toBeUndefined()
  })

  it("re-settles after a layout prop change (gap)", () => {
    const s = newStore(
      doc(
        { id: "F", type: "frame", x: 0, y: 0, w: 0, h: 0, index: "", parentId: null, name: "F" } as AnyNode,
        img("A", 0, 0, 100, 50, "F"),
        img("B", 0, 0, 60, 80, "F"),
      ),
    )
    convertToLayout(s, "F", ["A", "B"])
    expect(box(s, "B").x).toBe(132) // gap 16
    setLayoutProps(s, "F", { gap: 40 })
    expect(box(s, "B").x).toBe(156) // 16+100+40
    expect(box(s, "F").w).toBe(232) // 100+60+40gap +pad32
  })
})

describe("removeLayout", () => {
  it("strips layout; children keep their settled coords", () => {
    const s = newStore(
      doc(
        { id: "F", type: "frame", x: 0, y: 0, w: 0, h: 0, index: "", parentId: null, name: "F" } as AnyNode,
        img("A", 0, 0, 100, 50, "F"),
        img("B", 0, 0, 60, 80, "F"),
      ),
    )
    convertToLayout(s, "F", ["A", "B"])
    const bxA = box(s, "A")
    removeLayout(s, "F")
    expect(isLayoutContainer(s.getState().nodes.F)).toBe(false)
    expect(box(s, "A")).toMatchObject(bxA) // unchanged
  })
})

describe("reconciler is a no-op on a doc with no layout frames", () => {
  it("plain commit does not throw or change anything", () => {
    const s = newStore(doc(img("A", 5, 5, 10, 10, "")))
    const before = JSON.stringify(s.toDoc())
    s.commit(() => s.replaceNode({ ...(s.getState().nodes.A as AnyNode), x: 5 } as AnyNode))
    expect(JSON.stringify(s.toDoc())).toBe(before)
  })
})
