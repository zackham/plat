// Per-mount measure data cache. The host hands us plain promises
// (MeasureSource); this store adds the reactive layer measure nodes need —
// fetch-once per id, subscriptions via useSyncExternalStore, refresh, and a
// bulk refetch for host-driven invalidation (PlatHandle.refetchMeasures).

import { useCallback, useEffect } from "react"
import { createContext, useContext, useSyncExternalStore } from "react"
import type { MeasureData, MeasureSource } from "./host"

export interface MeasureEntry {
  data: MeasureData | null
  /** Load/refresh failure message (distinct from a measure's own script error,
   *  which lives in data.latest.error). */
  error: string | null
  loading: boolean
  refreshing: boolean
}

const IDLE: MeasureEntry = { data: null, error: null, loading: true, refreshing: false }

export class MeasureDataStore {
  private entries = new Map<string, MeasureEntry>()
  private listeners = new Map<string, Set<() => void>>()
  private inFlight = new Set<string>()
  // Plain field assignment (not a constructor parameter property) so the
  // source stays erasable-syntax-only — hosts can compile with type-stripping.
  private source: MeasureSource | undefined

  constructor(source: MeasureSource | undefined) {
    this.source = source
  }

  get canRefresh(): boolean {
    return !!this.source?.refresh
  }

  entry(id: string): MeasureEntry {
    return this.entries.get(id) ?? IDLE
  }

  /** Subscribe a component to one measure; kicks the initial fetch. */
  subscribe(id: string, cb: () => void): () => void {
    let set = this.listeners.get(id)
    if (!set) {
      set = new Set()
      this.listeners.set(id, set)
    }
    set.add(cb)
    this.ensure(id)
    return () => {
      set.delete(cb)
    }
  }

  private emit(id: string) {
    for (const cb of this.listeners.get(id) ?? []) cb()
  }

  private patch(id: string, patch: Partial<MeasureEntry>) {
    this.entries.set(id, { ...this.entry(id), ...patch })
    this.emit(id)
  }

  /** Fetch once (no-op if already loaded or loading). */
  ensure(id: string): void {
    if (!id || this.entries.has(id) || this.inFlight.has(id)) return
    void this.load(id)
  }

  private async load(id: string): Promise<void> {
    if (!this.source) {
      this.entries.set(id, { data: null, error: "no measure source", loading: false, refreshing: false })
      this.emit(id)
      return
    }
    this.inFlight.add(id)
    this.patch(id, { loading: !this.entry(id).data })
    try {
      const data = await this.source.get(id)
      this.patch(id, { data, error: null, loading: false })
    } catch (e) {
      this.patch(id, {
        error: e instanceof Error ? e.message : String(e),
        loading: false,
      })
    } finally {
      this.inFlight.delete(id)
    }
  }

  /** Recompute via the host, keeping the stale value visible while it runs. */
  async refresh(id: string): Promise<void> {
    const refresh = this.source?.refresh
    if (!refresh || this.entry(id).refreshing) return
    this.patch(id, { refreshing: true })
    try {
      const data = await refresh(id)
      this.patch(id, { data, error: null, refreshing: false, loading: false })
    } catch (e) {
      this.patch(id, {
        error: e instanceof Error ? e.message : String(e),
        refreshing: false,
      })
    }
  }

  /** Re-fetch every cached measure (host-side data changed under us). */
  refetchAll(): void {
    for (const id of this.entries.keys()) {
      this.entries.delete(id)
      this.ensure(id)
    }
  }
}

export const MeasureDataContext = createContext<MeasureDataStore | null>(null)

export function useMeasureStore(): MeasureDataStore {
  const s = useContext(MeasureDataContext)
  if (!s) throw new Error("useMeasureStore outside MeasureDataContext")
  return s
}

/** Reactive view of one measure's data. */
export function useMeasureData(measureId: string): MeasureEntry {
  const store = useMeasureStore()
  const subscribe = useCallback(
    (cb: () => void) => store.subscribe(measureId, cb),
    [store, measureId],
  )
  const getSnap = useCallback(() => store.entry(measureId), [store, measureId])
  // ensure() runs in subscribe, but also on id change before first paint:
  useEffect(() => store.ensure(measureId), [store, measureId])
  return useSyncExternalStore(subscribe, getSnap, getSnap)
}
