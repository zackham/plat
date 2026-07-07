// Arrow geometry — straight + elbow, with node binding (normalized 0..1
// anchors, terminal edge-gap, precise-anchor option) and a draggable elbow
// mid-segment. Bound endpoints follow their node; flat endpoints are absolute.

import type { AnyNode, ArrowEndpoint, ArrowNode, Box, Vec } from "../types"
import { isArrow } from "../types"
import { getElbowRoute, type ElbowTerm } from "./elbow"

const GAP = 6 // page-unit gap between arrow tip and bound shape edge

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const len = (v: Vec) => Math.hypot(v.x, v.y)
const uni = (v: Vec): Vec => {
  const l = len(v)
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }
}
const center = (b: Box): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

interface Resolved {
  bound: boolean
  box: Box | null
  /** anchor point in page space (where the binding points). */
  anchorPt: Vec
  precise: boolean
}

function resolveEnd(ep: ArrowEndpoint, byId: Map<string, AnyNode>): Resolved {
  if (ep.binding) {
    const t = byId.get(ep.binding.nodeId)
    if (t && !isArrow(t)) {
      const box = { x: t.x, y: t.y, w: t.w, h: t.h }
      const a = ep.binding.anchor
      const precise =
        ep.binding.isPrecise ?? Math.hypot(a.x - 0.5, a.y - 0.5) > 0.02
      return {
        bound: true,
        box,
        anchorPt: { x: box.x + a.x * box.w, y: box.y + a.y * box.h },
        precise,
      }
    }
  }
  return { bound: false, box: null, anchorPt: { x: ep.x, y: ep.y }, precise: true }
}

/** Where a ray from `from` toward the box center exits the box boundary. */
function edgePoint(box: Box, from: Vec): Vec {
  const c = center(box)
  const d = sub(from, c)
  if (d.x === 0 && d.y === 0) return c
  const hx = box.w / 2
  const hy = box.h / 2
  const tx = d.x === 0 ? Infinity : hx / Math.abs(d.x)
  const ty = d.y === 0 ? Infinity : hy / Math.abs(d.y)
  const t = Math.min(tx, ty)
  return { x: c.x + d.x * t, y: c.y + d.y * t }
}

function straightTerminal(self: Resolved, other: Resolved): Vec {
  if (!self.bound || !self.box) return self.anchorPt
  if (self.precise) return self.anchorPt
  // imprecise/center binding: stop at the edge toward the other end + gap
  const e = edgePoint(self.box, other.anchorPt)
  const out = uni(sub(other.anchorPt, center(self.box)))
  return add(e, { x: out.x * GAP, y: out.y * GAP })
}

export interface ArrowInfo {
  points: Vec[]
  /** unit direction arriving at the end point (for the arrowhead). */
  endDir: Vec
  midHandle?: { axis: "x" | "y"; point: Vec; lo?: number; hi?: number }
  start: Vec
  end: Vec
}

function toElbowTerm(r: Resolved): ElbowTerm {
  return {
    box: r.box ?? { x: r.anchorPt.x, y: r.anchorPt.y, w: 0, h: 0 },
    isPoint: !r.box,
    anchor: r.anchorPt,
  }
}

export function getArrowInfo(a: ArrowNode, byId: Map<string, AnyNode>): ArrowInfo {
  const start = resolveEnd(a.start, byId)
  const end = resolveEnd(a.end, byId)
  if (a.kind === "elbow") {
    const res = getElbowRoute(toElbowTerm(start), toElbowTerm(end), a.elbowMid ?? 0.5)
    return {
      points: res.points,
      endDir: res.endDir,
      midHandle: res.midHandle,
      start: res.points[0],
      end: res.points[res.points.length - 1],
    }
  }
  const s = straightTerminal(start, end)
  const e = straightTerminal(end, start)
  return { points: [s, e], endDir: uni(sub(e, s)), start: s, end: e }
}

/** SVG arrowhead path (two 30° barbs at the end point). */
export function arrowheadPath(end: Vec, dir: Vec, size: number): string {
  const back = { x: end.x - dir.x * size, y: end.y - dir.y * size }
  const rot = (p: Vec, o: Vec, ang: number): Vec => {
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const dx = p.x - o.x
    const dy = p.y - o.y
    return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c }
  }
  const l = rot(back, end, Math.PI / 7)
  const r = rot(back, end, -Math.PI / 7)
  return `M ${l.x} ${l.y} L ${end.x} ${end.y} L ${r.x} ${r.y}`
}

function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function arrowHitDistance(info: ArrowInfo, p: Vec): number {
  let best = Infinity
  for (let i = 0; i < info.points.length - 1; i++) {
    best = Math.min(best, distToSeg(p, info.points[i], info.points[i + 1]))
  }
  return best
}

// ── endpoint snapping (drag an endpoint onto a target → anchor + precise) ──

const SNAP_PX = 12 // screen-pixel snap radius toward center/corner/edge anchors

/** The 9 key connection points of a box: center + 4 corners + 4 edge mids. */
export const ANCHOR_CANDIDATES: { a: Vec; precise: boolean }[] = [
  { a: { x: 0.5, y: 0.5 }, precise: false }, // center
  { a: { x: 0, y: 0 }, precise: true },
  { a: { x: 1, y: 0 }, precise: true },
  { a: { x: 0, y: 1 }, precise: true },
  { a: { x: 1, y: 1 }, precise: true },
  { a: { x: 0.5, y: 0 }, precise: true }, // top
  { a: { x: 0.5, y: 1 }, precise: true }, // bottom
  { a: { x: 0, y: 0.5 }, precise: true }, // left
  { a: { x: 1, y: 0.5 }, precise: true }, // right
]

/** Given a page point inside a target box, compute the binding anchor.
 *  Snap radius is a fixed screen distance (SNAP_PX / zoom in page units), so
 *  zooming in lets you place an endpoint precisely near — but not on — a corner. */
export function anchorForPoint(
  page: Vec,
  box: Box,
  zoom = 1,
): { anchor: Vec; isPrecise: boolean } {
  const r = SNAP_PX / zoom // page-unit radius
  let best: { a: Vec; precise: boolean } | null = null
  let bestD = Infinity
  for (const c of ANCHOR_CANDIDATES) {
    const px = box.x + c.a.x * box.w
    const py = box.y + c.a.y * box.h
    const d = Math.hypot(page.x - px, page.y - py)
    if (d <= r && d < bestD) {
      bestD = d
      best = c
    }
  }
  if (best) return { anchor: { ...best.a }, isPrecise: best.precise }
  const raw = {
    x: box.w ? (page.x - box.x) / box.w : 0.5,
    y: box.h ? (page.y - box.y) / box.h : 0.5,
  }
  return {
    anchor: { x: Math.max(0, Math.min(1, raw.x)), y: Math.max(0, Math.min(1, raw.y)) },
    isPrecise: true,
  }
}
