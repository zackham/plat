// Public surface of the plat library. Host apps should import from here, not
// from individual modules. Styles ship separately — import "plat/plat.css"
// once in your app (see HOSTING.md).

export { Plat } from "./Plat"
export { PlatSaveConflictError, isSaveConflict } from "./host"

export type {
  PlatHost,
  MeasureData,
  MeasureResult,
  MeasureSource,
  MeasureSummary,
  SaveDocOptions,
  SaveDocResult,
  UploadedAsset,
} from "./host"

// Runtime controller — what onReady hands out, also reachable from custom
// node renderers via usePlatApi(). PlatHandle is the compatibility alias.
export { PlatApi, usePlatApi } from "./api"
export type { PlatHandle, PlatNodeInit, ConnectOptions, ZoomToOptions, PlatApiEvent } from "./api"

// Host-extensible node types + the interactive-content protocol (NODES.md).
export { definePlatNodeType, platInteractive, PLAT_INTERACTIVE_ATTR } from "./nodeTypes"
export type { PlatNodeType, PlatNodeBehaviors, PlatNodeRenderProps } from "./nodeTypes"

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
  VideoNode,
  VideoPlayback,
} from "./types"
export {
  isArrow,
  isBox,
  isContainer,
  isLayoutContainer,
  videoPlayback,
  VIDEO_LOOP_MAX_SECONDS,
} from "./types"

// Programmatic authoring: settleDoc is the headless auto-layout settle every
// doc-writing process needs (see AUTHORING.md); the lower-level engine pieces
// and the measure render conventions ride along.
export { settleDoc, flowChildren, reflowLayoutFrame, outermostLayoutAncestor } from "./layout"
export type { LayoutPatch } from "./layout"
export { formatValue, pickText, pickValue } from "./measureFormat"
