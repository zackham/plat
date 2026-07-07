// Auto-layout commands: convert a frame to auto-layout, change its layout props,
// remove layout, and the reconciliation choke point. All go through store.commit
// so the reflow folds into one undo step (store.commit runs the reconciler).

import type { PlatStore } from "./store"
import { reflowLayoutFrame, outermostLayoutAncestor } from "./layout"
import { isArrow, isLayoutContainer } from "./types"
import type { AnyNode, BoxNode, FrameNode, LayoutProps } from "./types"

export const DEFAULT_LAYOUT: LayoutProps = {
  dir: "h",
  gap: 16,
  padding: { t: 16, r: 16, b: 16, l: 16 },
  justify: "start",
  align: "start",
  sizing: { main: "hug", cross: "hug" },
}

/** Ordinal flow-order key. Reassigned wholesale on convert/reorder/insert, so we
 *  never need midpoint (fractional) generation — simple and collision-proof. */
export const flowIndex = (i: number): string => String(i).padStart(6, "0")

/**
 * Reflow every outermost auto-layout frame and apply the settled patches. This is
 * THE choke point: store.commit() calls it after every committed mutation, so a
 * layout frame's child coords + hug box can't drift no matter which code path
 * changed membership/sizes. Idempotent (no patches when already settled). Applies
 * ephemeral patches only — must run inside a commit/gesture, never standalone.
 */
export function reconcileLayout(store: PlatStore): void {
  const nodes = store.getState().nodes
  const roots = new Set<string>()
  for (const id in nodes) {
    if (isLayoutContainer(nodes[id])) {
      const top = outermostLayoutAncestor(id, nodes)
      if (top) roots.add(top)
    }
  }
  if (roots.size === 0) return
  const patches: { id: string; patch: Partial<AnyNode> }[] = []
  for (const r of roots) {
    for (const p of reflowLayoutFrame(r, nodes)) {
      patches.push({ id: p.id, patch: p.patch as Partial<AnyNode> })
    }
  }
  if (patches.length) store.patchNodes(patches)
}

/**
 * Turn a frame into an auto-layout container. `flowChildIds` (in the desired flow
 * order) get fresh ordinal indices and become flow members; every OTHER member of
 * the frame is marked `layoutIgnore` so deliberately-placed annotations/arrows
 * stay put. One committed edit; the reconciler settles coordinates.
 */
export function convertToLayout(
  store: PlatStore,
  frameId: string,
  flowChildIds: string[],
  layout: LayoutProps = DEFAULT_LAYOUT,
): void {
  store.commit(() => {
    const nodes = store.getState().nodes
    const frame = nodes[frameId]
    if (!frame || frame.type !== "frame") return
    const flow = new Set(flowChildIds)
    const patches: { id: string; patch: Partial<AnyNode> }[] = []
    flowChildIds.forEach((id, i) => {
      if (nodes[id]) patches.push({ id, patch: { index: flowIndex(i), layoutIgnore: false } as Partial<AnyNode> })
    })
    for (const id in nodes) {
      const n = nodes[id]
      if (!isArrow(n) && n.parentId === frameId && !flow.has(id)) {
        patches.push({ id, patch: { layoutIgnore: true } as Partial<AnyNode> })
      }
    }
    if (patches.length) store.patchNodes(patches)
    store.replaceNode({ ...(frame as FrameNode), layout })
  })
}

/** Strip auto-layout from a frame (children keep their settled coords). Also
 *  clears stale `layoutIgnore` on members so a later re-convert flows them. */
export function removeLayout(store: PlatStore, frameId: string): void {
  store.commit(() => {
    const nodes = store.getState().nodes
    const f = nodes[frameId]
    if (!f || f.type !== "frame" || !f.layout) return
    const next = { ...(f as FrameNode) }
    delete next.layout
    store.replaceNode(next)
    const cleared: { id: string; patch: Partial<AnyNode> }[] = []
    for (const id in nodes) {
      const n = nodes[id]
      if (!isArrow(n) && (n as BoxNode).parentId === frameId && (n as BoxNode).layoutIgnore) {
        cleared.push({ id, patch: { layoutIgnore: false } as Partial<AnyNode> })
      }
    }
    if (cleared.length) store.patchNodes(cleared)
  })
}

/** Patch a layout frame's props (shallow merge; `padding` deep-merged). */
export function setLayoutProps(
  store: PlatStore,
  frameId: string,
  patch: Partial<LayoutProps>,
): void {
  store.commit(() => {
    const f = store.getState().nodes[frameId]
    if (!f || f.type !== "frame" || !isLayoutContainer(f)) return
    const cur = (f as FrameNode).layout!
    const next: LayoutProps = {
      ...cur,
      ...patch,
      padding: patch.padding ? { ...cur.padding, ...patch.padding } : cur.padding,
      sizing: patch.sizing ? { ...cur.sizing, ...patch.sizing } : cur.sizing,
    }
    store.replaceNode({ ...(f as FrameNode), layout: next })
  })
}
