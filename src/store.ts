import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
} from "react"
import type { AnyNode, Camera, PlatDoc, ToolMode } from "./types"
import { resolveEndpoint } from "./geometry"

interface State {
  nodes: Record<string, AnyNode>
  order: string[] // z-order, back -> front
  selectedIds: string[]
  camera: Camera
  tool: ToolMode
}

interface Snapshot {
  nodes: Record<string, AnyNode>
  order: string[]
  selectedIds: string[]
}

const HISTORY_CAP = 100

export class PlatStore {
  private state: State
  private listeners = new Set<() => void>()
  private past: Snapshot[] = []
  private future: Snapshot[] = []
  private gestureSnap: Snapshot | null = null
  /** Optional layout reconciler, run after every committed mutation so a layout
   *  frame's settled coords/hug box can never drift. Injected (store stays
   *  layout-agnostic). It applies ephemeral patches; it must not itself commit. */
  private reconciler: (() => void) | null = null
  readonly: boolean

  constructor(doc: PlatDoc | null, camera: Camera, readonly = false) {
    const nodes: Record<string, AnyNode> = {}
    const order: string[] = []
    for (const n of doc?.nodes ?? []) {
      nodes[n.id] = n
      order.push(n.id)
    }
    this.state = { nodes, order, selectedIds: [], camera, tool: "select" }
    this.readonly = readonly
  }

  // ── subscription ──
  getState = (): State => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    for (const l of this.listeners) l()
  }
  private set(partial: Partial<State>) {
    this.state = { ...this.state, ...partial }
    this.emit()
  }

  // ── derived ──
  byId(): Map<string, AnyNode> {
    return new Map(Object.entries(this.state.nodes))
  }
  orderedNodes(): AnyNode[] {
    return this.state.order.map((id) => this.state.nodes[id]).filter(Boolean)
  }

  // ── read-only (mutation guard; toggled live from the header) ──
  // The flag is set at construction but can flip without a remount. JSX/handlers
  // read the prop directly; this keeps the store's own guard in sync. Entering
  // read-only drops the selection so no stale handles/edit state linger.
  setReadonly = (v: boolean) => {
    if (this.readonly === v) return
    this.readonly = v
    if (v && this.state.selectedIds.length) this.set({ selectedIds: [] })
  }

  // ── camera + tool (never in history) ──
  setCamera = (c: Camera) => this.set({ camera: c })
  setTool = (t: ToolMode) => this.set({ tool: t })

  // ── selection (not itself an undo step) ──
  setSelection = (ids: string[]) => this.set({ selectedIds: ids })
  toggleSelection = (id: string, additive: boolean) => {
    const cur = this.state.selectedIds
    if (additive) {
      this.set({
        selectedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      })
    } else if (!(cur.length === 1 && cur[0] === id)) {
      this.set({ selectedIds: [id] })
    }
  }

  // ── history ──
  private snap(): Snapshot {
    return {
      nodes: this.state.nodes,
      order: this.state.order,
      selectedIds: this.state.selectedIds,
    }
  }
  private changedSince(s: Snapshot): boolean {
    return (
      s.nodes !== this.state.nodes ||
      s.order !== this.state.order ||
      s.selectedIds !== this.state.selectedIds
    )
  }
  private pushUndo(s: Snapshot) {
    this.past.push(s)
    if (this.past.length > HISTORY_CAP) this.past.shift()
    this.future = []
  }

  /** snapshot the doc at gesture start (call on pointerdown that may mutate). */
  beginGesture = () => {
    this.gestureSnap = this.snap()
  }
  /** push the gesture-start snapshot if anything changed. */
  commitGesture = () => {
    if (this.gestureSnap && this.changedSince(this.gestureSnap)) {
      this.pushUndo(this.gestureSnap)
    }
    this.gestureSnap = null
  }
  /** abort a gesture: restore the start snapshot without creating history. */
  cancelGesture = () => {
    if (this.gestureSnap) {
      this.set({ ...this.gestureSnap })
      this.gestureSnap = null
    }
  }
  setReconciler = (fn: (() => void) | null) => {
    this.reconciler = fn
  }
  /** Run the layout reconciler (settles auto-layout frames) without recursing —
   *  callers inside a gesture invoke this before commitGesture. */
  reconcile = () => {
    if (this.readonly) return
    this.reconciler?.()
  }

  /** instant mutation that should be one undo step. Layout reconcile folds in. */
  commit = (fn: () => void) => {
    if (this.readonly) return
    const s = this.snap()
    fn()
    this.reconciler?.()
    if (this.changedSince(s)) this.pushUndo(s)
  }

  undo = () => {
    if (this.readonly) return
    const s = this.past.pop()
    if (!s) return
    this.future.push(this.snap())
    this.set({ ...s })
  }
  redo = () => {
    if (this.readonly) return
    const s = this.future.pop()
    if (!s) return
    this.past.push(this.snap())
    this.set({ ...s })
  }
  canUndo = () => this.past.length > 0
  canRedo = () => this.future.length > 0

  // ── node mutations (immutable: replace only changed node objects) ──

  /** ephemeral — no history (use inside a gesture between begin/commit). */
  patchNodes = (patches: { id: string; patch: Partial<AnyNode> }[]) => {
    if (this.readonly || patches.length === 0) return
    const nodes = { ...this.state.nodes }
    for (const { id, patch } of patches) {
      const cur = nodes[id]
      if (cur) nodes[id] = { ...cur, ...patch } as AnyNode
    }
    this.set({ nodes })
  }

  replaceNode = (node: AnyNode) => {
    if (this.readonly) return
    this.set({ nodes: { ...this.state.nodes, [node.id]: node } })
  }

  addNodes = (newNodes: AnyNode[], select = true) => {
    if (this.readonly) return
    const nodes = { ...this.state.nodes }
    const order = [...this.state.order]
    for (const n of newNodes) {
      nodes[n.id] = n
      order.push(n.id)
    }
    this.set({
      nodes,
      order,
      selectedIds: select ? newNodes.map((n) => n.id) : this.state.selectedIds,
    })
  }

  removeNodes = (ids: string[]) => {
    if (this.readonly || ids.length === 0) return
    const kill = new Set(ids)
    // resolve against the pre-delete map so baked coords are where the arrow
    // visually was, not the stale flat coords from before binding.
    const before = new Map(Object.entries(this.state.nodes))
    const nodes = { ...this.state.nodes }
    for (const id of ids) delete nodes[id]
    // unbind arrows that referenced removed nodes (bake to resolved coords)
    for (const id of Object.keys(nodes)) {
      const n = nodes[id]
      if (n.type === "arrow") {
        let next = n
        for (const term of ["start", "end"] as const) {
          const ep = next[term]
          if (ep.binding && kill.has(ep.binding.nodeId)) {
            const p = resolveEndpoint(ep, before)
            next = { ...next, [term]: { x: p.x, y: p.y, binding: null } }
          }
        }
        if (next !== n) nodes[id] = next
      } else if (n.parentId && kill.has(n.parentId)) {
        // orphan members of a deleted group/frame (keep the content)
        nodes[id] = { ...n, parentId: null }
      }
    }
    this.set({
      nodes,
      order: this.state.order.filter((id) => !kill.has(id)),
      selectedIds: this.state.selectedIds.filter((id) => !kill.has(id)),
    })
  }

  bringToFront = (ids: string[]) => {
    const set = new Set(ids)
    this.set({
      order: [...this.state.order.filter((id) => !set.has(id)), ...this.state.order.filter((id) => set.has(id))],
    })
  }
  sendToBack = (ids: string[]) => {
    const set = new Set(ids)
    this.set({
      order: [...this.state.order.filter((id) => set.has(id)), ...this.state.order.filter((id) => !set.has(id))],
    })
  }
  /** Move each selected id one step toward the front (preserving relative order). */
  bringForward = (ids: string[]) => {
    const set = new Set(ids)
    const order = [...this.state.order]
    for (let i = order.length - 2; i >= 0; i--) {
      if (set.has(order[i]) && !set.has(order[i + 1])) {
        ;[order[i], order[i + 1]] = [order[i + 1], order[i]]
      }
    }
    this.set({ order })
  }
  sendBackward = (ids: string[]) => {
    const set = new Set(ids)
    const order = [...this.state.order]
    for (let i = 1; i < order.length; i++) {
      if (set.has(order[i]) && !set.has(order[i - 1])) {
        ;[order[i], order[i - 1]] = [order[i - 1], order[i]]
      }
    }
    this.set({ order })
  }

  /** Replace the whole document (used once on load) and reset history. */
  load = (doc: PlatDoc) => {
    const nodes: Record<string, AnyNode> = {}
    const order: string[] = []
    for (const n of doc.nodes) {
      nodes[n.id] = n
      order.push(n.id)
    }
    this.past = []
    this.future = []
    this.gestureSnap = null
    this.set({ nodes, order, selectedIds: [] })
  }

  toDoc = (): PlatDoc => ({
    format: "plat",
    version: 1,
    nodes: this.orderedNodes(),
  })
}

// ── React glue ──
export const PlatStoreContext = createContext<PlatStore | null>(null)

export function useStore(): PlatStore {
  const s = useContext(PlatStoreContext)
  if (!s) throw new Error("useStore outside PlatStoreContext")
  return s
}

/** Subscribe to a derived slice; selector MUST return a stable ref/primitive. */
export function useSel<T>(store: PlatStore, selector: (s: PlatStore) => T): T {
  const getSnap = useCallback(() => selector(store), [store, selector])
  return useSyncExternalStore(store.subscribe, getSnap, getSnap)
}

// shared stable selectors
export const selNodes = (s: PlatStore) => s.getState().nodes
export const selOrder = (s: PlatStore) => s.getState().order
export const selSelected = (s: PlatStore) => s.getState().selectedIds
export const selCamera = (s: PlatStore) => s.getState().camera
export const selTool = (s: PlatStore) => s.getState().tool
