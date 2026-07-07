import { describe, it, expect } from "vitest"
import { getElbowRoute, type ElbowTerm } from "../arrows/elbow"
import type { Box, Vec } from "../types"

const term = (box: Box, anchor?: Vec): ElbowTerm => ({
  box,
  isPoint: false,
  anchor: anchor ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 },
})

function isOrthogonal(pts: Vec[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = Math.abs(pts[i + 1].x - pts[i].x)
    const dy = Math.abs(pts[i + 1].y - pts[i].y)
    if (dx > 0.5 && dy > 0.5) return false
  }
  return true
}

describe("elbow router (deterministic, manually-steered)", () => {
  const A: Box = { x: 0, y: 0, w: 100, h: 100 }

  it("always produces an orthogonal route", () => {
    for (const B of [
      { x: 300, y: 0, w: 100, h: 100 },
      { x: 0, y: 300, w: 100, h: 100 },
      { x: 300, y: -300, w: 100, h: 100 },
      { x: 40, y: 40, w: 100, h: 100 },
    ] as Box[]) {
      const r = getElbowRoute(term(A), term(B), 0.5)
      expect(isOrthogonal(r.points)).toBe(true)
      expect(r.points.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("collapses to a straight line when endpoints line up", () => {
    const B: Box = { x: 300, y: 0, w: 100, h: 100 }
    expect(getElbowRoute(term(A), term(B), 0.5).points.length).toBe(2)
  })

  it("offset boxes give a 2-bend route with a draggable mid handle", () => {
    const B: Box = { x: 300, y: 160, w: 100, h: 100 }
    const r = getElbowRoute(term(A), term(B), 0.5)
    expect(r.points.length).toBe(4)
    expect(r.midHandle).toBeTruthy()
  })

  it("the mid handle moves the route", () => {
    const B: Box = { x: 300, y: 160, w: 100, h: 100 }
    const r0 = getElbowRoute(term(A), term(B), 0.1)
    const r1 = getElbowRoute(term(A), term(B), 0.9)
    expect(JSON.stringify(r0.points)).not.toBe(JSON.stringify(r1.points))
  })

  it("end direction is a unit axis vector", () => {
    const B: Box = { x: 300, y: 0, w: 100, h: 100 }
    const d = getElbowRoute(term(A), term(B), 0.5).endDir
    expect(Math.abs(Math.abs(d.x) + Math.abs(d.y) - 1)).toBeLessThan(0.001)
  })

  it("side→side (both horizontal) gives a 2-bend route", () => {
    // anchors on the right edge of A and left edge of B → both horizontal
    const B: Box = { x: 300, y: 160, w: 100, h: 100 }
    const a = term(A, { x: A.x + A.w, y: A.y + A.h / 2 }) // right edge
    const b = term(B, { x: B.x, y: B.y + B.h / 2 }) // left edge
    const r = getElbowRoute(a, b, 0.5)
    expect(r.points.length).toBe(4)
    expect(r.midHandle).toBeTruthy()
  })

  it("top→side gives a single-bend L route (no mid handle)", () => {
    // A leaves from its bottom edge, B is entered on its left edge
    const B: Box = { x: 300, y: 300, w: 100, h: 100 }
    const a = term(A, { x: A.x + A.w / 2, y: A.y + A.h }) // bottom edge → vertical
    const b = term(B, { x: B.x, y: B.y + B.h / 2 }) // left edge → horizontal
    const r = getElbowRoute(a, b, 0.5)
    expect(r.points.length).toBe(3) // one corner
    expect(r.midHandle).toBeFalsy()
    expect(isOrthogonal(r.points)).toBe(true)
  })
})
