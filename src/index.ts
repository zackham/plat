// Public surface of the plat library. Host apps should import from here, not
// from individual modules. Styles ship separately — import "plat/plat.css"
// once in your app (see HOSTING.md).

export { Plat } from "./Plat"
export { PlatSaveConflictError, isSaveConflict } from "./host"

export type {
  PlatHost,
  PlatHandle,
  MeasureData,
  MeasureResult,
  MeasureSource,
  MeasureSummary,
  SaveDocOptions,
  SaveDocResult,
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

// Programmatic authoring: settleDoc is the headless auto-layout settle every
// doc-writing process needs (see AUTHORING.md); the lower-level engine pieces
// and the measure render conventions ride along.
export { settleDoc, flowChildren, reflowLayoutFrame, outermostLayoutAncestor } from "./layout"
export type { LayoutPatch } from "./layout"
export { formatValue, pickText, pickValue } from "./measureFormat"
