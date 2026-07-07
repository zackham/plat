// Public surface of the canvas library. Everything an embedding application
// needs — and nothing that isn't meant to travel when this feature is
// extracted to its own package. Host apps should import from here, not from
// individual modules.

export { Plat } from "./Plat"

export type {
  PlatHost,
  PlatHandle,
  MeasureData,
  MeasureResult,
  MeasureSource,
  MeasureSummary,
  SaveDocOptions,
} from "./host"

export type {
  AnyNode,
  ArrowNode,
  BoxNode,
  PlatDoc,
  FrameNode,
  GroupNode,
  ImageNode,
  LayoutProps,
  LinkNode,
  MeasureNode,
  TextNode,
} from "./types"
export { isArrow, isBox, isContainer, isLayoutContainer } from "./types"

// Programmatic authoring: the layout engine (settle auto-layout frames without
// mounting an editor) and the measure render conventions.
export { flowChildren, reflowLayoutFrame, outermostLayoutAncestor } from "./layout"
export type { LayoutPatch } from "./layout"
export { formatValue, pickText, pickValue } from "./measureFormat"
