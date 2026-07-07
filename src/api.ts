// PlatApi — the runtime controller. Everything a host application (or a
// custom node renderer, via usePlatApi) can do to a mounted plat at runtime:
// create/patch/connect nodes, group mutations into undo steps, stream content
// without history spam, drive the camera, and subscribe to changes.
//
// The same object is what `onReady` hands out (PlatHandle is an alias kept
// from earlier releases). Everything here goes through the store's normal
// commit/gesture machinery, so undo/redo and the auto-layout reconciler see
// api mutations exactly like editor mutations.

import { createContext, useContext } from "react"
import { genNodeId } from "./ids"
import type { MeasureDataStore } from "./measureData"
import type { NodeTypeRegistry } from "./nodeTypes"
import type { PlatStore } from "./store"
import { isArrow } from "./types"
import type {
  AnyNode,
  ArrowNode,
  Box,
  BoxNode,
  Camera,
  PlatDoc,
  Vec,
} from "./types"

/** Input to api.create — everything optional except type/x/y. Unknown fields
 *  pass through onto the node (built-ins: `text`, `src`, `measureId`, …;
 *  custom types use `props`). Sizes default from the node type's defaultSize. */
export interface PlatNodeInit {
  type: string
  x: number
  y: number
  w?: number
  h?: number
  id?: string
  index?: string
  parentId?: string | null
  props?: Record<string, unknown>
  [extra: string]: unknown
}

export interface ConnectOptions {
  /** 0..1 anchors within each node's bounds. Defaults: from {1, 0.5} → to {0, 0.5}. */
  fromAnchor?: Vec
  toAnchor?: Vec
  color?: string
  kind?: "straight" | "elbow" | "curve"
  /** "none" for tree-link styling without an arrowhead. */
  arrowhead?: "end" | "none"
}

export interface ZoomToOptions {
  /** Tween duration in ms; 0/absent = jump. */
  animate?: number
  /** Page-units padding around the target. */
  padding?: number
  maxZoom?: number
}

export type PlatApiEvent = "change" | "selection" | "camera"

interface Attachment {
  getRect: () => DOMRect | null
}

export class PlatApi {
  private store: PlatStore
  private measures: MeasureDataStore
  private registry: NodeTypeRegistry
  private attachment: Attachment | null = null
  private listeners: Record<PlatApiEvent, Set<() => void>> = {
    change: new Set(),
    selection: new Set(),
    camera: new Set(),
  }
  private tweenId = 0
  private tweenApplying = false

  constructor(store: PlatStore, measures: MeasureDataStore, registry: NodeTypeRegistry) {
    this.store = store
    this.measures = measures
    this.registry = registry
    let prev = store.getState()
    store.subscribe(() => {
      const s = store.getState()
      if (s.nodes !== prev.nodes || s.order !== prev.order) this.emit("change")
      if (s.selectedIds !== prev.selectedIds) this.emit("selection")
      if (s.camera !== prev.camera) {
        // a camera move we didn't apply ourselves cancels any running tween
        if (!this.tweenApplying) this.tweenId++
        this.emit("camera")
      }
      prev = s
    })
  }

  /** @internal */ _setRegistry(r: NodeTypeRegistry) {
    this.registry = r
  }
  /** @internal */ _attach(a: Attachment) {
    this.attachment = a
  }

  private emit(ev: PlatApiEvent) {
    for (const cb of this.listeners[ev]) cb()
  }

  // ── document ─────────────────────────────────────────────

  getDoc(): PlatDoc {
    return this.store.toDoc()
  }

  getNode(id: string): AnyNode | undefined {
    return this.store.getState().nodes[id]
  }

  /** Create node(s) in one undo step. Fills id, index, size (from the node
   *  type's defaultSize) and props (over defaultProps). Returns the created
   *  nodes. Positions are absolute page coordinates. */
  create(init: PlatNodeInit | PlatNodeInit[], opts: { select?: boolean } = {}): AnyNode[] {
    const inits = Array.isArray(init) ? init : [init]
    const created = inits.map((i) => this.materialize(i))
    this.store.commit(() => this.store.addNodes(created, opts.select ?? false))
    return created.map((n) => this.store.getState().nodes[n.id] ?? n)
  }

  private materialize(i: PlatNodeInit): AnyNode {
    const def = this.registry.get(i.type)
    const { type, x, y, w, h, id, index, parentId, props, ...extra } = i
    const node = {
      id: id ?? genNodeId(),
      type,
      x,
      y,
      w: w ?? def?.defaultSize?.w ?? 240,
      h: h ?? def?.defaultSize?.h ?? 160,
      index: index ?? "",
      parentId: parentId ?? null,
      ...extra,
    } as Record<string, unknown>
    if (type.includes(".")) {
      node.props = { ...(def?.defaultProps ?? {}), ...(props ?? {}) }
    } else if (def?.defaultProps) {
      // built-ins keep their flat fields; defaults fill anything not provided
      for (const [k, v] of Object.entries(def.defaultProps)) {
        if (!(k in node)) node[k] = v
      }
    }
    return node as unknown as AnyNode
  }

  /** Shallow-merge node fields (x/y/w/h/…). `history: false` = ephemeral
   *  (no undo entry) — pair with beginEphemeral/endEphemeral for streams. */
  updateNode(id: string, patch: Partial<AnyNode>, opts: { history?: boolean } = {}): void {
    if (opts.history === false) {
      this.store.patchNodes([{ id, patch }])
      this.store.reconcile()
    } else {
      this.store.commit(() => this.store.patchNodes([{ id, patch }]))
    }
  }

  /** Shallow-merge into a custom node's `props`. Same history semantics. */
  updateProps(
    id: string,
    props: Record<string, unknown>,
    opts: { history?: boolean } = {},
  ): void {
    const cur = this.getNode(id)
    if (!cur || isArrow(cur)) return
    const merged = { ...((cur as BoxNode & { props?: Record<string, unknown> }).props ?? {}), ...props }
    this.updateNode(id, { props: merged } as Partial<AnyNode>, opts)
  }

  remove(ids: string | string[]): void {
    const list = Array.isArray(ids) ? ids : [ids]
    this.store.commit(() => this.store.removeNodes(list))
  }

  /** Create a bound arrow between two nodes (one undo step). */
  connect(fromId: string, toId: string, opts: ConnectOptions = {}): ArrowNode {
    const arrow: ArrowNode = {
      id: genNodeId(),
      type: "arrow",
      index: "",
      start: {
        x: 0,
        y: 0,
        binding: { nodeId: fromId, anchor: opts.fromAnchor ?? { x: 1, y: 0.5 } },
      },
      end: {
        x: 0,
        y: 0,
        binding: { nodeId: toId, anchor: opts.toAnchor ?? { x: 0, y: 0.5 } },
      },
      ...(opts.color ? { color: opts.color } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.arrowhead ? { arrowhead: opts.arrowhead } : {}),
    }
    this.store.commit(() => this.store.addNodes([arrow], false))
    return arrow
  }

  /** Group several mutations into ONE undo step. */
  batch(fn: () => void): void {
    this.store.commit(fn)
  }

  /** Streaming pattern: snapshot now, apply many `history:false` updates,
   *  then endEphemeral() — the whole stream lands as ONE undo step. */
  beginEphemeral(): void {
    this.store.beginGesture()
  }
  endEphemeral(): void {
    this.store.reconcile()
    this.store.commitGesture()
  }

  // ── selection ────────────────────────────────────────────

  getSelection(): string[] {
    return this.store.getState().selectedIds
  }
  select(ids: string[]): void {
    this.store.setSelection(ids)
  }

  // ── camera ───────────────────────────────────────────────

  getCamera(): Camera {
    return this.store.getState().camera
  }
  setCamera(partial: Partial<Camera>): void {
    this.tweenId++ // manual camera set cancels tweens
    this.store.setCamera({ ...this.getCamera(), ...partial })
  }

  /** Center a node (or explicit page-space box) in the viewport, optionally
   *  animated. Resolves when the move completes or is superseded. */
  async zoomTo(target: string | Box, opts: ZoomToOptions = {}): Promise<void> {
    const rect = this.attachment?.getRect()
    if (!rect) return
    let box: Box
    if (typeof target === "string") {
      const n = this.getNode(target)
      if (!n || isArrow(n)) return
      box = { x: n.x, y: n.y, w: n.w, h: n.h }
    } else {
      box = target
    }
    const pad = opts.padding ?? 48
    const padded = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
    const maxZ = opts.maxZoom ?? 1
    const z = Math.max(
      0.1,
      Math.min(maxZ, Math.min(rect.width / (padded.w || 1), rect.height / (padded.h || 1))),
    )
    const dest: Camera = {
      x: rect.width / 2 / z - (padded.x + padded.w / 2),
      y: rect.height / 2 / z - (padded.y + padded.h / 2),
      z,
    }
    const dur = opts.animate ?? 0
    if (dur <= 0 || typeof requestAnimationFrame === "undefined") {
      this.tweenId++
      this.store.setCamera(dest)
      return
    }
    const from = this.getCamera()
    const id = ++this.tweenId
    const t0 = performance.now()
    const ease = (u: number) => 1 - Math.pow(1 - u, 3) // easeOutCubic
    await new Promise<void>((resolve) => {
      const step = () => {
        if (id !== this.tweenId) return resolve() // superseded/cancelled
        const u = Math.min(1, (performance.now() - t0) / dur)
        const k = ease(u)
        this.tweenApplying = true
        this.store.setCamera({
          x: from.x + (dest.x - from.x) * k,
          y: from.y + (dest.y - from.y) * k,
          z: from.z + (dest.z - from.z) * k,
        })
        this.tweenApplying = false
        if (u < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }

  zoomToFit(opts: ZoomToOptions = {}): void {
    const nodes = this.store.orderedNodes().filter((n) => !isArrow(n)) as BoxNode[]
    if (!nodes.length) return
    const x1 = Math.min(...nodes.map((n) => n.x))
    const y1 = Math.min(...nodes.map((n) => n.y))
    const x2 = Math.max(...nodes.map((n) => n.x + n.w))
    const y2 = Math.max(...nodes.map((n) => n.y + n.h))
    void this.zoomTo({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, opts)
  }

  /** Convert client (viewport) coordinates to page coordinates. */
  clientToPage(client: Vec): Vec {
    const rect = this.attachment?.getRect()
    const cam = this.getCamera()
    const cx = client.x - (rect?.left ?? 0)
    const cy = client.y - (rect?.top ?? 0)
    return { x: cx / cam.z - cam.x, y: cy / cam.z - cam.y }
  }
  pageToClient(page: Vec): Vec {
    const rect = this.attachment?.getRect()
    const cam = this.getCamera()
    return {
      x: (page.x + cam.x) * cam.z + (rect?.left ?? 0),
      y: (page.y + cam.y) * cam.z + (rect?.top ?? 0),
    }
  }

  /** Page coordinates of the current viewport center. */
  viewportCenterPage(): Vec {
    const rect = this.attachment?.getRect()
    const cam = this.getCamera()
    const w = rect?.width ?? 0
    const h = rect?.height ?? 0
    return { x: w / 2 / cam.z - cam.x, y: h / 2 / cam.z - cam.y }
  }

  // ── events ───────────────────────────────────────────────

  on(event: PlatApiEvent, cb: () => void): () => void {
    this.listeners[event].add(cb)
    return () => {
      this.listeners[event].delete(cb)
    }
  }

  // ── measures (built-in node type helpers, kept for hosts) ──

  /** Drop a measure node at the viewport center (one undo step). */
  insertMeasure(measureId: string): void {
    const c = this.viewportCenterPage()
    const size = this.registry.get("measure")?.defaultSize ?? { w: 240, h: 160 }
    this.create(
      {
        type: "measure",
        x: c.x - size.w / 2,
        y: c.y - size.h / 2,
        measureId,
        fontScale: 1,
      },
      { select: true },
    )
  }

  /** Re-fetch every cached measure (host data changed out-of-band). */
  refetchMeasures(): void {
    this.measures.refetchAll()
  }
}

/** Kept from earlier releases: the onReady handle IS the full runtime api. */
export type PlatHandle = PlatApi

export const PlatApiContext = createContext<PlatApi | null>(null)

/** The runtime api, available anywhere under <Plat> — including inside
 *  custom node renderers. */
export function usePlatApi(): PlatApi {
  const api = useContext(PlatApiContext)
  if (!api) throw new Error("usePlatApi outside Plat")
  return api
}
