// Golden-fixture parity between settleDoc (layout.ts) and the origin host's
// python port of the layout engine. Both engines settle the same input docs
// from fixtures/layout-parity.json and must land on byte-identical x/y/w/h —
// the fixture is also asserted by the python suite, so a drift in either
// implementation breaks one of the two.
//
// If you change layout semantics: update BOTH engines, regenerate the
// fixture, and make sure both suites pass.

import { describe, expect, it } from "vitest"
import { settleDoc } from "../layout"
import type { AnyNode } from "../types"
import fixture from "./fixtures/layout-parity.json"

interface Case {
  name: string
  input: { nodes: AnyNode[] }
  expected: Record<string, { x: number; y: number; w: number; h: number }>
}

const byId = (nodes: AnyNode[]): Record<string, AnyNode> => {
  const out: Record<string, AnyNode> = {}
  for (const n of nodes) out[n.id] = n
  return out
}

describe("settleDoc ↔ python reflow parity (golden fixtures)", () => {
  for (const c of fixture as unknown as Case[]) {
    it(c.name, () => {
      const settled = byId(settleDoc(c.input.nodes))
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
