import type {
  AnyNode,
  ArrowNode,
  Box,
  BoxNode,
  ResizeHandle,
  Vec,
} from "./types"
import { isArrow, isLayoutContainer } from "./types"
import { arrowHitDistance, getArrowInfo } from "./arrows/arrow"

export const MIN_SIZE = 8

export function pointInBox(p: Vec, b: Box, pad = 0): boolean {
  return (
    p.x >= b.x - pad &&
    p.x <= b.x + b.w + pad &&
    p.y >= b.y - pad &&
    p.y <= b.y + b.h + pad
  )
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

export function boxNode(n: BoxNode): Box {
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Resolve an arrow endpoint to a page point (binding-authoritative). */
export function resolveEndpoint(
  ep: ArrowNode["start"],
  byId: Map<string, AnyNode>,
): Vec {
  if (ep.binding) {
    const target = byId.get(ep.binding.nodeId)
    if (target && !isArrow(target)) {
      return {
        x: target.x + target.w * ep.binding.anchor.x,
        y: target.y + target.h * ep.binding.anchor.y,
      }
    }
  }
  return { x: ep.x, y: ep.y }
}

export function arrowPoints(
  a: ArrowNode,
  byId: Map<string, AnyNode>,
): { start: Vec; end: Vec } {
  return { start: resolveEndpoint(a.start, byId), end: resolveEndpoint(a.end, byId) }
}

export function arrowBox(a: ArrowNode, byId: Map<string, AnyNode>): Box {
  const { start, end } = arrowPoints(a, byId)
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  }
}

/** Live bounds of a group = union of its members (the stored box can go stale).
 *  A *layout* group is the exception: its w/h is computed by the reflow engine
 *  (hug = children + padding), so the stored box is authoritative — deriving it
 *  from the bare member union would drop the padding. */
export function groupBox(group: BoxNode, byId: Map<string, AnyNode>): Box {
  if (isLayoutContainer(group)) return boxNode(group)
  const members: Box[] = []
  for (const n of byId.values()) {
    if (!isArrow(n) && (n as BoxNode).parentId === group.id) members.push(boxNode(n as BoxNode))
  }
  return unionBoxes(members) ?? boxNode(group)
}

export function nodeBox(n: AnyNode, byId: Map<string, AnyNode>): Box {
  if (isArrow(n)) return arrowBox(n, byId)
  if (n.type === "group") return groupBox(n as BoxNode, byId)
  return boxNode(n)
}

/** distance from point to segment */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Hit-test a page point against nodes in TOP-FIRST order. Returns the node id or
 * null. `arrowTol` is in page units (caller passes screen-tol / zoom).
 */
export function hitTest(
  page: Vec,
  topFirst: AnyNode[],
  byId: Map<string, AnyNode>,
  arrowTol: number,
): string | null {
  // A frame is a container: its bounds enclose its members, so a naive top-first
  // box test would let the frame swallow clicks meant for a child. Treat frames
  // as a fallback — any real node under the cursor wins; the topmost frame is
  // returned only when the click lands on the frame's empty interior.
  let frameFallback: string | null = null
  for (const n of topFirst) {
    if (isArrow(n)) {
      if (arrowHitDistance(getArrowInfo(n, byId), page) <= arrowTol) return n.id
    } else if (n.type === "frame") {
      if (frameFallback === null && pointInBox(page, boxNode(n))) frameFallback = n.id
    } else if (pointInBox(page, boxNode(n))) {
      return n.id
    }
  }
  return frameFallback
}

// ── snapping ──────────────────────────────────────────────
// Candidate snap lines: each box contributes 3 x-lines (left/centerX/right) and
// 3 y-lines (top/centerY/bottom). We snap the moving selection's own 3+3 lines
// to the nearest static line within threshold, with hysteresis.

export interface SnapGuide {
  axis: "x" | "y"
  /** page coordinate of the guide line */
  pos: number
  /** page-space extent (min,max) of the perpendicular axis, for drawing. */
  from: number
  to: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

function xLines(b: Box): number[] {
  return [b.x, b.x + b.w / 2, b.x + b.w]
}
function yLines(b: Box): number[] {
  return [b.y, b.y + b.h / 2, b.y + b.h]
}

/**
 * Given the moving selection's RAW bounds and the static boxes, return the snap
 * offset (dx,dy) to apply, plus guide lines. `engaged` carries hysteresis state.
 */
export function computeSnap(
  movingBox: Box,
  staticBoxes: Box[],
  zoom: number,
  engaged: { x: boolean; y: boolean },
): SnapResult {
  const engage = 6 / zoom
  const release = 10 / zoom
  const mX = xLines(movingBox)
  const mY = yLines(movingBox)

  let bestX: { off: number; pos: number; mref: number } | null = null
  let bestY: { off: number; pos: number; mref: number } | null = null

  for (const sb of staticBoxes) {
    for (const sx of xLines(sb)) {
      for (const mx of mX) {
        const off = sx - mx
        const thresh = engaged.x ? release : engage
        if (Math.abs(off) <= thresh && (!bestX || Math.abs(off) < Math.abs(bestX.off))) {
          bestX = { off, pos: sx, mref: mx }
        }
      }
    }
    for (const sy of yLines(sb)) {
      for (const my of mY) {
        const off = sy - my
        const thresh = engaged.y ? release : engage
        if (Math.abs(off) <= thresh && (!bestY || Math.abs(off) < Math.abs(bestY.off))) {
          bestY = { off, pos: sy, mref: my }
        }
      }
    }
  }

  const guides: SnapGuide[] = []
  if (bestX) {
    guides.push({
      axis: "x",
      pos: bestX.pos,
      from: movingBox.y - 40,
      to: movingBox.y + movingBox.h + 40,
    })
  }
  if (bestY) {
    guides.push({
      axis: "y",
      pos: bestY.pos,
      from: movingBox.x - 40,
      to: movingBox.x + movingBox.w + 40,
    })
  }
  engaged.x = !!bestX
  engaged.y = !!bestY
  return { dx: bestX?.off ?? 0, dy: bestY?.off ?? 0, guides }
}

// ── resize (no flip; clamp the moving edge so the opposite stays pinned) ──

export function resizeBox(
  initial: Box,
  handle: ResizeHandle,
  pointerPage: Vec,
  opts: { aspect?: boolean; minSize?: number } = {},
): Box {
  const min = opts.minSize ?? MIN_SIZE
  let { x, y, w, h } = initial
  let left = x
  let top = y
  let right = x + w
  let bottom = y + h

  const movesLeft = handle.includes("w")
  const movesRight = handle.includes("e")
  const movesTop = handle.includes("n")
  const movesBottom = handle.includes("s")

  if (movesLeft) left = Math.min(pointerPage.x, right - min)
  if (movesRight) right = Math.max(pointerPage.x, left + min)
  if (movesTop) top = Math.min(pointerPage.y, bottom - min)
  if (movesBottom) bottom = Math.max(pointerPage.y, top + min)

  let nw = right - left
  let nh = bottom - top

  if (opts.aspect && initial.w > 0 && initial.h > 0) {
    const ratio = initial.w / initial.h
    // drive the dominant axis, derive the other; keep the anchor edge fixed
    const drivingX = movesLeft || movesRight
    const drivingY = movesTop || movesBottom
    if (drivingX && drivingY) {
      // corner: use the larger relative change
      if (nw / initial.w >= nh / initial.h) nh = nw / ratio
      else nw = nh * ratio
    } else if (drivingX) {
      nh = nw / ratio
    } else if (drivingY) {
      nw = nh * ratio
    }
    if (movesLeft) left = right - nw
    if (movesTop) top = bottom - nh
  }

  x = movesLeft ? right - nw : left
  y = movesTop ? bottom - nh : top
  w = nw
  h = nh
  return { x, y, w: Math.max(min, w), h: Math.max(min, h) }
}
