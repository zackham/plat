import { describe, it, expect } from "vitest"
import {
  reflowLayoutFrame,
  flowChildren,
  outermostLayoutAncestor,
  MIN_EMPTY_LAYOUT,
  type LayoutPatch,
} from "../layout"
import { isLayoutContainer } from "../types"
import type { AnyNode, BoxNode, FrameNode, LayoutProps, LayoutContainer } from "../types"
import { groupBox } from "../geometry"

// ── builders ──────────────────────────────────────────────
const L = (over: Partial<LayoutProps> = {}): LayoutProps => ({
  dir: "h",
  gap: 10,
  padding: { t: 8, r: 8, b: 8, l: 8 },
  justify: "start",
  align: "start",
  sizing: { main: "hug", cross: "hug" },
  ...over,
})

const frame = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  layout: LayoutProps | undefined,
  index = "a0",
  parentId: string | null = null,
): FrameNode => ({ id, type: "frame", x, y, w, h, index, parentId, name: id, layout })

const grp = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  layout: LayoutProps | undefined,
  index = "a0",
  parentId: string | null = null,
): AnyNode => ({ id, type: "group", x, y, w, h, index, parentId, layout } as AnyNode)

const img = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  index: string,
  parentId: string | null = null,
  extra: Partial<BoxNode> = {},
): AnyNode => ({ id, type: "image", x, y, w, h, index, parentId, src: "", ...extra } as AnyNode)

const rec = (...nodes: AnyNode[]): Record<string, AnyNode> => {
  const m: Record<string, AnyNode> = {}
  for (const n of nodes) m[n.id] = n
  return m
}

/** apply patches to a copy of the node map (for idempotency / multi-pass tests). */
const apply = (nodes: Record<string, AnyNode>, patches: LayoutPatch[]): Record<string, AnyNode> => {
  const next = { ...nodes }
  for (const { id, patch } of patches) next[id] = { ...next[id], ...patch } as AnyNode
  return next
}

/** patch lookup by id (only present when the node actually moved/resized). */
const at = (patches: LayoutPatch[], id: string) => patches.find((p) => p.id === id)?.patch

/** reflow a frame and return the SETTLED node boxes — the actual resulting layout,
 *  independent of whether a given node happened to already be in place. */
const settle = (nodes: Record<string, AnyNode>, frameId: string) =>
  apply(nodes, reflowLayoutFrame(frameId, nodes))
const box = (nodes: Record<string, AnyNode>, id: string) => {
  const n = nodes[id] as BoxNode
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

describe("layout engine — horizontal hug", () => {
  const nodes = rec(
    frame("F", 1000, 500, 0, 0, L()),
    img("A", 0, 0, 100, 50, "a1", "F"),
    img("B", 0, 0, 60, 80, "a2", "F"),
    img("C", 0, 0, 40, 30, "a3", "F"),
  )
  const p = reflowLayoutFrame("F", nodes)

  it("hugs to content + padding, frame anchor (x,y) unchanged", () => {
    // contentMain = 100+60+40 + 10*2 = 220; +16 pad = 236. cross = max(50,80,30)=80; +16 = 96
    expect(at(p, "F")).toMatchObject({ x: 1000, y: 500, w: 236, h: 96 })
  })
  it("places children left-to-right with gaps, top-aligned (start)", () => {
    expect(at(p, "A")).toMatchObject({ x: 1008, y: 508 })
    expect(at(p, "B")).toMatchObject({ x: 1118, y: 508 }) // 1000+8+100+10
    expect(at(p, "C")).toMatchObject({ x: 1188, y: 508 }) // +60+10
  })
})

describe("layout engine — counter-axis alignment", () => {
  const build = (align: LayoutProps["align"]) =>
    reflowLayoutFrame(
      "F",
      rec(
        frame("F", 0, 0, 0, 0, L({ align })),
        img("A", 0, 0, 100, 50, "a1", "F"),
        img("B", 0, 0, 60, 80, "a2", "F"), // tallest → defines line cross = 80
      ),
    )
  it("start: all at top pad", () => {
    const p = build("start")
    expect(at(p, "A")?.y).toBe(8)
    expect(at(p, "B")?.y).toBe(8)
  })
  it("center: each centered in the 80-tall line", () => {
    const p = build("center")
    expect(at(p, "A")?.y).toBe(8 + (80 - 50) / 2) // 23
    expect(at(p, "B")?.y).toBe(8)
  })
  it("end: each bottom-aligned", () => {
    const p = build("end")
    expect(at(p, "A")?.y).toBe(8 + (80 - 50)) // 38
    expect(at(p, "B")?.y).toBe(8)
  })
})

describe("layout engine — vertical hug", () => {
  const p = reflowLayoutFrame(
    "F",
    rec(
      frame("F", 1000, 500, 0, 0, L({ dir: "v" })),
      img("A", 0, 0, 100, 50, "a1", "F"),
      img("B", 0, 0, 60, 80, "a2", "F"),
      img("C", 0, 0, 40, 30, "a3", "F"),
    ),
  )
  it("stacks top-to-bottom; hugs width to widest + pad", () => {
    // main(h)=50+80+30+20gap=180 +16 = 196; cross(w)=max(100,60,40)=100 +16 = 116
    expect(at(p, "F")).toMatchObject({ w: 116, h: 196 })
    expect(at(p, "A")).toMatchObject({ x: 1008, y: 508 })
    expect(at(p, "B")).toMatchObject({ x: 1008, y: 568 }) // 500+8+50+10
    expect(at(p, "C")).toMatchObject({ x: 1008, y: 658 }) // +80+10
  })
})

describe("layout engine — fixed container + justify", () => {
  const build = (justify: LayoutProps["justify"]) =>
    settle(
      rec(
        frame("F", 0, 0, 400, 200, L({ justify, gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 }, sizing: { main: "fixed", cross: "hug" } })),
        img("A", 0, 0, 100, 50, "a1", "F"),
        img("B", 0, 0, 60, 80, "a2", "F"),
        img("C", 0, 0, 40, 30, "a3", "F"),
      ),
      "F",
    )
  it("keeps fixed main size; start packs from 0", () => {
    const s = build("start")
    expect(box(s, "F").w).toBe(400)
    expect(box(s, "A").x).toBe(0)
    expect(box(s, "B").x).toBe(100)
    expect(box(s, "C").x).toBe(160)
  })
  it("space-between spreads with first at 0 and last flush to the end", () => {
    const s = build("space-between") // sum=200, leftover=200, 2 gaps → stride 100
    expect(box(s, "A").x).toBe(0)
    expect(box(s, "B").x).toBe(200)
    expect(box(s, "C").x).toBe(360) // ends at 400
  })
  it("center centers the packed block", () => {
    const s = build("center") // leftover 200 → start at 100
    expect(box(s, "A").x).toBe(100)
    expect(box(s, "C").x).toBe(260)
  })
  it("end pushes the block to the far edge", () => {
    const s = build("end")
    expect(box(s, "C").x).toBe(360) // 400-40
  })
})

describe("layout engine — nesting (row of columns, center-aligned)", () => {
  // outer row, gap 20, no pad, center; col1 (v) 100-wide 100-tall, col2 (v) 100-wide 30-tall
  const nodes = rec(
    frame("ROW", 0, 0, 0, 0, L({ gap: 20, padding: { t: 0, r: 0, b: 0, l: 0 }, align: "center" }), "a0"),
    frame("COL1", 0, 0, 0, 0, L({ dir: "v", gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 } }), "a1", "ROW"),
    frame("COL2", 0, 0, 0, 0, L({ dir: "v", gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 } }), "a2", "ROW"),
    img("A", 0, 0, 100, 40, "a1", "COL1"),
    img("B", 0, 0, 100, 60, "a2", "COL1"),
    img("C", 0, 0, 100, 30, "a1", "COL2"),
  )
  const p = reflowLayoutFrame("ROW", nodes)
  it("outer hugs to both columns; line cross = tallest column (100)", () => {
    expect(at(p, "ROW")).toMatchObject({ w: 220, h: 100 }) // 100+100+20 gap, h=max(100,30)
  })
  it("nested columns hug their own children (bottom-up)", () => {
    expect(at(p, "COL1")).toMatchObject({ w: 100, h: 100 })
    expect(at(p, "COL2")).toMatchObject({ w: 100, h: 30 })
  })
  it("shorter column is vertically centered in the row", () => {
    expect(at(p, "COL1")).toMatchObject({ x: 0, y: 0 })
    expect(at(p, "COL2")).toMatchObject({ x: 120, y: 35 }) // (100-30)/2 = 35
  })
  it("leaf grandchildren positioned absolutely under their reflowed column", () => {
    const s = apply(nodes, p)
    expect(box(s, "A")).toMatchObject({ x: 0, y: 0 })
    expect(box(s, "B")).toMatchObject({ x: 0, y: 40 })
    expect(box(s, "C")).toMatchObject({ x: 120, y: 35 })
  })
})

describe("layout engine — exclusions (layoutIgnore + arrows)", () => {
  const nodes = rec(
    frame("F", 0, 0, 0, 0, L({ padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0 })),
    img("A", 0, 0, 100, 50, "a1", "F"),
    img("GHOST", 999, 999, 500, 500, "a2", "F", { layoutIgnore: true }),
    { id: "ARR", type: "arrow", index: "a3", parentId: "F", start: { x: 0, y: 0 }, end: { x: 5, y: 5 } } as AnyNode,
    img("B", 0, 0, 60, 80, "a4", "F"),
  )
  const p = reflowLayoutFrame("F", nodes)
  it("ignored member + arrow do not flow and do not affect hug size", () => {
    expect(at(p, "F")).toMatchObject({ w: 160, h: 80 }) // only A(100)+B(60), cross max(50,80)
    expect(at(p, "GHOST")).toBeUndefined()
    expect(at(p, "ARR")).toBeUndefined()
    expect(at(p, "B")).toMatchObject({ x: 100, y: 0 })
  })
  it("flowChildren returns only the two flowed images in index order", () => {
    const ids = flowChildren(nodes.F as LayoutContainer, nodes).map((n) => n.id)
    expect(ids).toEqual(["A", "B"])
  })
})

describe("layout engine — flow order follows index, not insertion/geometry", () => {
  // declared C,A,B; indices make order B,A,C; x positions are all 0
  const nodes = rec(
    frame("F", 0, 0, 0, 0, L({ padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0 })),
    img("C", 0, 0, 30, 10, "a3", "F"),
    img("A", 0, 0, 100, 10, "a2", "F"),
    img("B", 0, 0, 50, 10, "a1", "F"),
  )
  const s = settle(nodes, "F")
  it("lays out in B,A,C order", () => {
    expect(box(s, "B").x).toBe(0)
    expect(box(s, "A").x).toBe(50)
    expect(box(s, "C").x).toBe(150)
  })
})

describe("layout engine — degenerate guards", () => {
  it("empty hug container → min box (still grabbable)", () => {
    const p = reflowLayoutFrame("F", rec(frame("F", 0, 0, 0, 0, L({ padding: { t: 2, r: 2, b: 2, l: 2 } }))))
    expect(at(p, "F")).toMatchObject({ w: MIN_EMPTY_LAYOUT, h: MIN_EMPTY_LAYOUT })
  })
  it("single child + space-between → no NaN, behaves like start", () => {
    const s = settle(
      rec(
        frame("F", 0, 0, 400, 100, L({ justify: "space-between", gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 }, sizing: { main: "fixed", cross: "hug" } })),
        img("A", 7, 3, 100, 50, "a1", "F"), // off-origin so a move is observable
      ),
      "F",
    )
    expect(Number.isFinite(box(s, "A").x)).toBe(true)
    expect(box(s, "A").x).toBe(0)
  })
  it("non-layout frame id → no patches", () => {
    expect(reflowLayoutFrame("F", rec(frame("F", 0, 0, 100, 100, undefined)))).toEqual([])
  })
})

describe("layout engine — idempotency", () => {
  it("re-reflow of a settled frame yields no patches", () => {
    const nodes = rec(
      frame("F", 1000, 500, 0, 0, L()),
      img("A", 0, 0, 100, 50, "a1", "F"),
      img("B", 0, 0, 60, 80, "a2", "F"),
    )
    const settled = apply(nodes, reflowLayoutFrame("F", nodes))
    expect(reflowLayoutFrame("F", settled)).toEqual([])
  })
})

describe("layout engine — non-layout container child rigid-shifts its subtree", () => {
  // a plain group G (with member M) flowed inside a layout row → G and M move together
  const nodes = rec(
    frame("F", 0, 0, 0, 0, L({ padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0 })),
    img("A", 0, 0, 100, 50, "a1", "F"),
    { id: "G", type: "group", x: 0, y: 0, w: 50, h: 50, index: "a2", parentId: "F" } as AnyNode,
    img("M", 10, 10, 20, 20, "z", "G"), // member of the group, not of the layout frame
  )
  const p = reflowLayoutFrame("F", nodes)
  it("group moves to its flow slot and its member shifts by the same delta", () => {
    expect(at(p, "G")).toMatchObject({ x: 100, y: 0 }) // after A(100)
    expect(at(p, "M")).toMatchObject({ x: 110, y: 10 }) // 10 + dx(100), 10 + dy(0)
  })
})

describe("layout engine — groups are layout containers too (chrome-less)", () => {
  it("a layout group hugs + places children identically to a layout frame", () => {
    // same inputs as the very first 'horizontal hug' frame test → same result
    const g = settle(
      rec(
        grp("G", 1000, 500, 0, 0, L()),
        img("A", 0, 0, 100, 50, "a1", "G"),
        img("B", 0, 0, 60, 80, "a2", "G"),
        img("C", 0, 0, 40, 30, "a3", "G"),
      ),
      "G",
    )
    expect(box(g, "G")).toMatchObject({ x: 1000, y: 500, w: 236, h: 96 })
    expect(box(g, "A")).toMatchObject({ x: 1008, y: 508 })
    expect(box(g, "B")).toMatchObject({ x: 1118, y: 508 })
    expect(box(g, "C")).toMatchObject({ x: 1188, y: 508 })
  })

  it("nests: a layout frame flows a layout group, which flows its own children", () => {
    // F(v) → [ G(h) → [A,B] ]; everything hugs, zero pad/gap
    const s = settle(
      rec(
        frame("F", 0, 0, 0, 0, L({ dir: "v", padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0 })),
        grp("G", 0, 0, 0, 0, L({ padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0 }), "a0", "F"),
        img("A", 0, 0, 100, 50, "a0", "G"),
        img("B", 0, 0, 60, 80, "a1", "G"),
      ),
      "F",
    )
    expect(box(s, "G")).toMatchObject({ w: 160, h: 80 }) // hug of A(100)+B(60), cross max(50,80)
    expect(box(s, "F")).toMatchObject({ w: 160, h: 80 }) // hugs its single group child
    expect(box(s, "A").x).toBe(0)
    expect(box(s, "B").x).toBe(100)
  })

  it("isLayoutContainer: layout group/frame true; plain group/frame & leaves false", () => {
    expect(isLayoutContainer(grp("G", 0, 0, 0, 0, L()))).toBe(true)
    expect(isLayoutContainer(grp("G", 0, 0, 0, 0, undefined))).toBe(false)
    expect(isLayoutContainer(frame("F", 0, 0, 0, 0, L()))).toBe(true)
    expect(isLayoutContainer(frame("F", 0, 0, 0, 0, undefined))).toBe(false)
    expect(isLayoutContainer(img("A", 0, 0, 1, 1, "a0"))).toBe(false)
  })

  it("groupBox: a layout group reports its reflowed (padded) box, not the member union", () => {
    const s = settle(
      rec(
        grp("G", 100, 100, 0, 0, L({ padding: { t: 8, r: 8, b: 8, l: 8 }, gap: 0 })),
        img("A", 0, 0, 40, 20, "a0", "G"),
      ),
      "G",
    )
    const byId = new Map<string, AnyNode>(Object.entries(s))
    // padded hug = 40+16 × 20+16, NOT the bare member union (40×20)
    expect(groupBox(s.G as BoxNode, byId)).toMatchObject({ x: 100, y: 100, w: 56, h: 36 })
  })
})

describe("layout engine — cycle safety (corrupt/cyclic parentId never hangs)", () => {
  it("self-parented layout frame does not stack-overflow", () => {
    const f = frame("F", 0, 0, 50, 50, L())
    ;(f as { parentId: string | null }).parentId = "F" // F is its own parent
    const nodes = rec(f, img("A", 0, 0, 40, 20, "a1", "F"))
    expect(() => reflowLayoutFrame("F", nodes)).not.toThrow()
  })
  it("mutually-parented layout frames do not stack-overflow", () => {
    const a = frame("A", 0, 0, 50, 50, L(), "a0", "B")
    const b = frame("B", 0, 0, 50, 50, L({ dir: "v" }), "a1", "A")
    expect(() => reflowLayoutFrame("A", rec(a, b))).not.toThrow()
    expect(() => reflowLayoutFrame("B", rec(a, b))).not.toThrow()
  })
})

describe("outermostLayoutAncestor", () => {
  const nodes = rec(
    frame("ROW", 0, 0, 0, 0, L()),
    frame("COL", 0, 0, 0, 0, L({ dir: "v" }), "a1", "ROW"),
    img("LEAF", 0, 0, 10, 10, "a1", "COL"),
    frame("PLAIN", 0, 0, 10, 10, undefined, "a9"),
    img("FREE", 0, 0, 10, 10, "a1", null),
  )
  it("walks up to the topmost layout frame", () => {
    expect(outermostLayoutAncestor("LEAF", nodes)).toBe("ROW")
    expect(outermostLayoutAncestor("COL", nodes)).toBe("ROW")
    expect(outermostLayoutAncestor("ROW", nodes)).toBe("ROW")
  })
  it("returns null when neither the node nor any ancestor is a layout frame", () => {
    expect(outermostLayoutAncestor("PLAIN", nodes)).toBe(null)
    expect(outermostLayoutAncestor("FREE", nodes)).toBe(null)
  })
})
