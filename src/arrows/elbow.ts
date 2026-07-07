// Elbow arrow router — an orthogonal route that adapts to which edge each end
// connects to:
//   • side ↔ side  → 2 bends (Z / C route) with a draggable middle segment
//   • side ↔ top   → 1 bend (L route)
// The exit side is taken from the binding anchor when it sits on an edge
// (top/bottom/left/right), otherwise inferred from the direction to the other
// end. Intentionally NOT auto-avoiding obstacles — predictable, manually steered.

import type { Box, Vec } from "../types"

export const ELBOW_PAD = 24 // minimum leg length out of a shape edge
const EPS = 0.01
const EDGE = 0.02 // normalized tolerance for "anchor sits on this edge"

export interface ElbowTerm {
  box: Box
  isPoint: boolean
  anchor: Vec
}

export interface ElbowResult {
  points: Vec[]
  endDir: Vec
  midHandle?: { axis: "x" | "y"; point: Vec; lo: number; hi: number }
}

type Side = "left" | "right" | "top" | "bottom"

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const cx = (b: Box) => b.x + b.w / 2
const cy = (b: Box) => b.y + b.h / 2
const axisOf = (s: Side): "h" | "v" => (s === "left" || s === "right" ? "h" : "v")
const dirOut = (s: Side): Vec =>
  s === "right" ? { x: 1, y: 0 } : s === "left" ? { x: -1, y: 0 } : s === "top" ? { x: 0, y: -1 } : { x: 0, y: 1 }

function exitPoint(t: ElbowTerm, side: Side): Vec {
  if (t.isPoint || t.box.w === 0 || t.box.h === 0) return { x: t.anchor.x, y: t.anchor.y }
  const b = t.box
  switch (side) {
    case "right":
      return { x: b.x + b.w, y: clamp(t.anchor.y, b.y, b.y + b.h) }
    case "left":
      return { x: b.x, y: clamp(t.anchor.y, b.y, b.y + b.h) }
    case "top":
      return { x: clamp(t.anchor.x, b.x, b.x + b.w), y: b.y }
    case "bottom":
      return { x: clamp(t.anchor.x, b.x, b.x + b.w), y: b.y + b.h }
  }
}

function inferSide(from: Vec, toward: Vec): Side {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left"
  return dy >= 0 ? "bottom" : "top"
}

/** Which edge this end leaves from: the bound edge if the anchor sits on one,
 *  else inferred from the direction to the other end's center. */
function classifySide(t: ElbowTerm, otherC: Vec): Side {
  const c = t.isPoint ? t.anchor : { x: cx(t.box), y: cy(t.box) }
  if (t.isPoint || t.box.w === 0 || t.box.h === 0) return inferSide(c, otherC)
  const nx = (t.anchor.x - t.box.x) / t.box.w
  const ny = (t.anchor.y - t.box.y) / t.box.h
  const nearL = nx <= EDGE, nearR = nx >= 1 - EDGE
  const nearT = ny <= EDGE, nearB = ny >= 1 - EDGE
  const h = nearL || nearR
  const v = nearT || nearB
  if (h && v) {
    // corner anchor — pick the axis that faces the other end
    if (Math.abs(otherC.x - c.x) >= Math.abs(otherC.y - c.y)) return nearL ? "left" : "right"
    return nearT ? "top" : "bottom"
  }
  if (h) return nearL ? "left" : "right"
  if (v) return nearT ? "top" : "bottom"
  return inferSide(c, otherC) // interior anchor → infer
}

/** Merge near-duplicate & collinear points -> straight where possible. */
function simplify(pts: Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of pts) {
    const p1 = out[out.length - 1]
    const p2 = out[out.length - 2]
    if (!p1) {
      out.push(p)
      continue
    }
    if (Math.abs(p.x - p1.x) < EPS && Math.abs(p.y - p1.y) < EPS) continue
    if (p2) {
      const colX = Math.abs(p.x - p1.x) < EPS && Math.abs(p1.x - p2.x) < EPS
      const colY = Math.abs(p.y - p1.y) < EPS && Math.abs(p1.y - p2.y) < EPS
      if (colX || colY) {
        out[out.length - 1] = p
        continue
      }
    }
    out.push(p)
  }
  return out
}

const dirOf = (a: Vec, b: Vec): Vec => {
  if (Math.abs(b.x - a.x) > Math.abs(b.y - a.y)) return { x: Math.sign(b.x - a.x), y: 0 }
  return { x: 0, y: Math.sign(b.y - a.y) }
}

export function getElbowRoute(a: ElbowTerm, b: ElbowTerm, mid: number): ElbowResult {
  const pad = ELBOW_PAD
  const ac = a.isPoint ? a.anchor : { x: cx(a.box), y: cy(a.box) }
  const bc = b.isPoint ? b.anchor : { x: cx(b.box), y: cy(b.box) }
  const sideA = classifySide(a, bc)
  const sideB = classifySide(b, ac)
  const ea = exitPoint(a, sideA)
  const eb = exitPoint(b, sideB)
  const dA = dirOut(sideA)
  const dB = dirOut(sideB)
  const axA = axisOf(sideA)
  const axB = axisOf(sideB)

  // ── mixed: one horizontal, one vertical → single-bend L ──
  if (axA !== axB) {
    const corner = axA === "h" ? { x: eb.x, y: ea.y } : { x: ea.x, y: eb.y }
    const pts = simplify([ea, corner, eb])
    const endDir = pts.length >= 2 ? dirOf(pts[pts.length - 2], pts[pts.length - 1]) : dB
    return { points: pts, endDir }
  }

  // ── same axis: 2-bend Z (opposite sides) or C (same side) ──
  if (axA === "h") {
    const legA = ea.x + dA.x * pad
    const legB = eb.x + dB.x * pad
    const opposite = dA.x !== dB.x
    const defSeam = opposite ? (legA + legB) / 2 : dA.x > 0 ? Math.max(legA, legB) : Math.min(legA, legB)
    const lo = Math.min(a.box.x, b.box.x) - pad
    const hi = Math.max(a.box.x + a.box.w, b.box.x + b.box.w) + pad
    const seam = Math.abs(mid - 0.5) < 0.001 ? defSeam : lerp(lo, hi, clamp(mid, 0, 1))
    const pts = simplify([ea, { x: seam, y: ea.y }, { x: seam, y: eb.y }, eb])
    const endDir = pts.length >= 2 ? dirOf(pts[pts.length - 2], pts[pts.length - 1]) : dB
    return {
      points: pts,
      endDir,
      midHandle: pts.length >= 4 ? { axis: "x", point: { x: seam, y: (ea.y + eb.y) / 2 }, lo, hi } : undefined,
    }
  }

  const legA = ea.y + dA.y * pad
  const legB = eb.y + dB.y * pad
  const opposite = dA.y !== dB.y
  const defSeam = opposite ? (legA + legB) / 2 : dA.y > 0 ? Math.max(legA, legB) : Math.min(legA, legB)
  const lo = Math.min(a.box.y, b.box.y) - pad
  const hi = Math.max(a.box.y + a.box.h, b.box.y + b.box.h) + pad
  const seam = Math.abs(mid - 0.5) < 0.001 ? defSeam : lerp(lo, hi, clamp(mid, 0, 1))
  const pts = simplify([ea, { x: ea.x, y: seam }, { x: eb.x, y: seam }, eb])
  const endDir = pts.length >= 2 ? dirOf(pts[pts.length - 2], pts[pts.length - 1]) : dB
  return {
    points: pts,
    endDir,
    midHandle: pts.length >= 4 ? { axis: "y", point: { x: (ea.x + eb.x) / 2, y: seam }, lo, hi } : undefined,
  }
}
