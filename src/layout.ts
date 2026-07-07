// Pure auto-layout reflow engine.
//
// Given a layout container (group or frame), computes the absolute position of
// every flow child and the container's (hug) size, recursively for nested layout
// containers. group = invisible scaffold, frame = titled/bordered — auto-layout is
// orthogonal to chrome, so the engine treats both identically. This is a
// PURE, SYNCHRONOUS function over fixed-size inputs — no React, no DOM, no store
// — so it is exhaustively unit-testable. It excludes the genuine flexbox
// minefield by design: no fill/grow, no stretch, no wrap, no content-measurement
// (children use their stored w/h). What remains — hug/fixed sizing, single-axis
// flow, nesting via recursion, counter-axis alignment via a local second pass —
// is deterministic and drift-free (exact float arithmetic: the running cursor and
// the hug extent share the same sum, so a hug box always exactly fits its flow).
//
// Two phases:
//   measure(node)  → outer size, bottom-up (hug = fn of children; fixed = stored)
//   place(node,x,y) → emit absolute positions top-down, recursing into containers
//
// Reflow preserves the frame's own (x,y) anchor; only its w/h (when hugging) and
// its descendants' positions change.

import type { AnyNode, BoxNode, LayoutContainer } from "./types"
import { isArrow, isLayoutContainer } from "./types"

export interface LayoutPatch {
  id: string
  patch: { x?: number; y?: number; w?: number; h?: number }
}

type Nodes = Record<string, AnyNode>
type Size = { w: number; h: number }

/** Min size for an empty hug container so it stays grabbable / drop-targetable. */
export const MIN_EMPTY_LAYOUT = 24

/** Flow children of a layout frame: box members, not layout-ignored, in `index`
 *  order. Arrows and layoutIgnore members never participate in the flow. */
export function flowChildren(frame: LayoutContainer, nodes: Nodes): BoxNode[] {
  const kids: BoxNode[] = []
  for (const id in nodes) {
    const n = nodes[id]
    if (isArrow(n)) continue
    const b = n as BoxNode
    if (b.parentId === frame.id && !b.layoutIgnore) kids.push(b)
  }
  kids.sort((a, b) => {
    const ai = a.index ?? ""
    const bi = b.index ?? ""
    return ai < bi ? -1 : ai > bi ? 1 : 0
  })
  return kids
}

/** Measured outer size of a node, recursive for nested layout frames. Leaves and
 *  non-layout containers use their stored w/h (no content measurement). */
function measure(
  node: BoxNode,
  nodes: Nodes,
  memo: Map<string, Size>,
  stack: Set<string> = new Set(),
): Size {
  const cached = memo.get(node.id)
  if (cached) return cached

  // Leaf, or a parentId cycle (node already being measured): use the stored box
  // and don't recurse. The cycle guard makes a corrupt/cyclic doc safe (no hang).
  if (!isLayoutContainer(node) || stack.has(node.id)) {
    const s = { w: node.w, h: node.h }
    memo.set(node.id, s)
    return s
  }
  stack.add(node.id)

  const L = node.layout
  const horiz = L.dir === "h"
  const mainKey = horiz ? "w" : "h"
  const crossKey = horiz ? "h" : "w"
  const padMain = horiz ? L.padding.l + L.padding.r : L.padding.t + L.padding.b
  const padCross = horiz ? L.padding.t + L.padding.b : L.padding.l + L.padding.r

  const kids = flowChildren(node, nodes)
  let size: Size
  if (kids.length === 0) {
    const mainSize = L.sizing.main === "hug" ? Math.max(padMain, MIN_EMPTY_LAYOUT) : node[mainKey]
    const crossSize = L.sizing.cross === "hug" ? Math.max(padCross, MIN_EMPTY_LAYOUT) : node[crossKey]
    size = horiz ? { w: mainSize, h: crossSize } : { w: crossSize, h: mainSize }
  } else {
    const sizes = kids.map((k) => measure(k, nodes, memo, stack))
    const contentMain =
      sizes.reduce((s, sz) => s + sz[mainKey], 0) + L.gap * (kids.length - 1)
    const contentCross = Math.max(...sizes.map((sz) => sz[crossKey]))
    const mainSize = L.sizing.main === "hug" ? contentMain + padMain : node[mainKey]
    const crossSize = L.sizing.cross === "hug" ? contentCross + padCross : node[crossKey]
    size = horiz ? { w: mainSize, h: crossSize } : { w: crossSize, h: mainSize }
  }
  stack.delete(node.id)
  memo.set(node.id, size)
  return size
}

/** Emit {x,y,w,h} for `node` at (x,y), then position its flow children. Non-layout
 *  container children (group / plain frame) are rigid-shifted with their whole
 *  subtree; nested layout-frame children recurse. */
function place(
  node: BoxNode,
  x: number,
  y: number,
  nodes: Nodes,
  memo: Map<string, Size>,
  out: LayoutPatch[],
  stack: Set<string> = new Set(),
): void {
  const size = measure(node, nodes, memo)
  out.push({ id: node.id, patch: { x, y, w: size.w, h: size.h } })
  if (!isLayoutContainer(node) || stack.has(node.id)) return // cycle guard
  stack.add(node.id)

  const L = node.layout
  const horiz = L.dir === "h"
  const kids = flowChildren(node, nodes)
  if (kids.length === 0) return

  const sizes = kids.map((k) => measure(k, nodes, memo))
  const mainKey = horiz ? "w" : "h"
  const crossKey = horiz ? "h" : "w"
  const padMainStart = horiz ? L.padding.l : L.padding.t
  const padMainEnd = horiz ? L.padding.r : L.padding.b
  const padCrossStart = horiz ? L.padding.t : L.padding.l
  const padCrossEnd = horiz ? L.padding.b : L.padding.r

  const innerMain = size[mainKey] - padMainStart - padMainEnd
  const innerCross = size[crossKey] - padCrossStart - padCrossEnd
  const sumMain = sizes.reduce((s, sz) => s + sz[mainKey], 0)
  const nGaps = kids.length - 1
  const leftover = innerMain - (sumMain + L.gap * nGaps)

  // primary-axis distribution
  let cursor = padMainStart
  let stride = L.gap
  if (L.justify === "center") cursor += leftover / 2
  else if (L.justify === "end") cursor += leftover
  else if (L.justify === "space-between" && nGaps > 0) stride = L.gap + leftover / nGaps

  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    const sz = sizes[i]
    // counter-axis alignment
    let crossOff = padCrossStart
    if (L.align === "center") crossOff += (innerCross - sz[crossKey]) / 2
    else if (L.align === "end") crossOff += innerCross - sz[crossKey]

    const mainAbs = (horiz ? x : y) + cursor
    const crossAbs = (horiz ? y : x) + crossOff
    const kx = horiz ? mainAbs : crossAbs
    const ky = horiz ? crossAbs : mainAbs

    if (isLayoutContainer(k)) {
      place(k, kx, ky, nodes, memo, out, stack)
    } else {
      // rigid-shift this child and anything it owns (group / plain-frame members)
      shiftSubtree(k, kx - k.x, ky - k.y, nodes, out)
    }
    cursor += sz[mainKey] + stride
  }
}

/** Emit position patches for `node` and every box it transitively owns, shifted
 *  by (dx,dy). Used for non-layout container children of a layout frame. */
function shiftSubtree(
  node: BoxNode,
  dx: number,
  dy: number,
  nodes: Nodes,
  out: LayoutPatch[],
  seen: Set<string> = new Set(),
): void {
  if (seen.has(node.id)) return // cycle guard
  seen.add(node.id)
  out.push({ id: node.id, patch: { x: node.x + dx, y: node.y + dy } })
  for (const id in nodes) {
    const c = nodes[id]
    if (isArrow(c)) continue
    if ((c as BoxNode).parentId === node.id) shiftSubtree(c as BoxNode, dx, dy, nodes, out, seen)
  }
}

/**
 * Reflow a layout frame and all its nested layout descendants. Returns the
 * minimal set of patches (no-ops where a value is unchanged are filtered out, so
 * a re-reflow of an already-settled frame returns []). Anchors the frame at its
 * current (x,y). Returns [] if `frameId` is not a layout frame.
 */
export function reflowLayoutFrame(frameId: string, nodes: Nodes): LayoutPatch[] {
  const frame = nodes[frameId]
  if (!frame || !isLayoutContainer(frame)) return []
  const out: LayoutPatch[] = []
  place(frame as LayoutContainer, frame.x, frame.y, nodes, new Map(), out)
  // drop patches that wouldn't change anything (keeps undo/autosave quiet & idempotent)
  return out.filter(({ id, patch }) => {
    const cur = nodes[id]
    if (!cur || isArrow(cur)) return false
    const b = cur as BoxNode
    return (
      (patch.x !== undefined && patch.x !== b.x) ||
      (patch.y !== undefined && patch.y !== b.y) ||
      (patch.w !== undefined && patch.w !== b.w) ||
      (patch.h !== undefined && patch.h !== b.h)
    )
  })
}

/** The outermost layout-frame ancestor of a node (walk up parentId while the
 *  parent is a layout frame). Returns the node's own id if it's a layout frame
 *  with no layout-frame parent, or null if neither it nor any ancestor is one.
 *  Reconciliation reflows this so nested hug sizes propagate upward. */
export function outermostLayoutAncestor(nodeId: string, nodes: Nodes): string | null {
  let top: string | null = null
  let cur: AnyNode | undefined = nodes[nodeId]
  const seen = new Set<string>() // cycle guard
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (isLayoutContainer(cur)) top = cur.id
    const pid: string | null = !isArrow(cur) ? cur.parentId ?? null : null
    cur = pid ? nodes[pid] : undefined
  }
  return top
}

/**
 * Settle every auto-layout container in a document's node list — the headless
 * equivalent of the editor's reconciler, for programmatic authoring. There is
 * deliberately no reflow-on-load (opening a plat never moves anything), so a
 * process that writes layout containers must settle coordinates before
 * persisting (FORMAT.md §5). Returns a NEW array in the same order with
 * patched x/y/w/h; the input is not mutated. Idempotent.
 */
export function settleDoc(nodes: AnyNode[]): AnyNode[] {
  const byId: Nodes = {}
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
  return nodes.map((n) => byId[n.id])
}
