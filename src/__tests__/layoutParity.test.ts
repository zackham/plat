// Golden-fixture parity between layout.ts and its python port
// (scripts/canvases/reflow.py). Both engines settle the same input docs from
// fixtures/layout-parity.json and must land on byte-identical x/y/w/h — the
// fixture is also asserted by tests/test_canvas_reflow.py on the python side,
// so a drift in either implementation breaks one of the two suites.
//
// If you change layout semantics: update BOTH engines, regenerate the fixture
// (see tests/test_canvas_reflow.py for the generator pointer), and make sure
// both suites pass.

import { describe, expect, it } from "vitest"
import { reflowLayoutFrame, outermostLayoutAncestor } from "../layout"
import { isLayoutContainer } from "../types"
import type { AnyNode } from "../types"
import fixture from "./fixtures/layout-parity.json"

interface Case {
  name: string
  input: { nodes: AnyNode[] }
  expected: Record<string, { x: number; y: number; w: number; h: number }>
}

/** Doc-level settle: reflow every outermost layout container (the pure-data
 *  equivalent of layoutCommands.reconcileLayout / python reflow_doc). */
function settleDoc(nodes: AnyNode[]): Record<string, AnyNode> {
  const byId: Record<string, AnyNode> = {}
  for (const n of nodes) byId[n.id] = n
  const roots = new Set<string>()
  for (const id in byId) {
    if (isLayoutContainer(byId[id])) {
      const top = outermostLayoutAncestor(id, byId)
      if (top) roots.add(top)
    }
  }
  for (const r of roots) {
    for (const p of reflowLayoutFrame(r, byId)) {
      byId[p.id] = { ...byId[p.id], ...p.patch } as AnyNode
    }
  }
  return byId
}

describe("layout.ts ↔ reflow.py parity (golden fixtures)", () => {
  for (const c of fixture as unknown as Case[]) {
    it(c.name, () => {
      const settled = settleDoc(c.input.nodes)
      for (const [id, exp] of Object.entries(c.expected)) {
        const n = settled[id] as AnyNode & { x: number; y: number; w: number; h: number }
        expect(n, `node ${id} missing`).toBeDefined()
        expect(
          { x: n.x, y: n.y, w: n.w, h: n.h },
          `node ${id} in case ${c.name}`,
        ).toEqual(exp)
      }
    })
  }
})
