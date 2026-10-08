// Canvas data model. A flat document of nodes (boxes) + arrows, keyed by id.
// Designed for extension: add a node type by adding a variant here, a renderer
// in nodes/index.ts, and (optionally) a behavior in behaviors.ts.

export interface Camera {
  x: number
  y: number
  z: number
}

export interface Vec {
  x: number
  y: number
}

/** Box nodes share this shape (image/video/text/measure/group). */
export interface BoxBase {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** fractional index string (sortable). For members of an auto-layout frame this
   *  is the FLOW order. It is NOT z-order — z-order is the store's `order` array. */
  index: string
  /** group/frame membership (id of the container node) or null. */
  parentId?: string | null
  /** member of an auto-layout frame but excluded from the flow: keeps its own
   *  absolute coords and does not feed hug sizing. Figma's "ignore auto layout".
   *  No effect on a non-layout container. */
  layoutIgnore?: boolean
}

export interface ImageNode extends BoxBase {
  type: "image"
  src: string
  assetId?: string
  name?: string
}

/** Playback behavior of a video node. "loop" = muted autoplay loop while the
 *  node is on screen (GIF-like, for short silent clips); "click" = poster
 *  frame + play button. */
export type VideoPlayback = "loop" | "click"

/** Clips at or under this length with no audio default to "loop". */
export const VIDEO_LOOP_MAX_SECONDS = 30

export interface VideoNode extends BoxBase {
  type: "video"
  /** host asset URL of a browser-playable file (H.264 MP4 is the safe choice) */
  src: string
  /** still frame shown before playback and used by PNG export */
  poster?: string
  assetId?: string
  name?: string
  /** seconds; with `hasAudio` it picks the default playback mode */
  duration?: number
  hasAudio?: boolean
  /** explicit playback mode; absent ⇒ derived (see videoPlayback) */
  playback?: VideoPlayback
}

/** Effective playback mode: explicit `playback` wins; otherwise short silent
 *  clips loop and everything else (long, has audio, or unknown) is click. */
export function videoPlayback(
  n: Pick<VideoNode, "playback" | "duration" | "hasAudio">,
): VideoPlayback {
  if (n.playback) return n.playback
  return n.duration != null && n.duration <= VIDEO_LOOP_MAX_SECONDS && n.hasAudio === false
    ? "loop"
    : "click"
}

export interface TextNode extends BoxBase {
  type: "text"
  text: string
  fontSize: number
  color?: string
  align?: "left" | "center"
}

export interface MeasureNode extends BoxBase {
  type: "measure"
  measureId: string
  fontScale?: number
}

export interface GroupNode extends BoxBase {
  type: "group"
  /** Auto-layout config. Its presence makes this an invisible (chrome-less) flex
   *  container — same engine as a frame, but a group draws NO border/title. Use a
   *  group for pure nested layout scaffolding; use a frame when you want a titled,
   *  bordered, clipping container. Auto-layout is orthogonal to chrome. */
  layout?: LayoutProps
}

/** A clickable external link (e.g. an Amplitude funnel chart). Renders as a
 *  pill; opens in a new tab when the canvas is read-only/viewed. */
export interface LinkNode extends BoxBase {
  type: "link"
  url: string
  label?: string
  fontSize?: number
  color?: string
}

/** Per-side inner padding for an auto-layout frame, in page units. */
export interface LayoutPadding {
  t: number
  r: number
  b: number
  l: number
}

/** Auto-layout (flex-style) config on a frame. Presence of this object is what
 *  makes a frame an auto-layout container; absence = a normal free-form frame
 *  (byte-identical legacy behavior). Children flow in `index` order. */
export interface LayoutProps {
  /** flow direction: 'h' = horizontal row, 'v' = vertical column. */
  dir: "h" | "v"
  /** uniform gap between adjacent flow children, in page units. */
  gap: number
  /** inner padding, per side, in page units. */
  padding: LayoutPadding
  /** main-axis (along `dir`) distribution of children within the container. */
  justify: "start" | "center" | "end" | "space-between"
  /** counter-axis (perpendicular) alignment of each child. */
  align: "start" | "center" | "end"
  /** per-axis container sizing. 'hug' = size to fit children; 'fixed' = keep the
   *  stored w/h. `main` is along `dir`; `cross` is perpendicular. */
  sizing: { main: "hug" | "fixed"; cross: "hug" | "fixed" }
}

/** Figma-style frame: a titled, bordered container with its own bounds that
 *  clips and moves its members. Members reference it via parentId. When
 *  `layout` is set the frame becomes an auto-layout container (see layout.ts). */
export interface FrameNode extends BoxBase {
  type: "frame"
  name: string
  layout?: LayoutProps
}

/** A container (group or frame) with auto-layout enabled. group = invisible
 *  scaffold, frame = titled/bordered — auto-layout is orthogonal to chrome, so
 *  the engine treats both identically. */
export type LayoutContainer = (FrameNode | GroupNode) & { layout: LayoutProps }

export const isLayoutContainer = (n: AnyNode): n is LayoutContainer =>
  (n.type === "frame" || n.type === "group") &&
  !!(n as FrameNode | GroupNode).layout

export interface ArrowBinding {
  nodeId: string
  /** 0..1 position within the node's bounds (0.5,0.5 = center). */
  anchor: Vec
  /** true = anchor is a user-chosen precise point; false = treat as center. */
  isPrecise?: boolean
}

export interface ArrowEndpoint {
  x: number
  y: number
  binding?: ArrowBinding | null
}

export type ArrowKind = "straight" | "elbow" | "curve"

export interface ArrowNode {
  id: string
  type: "arrow"
  index: string
  parentId?: string | null
  start: ArrowEndpoint
  end: ArrowEndpoint
  color?: string
  kind?: ArrowKind
  /** elbow mid-segment position along its range (0..1). */
  elbowMid?: number
  /** "none" = connector styling (tree links) without an arrowhead. */
  arrowhead?: "end" | "none"
}

export type ToolMode = "select" | "hand" | "arrow" | "text" | "frame"

/** Custom (host-defined) node type ids MUST be namespaced with a dot, e.g.
 *  "rabbithole.document" or "acme.chat". The dot is what keeps the node union
 *  discriminated for TypeScript (a dotted id can never collide with a built-in
 *  literal like "frame") and keeps plugin ecosystems collision-free.
 *  Registration: definePlatNodeType + the `nodeTypes` prop (see NODES.md). */
export type CustomNodeTypeId = `${string}.${string}`

/** A host-defined content node. The engine treats it as a plain box (drag,
 *  resize, snap, group, arrows, layout all work); rendering and `props`
 *  semantics belong to the registered node type. */
export interface CustomNode extends BoxBase {
  type: CustomNodeTypeId
  props: Record<string, unknown>
}

export const isCustomNode = (n: AnyNode): n is CustomNode =>
  n.type.includes(".")

export type BoxNode =
  | ImageNode
  | VideoNode
  | TextNode
  | MeasureNode
  | GroupNode
  | FrameNode
  | LinkNode
  | CustomNode
export type AnyNode = BoxNode | ArrowNode

export interface PlatDoc {
  format: "plat"
  version: 1
  nodes: AnyNode[]
  /** Optional multi-writer safety (see EMBEDDING.md). On a stored doc: the
   *  revision it was saved under. On a doc handed to `saveDoc`: the BASE
   *  revision the editor's changes started from — a revision-aware host
   *  rejects the save when it no longer matches storage. Absent ⇒
   *  last-writer-wins. */
  revision?: number
}

export const isArrow = (n: AnyNode): n is ArrowNode => n.type === "arrow"
export const isBox = (n: AnyNode): n is BoxNode => n.type !== "arrow"
/** containers own members via parentId. group = invisible/scales; frame = titled/clips. */
export const isContainer = (n: AnyNode): n is GroupNode | FrameNode =>
  n.type === "group" || n.type === "frame"

export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
