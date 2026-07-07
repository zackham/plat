// Selection operations: align, distribute, group/ungroup. Reorder lives on the
// store. Each command commits one undo step.

import type { PlatStore } from "./store"
import { boxNode, unionBoxes } from "./geometry"
import {
  isArrow,
  type AnyNode,
  type Box,
  type BoxNode,
  type FrameNode,
  type GroupNode,
} from "./types"

export type AlignOp = "left" | "center-x" | "right" | "top" | "center-y" | "bottom"
export type DistributeAxis = "x" | "y"

const genId = () =>
  "g_" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** The selectable "units" — top-level selected nodes; groups carry members. */
function selectedUnits(store: PlatStore): { id: string; box: Box; memberIds: string[] }[] {
  const s = store.getState()
  return s.selectedIds
    .map((id) => s.nodes[id])
    .filter((n): n is BoxNode => !!n && !isArrow(n))
    .map((n) => {
      if (n.type === "group") {
        const members = s.order.filter(
          (k) => !isArrow(s.nodes[k]) && (s.nodes[k] as BoxNode).parentId === n.id,
        )
        const box =
          unionBoxes(members.map((k) => boxNode(s.nodes[k] as BoxNode))) ?? boxNode(n)
        return { id: n.id, box, memberIds: members }
      }
      return { id: n.id, box: boxNode(n), memberIds: [] }
    })
}

function moveUnit(
  store: PlatStore,
  unit: { id: string; memberIds: string[] },
  dx: number,
  dy: number,
) {
  const s = store.getState()
  const patches: { id: string; patch: Partial<AnyNode> }[] = []
  const push = (id: string) => {
    const n = s.nodes[id] as BoxNode
    patches.push({ id, patch: { x: n.x + dx, y: n.y + dy } as Partial<AnyNode> })
  }
  push(unit.id)
  for (const m of unit.memberIds) push(m)
  store.patchNodes(patches)
}

export function align(store: PlatStore, op: AlignOp) {
  const units = selectedUnits(store)
  if (units.length < 2) return
  const common = unionBoxes(units.map((u) => u.box))!
  store.commit(() => {
    for (const u of units) {
      let dx = 0
      let dy = 0
      switch (op) {
        case "left":
          dx = common.x - u.box.x
          break
        case "right":
          dx = common.x + common.w - (u.box.x + u.box.w)
          break
        case "center-x":
          dx = common.x + common.w / 2 - (u.box.x + u.box.w / 2)
          break
        case "top":
          dy = common.y - u.box.y
          break
        case "bottom":
          dy = common.y + common.h - (u.box.y + u.box.h)
          break
        case "center-y":
          dy = common.y + common.h / 2 - (u.box.y + u.box.h / 2)
          break
      }
      if (dx || dy) moveUnit(store, u, dx, dy)
    }
  })
}

export function distribute(store: PlatStore, axis: DistributeAxis) {
  const units = selectedUnits(store)
  if (units.length < 3) return
  const size = (b: Box) => (axis === "x" ? b.w : b.h)
  const min = (b: Box) => (axis === "x" ? b.x : b.y)
  const sorted = [...units].sort((a, b) => min(a.box) - min(b.box))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = min(last.box) + size(last.box) - min(first.box)
  const sumSizes = sorted.reduce((acc, u) => acc + size(u.box), 0)
  const gap = (span - sumSizes) / (sorted.length - 1)
  store.commit(() => {
    let cursor = min(first.box)
    for (const u of sorted) {
      const target = cursor
      const delta = target - min(u.box)
      if (delta) moveUnit(store, u, axis === "x" ? delta : 0, axis === "y" ? delta : 0)
      cursor += size(u.box) + gap
    }
  })
}

export function group(store: PlatStore) {
  const s = store.getState()
  const members = s.selectedIds
    .map((id) => s.nodes[id])
    .filter((n): n is BoxNode => !!n && !isArrow(n) && n.type !== "group")
  if (members.length < 2) return
  const box = unionBoxes(members.map(boxNode))!
  const gid = genId()
  const groupNode: GroupNode = {
    id: gid,
    type: "group",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    index: "",
    parentId: null,
  }
  store.commit(() => {
    store.patchNodes(members.map((m) => ({ id: m.id, patch: { parentId: gid } as Partial<AnyNode> })))
    store.addNodes([groupNode], false)
    store.bringToFront([gid, ...members.map((m) => m.id)])
    store.setSelection([gid])
  })
}

const FRAME_PAD = 24

/** Wrap the selected (non-container) nodes in a titled frame behind them. */
export function frameSelection(store: PlatStore, name = "Frame") {
  const s = store.getState()
  const members = s.selectedIds
    .map((id) => s.nodes[id])
    .filter(
      (n): n is BoxNode => !!n && !isArrow(n) && n.type !== "group" && n.type !== "frame",
    )
  if (members.length === 0) return
  const u = unionBoxes(members.map(boxNode))!
  const fid = "f_" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const frame: FrameNode = {
    id: fid,
    type: "frame",
    x: u.x - FRAME_PAD,
    y: u.y - FRAME_PAD,
    w: u.w + 2 * FRAME_PAD,
    h: u.h + 2 * FRAME_PAD,
    index: "",
    parentId: null,
    name,
  }
  store.commit(() => {
    store.patchNodes(members.map((m) => ({ id: m.id, patch: { parentId: fid } as Partial<AnyNode> })))
    store.addNodes([frame], false)
    store.sendToBack([fid]) // frame renders behind its members
    store.setSelection([fid])
  })
}

export function ungroup(store: PlatStore) {
  const s = store.getState()
  const groups = s.selectedIds
    .map((id) => s.nodes[id])
    .filter((n): n is GroupNode => !!n && !isArrow(n) && n.type === "group")
  if (groups.length === 0) return
  const groupIds = new Set(groups.map((g) => g.id))
  const freed: string[] = []
  store.commit(() => {
    const patches: { id: string; patch: Partial<AnyNode> }[] = []
    for (const id of s.order) {
      const n = s.nodes[id]
      if (n && !isArrow(n) && groupIds.has((n as BoxNode).parentId ?? "")) {
        patches.push({ id, patch: { parentId: null } as Partial<AnyNode> })
        freed.push(id)
      }
    }
    store.patchNodes(patches)
    store.removeNodes([...groupIds])
    store.setSelection(freed)
  })
}
