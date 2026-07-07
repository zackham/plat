import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Share2, Check } from "lucide-react"
import { PlatHostContext, notifyError, usePlatHost } from "./host"
import type { PlatHost, PlatHandle } from "./host"
import { MeasureDataContext, MeasureDataStore } from "./measureData"
import {
  PlatStore,
  PlatStoreContext,
  selCamera,
  selNodes,
  selOrder,
  selSelected,
  selTool,
  useSel,
  useStore,
} from "./store"
import {
  frameSelection as frameSelectionCmd,
  group as groupCmd,
  ungroup as ungroupCmd,
} from "./commands"
import { reconcileLayout } from "./layoutCommands"
import { copySelectionAsPng, downloadOriginal } from "./export"
import { anchorForPoint, getArrowInfo, ANCHOR_CANDIDATES } from "./arrows/arrow"
import { getLastArrowKind } from "./arrowPrefs"
import { BottomToolbar } from "./ui/BottomToolbar"
import { StylePanel } from "./ui/StylePanel"
import { ContextMenu } from "./ui/ContextMenu"
import {
  cameraTransform,
  dragPan,
  normalizeWheel,
  panBy,
  pinchCamera,
  screenToPage,
  toContainerPoint,
  wheelZoomDelta,
  zoomToward,
  zoomToAt,
} from "./camera"
import {
  boxNode,
  computeSnap,
  hitTest,
  MIN_SIZE,
  nodeBox,
  resizeBox,
  resolveEndpoint,
  unionBoxes,
  type SnapGuide,
} from "./geometry"
import { flowChildren } from "./layout"
import { flowIndex } from "./layoutCommands"
import { NODE_RENDERERS } from "./nodes"
import { ArrowLayer } from "./nodes/ArrowLayer"
import {
  isArrow,
  isContainer,
  isLayoutContainer,
  type AnyNode,
  type ArrowNode,
  type Box,
  type BoxNode,
  type PlatDoc,
  type FrameNode,
  type LayoutContainer,
  type ResizeHandle,
  type Vec,
} from "./types"

const genId = () =>
  "n_" +
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** Props for the embeddable canvas. `host` must be referentially stable for
 *  the lifetime of the mount (memoize it) — the doc loads once per mount. */
interface Props {
  host: PlatHost
  /** UI-level edit lock (can flip live; camera is preserved). A host without
   *  `saveDoc` is view-only regardless of this flag. */
  readOnly?: boolean
  /** Host-specific "create a new measure" flow, rendered when the user picks
   *  the toolbar entry. Omit ⇒ no such entry. */
  renderMeasureCreate?: (props: {
    onCreated: (m: { id: string }) => void
    onClose: () => void
  }) => ReactNode
  newMeasureLabel?: string
  /** Receives the imperative handle once the canvas is mounted — how outside
   *  chrome (panels, refresh buttons) talks to the canvas. */
  onReady?: (handle: PlatHandle) => void
}

export function Plat({
  host,
  readOnly = false,
  renderMeasureCreate,
  newMeasureLabel,
  onReady,
}: Props) {
  const effReadOnly = readOnly || !host.saveDoc

  const [store] = useState(() => {
    const s = new PlatStore(null, { x: 0, y: 0, z: 1 }, effReadOnly)
    // auto-layout reconciler: every committed mutation re-settles layout frames
    // so a hug box / child coords can never drift (no-op when no layout frames).
    s.setReconciler(() => reconcileLayout(s))
    return s
  })
  const [measureStore] = useState(() => new MeasureDataStore(host.measures))
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const seededRef = useRef(false)

  // Serialized doc saver: latest doc wins, in order, one save in flight (a slow
  // seed-save can't clobber a fast first edit). Transport-level retries and
  // save-state UI are the host adapter's concern; `final` marks the last-chance
  // flush during page unload (keepalive transport, no UI).
  const savingRef = useRef(false)
  const pendingRef = useRef<PlatDoc | null>(null)
  const putDoc = useCallback(
    async (doc: PlatDoc, final = false) => {
      if (!host.saveDoc) return
      try {
        await host.saveDoc(doc, final ? { final: true } : undefined)
      } catch (e) {
        // Adapter owns save-state reporting; during unload there's nothing to do.
        if (!final) console.error("[canvas] save failed", e)
      }
    },
    [host],
  )
  const persist = useCallback(
    (doc: PlatDoc) => {
      pendingRef.current = doc
      if (savingRef.current) return
      const flush = () => {
        const d = pendingRef.current
        if (!d) {
          savingRef.current = false
          return
        }
        pendingRef.current = null
        savingRef.current = true
        putDoc(d).finally(flush)
      }
      flush()
    },
    [putDoc],
  )

  // Load once per mount: host doc > empty doc (persisted so a fresh canvas gets
  // a doc on first open). A load FAILURE is a hard error screen — it must never
  // be treated as "empty canvas", or the next autosave would clobber the real
  // doc with an empty one.
  // NOTE: no cancellation on cleanup — seededRef makes this a true one-shot,
  // and StrictMode's simulated unmount/remount would otherwise cancel the only
  // load that ever runs. Post-unmount setState is a no-op; store.load on an
  // unmounted store is harmless.
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    host
      .loadDoc()
      .then((doc) => {
        if (doc && Array.isArray(doc.nodes)) {
          store.load(doc)
        } else {
          const empty: PlatDoc = { format: "plat", version: 1, nodes: [] }
          store.load(empty)
          if (!effReadOnly) persist(empty)
        }
        setReady(true)
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e))
      })
  }, [host, store, effReadOnly, persist])

  // Autosave: only on doc (nodes/order) change — NOT camera/selection/tool.
  // Flush the pending save on unmount / tab close so no edit is lost.
  useEffect(() => {
    if (effReadOnly || !ready) return
    let t: ReturnType<typeof setTimeout> | null = null
    let lastNodes = store.getState().nodes
    let lastOrder = store.getState().order
    const flushNow = () => {
      if (t) {
        clearTimeout(t)
        t = null
        putDoc(store.toDoc(), true)
      }
    }
    const unsub = store.subscribe(() => {
      const s = store.getState()
      if (s.nodes === lastNodes && s.order === lastOrder) return
      lastNodes = s.nodes
      lastOrder = s.order
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        t = null
        persist(store.toDoc())
      }, 700)
    })
    window.addEventListener("beforeunload", flushNow)
    return () => {
      window.removeEventListener("beforeunload", flushNow)
      unsub()
      flushNow()
    }
  }, [store, ready, effReadOnly, persist, putDoc])

  // Read-only can flip live from host chrome (no remount, so camera/scroll are
  // preserved). The store's mutation guard is set at construction, so keep it in
  // sync with the prop — JSX/handlers already read the prop directly.
  useEffect(() => {
    store.setReadonly(effReadOnly)
  }, [store, effReadOnly])

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-rose-500">
        Failed to load canvas: {loadError}
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
        Loading canvas…
      </div>
    )
  }

  return (
    <PlatHostContext.Provider value={host}>
      <MeasureDataContext.Provider value={measureStore}>
        <PlatStoreContext.Provider value={store}>
          <PlatInner
            readOnly={effReadOnly}
            renderMeasureCreate={renderMeasureCreate}
            newMeasureLabel={newMeasureLabel}
            onReady={onReady}
            measureStore={measureStore}
          />
        </PlatStoreContext.Provider>
      </MeasureDataContext.Provider>
    </PlatHostContext.Provider>
  )
}

// ── interaction surface ───────────────────────────────────

type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; lastClient: Vec }
  | { kind: "pinch"; lastCenterClient: Vec; lastDist: number }
  | {
      kind: "translate"
      originPage: Vec
      moving: { id: string; ox: number; oy: number }[]
      arrows: { id: string; sx: number; sy: number; ex: number; ey: number; sBound: boolean; eBound: boolean }[]
      snap: { x: boolean; y: boolean }
      started: boolean
      originClient: Vec
    }
  | {
      kind: "resize"
      handle: ResizeHandle
      initBounds: Box
      items: { id: string; box: Box }[]
      aspect: boolean
    }
  | {
      kind: "marquee"
      originPage: Vec
      originClient: Vec
      started: boolean
      additive: boolean
      base: string[]
    }
  | { kind: "arrowing"; id: string; started: boolean; originClient: Vec }
  | { kind: "arrowHandle"; id: string; handle: "start" | "end" | "mid" }
  | { kind: "framing"; originPage: Vec; originClient: Vec; started: boolean }

function PlatInner({
  readOnly,
  renderMeasureCreate,
  newMeasureLabel,
  onReady,
  measureStore,
}: {
  readOnly: boolean
  renderMeasureCreate?: Props["renderMeasureCreate"]
  newMeasureLabel?: string
  onReady?: (handle: PlatHandle) => void
  measureStore: MeasureDataStore
}) {
  const store = useStore()
  const host = usePlatHost()
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied" | "error">("idle")
  const onShare = async () => {
    if (!host.share) return
    setShareState("sharing")
    try {
      const { url } = await host.share()
      await navigator.clipboard?.writeText(url).catch(() => {})
      setShareState("copied")
      host.notify?.("success", "Public link copied")
      setTimeout(() => setShareState("idle"), 2200)
    } catch (e) {
      setShareState("error")
      notifyError(host, String(e))
      setTimeout(() => setShareState("idle"), 2200)
    }
  }
  const camera = useSel(store, selCamera)
  const nodes = useSel(store, selNodes)
  const order = useSel(store, selOrder)
  const selectedIds = useSel(store, selSelected)
  const tool = useSel(store, selTool)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [measureCreateOpen, setMeasureCreateOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture>({ kind: "idle" })
  // active touch pointers (client coords) — feeds the two-finger pinch gesture
  const touchesRef = useRef<Map<number, Vec>>(new Map())
  const tapStartRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const spaceRef = useRef(false)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null)
  const [hoverBind, setHoverBind] = useState<string | null>(null)
  const [arrowHoverId, setArrowHoverId] = useState<string | null>(null)
  const lastPointerPage = useRef<Vec>({ x: 0, y: 0 })

  // Drop any in-progress text edit when the canvas is locked mid-edit.
  useEffect(() => {
    if (readOnly) setEditingId(null)
  }, [readOnly])

  const byId = useMemo(() => new Map(Object.entries(nodes)), [nodes])
  const orderedNodes = useMemo(
    () => order.map((id) => nodes[id]).filter(Boolean) as AnyNode[],
    [order, nodes],
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const rect = () => containerRef.current?.getBoundingClientRect()

  const toPage = (clientX: number, clientY: number): Vec => {
    const r = rect()!
    return screenToPage(toContainerPoint(clientX, clientY, r), cameraRef.current)
  }

  // midpoint + spread of the first two tracked touches (client coords)
  const pinchOf = (m: Map<number, Vec>) => {
    const [a, b] = [...m.values()]
    return {
      centerClient: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(b.x - a.x, b.y - a.y),
    }
  }

  // resolve a hit node id to its selection target. A grouped child resolves to
  // its group UNLESS we've drilled into that group (focusedGroup), in which case
  // the child itself is selectable.
  const selectionTarget = (id: string): string => {
    const n = nodes[id]
    if (n && !isArrow(n) && n.parentId && nodes[n.parentId]?.type === "group") {
      return n.parentId === focusedGroup ? id : n.parentId
    }
    return id
  }
  const isInFocusedGroup = (id: string): boolean => {
    const n = nodes[id]
    return !!(n && !isArrow(n) && (n as BoxNode).parentId === focusedGroup)
  }

  // expand a set of ids to include container (group/frame) members
  const withGroupMembers = (ids: string[]): string[] => {
    const out = new Set(ids)
    const stack = [...ids]
    while (stack.length) {
      const id = stack.pop()!
      const n = nodes[id]
      if (n && isContainer(n)) {
        for (const k of Object.keys(nodes)) {
          const c = nodes[k]
          if (c && !isArrow(c) && (c as BoxNode).parentId === id && !out.has(k)) {
            out.add(k)
            stack.push(k) // recurse into nested containers (whole subtree moves)
          }
        }
      }
    }
    return [...out]
  }
  // the topmost frame whose box contains a page point (for drop-to-add)
  const frameAt = (p: Vec, excludeId?: string): string | null => {
    let hit: string | null = null
    for (const id of order) {
      const n = nodes[id]
      if (n && n.type === "frame" && id !== excludeId) {
        if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) hit = id
      }
    }
    return hit
  }

  // ── wheel: ctrl→zoom, shift→hpan, else pan ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let raf = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cur = toContainerPoint(e.clientX, e.clientY, r)
      const { dx, dy } = normalizeWheel(e)
      if (e.ctrlKey || e.metaKey) {
        cameraRef.current = zoomToward(cameraRef.current, cur, wheelZoomDelta(dy))
      } else if (e.shiftKey && dx === 0) {
        cameraRef.current = panBy(cameraRef.current, dy, 0)
      } else {
        cameraRef.current = panBy(cameraRef.current, dx, dy)
      }
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0
          store.setCamera(cameraRef.current)
        })
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [store])

  // ── camera fit on first ready ──
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current) return
    const r = rect()
    if (!r) return
    const boxes = orderedNodes.map((n) => nodeBox(n, byId)).filter((b) => b.w >= 0 && b.h >= 0)
    const u = unionBoxes(boxes)
    if (!u) {
      fittedRef.current = true
      return
    }
    fittedRef.current = true
    const pad = 0.85
    const z = Math.max(0.1, Math.min(2, Math.min(r.width / (u.w || 1), r.height / (u.h || 1)) * pad))
    const cx = u.x + u.w / 2
    const cy = u.y + u.h / 2
    store.setCamera({ x: r.width / 2 / z - cx, y: r.height / 2 / z - cy, z })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedNodes.length])

  // ── pointer handlers ──
  const DRAG = 4 // screen px

  // endpoint for an arrow being drawn: bind to a box if one is under the point
  const makeEndpoint = (page: Vec, hitId: string | null) => {
    if (hitId) {
      const n = nodes[hitId]
      if (n && !isArrow(n)) {
        const { anchor, isPrecise } = anchorForPoint(page, boxNode(n as BoxNode), cameraRef.current.z)
        return { x: page.x, y: page.y, binding: { nodeId: hitId, anchor, isPrecise } }
      }
    }
    return { x: page.x, y: page.y, binding: null }
  }
  const boxTopFirst = () =>
    [...orderedNodes].reverse().filter((n) => !isArrow(n) && n.type !== "group")

  // Select `hit` (honoring shift) and arm a translate gesture over the resulting
  // selection. Shared by direct canvas clicks and frame-title drags.
  const armTranslate = (hit: string, page: Vec, e: React.PointerEvent) => {
    const target = selectionTarget(hit)
    const additive = e.shiftKey
    if (!selectedSet.has(target)) {
      store.toggleSelection(target, additive)
    } else if (additive) {
      store.toggleSelection(target, true)
      return // shift-click on an already-selected node deselects it; no drag
    }
    // arm translate over the (possibly just-updated) selection
    const sel = store.getState().selectedIds
    const movingIds = withGroupMembers(sel)
    const moving = movingIds
      .map((id) => nodes[id])
      .filter((n) => n && !isArrow(n))
      .map((n) => ({ id: n.id, ox: (n as BoxNode).x, oy: (n as BoxNode).y }))
    const arrows = movingIds
      .map((id) => nodes[id])
      .filter((n): n is Extract<AnyNode, { type: "arrow" }> => !!n && isArrow(n))
      .map((a) => ({
        id: a.id,
        sx: a.start.x,
        sy: a.start.y,
        ex: a.end.x,
        ey: a.end.y,
        sBound: !!a.start.binding,
        eBound: !!a.end.binding,
      }))
    store.beginGesture()
    gestureRef.current = {
      kind: "translate",
      originPage: page,
      moving,
      arrows,
      snap: { x: false, y: false },
      started: false,
      originClient: { x: e.clientX, y: e.clientY },
    }
  }

  // A frame's title sits above its box (outside the geometric hit area), so it
  // gets its own pointerdown that selects + drags the frame just like clicking
  // its interior would. Pointer capture routes the move/up to the container.
  const startFrameTitleDrag = (frameId: string, e: React.PointerEvent) => {
    if (readOnly || e.button !== 0) return
    e.stopPropagation()
    if (editingId) setEditingId(null)
    containerRef.current?.setPointerCapture(e.pointerId)
    armTranslate(frameId, toPage(e.clientX, e.clientY), e)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      containerRef.current?.setPointerCapture(e.pointerId)
      if (touchesRef.current.size === 2) {
        // Second finger → pinch. Roll back any in-flight mutating gesture
        // (translate/arrowing snapshot at pointerdown; cancelGesture is a
        // no-op for pan/marquee which never snapshot).
        if (gestureRef.current.kind !== "idle" && gestureRef.current.kind !== "pan") {
          store.cancelGesture()
          setGuides([])
          setMarquee(null)
        }
        tapStartRef.current = null
        const { centerClient, dist } = pinchOf(touchesRef.current)
        gestureRef.current = { kind: "pinch", lastCenterClient: centerClient, lastDist: dist }
        setPanning(true)
        return
      }
      if (touchesRef.current.size > 2) return // pinch tracks the first two fingers
      tapStartRef.current = { t: performance.now(), x: e.clientX, y: e.clientY }
    }
    if (readOnly) {
      // readonly: no selection/editing, but drag-to-pan so the canvas stays
      // navigable. Left or middle button arms a pan; everything else is inert.
      if (e.button === 0 || e.button === 1) {
        e.preventDefault()
        gestureRef.current = { kind: "pan", lastClient: { x: e.clientX, y: e.clientY } }
        setPanning(true)
        containerRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }
    // stop the browser from starting a text selection / native element drag
    // (this caused the "ghost of every element" drag + measure-text selection)
    if (e.button === 0 || e.button === 1) e.preventDefault()
    setMenu(null)
    const panMode = e.button === 1 || spaceRef.current || tool === "hand"
    if (panMode) {
      gestureRef.current = { kind: "pan", lastClient: { x: e.clientX, y: e.clientY } }
      setPanning(true)
      containerRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    if (editingId) setEditingId(null)
    const page = toPage(e.clientX, e.clientY)
    const arrowTol = 8 / cameraRef.current.z
    containerRef.current?.setPointerCapture(e.pointerId)

    if (tool === "arrow") {
      const hit = hitTest(page, boxTopFirst(), byId, 0)
      const id = genId()
      store.beginGesture()
      store.addNodes(
        [
          {
            id,
            type: "arrow",
            index: "",
            parentId: null,
            start: makeEndpoint(page, hit),
            end: { x: page.x, y: page.y, binding: null },
            kind: getLastArrowKind(),
          } as AnyNode,
        ],
        true,
      )
      gestureRef.current = { kind: "arrowing", id, started: false, originClient: { x: e.clientX, y: e.clientY } }
      return
    }
    if (tool === "text") {
      const id = genId()
      const h = 40
      store.commit(() =>
        store.addNodes(
          [
            {
              id,
              type: "text",
              x: page.x,
              y: page.y - h / 2,
              w: 200,
              h,
              index: "",
              parentId: null,
              text: "",
              fontSize: 22,
              align: "left",
            } as AnyNode,
          ],
          true,
        ),
      )
      setEditingId(id)
      store.setTool("select")
      return
    }
    if (tool === "frame") {
      gestureRef.current = {
        kind: "framing",
        originPage: page,
        originClient: { x: e.clientX, y: e.clientY },
        started: false,
      }
      return
    }

    // boxes win over arrows at the same point; groups are hit via their children
    const hit =
      hitTest(page, boxTopFirst(), byId, 0) ??
      hitTest(page, [...orderedNodes].reverse().filter(isArrow), byId, arrowTol)
    // exit a drilled-in group when clicking outside it
    if (focusedGroup && !(hit && isInFocusedGroup(hit))) setFocusedGroup(null)
    if (hit) {
      armTranslate(hit, page, e)
    } else {
      const base = e.shiftKey ? store.getState().selectedIds : []
      if (!e.shiftKey) store.setSelection([])
      gestureRef.current = {
        kind: "marquee",
        originPage: page,
        originClient: { x: e.clientX, y: e.clientY },
        started: false,
        additive: e.shiftKey,
        base,
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const p = gestureRef.current
      if (p.kind === "pinch") {
        if (touchesRef.current.size < 2) return
        const r = rect()
        if (!r) return
        const { centerClient, dist } = pinchOf(touchesRef.current)
        cameraRef.current = pinchCamera(
          cameraRef.current,
          toContainerPoint(centerClient.x, centerClient.y, r),
          {
            x: centerClient.x - p.lastCenterClient.x,
            y: centerClient.y - p.lastCenterClient.y,
          },
          p.lastDist > 0 ? dist / p.lastDist : 1,
        )
        p.lastCenterClient = centerClient
        p.lastDist = dist
        store.setCamera(cameraRef.current)
        return
      }
    }
    lastPointerPage.current = toPage(e.clientX, e.clientY)
    const g = gestureRef.current
    if (g.kind === "idle") {
      // in arrow mode, surface the connection points of the box under the cursor
      if (tool === "arrow" && !readOnly) {
        const p = lastPointerPage.current
        setArrowHoverId(hitTest(p, boxTopFirst(), byId, 0))
      } else if (arrowHoverId) {
        setArrowHoverId(null)
      }
      return
    }
    if (e.buttons === 0) {
      finishGesture()
      return
    }
    if (g.kind === "pan") {
      cameraRef.current = dragPan(
        cameraRef.current,
        e.clientX - g.lastClient.x,
        e.clientY - g.lastClient.y,
      )
      g.lastClient = { x: e.clientX, y: e.clientY }
      store.setCamera(cameraRef.current)
      return
    }
    const page = toPage(e.clientX, e.clientY)
    if (g.kind === "translate") {
      const movedScreen = Math.hypot(e.clientX - g.originClient.x, e.clientY - g.originClient.y)
      if (!g.started && movedScreen < DRAG) return
      g.started = true
      const rawdx = page.x - g.originPage.x
      const rawdy = page.y - g.originPage.y
      // moving union from original positions
      const origBoxes: Box[] = g.moving.map((m) => {
        const n = nodes[m.id] as BoxNode
        return { x: m.ox + rawdx, y: m.oy + rawdy, w: n.w, h: n.h }
      })
      const movingUnion = unionBoxes(origBoxes)
      const movingIdSet = new Set([...g.moving.map((m) => m.id), ...g.arrows.map((a) => a.id)])
      const staticBoxes: Box[] = orderedNodes
        .filter((n) => !isArrow(n) && !movingIdSet.has(n.id) && n.type !== "group")
        .map((n) => boxNode(n as BoxNode))
      let sdx = 0
      let sdy = 0
      if (movingUnion && staticBoxes.length) {
        const snap = computeSnap(movingUnion, staticBoxes, cameraRef.current.z, g.snap)
        sdx = snap.dx
        sdy = snap.dy
        setGuides(snap.guides)
      } else {
        setGuides([])
      }
      const dx = rawdx + sdx
      const dy = rawdy + sdy
      const patches: { id: string; patch: Partial<AnyNode> }[] = g.moving.map((m) => ({
        id: m.id,
        patch: { x: m.ox + dx, y: m.oy + dy } as Partial<AnyNode>,
      }))
      // translate only UNBOUND arrow endpoints (bound ones follow their node)
      for (const a of g.arrows) {
        const cur = nodes[a.id] as Extract<AnyNode, { type: "arrow" }>
        patches.push({
          id: a.id,
          patch: {
            start: a.sBound ? cur.start : { ...cur.start, x: a.sx + dx, y: a.sy + dy },
            end: a.eBound ? cur.end : { ...cur.end, x: a.ex + dx, y: a.ey + dy },
          } as Partial<AnyNode>,
        })
      }
      store.patchNodes(patches)
      return
    }
    if (g.kind === "resize") {
      const nb = resizeBox(g.initBounds, g.handle, page, {
        aspect: g.aspect || e.shiftKey,
        minSize: MIN_SIZE,
      })
      const sx = g.initBounds.w ? nb.w / g.initBounds.w : 1
      const sy = g.initBounds.h ? nb.h / g.initBounds.h : 1
      const patches = g.items.map((it) => ({
        id: it.id,
        patch: {
          x: nb.x + (it.box.x - g.initBounds.x) * sx,
          y: nb.y + (it.box.y - g.initBounds.y) * sy,
          w: Math.max(MIN_SIZE, it.box.w * sx),
          h: Math.max(MIN_SIZE, it.box.h * sy),
        } as Partial<AnyNode>,
      }))
      store.patchNodes(patches)
      return
    }
    if (g.kind === "arrowing") {
      const moved = Math.hypot(e.clientX - g.originClient.x, e.clientY - g.originClient.y)
      if (!g.started && moved < DRAG) return
      g.started = true
      const hit = hitTest(page, boxTopFirst().filter((n) => n.id !== g.id), byId, 0)
      setHoverBind(hit)
      store.patchNodes([{ id: g.id, patch: { end: makeEndpoint(page, hit) } as Partial<AnyNode> }])
      return
    }
    if (g.kind === "arrowHandle") {
      const a = nodes[g.id] as ArrowNode
      if (!a) return
      if (g.handle === "mid") {
        const info = getArrowInfo(a, byId)
        if (info.midHandle) {
          const axis = info.midHandle.axis
          const c = axis === "x" ? page.x : page.y
          const lo = info.midHandle.lo ?? (axis === "x" ? info.start.x : info.start.y)
          const hi = info.midHandle.hi ?? (axis === "x" ? info.end.x : info.end.y)
          const mid = hi !== lo ? Math.max(0, Math.min(1, (c - lo) / (hi - lo))) : 0.5
          store.patchNodes([{ id: g.id, patch: { elbowMid: mid } as Partial<AnyNode> }])
        }
        return
      }
      const hit = hitTest(page, boxTopFirst().filter((n) => n.id !== g.id), byId, 0)
      setHoverBind(hit)
      store.patchNodes([{ id: g.id, patch: { [g.handle]: makeEndpoint(page, hit) } as Partial<AnyNode> }])
      return
    }
    if (g.kind === "framing") {
      const moved = Math.hypot(e.clientX - g.originClient.x, e.clientY - g.originClient.y)
      if (!g.started && moved < DRAG) return
      g.started = true
      setMarquee({
        x: Math.min(g.originPage.x, page.x),
        y: Math.min(g.originPage.y, page.y),
        w: Math.abs(page.x - g.originPage.x),
        h: Math.abs(page.y - g.originPage.y),
      })
      return
    }
    if (g.kind === "marquee") {
      const movedScreen = Math.hypot(e.clientX - g.originClient.x, e.clientY - g.originClient.y)
      if (!g.started && movedScreen < DRAG) return
      g.started = true
      const box: Box = {
        x: Math.min(g.originPage.x, page.x),
        y: Math.min(g.originPage.y, page.y),
        w: Math.abs(page.x - g.originPage.x),
        h: Math.abs(page.y - g.originPage.y),
      }
      setMarquee(box)
      const hits = orderedNodes
        .filter((n) => n.type !== "group")
        .filter((n) => {
          const b = nodeBox(n, byId)
          return !(b.x + b.w < box.x || box.x + box.w < b.x || b.y + b.h < box.y || box.y + box.h < b.y)
        })
        .map((n) => selectionTarget(n.id))
      store.setSelection([...new Set(g.additive ? [...g.base, ...hits] : hits)])
    }
  }

  const finishGesture = () => {
    const g = gestureRef.current
    if (g.kind === "translate") {
      // drop-to-add: reparent moved leaf nodes into the frame under them
      const reparent: { id: string; patch: Partial<AnyNode> }[] = []
      for (const m of g.moving) {
        const c = nodes[m.id]
        if (!c || isArrow(c) || c.type === "frame" || c.type === "group") continue
        const cur = (c as BoxNode).parentId ?? null
        if (cur && nodes[cur]?.type === "group") continue // don't touch group membership
        const cx = (c as BoxNode).x + (c as BoxNode).w / 2
        const cy = (c as BoxNode).y + (c as BoxNode).h / 2
        const fid = frameAt({ x: cx, y: cy }, m.id)
        // on a parent change, clear stale flow state so the node joins (or leaves)
        // a layout cleanly: not ignored, fresh index (reorder below assigns order).
        if ((fid ?? null) !== cur)
          reparent.push({ id: m.id, patch: { parentId: fid, layoutIgnore: false, index: "" } as Partial<AnyNode> })
      }
      if (reparent.length) store.patchNodes(reparent)
      // layout reorder: a flow member dropped INSIDE its layout frame re-sorts the
      // frame's flow order by drop position (reconcile then snaps to clean slots).
      // A member dropped OUTSIDE was just detached above (parentId→other), so it's
      // no longer a flow child and won't be re-sorted here.
      const nowNodes = store.getState().nodes
      const reorderedFrames = new Set<string>()
      const reindex: { id: string; patch: Partial<AnyNode> }[] = []
      for (const m of g.moving) {
        const c = nowNodes[m.id]
        if (!c || isArrow(c) || (c as BoxNode).layoutIgnore) continue
        const pid = (c as BoxNode).parentId
        const parent = pid ? nowNodes[pid] : null
        if (!pid || !parent || !isLayoutContainer(parent) || reorderedFrames.has(pid)) continue
        reorderedFrames.add(pid)
        const horiz = (parent as LayoutContainer).layout.dir === "h"
        const center = (b: BoxNode) => (horiz ? b.x + b.w / 2 : b.y + b.h / 2)
        const sorted = flowChildren(parent as LayoutContainer, nowNodes).sort(
          (a, b) => center(a) - center(b),
        )
        // only rewrite indices if the order actually changed (avoids no-op churn
        // + spurious autosave when a layout frame is dragged rigidly).
        if (sorted.some((s, i) => (s.index ?? "") !== flowIndex(i)))
          sorted.forEach((s, i) => reindex.push({ id: s.id, patch: { index: flowIndex(i) } as Partial<AnyNode> }))
      }
      if (reindex.length) store.patchNodes(reindex)
      store.reconcile() // settle layout frames before the change is committed
      store.commitGesture()
    } else if (g.kind === "resize" || g.kind === "arrowHandle") {
      store.reconcile() // hug axis snaps back; fixed axis redistributes
      store.commitGesture()
    } else if (g.kind === "arrowing") {
      const a = store.getState().nodes[g.id] as ArrowNode | undefined
      const info = a ? getArrowInfo(a, byId) : null
      const dist = info ? Math.hypot(info.end.x - info.start.x, info.end.y - info.start.y) : 0
      const bound = !!(a && a.start.binding && a.end.binding)
      if (!a || (dist < 8 && !bound)) {
        store.cancelGesture()
      } else {
        store.commitGesture()
        store.setSelection([g.id])
        store.setTool("select")
      }
    } else if (g.kind === "framing") {
      if (g.started) {
        const p = lastPointerPage.current
        const fx = Math.min(g.originPage.x, p.x)
        const fy = Math.min(g.originPage.y, p.y)
        const fw = Math.abs(p.x - g.originPage.x)
        const fh = Math.abs(p.y - g.originPage.y)
        if (fw > 10 && fh > 10) {
          const fid = genId()
          const captured: { id: string; patch: Partial<AnyNode> }[] = []
          for (const id of order) {
            const c = nodes[id]
            if (!c || isArrow(c) || c.type === "frame" || c.type === "group") continue
            if ((c as BoxNode).parentId) continue
            const cx = (c as BoxNode).x + (c as BoxNode).w / 2
            const cy = (c as BoxNode).y + (c as BoxNode).h / 2
            if (cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh)
              captured.push({ id, patch: { parentId: fid } as Partial<AnyNode> })
          }
          store.commit(() => {
            store.addNodes(
              [{ id: fid, type: "frame", x: fx, y: fy, w: fw, h: fh, index: "", parentId: null, name: "Frame" } as AnyNode],
              false,
            )
            store.sendToBack([fid])
            if (captured.length) store.patchNodes(captured)
            store.setSelection([fid])
          })
        }
      }
      store.setTool("select")
    }
    gestureRef.current = { kind: "idle" }
    setGuides([])
    setMarquee(null)
    setPanning(false)
    setHoverBind(null)
  }

  const startArrowHandle = (handle: "start" | "end" | "mid", id: string, e: React.PointerEvent) => {
    e.stopPropagation()
    containerRef.current?.setPointerCapture(e.pointerId)
    store.beginGesture()
    gestureRef.current = { kind: "arrowHandle", id, handle }
  }

  // Touch bookkeeping shared by pointerup/pointercancel. Returns true when the
  // pointer belonged to a pinch — the gesture continues (two fingers left),
  // degrades to a one-finger pan, or ends, but never runs finishGesture.
  const endTouch = (e: React.PointerEvent): boolean => {
    touchesRef.current.delete(e.pointerId)
    const g = gestureRef.current
    if (g.kind !== "pinch") return false
    if (touchesRef.current.size >= 2) {
      // a finger lifted but two remain — re-anchor to the survivors
      const { centerClient, dist } = pinchOf(touchesRef.current)
      g.lastCenterClient = centerClient
      g.lastDist = dist
    } else if (touchesRef.current.size === 1) {
      // hand off to a one-finger pan without a jump
      const [p] = [...touchesRef.current.values()]
      gestureRef.current = { kind: "pan", lastClient: { x: p.x, y: p.y } }
    } else {
      gestureRef.current = { kind: "idle" }
      setPanning(false)
    }
    return true
  }

  // Double-tap zoom for the read-only viewer (phones): two quick taps near the
  // same spot zoom 2x toward the tap point. Edit mode keeps double-tap free for
  // text editing / group drill-in via onDoubleClick.
  const maybeDoubleTapZoom = (e: React.PointerEvent) => {
    if (!readOnly) return
    const start = tapStartRef.current
    tapStartRef.current = null
    if (!start) return
    const now = performance.now()
    const isTap =
      now - start.t < 350 && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 12
    if (!isTap) {
      lastTapRef.current = null
      return
    }
    const prev = lastTapRef.current
    lastTapRef.current = { t: now, x: e.clientX, y: e.clientY }
    if (!prev || now - prev.t > 350 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 48)
      return
    lastTapRef.current = null
    const r = rect()
    if (!r) return
    cameraRef.current = zoomToAt(
      cameraRef.current,
      toContainerPoint(e.clientX, e.clientY, r),
      cameraRef.current.z * 2,
    )
    store.setCamera(cameraRef.current)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    containerRef.current?.releasePointerCapture(e.pointerId)
    if (e.pointerType === "touch") {
      if (endTouch(e)) return
      maybeDoubleTapZoom(e)
    }
    finishGesture()
  }
  const onPointerCancel = (e?: React.PointerEvent) => {
    tapStartRef.current = null
    if (e?.pointerType === "touch" && endTouch(e)) return
    // Roll back ANY mutating gesture's speculative changes. arrowing/arrowHandle
    // call beginGesture and create/move nodes at pointerdown — without this they
    // leave an orphan (e.g. a zero-length arrow) committed but never historied.
    // cancelGesture is a no-op when no snapshot was taken (pan/marquee/framing).
    if (gestureRef.current.kind !== "idle") {
      store.cancelGesture()
    }
    gestureRef.current = { kind: "idle" }
    setPanning(false)
    setHoverBind(null)
    setGuides([])
    setMarquee(null)
  }

  const startResize = (handle: ResizeHandle, e: React.PointerEvent) => {
    e.stopPropagation()
    // affected box nodes = selected boxes + group members (not group containers)
    const affected = new Set<string>()
    for (const id of selectedIds) {
      const n = nodes[id]
      if (!n || isArrow(n)) continue
      if (n.type === "group") {
        for (const k of order) {
          const c = nodes[k]
          if (c && !isArrow(c) && (c as BoxNode).parentId === id) affected.add(k)
        }
      } else affected.add(id)
    }
    const items = [...affected].map((id) => ({ id, box: boxNode(nodes[id] as BoxNode) }))
    if (!items.length) return
    const initBounds = unionBoxes(items.map((it) => it.box))!
    containerRef.current?.setPointerCapture(e.pointerId)
    store.beginGesture()
    gestureRef.current = { kind: "resize", handle, initBounds, items, aspect: e.shiftKey }
  }

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (tgt && (/^(input|textarea|select)$/i.test(tgt.tagName) || tgt.isContentEditable))
        return
      if (e.key === " ") {
        spaceRef.current = true
        setSpaceHeld(true)
        if (!editingId) e.preventDefault()
      }
      if (editingId) return
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) flushNudge()
      const meta = e.metaKey || e.ctrlKey
      const sel = store.getState().selectedIds
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault()
        const st = store.getState()
        // top-level units only: groups + ungrouped shapes + arrows, no members
        store.setSelection(
          st.order.filter((id) => {
            const n = st.nodes[id]
            const pid = n && !isArrow(n) ? (n as BoxNode).parentId : null
            return !(pid && st.nodes[pid]?.type === "group")
          }),
        )
      } else if (!readOnly && (e.key === "Delete" || e.key === "Backspace")) {
        if (sel.length) {
          e.preventDefault()
          store.commit(() => store.removeNodes(withGroupMembers(sel)))
        }
      } else if (meta && e.key.toLowerCase() === "c") {
        copy()
      } else if (meta && e.key.toLowerCase() === "v") {
        paste()
      } else if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault()
        duplicate()
      } else if (meta && e.key.toLowerCase() === "x") {
        cut()
      } else if (meta && e.key.toLowerCase() === "g") {
        e.preventDefault()
        if (e.shiftKey) ungroupCmd(store)
        else groupCmd(store)
      } else if (e.key === "Escape") {
        if (gestureRef.current.kind !== "idle") onPointerCancel()
        else if (focusedGroup) {
          setFocusedGroup(null)
          store.setSelection([focusedGroup])
        } else store.setSelection([])
      } else if (!readOnly && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (!sel.length) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
        nudge(dx, dy)
      } else if (meta && e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault()
        frameSelectionCmd(store)
      } else if (!meta && !readOnly && ["v", "h", "a", "t", "f"].includes(e.key.toLowerCase())) {
        const map = { v: "select", h: "hand", a: "arrow", t: "text", f: "frame" } as const
        store.setTool(map[e.key.toLowerCase() as "v" | "h" | "a" | "t" | "f"])
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        spaceRef.current = false
        setSpaceHeld(false)
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, readOnly, focusedGroup])

  // nudge with debounced commit
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nudgeSnapTaken = useRef(false)
  const nudge = (dx: number, dy: number) => {
    if (!nudgeSnapTaken.current) {
      store.beginGesture()
      nudgeSnapTaken.current = true
    }
    const ids = withGroupMembers(store.getState().selectedIds)
    const patches = ids
      .map((id) => store.getState().nodes[id])
      .filter((n) => n && !isArrow(n))
      .map((n) => ({ id: n.id, patch: { x: (n as BoxNode).x + dx, y: (n as BoxNode).y + dy } as Partial<AnyNode> }))
    store.patchNodes(patches)
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = setTimeout(() => {
      store.commitGesture()
      nudgeSnapTaken.current = false
    }, 500)
  }
  const flushNudge = () => {
    if (nudgeSnapTaken.current) {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
      store.commitGesture()
      nudgeSnapTaken.current = false
    }
  }

  // ── clipboard ──
  const clipRef = useRef<AnyNode[] | null>(null)
  const copy = () => {
    const sel = new Set(withGroupMembers(store.getState().selectedIds))
    const picked = store.getState().order
      .filter((id) => sel.has(id))
      .map((id) => store.getState().nodes[id])
      .filter(Boolean) as AnyNode[]
    if (!picked.length) return
    clipRef.current = picked
    try {
      navigator.clipboard?.writeText(JSON.stringify({ format: "plat-clip", nodes: picked }))
    } catch {
      /* in-memory fallback */
    }
  }
  const cloneNodes = (src: AnyNode[], dx: number, dy: number): AnyNode[] => {
    const idMap = new Map<string, string>()
    src.forEach((n) => idMap.set(n.id, genId()))
    return src.map((n) => {
      const id = idMap.get(n.id)!
      if (isArrow(n)) {
        const remap = (ep: typeof n.start) => {
          if (ep.binding && idMap.has(ep.binding.nodeId)) {
            return {
              x: ep.x + dx,
              y: ep.y + dy,
              binding: {
                nodeId: idMap.get(ep.binding.nodeId)!,
                anchor: ep.binding.anchor,
                isPrecise: ep.binding.isPrecise,
              },
            }
          }
          // unbound, or bound to a node not in the clone set: bake resolved point
          const p = resolveEndpoint(ep, byId)
          return { x: p.x + dx, y: p.y + dy, binding: null }
        }
        return { ...n, id, start: remap(n.start), end: remap(n.end) }
      }
      const parentId = n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : null
      return { ...n, id, x: n.x + dx, y: n.y + dy, parentId }
    })
  }
  const srcCenter = (src: AnyNode[]): Vec | null => {
    const boxes = src.filter((n) => !isArrow(n)).map((n) => boxNode(n as BoxNode))
    const u = unionBoxes(boxes)
    return u ? { x: u.x + u.w / 2, y: u.y + u.h / 2 } : null
  }
  const placeNodes = (src: AnyNode[], atPointer: boolean) => {
    if (!src.length) return
    let dx = 16
    let dy = 16
    if (atPointer) {
      const c = srcCenter(src)
      if (c) {
        dx = lastPointerPage.current.x - c.x
        dy = lastPointerPage.current.y - c.y
      }
    }
    store.commit(() => store.addNodes(cloneNodes(src, dx, dy), true))
  }
  const duplicate = () => {
    const sel = new Set(withGroupMembers(store.getState().selectedIds))
    const picked = store.getState().order.filter((id) => sel.has(id)).map((id) => store.getState().nodes[id]).filter(Boolean) as AnyNode[]
    placeNodes(picked, false)
  }
  const paste = async () => {
    if (readOnly) return
    // 1) our JSON clip
    let text = ""
    try {
      text = (await navigator.clipboard?.readText()) ?? ""
    } catch {
      /* ignore */
    }
    if (text) {
      try {
        const parsed = JSON.parse(text)
        if (parsed?.format === "plat-clip" && Array.isArray(parsed.nodes)) {
          placeNodes(parsed.nodes, true)
          return
        }
      } catch {
        /* not ours */
      }
    }
    if (clipRef.current) {
      placeNodes(clipRef.current, true)
      return
    }
    // 2) image from clipboard (screenshot paste)
    try {
      const items = await navigator.clipboard?.read?.()
      for (const it of items ?? []) {
        const imgType = it.types.find((t) => t.startsWith("image/"))
        if (imgType) {
          const blob = await it.getType(imgType)
          await pasteImageBlob(blob)
          return
        }
      }
    } catch {
      /* clipboard image unavailable */
    }
  }
  const pasteImageBlob = async (blob: Blob) => {
    if (!host.uploadAsset) return
    const file = new File([blob], "pasted.png", { type: blob.type || "image/png" })
    const dims = await imageDims(file)
    const { src } = await host.uploadAsset(file, file.name)
    const r = rect()!
    const center = screenToPage({ x: r.width / 2, y: r.height / 2 }, cameraRef.current)
    const w = Math.min(dims.w, 600)
    const h = (w / dims.w) * dims.h
    store.commit(() =>
      store.addNodes(
        [
          {
            id: genId(),
            type: "image",
            x: center.x - w / 2,
            y: center.y - h / 2,
            w,
            h,
            index: "",
            parentId: null,
            src,
          },
        ],
        true,
      ),
    )
  }

  const addAtCenter = (node: AnyNode, w: number, h: number) => {
    const r = rect()!
    const c = screenToPage({ x: r.width / 2, y: r.height / 2 }, cameraRef.current)
    store.commit(() =>
      store.addNodes([{ ...node, x: c.x - w / 2, y: c.y - h / 2 } as AnyNode], true),
    )
  }
  const insertImageFile = async (file: File) => {
    if (!host.uploadAsset) return
    const dims = await imageDims(file)
    let src: string
    try {
      ;({ src } = await host.uploadAsset(file, file.name))
    } catch (e) {
      notifyError(host, `Image upload failed: ${e instanceof Error ? e.message : e}`)
      return
    }
    const w = Math.min(dims.w, 600)
    const h = (w / dims.w) * dims.h
    addAtCenter(
      { id: genId(), type: "image", x: 0, y: 0, w, h, index: "", parentId: null, src } as AnyNode,
      w,
      h,
    )
  }
  const insertMeasure = (measureId: string) => {
    addAtCenter(
      {
        id: genId(),
        type: "measure",
        x: 0,
        y: 0,
        w: 240,
        h: 160,
        index: "",
        parentId: null,
        measureId,
        fontScale: 1,
      } as AnyNode,
      240,
      160,
    )
  }
  // Hand the imperative surface to the host — panels and refresh buttons that
  // live outside this tree talk to the mounted canvas through it. Methods read
  // the latest closures via ref so the handle itself stays stable.
  const handleFnsRef = useRef({ insertMeasure, fitView })
  handleFnsRef.current = { insertMeasure, fitView }
  useEffect(() => {
    onReady?.({
      insertMeasure: (id) => handleFnsRef.current.insertMeasure(id),
      refetchMeasures: () => measureStore.refetchAll(),
      zoomToFit: () => handleFnsRef.current.fitView(),
    })
  }, [onReady, measureStore])
  const cut = () => {
    copy()
    const sel = withGroupMembers(store.getState().selectedIds)
    if (sel.length) store.commit(() => store.removeNodes(sel))
  }

  // ── render ──
  const boxNodes = useMemo(
    () => orderedNodes.filter((n) => !isArrow(n) && n.type !== "group") as BoxNode[],
    [orderedNodes],
  )
  const arrows = useMemo(() => orderedNodes.filter(isArrow) as ArrowNode[], [orderedNodes])
  const frames = useMemo(
    () => orderedNodes.filter((n) => n.type === "frame") as FrameNode[],
    [orderedNodes],
  )
  const selectionBounds = useMemo(() => {
    const boxes = selectedIds
      .map((id) => nodes[id])
      .filter(Boolean)
      .map((n) => nodeBox(n as AnyNode, byId))
    return unionBoxes(boxes)
  }, [selectedIds, nodes, byId])
  const resizableSel = selectedIds.some((id) => nodes[id] && !isArrow(nodes[id]))
  const singleArrowSelected =
    selectedIds.length === 1 && nodes[selectedIds[0]]?.type === "arrow"

  return (
    <div className="flex-1 min-h-0 relative">
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden bg-slate-50 touch-none select-none"
        style={{
          cursor: panning
            ? "grabbing"
            : readOnly || spaceHeld || tool === "hand"
              ? "grab"
              : tool === "arrow" || tool === "text" || tool === "frame"
                ? "crosshair"
                : "default",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => arrowHoverId && setArrowHoverId(null)}
        onDragStart={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (readOnly) return
          const page = toPage(e.clientX, e.clientY)
          const hit =
            hitTest(page, boxTopFirst(), byId, 0) ??
            hitTest(page, [...orderedNodes].reverse().filter(isArrow), byId, 8 / camera.z)
          if (!hit) return
          const n = nodes[hit]
          if (!n) return
          const pid = !isArrow(n) ? (n as BoxNode).parentId : null
          if (pid && nodes[pid]?.type === "group" && focusedGroup !== pid) {
            setFocusedGroup(pid)
            store.setSelection([hit])
            return
          }
          if (n.type === "text") setEditingId(hit)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (readOnly) return
          const page = toPage(e.clientX, e.clientY)
          const hit = hitTest(page, [...orderedNodes].reverse(), byId, 8 / camera.z)
          if (hit) {
            const t = selectionTarget(hit)
            if (!selectedSet.has(t)) store.setSelection([t])
          } else {
            store.setSelection([])
          }
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: cameraTransform(camera),
            transformOrigin: "0 0",
            width: 1,
            height: 1,
          }}
        >
          <ArrowLayer arrows={arrows} byId={byId} zoom={camera.z} selectedIds={selectedSet} />

          <NodeLayer
            boxNodes={boxNodes}
            readOnly={readOnly}
            editingId={editingId}
            setEditingId={setEditingId}
          />

          {/* frame chrome (border + title) — constant screen size via ÷zoom */}
          {frames.map((f) => (
            <FrameChrome
              key={"fc-" + f.id}
              frame={f}
              zoom={camera.z}
              readOnly={readOnly}
              editing={editingId === f.id}
              onTitlePointerDown={(e) => startFrameTitleDrag(f.id, e)}
              onEdit={() => setEditingId(f.id)}
              onCommitName={(name) => {
                store.commit(() => store.replaceNode({ ...f, name }))
                setEditingId(null)
              }}
            />
          ))}

          {/* per-node indicators for multi-selection (see every object) */}
          {!readOnly &&
            selectedIds.length > 1 &&
            selectedIds.map((id) => {
              const n = nodes[id]
              if (!n) return null
              const b = nodeBox(n, byId)
              return (
                <div
                  key={"ind-" + id}
                  style={{
                    position: "absolute",
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    border: `${1.5 / camera.z}px solid #6366f1`,
                    borderRadius: isArrow(n) ? 0 : 2,
                    pointerEvents: "none",
                  }}
                />
              )
            })}

          {/* selection + handles + guides (world space) */}
          {!readOnly && selectionBounds && !singleArrowSelected && (
            <SelectionOverlay
              bounds={selectionBounds}
              zoom={camera.z}
              resizable={resizableSel}
              onResizeStart={(h, e) => startResize(h, e)}
            />
          )}

          {!readOnly && singleArrowSelected &&
            (() => {
              const a = nodes[selectedIds[0]] as ArrowNode
              const info = getArrowInfo(a, byId)
              const hs = 10 / camera.z
              const round = (p: Vec, handle: "start" | "end") => (
                <div
                  key={handle}
                  onPointerDown={(e) => startArrowHandle(handle, a.id, e)}
                  style={{
                    position: "absolute",
                    left: p.x - hs / 2,
                    top: p.y - hs / 2,
                    width: hs,
                    height: hs,
                    background: "#fff",
                    border: `${1.5 / camera.z}px solid #6366f1`,
                    borderRadius: "50%",
                    cursor: "pointer",
                    pointerEvents: "all",
                  }}
                />
              )
              return (
                <>
                  {round(info.start, "start")}
                  {round(info.end, "end")}
                  {info.midHandle && (
                    <div
                      onPointerDown={(e) => startArrowHandle("mid", a.id, e)}
                      style={{
                        position: "absolute",
                        left: info.midHandle.point.x - hs / 2,
                        top: info.midHandle.point.y - hs / 2,
                        width: hs,
                        height: hs,
                        background: "#6366f1",
                        borderRadius: 2,
                        cursor: info.midHandle.axis === "x" ? "ew-resize" : "ns-resize",
                        pointerEvents: "all",
                      }}
                    />
                  )}
                </>
              )
            })()}
          {guides.map((g, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                background: "#6366f1",
                ...(g.axis === "x"
                  ? { left: g.pos, top: g.from, width: 1 / camera.z, height: g.to - g.from }
                  : { top: g.pos, left: g.from, height: 1 / camera.z, width: g.to - g.from }),
              }}
            />
          ))}
          {marquee && (
            <div
              style={{
                position: "absolute",
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
                border: `${1 / camera.z}px solid #6366f1`,
                background: "rgba(99,102,241,0.08)",
              }}
            />
          )}

          {/* arrow bind-target highlight */}
          {hoverBind &&
            nodes[hoverBind] &&
            !isArrow(nodes[hoverBind]) &&
            (() => {
              const b = boxNode(nodes[hoverBind] as BoxNode)
              return (
                <div
                  style={{
                    position: "absolute",
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    border: `${2 / camera.z}px solid #6366f1`,
                    borderRadius: 3,
                    background: "rgba(99,102,241,0.06)",
                    pointerEvents: "none",
                  }}
                />
              )
            })()}

          {/* connection-point hints: while drawing onto a target, or hovering a
              box in arrow mode. Shows center + corners + edge mids to drag from. */}
          {!readOnly &&
            (() => {
              const id = hoverBind ?? (tool === "arrow" ? arrowHoverId : null)
              const n = id ? nodes[id] : null
              if (!n || isArrow(n)) return null
              const b = boxNode(n as BoxNode)
              const ds = 7 / camera.z
              const bw = 1.5 / camera.z
              return ANCHOR_CANDIDATES.map((c, i) => (
                <div
                  key={"cdot-" + i}
                  style={{
                    position: "absolute",
                    left: b.x + c.a.x * b.w - ds / 2,
                    top: b.y + c.a.y * b.h - ds / 2,
                    width: ds,
                    height: ds,
                    background: c.precise ? "#fff" : "#6366f1",
                    border: `${bw}px solid #6366f1`,
                    borderRadius: "50%",
                    pointerEvents: "none",
                  }}
                />
              ))
            })()}

          {/* drilled-in group outline */}
          {!readOnly &&
            focusedGroup &&
            nodes[focusedGroup] &&
            (() => {
              const b = nodeBox(nodes[focusedGroup], byId)
              const p = 4 / camera.z
              return (
                <div
                  style={{
                    position: "absolute",
                    left: b.x - p,
                    top: b.y - p,
                    width: b.w + 2 * p,
                    height: b.h + 2 * p,
                    border: `${1 / camera.z}px dashed #94a3b8`,
                    pointerEvents: "none",
                  }}
                />
              )
            })()}
        </div>
      </div>

      {/* zoom / history controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg border border-slate-200 shadow-sm p-1 pointer-events-auto">
        <Ctl title="Undo" onClick={() => store.undo()}><Undo2 size={15} /></Ctl>
        <Ctl title="Redo" onClick={() => store.redo()}><Redo2 size={15} /></Ctl>
        <div className="w-px h-5 bg-slate-200 mx-0.5" />
        <Ctl title="Zoom out" onClick={() => zoomBtn(-1)}><ZoomOut size={15} /></Ctl>
        <button
          type="button"
          title="Reset to 100%"
          onClick={() => zoomTo(1)}
          className="text-[11px] tabular-nums text-slate-500 hover:text-slate-900 w-11 text-center"
        >
          {Math.round(camera.z * 100)}%
        </button>
        <Ctl title="Zoom in" onClick={() => zoomBtn(1)}><ZoomIn size={15} /></Ctl>
        <Ctl title="Zoom to fit" onClick={() => fitView()}><Maximize size={15} /></Ctl>
        {!readOnly && host.share && (
          <>
            <div className="w-px h-5 bg-slate-200 mx-0.5" />
            <Ctl
              title={shareState === "copied" ? "Link copied!" : "Copy public read-only link"}
              onClick={() => void onShare()}
            >
              {shareState === "copied" ? (
                <Check size={15} className="text-emerald-600" />
              ) : shareState === "error" ? (
                <Share2 size={15} className="text-rose-600" />
              ) : (
                <Share2 size={15} className={shareState === "sharing" ? "animate-pulse" : ""} />
              )}
            </Ctl>
            {shareState === "copied" && (
              <span className="text-[11px] text-emerald-600 pr-1">copied</span>
            )}
          </>
        )}
      </div>

      {!readOnly && (
        <BottomToolbar
          tool={tool}
          onTool={(t) => store.setTool(t)}
          onInsertImage={host.uploadAsset ? () => fileInputRef.current?.click() : null}
          onInsertMeasure={insertMeasure}
          onNewMeasure={renderMeasureCreate ? () => setMeasureCreateOpen(true) : null}
          newMeasureLabel={newMeasureLabel}
        />
      )}
      {!readOnly &&
        measureCreateOpen &&
        renderMeasureCreate?.({
          onCreated: (m) => insertMeasure(m.id),
          onClose: () => setMeasureCreateOpen(false),
        })}
      {!readOnly && <StylePanel store={store} />}
      {menu && (
        <ContextMenu
          store={store}
          pos={menu}
          onClose={() => setMenu(null)}
          actions={{
            cut,
            copy,
            paste,
            duplicate,
            remove: () => {
              const sel = withGroupMembers(store.getState().selectedIds)
              if (sel.length) store.commit(() => store.removeNodes(sel))
            },
            copyPng: () => void copySelectionAsPng(store),
            download: () => void downloadOriginal(store),
          }}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void insertImageFile(f)
          e.target.value = ""
        }}
      />
    </div>
  )

  function zoomBtn(dir: number) {
    const r = rect()
    if (!r) return
    const center = { x: r.width / 2, y: r.height / 2 }
    cameraRef.current = zoomToAt(cameraRef.current, center, cameraRef.current.z * (dir > 0 ? 1.2 : 1 / 1.2))
    store.setCamera(cameraRef.current)
  }
  function zoomTo(z: number) {
    const r = rect()
    if (!r) return
    cameraRef.current = zoomToAt(cameraRef.current, { x: r.width / 2, y: r.height / 2 }, z)
    store.setCamera(cameraRef.current)
  }
  function fitView() {
    fittedRef.current = false
    const r = rect()
    if (!r) return
    const boxes = orderedNodes.map((n) => nodeBox(n, byId))
    const u = unionBoxes(boxes)
    if (!u) return
    const z = Math.max(0.1, Math.min(2, Math.min(r.width / (u.w || 1), r.height / (u.h || 1)) * 0.85))
    cameraRef.current = { x: r.width / 2 / z - (u.x + u.w / 2), y: r.height / 2 / z - (u.y + u.h / 2), z }
    store.setCamera(cameraRef.current)
  }
}

interface NodeRenderCtx {
  readOnly: boolean
  editingId: string | null
  setEditingId: (id: string | null) => void
}

// One node's positioned wrapper + content + (text) editor. `left/top` are
// absolute for free nodes, frame-relative for frame members.
function NodeBox({
  n,
  left,
  top,
  ctx,
}: {
  n: BoxNode
  left: number
  top: number
  ctx: NodeRenderCtx
}) {
  const store = useStore()
  const Content = NODE_RENDERERS[n.type]
  return (
    <div
      data-node-id={n.id}
      style={{ position: "absolute", left, top, width: n.w, height: n.h }}
    >
      {Content ? <Content node={n} readOnly={ctx.readOnly} /> : null}
      {ctx.editingId === n.id && n.type === "text" ? (
        <TextEditor
          node={n}
          onCommit={(text) => {
            if (text.trim() === "") store.commit(() => store.removeNodes([n.id]))
            else store.commit(() => store.replaceNode({ ...n, text }))
            ctx.setEditingId(null)
          }}
        />
      ) : null}
    </div>
  )
}

// Just the clipped body + members. The border + title (which must stay a
// constant SCREEN size) are drawn separately in the zoom-aware overlay so this
// layer can stay camera-independent (perf).
// Clipped body + members, RECURSIVE: a frame member that is itself a frame
// renders as a nested FrameView (so auto-layout rows-of-columns clip & stack
// correctly). `left/top` position this frame relative to its parent's origin;
// children are offset from this frame's own absolute origin.
function FrameView({
  frame,
  left,
  top,
  childrenByParent,
  ctx,
}: {
  frame: FrameNode
  left: number
  top: number
  childrenByParent: Map<string, BoxNode[]>
  ctx: NodeRenderCtx
}) {
  const kids = childrenByParent.get(frame.id) ?? []
  return (
    <div
      data-node-id={frame.id}
      style={{
        position: "absolute",
        left,
        top,
        width: frame.w,
        height: frame.h,
        overflow: "hidden",
        borderRadius: 6,
        background: "rgba(248,250,252,0.5)",
        pointerEvents: "none",
      }}
    >
      {kids.map((c) =>
        c.type === "frame" ? (
          <FrameView
            key={c.id}
            frame={c}
            left={c.x - frame.x}
            top={c.y - frame.y}
            childrenByParent={childrenByParent}
            ctx={ctx}
          />
        ) : (
          <NodeBox key={c.id} n={c} left={c.x - frame.x} top={c.y - frame.y} ctx={ctx} />
        ),
      )}
    </div>
  )
}

// Memoized so pan/zoom (which only change the parent's CSS transform) don't
// re-render every node. Frames render as clipped containers (members nested,
// recursively for nested frames); group members and everything else render flat.
const NodeLayer = memo(function NodeLayer({
  boxNodes,
  readOnly,
  editingId,
  setEditingId,
}: {
  boxNodes: BoxNode[]
  readOnly: boolean
  editingId: string | null
  setEditingId: (id: string | null) => void
}) {
  const ctx: NodeRenderCtx = { readOnly, editingId, setEditingId }
  const frameIds = new Set(boxNodes.filter((n) => n.type === "frame").map((n) => n.id))
  // a node is "framed" iff its parent is a frame → rendered (recursively) inside
  // it. Group members (parent is a group, not a frame) render flat, as before.
  const isFramed = (n: BoxNode) => !!n.parentId && frameIds.has(n.parentId)
  const childrenByParent = new Map<string, BoxNode[]>()
  for (const n of boxNodes) {
    if (isFramed(n)) {
      const arr = childrenByParent.get(n.parentId!) ?? []
      arr.push(n) // boxNodes is in z-order, so children stay z-ordered
      childrenByParent.set(n.parentId!, arr)
    }
  }
  return (
    <>
      {boxNodes.map((n) => {
        if (isFramed(n)) return null // rendered inside its frame
        if (n.type === "frame")
          return <FrameView key={n.id} frame={n} left={n.x} top={n.y} childrenByParent={childrenByParent} ctx={ctx} />
        return <NodeBox key={n.id} n={n} left={n.x} top={n.y} ctx={ctx} />
      })}
    </>
  )
})

function FrameChrome({
  frame,
  zoom,
  readOnly,
  editing,
  onTitlePointerDown,
  onEdit,
  onCommitName,
}: {
  frame: FrameNode
  zoom: number
  readOnly: boolean
  editing: boolean
  onTitlePointerDown: (e: React.PointerEvent) => void
  onEdit: () => void
  onCommitName: (name: string) => void
}) {
  return (
    <>
      {editing && !readOnly ? (
        <input
          autoFocus
          defaultValue={frame.name}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => onCommitName(e.target.value || "Frame")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur()
            e.stopPropagation()
          }}
          style={{
            position: "absolute",
            left: frame.x,
            top: frame.y - 22 / zoom,
            width: frame.w,
            fontSize: 13 / zoom,
            fontWeight: 600,
            color: "#475569",
            border: `${1 / zoom}px solid #6366f1`,
            borderRadius: 3 / zoom,
            padding: `${1 / zoom}px ${4 / zoom}px`,
            background: "white",
            pointerEvents: "all",
          }}
        />
      ) : (
        <div
          onPointerDown={readOnly ? undefined : onTitlePointerDown}
          onDoubleClick={readOnly ? undefined : onEdit}
          style={{
            position: "absolute",
            left: frame.x,
            top: frame.y - 20 / zoom,
            maxWidth: frame.w,
            fontSize: 13 / zoom,
            fontWeight: 600,
            color: "#64748b",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            pointerEvents: readOnly ? "none" : "all",
            cursor: readOnly ? "default" : "move",
            lineHeight: 1.2,
          }}
        >
          {frame.name}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: frame.x,
          top: frame.y,
          width: frame.w,
          height: frame.h,
          border: `${1.5 / zoom}px solid #cbd5e1`,
          borderRadius: 6,
          pointerEvents: "none",
        }}
      />
    </>
  )
}

function Ctl({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const HANDLES: { h: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
  { h: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { h: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { h: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { h: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { h: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { h: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { h: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { h: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
]

function SelectionOverlay({
  bounds,
  zoom,
  resizable,
  onResizeStart,
}: {
  bounds: Box
  zoom: number
  resizable: boolean
  onResizeStart: (h: ResizeHandle, e: React.PointerEvent) => void
}) {
  const hs = 8 / zoom
  return (
    <div
      style={{
        position: "absolute",
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        border: `${1.5 / zoom}px solid #6366f1`,
        pointerEvents: "none",
      }}
    >
      {resizable &&
        HANDLES.map((handle) => (
          <div
            key={handle.h}
            onPointerDown={(e) => onResizeStart(handle.h, e)}
            style={{
              position: "absolute",
              left: bounds.w * handle.cx - hs / 2,
              top: bounds.h * handle.cy - hs / 2,
              width: hs,
              height: hs,
              background: "#fff",
              border: `${1 / zoom}px solid #6366f1`,
              borderRadius: hs * 0.25,
              cursor: handle.cursor,
              pointerEvents: "all",
            }}
          />
        ))}
    </div>
  )
}

function TextEditor({
  node,
  onCommit,
}: {
  node: { text: string; fontSize: number; color?: string; align?: "left" | "center" }
  onCommit: (text: string) => void
}) {
  const [val, setVal] = useState(node.text)
  return (
    <textarea
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onCommit(val)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onCommit(node.text)
        }
        e.stopPropagation()
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        resize: "none",
        border: "none",
        outline: "2px solid #6366f1",
        background: "white",
        fontSize: node.fontSize,
        lineHeight: 1.3,
        color: node.color ?? "#0f172a",
        textAlign: node.align ?? "left",
        padding: 2,
        pointerEvents: "all",
      }}
    />
  )
}

async function imageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => resolve({ w: 400, h: 300 })
    img.src = url
  })
}
