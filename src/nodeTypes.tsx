// Host-extensible node types. A PlatNodeType packages everything the engine
// needs to host a content node it knows nothing about: a renderer, sizing
// defaults, and interaction behaviors. Built-in content nodes (image, text,
// measure, link) are registered through this exact machinery — custom types
// are not second-class citizens, they're the same thing with a dotted id.
//
// Structural nodes (group, frame, arrow) are engine-level and NOT pluggable:
// they define containment and connection semantics the whole engine reasons
// about. Content is open; structure is owned.

import { createContext, useContext } from "react"
import type { ComponentType, ReactNode } from "react"
import type { AnyNode, CustomNodeTypeId } from "./types"

export interface PlatNodeRenderProps {
  node: AnyNode
  readOnly: boolean
}

export interface PlatNodeBehaviors {
  /** false ⇒ no resize handles when this node is the sole selection.
   *  (Multi-select scaling still applies — it's a selection-level gesture.) */
  resizable?: boolean
  /** Minimum edge length while resizing (page units). Engine floor is 8. */
  minSize?: number
  /** Content drives height: the node renders height-auto, the engine measures
   *  it and keeps `h` in sync (no history entries), and single-selection
   *  resize is limited to width. See NODES.md. */
  autoHeight?: boolean
}

export interface PlatNodeType {
  /** Built-in id or a dotted custom id ("yourapp.card"). */
  type: string
  /** Renders INSIDE the positioned box (fill 100%/100%). Mark regions that own
   *  their own pointer/wheel/keyboard with {...platInteractive} (NODES.md). */
  render: ComponentType<PlatNodeRenderProps>
  /** Seed for nodes created without explicit props (api.create). */
  defaultProps?: Record<string, unknown>
  /** Seed for nodes created without explicit size (api.create). */
  defaultSize?: { w: number; h: number }
  behaviors?: PlatNodeBehaviors
}

const STRUCTURAL_TYPES = new Set(["group", "frame", "arrow"])

/** Define a custom node type. Enforces the dotted-namespace rule at
 *  registration time (the type system enforces it on documents). */
export function definePlatNodeType(def: PlatNodeType & { type: CustomNodeTypeId }): PlatNodeType {
  if (STRUCTURAL_TYPES.has(def.type)) {
    throw new Error(`"${def.type}" is a structural engine type and cannot be redefined`)
  }
  if (!def.type.includes(".")) {
    throw new Error(
      `plat node type "${def.type}" must be namespaced with a dot (e.g. "yourapp.${def.type}")`,
    )
  }
  return def
}

export type NodeTypeRegistry = Map<string, PlatNodeType>

/** Merge built-ins with host types. Hosts may override built-in CONTENT types
 *  (a custom text renderer, say) but never structural ones. */
export function buildRegistry(
  builtins: PlatNodeType[],
  custom: PlatNodeType[] | undefined,
): NodeTypeRegistry {
  const reg: NodeTypeRegistry = new Map()
  for (const t of builtins) reg.set(t.type, t)
  for (const t of custom ?? []) {
    if (STRUCTURAL_TYPES.has(t.type)) {
      throw new Error(`"${t.type}" is a structural engine type and cannot be redefined`)
    }
    reg.set(t.type, t)
  }
  return reg
}

export function getBehaviors(reg: NodeTypeRegistry, type: string): PlatNodeBehaviors {
  return reg.get(type)?.behaviors ?? {}
}

/** Renders when a doc contains a node type this host didn't register —
 *  degrade legibly, never crash, never lose the node. */
export function UnknownNodeContent({ node }: PlatNodeRenderProps): ReactNode {
  return (
    <div className="plat-unknown">
      <span className="plat-unknown__type">{node.type}</span>
      <span className="plat-unknown__hint">unregistered node type</span>
    </div>
  )
}

export const NodeTypeRegistryContext = createContext<NodeTypeRegistry | null>(null)

export function useNodeTypeRegistry(): NodeTypeRegistry {
  const r = useContext(NodeTypeRegistryContext)
  if (!r) throw new Error("useNodeTypeRegistry outside Plat")
  return r
}

/* ── the interaction-protocol marker ─────────────────────────
 * Spread onto any element inside a node renderer that owns its own input:
 * the engine will not start canvas gestures from pointerdowns inside it,
 * wheel events scroll it natively when it can scroll, and keyboard shortcuts
 * defer while focus lives inside it. Clicking it still selects the node. */
export const PLAT_INTERACTIVE_ATTR = "data-plat-interactive"
export const platInteractive = { [PLAT_INTERACTIVE_ATTR]: "" } as const

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(`[${PLAT_INTERACTIVE_ATTR}]`) !== null
  )
}

/** The nearest scrollable element between `target` and the interactive-region
 *  boundary that can still scroll in the wheel direction — the wheel event
 *  belongs to it, not to canvas zoom/pan. */
export function interactiveScrollTarget(
  target: EventTarget | null,
  deltaY: number,
): Element | null {
  if (!(target instanceof Element)) return null
  const region = target.closest(`[${PLAT_INTERACTIVE_ATTR}]`)
  if (!region) return null
  let el: Element | null = target
  while (el) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const canDown = deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1
      const canUp = deltaY < 0 && el.scrollTop > 0
      if (canDown || canUp) return el
    }
    if (el === region) break
    el = el.parentElement
  }
  return null
}
