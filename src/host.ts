// The host adapter — everything the canvas needs from its embedding
// application, scoped to ONE canvas document. This is the library's only
// data boundary: the engine never fetches, never knows URLs, never knows how
// the host stores docs/assets/measures or who is allowed to edit them.
//
// Optional members are capabilities. Omit one and the corresponding UI simply
// doesn't render: no `saveDoc` ⇒ view-only, no `uploadAsset` ⇒ no image
// insert/paste, no `measures.refresh` ⇒ no refresh button, no `share` ⇒ no
// share button. The public read-only share and the full editor are the same
// component with different hosts.

import { createContext, useContext } from "react"
import type { PlatDoc } from "./types"

/** Latest computed result for a measure. `result` is an open dict; the
 *  renderer picks known keys: `value`, `label`, `note`, `link{url,label}`,
 *  `display:"text"` + `text`/`list_text`. Anything else rides along. */
export interface MeasureResult {
  result: Record<string, unknown> | null
  error: string | null
  refreshed_at: string | null
}

/** A measure as the canvas renders it: identity + latest result. */
export interface MeasureData {
  id: string
  name: string
  description?: string
  latest: MeasureResult | null
}

/** A measure as listed in the insert picker. */
export interface MeasureSummary {
  id: string
  name: string
}

/** Host-implemented measure data source. How measures are computed, stored,
 *  authored, and authorized is entirely the host's concern — the canvas only
 *  reads data and (optionally) asks for a recompute. */
export interface MeasureSource {
  /** Fetch a measure's current data. Reject ⇒ the node shows an error state. */
  get(measureId: string): Promise<MeasureData>
  /** Recompute a measure and return fresh data. Omit ⇒ no refresh button. */
  refresh?(measureId: string): Promise<MeasureData>
  /** Measures available to insert from the toolbar. Omit ⇒ no picker. */
  list?(): Promise<MeasureSummary[]>
}

export interface SaveDocOptions {
  /** Last-chance flush while the page unloads: use a keepalive-capable
   *  transport, skip retries and UI signals. */
  final?: boolean
}

/** Optional result of a save. A host that implements revision tracking
 *  returns the doc's NEW revision so the editor stamps it on the next save. */
export interface SaveDocResult {
  revision?: number
}

/**
 * Thrown (rejected) by a host's `saveDoc` when the stored doc changed under
 * the editor — i.e. the save's base revision (`doc.revision`) no longer
 * matches storage. The editor then freezes autosave and shows a conflict
 * banner instead of silently clobbering the other writer. See EMBEDDING.md.
 */
export class PlatSaveConflictError extends Error {
  readonly code = "plat/conflict"
  constructor(message = "plat changed elsewhere") {
    super(message)
    this.name = "PlatSaveConflictError"
  }
}

/** instanceof-safe conflict check (also honors a bare `{code:"plat/conflict"}`
 *  shape, so hosts don't strictly need our error class). */
export function isSaveConflict(e: unknown): boolean {
  return (
    e instanceof PlatSaveConflictError ||
    (typeof e === "object" && e !== null && (e as { code?: string }).code === "plat/conflict")
  )
}

export interface PlatHost {
  /** Load the document. Resolve null for a brand-new canvas (the editor then
   *  creates and persists an empty doc). Reject ⇒ a load-error screen; the
   *  editor will NOT treat a failed load as an empty canvas. */
  loadDoc(): Promise<PlatDoc | null>
  /** Persist the document. Transport-level retries and save-state UI are the
   *  host's concern. Omit ⇒ the canvas is view-only.
   *
   *  Optional revision protocol (multi-writer safety, see EMBEDDING.md): the
   *  editor echoes the revision it loaded as `doc.revision` (its BASE); a
   *  revision-aware host rejects a stale base with `PlatSaveConflictError`
   *  and otherwise stores the doc under a new revision, returning it as
   *  `{revision}`. Hosts that don't care ignore all of this. */
  saveDoc?(doc: PlatDoc, opts?: SaveDocOptions): Promise<SaveDocResult | void>
  /** Store an image blob, return a URL the canvas can render (must remain
   *  resolvable for future loads). Omit ⇒ image insert/paste disabled. */
  uploadAsset?(blob: Blob, name?: string): Promise<{ src: string }>
  /** Measure data source. Omit ⇒ measure nodes render "unavailable". */
  measures?: MeasureSource
  /** Create (or reuse) a public share link for this canvas. */
  share?(): Promise<{ url: string }>
  /** Surface a user-facing notification. Omit ⇒ errors go to console. */
  notify?(kind: "success" | "error", message: string): void
}

/** Imperative surface handed to the host via `onReady` — how surrounding
 *  chrome (panels, refresh buttons) talks to a mounted canvas. */
export interface PlatHandle {
  /** Drop a measure node at the viewport center. */
  insertMeasure(measureId: string): void
  /** Re-fetch every measure currently cached (call after host-side refreshes). */
  refetchMeasures(): void
  zoomToFit(): void
}

export const PlatHostContext = createContext<PlatHost | null>(null)

export function usePlatHost(): PlatHost {
  const h = useContext(PlatHostContext)
  if (!h) throw new Error("usePlatHost outside PlatHostContext")
  return h
}

export function notifyError(host: PlatHost, message: string): void {
  if (host.notify) host.notify("error", message)
  else console.error(`[canvas] ${message}`)
}
