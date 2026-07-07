# Embedding — the `PlatHost` contract

The canvas is embedded by mounting `<Plat host={...}>` with one adapter
object. The library owns rendering, interaction, the document format, and
autosave orchestration; the host owns storage, compute, auth, and transport.
Types in [`host.ts`](./host.ts) are authoritative.

```ts
interface PlatHost {
  loadDoc(): Promise<PlatDoc | null>          // null = brand-new canvas
  saveDoc?(doc, opts?: { final?: boolean }): Promise<void>
  uploadAsset?(blob: Blob, name?: string): Promise<{ src: string }>
  measures?: MeasureSource
  share?(): Promise<{ url: string }>
  notify?(kind: "success" | "error", message: string): void
}
```

The host is scoped to **one canvas document** — the library has no concept of
projects, canvas lists, or ids beyond what the host closes over. Keep the host
referentially stable per mount (memoize); the doc loads once per mount.

## Capability gating

Optional members are capabilities; omitting one removes its UI:

| omitted | effect |
|---|---|
| `saveDoc` | view-only (edit surface disabled entirely) |
| `uploadAsset` | no image insert button, no paste-image |
| `measures` | measure nodes render "unavailable" |
| `measures.refresh` | no per-measure refresh button |
| `measures.list` | no insert-measure picker |
| `share` | no share button |
| `notify` | errors go to `console.error` |

A read-only public share is just a host with `loadDoc` + `measures.get` and
nothing else. The full editor and the share viewer are the same component.

## Semantics the host must honor

- **`loadDoc`**: resolve `null` for a canvas that has never been saved (the
  editor creates and persists an empty doc). **Reject on failure** — the
  library shows an error screen and will not autosave, so a transient load
  failure can never overwrite a stored doc with an empty one.
- **`saveDoc`**: called from a serialized latest-wins queue (never concurrent).
  Transport retries and save-state UI (spinners/indicators) are the host's
  job. `{final: true}` means the page is unloading: use a keepalive-capable
  transport, skip retries and UI.
- **`uploadAsset`**: return a URL that stays resolvable for future loads —
  it is stored verbatim in the doc as the image node's `src`.
- **`measures.refresh`**: recompute, then return the fresh `MeasureData`
  (the library keeps the stale value visible while it runs).

## The measure data contract

A measure node stores only a `measureId`. The host supplies data as:

```ts
interface MeasureData {
  id: string
  name: string                       // card header
  description?: string
  latest: {
    result: Record<string, unknown> | null   // open dict — see conventions
    error: string | null                     // compute failure → "script error"
    refreshed_at: string | null              // ISO timestamp, null = never run
  } | null
}
```

`result` is an **open dictionary**; the renderer picks known keys and ignores
the rest (so hosts can carry extra fields through). Conventions
(`measureFormat.ts` is the reference implementation):

| key | meaning |
|---|---|
| `value` | primary number/string. Numbers auto-format: `<1` → percent, `≥1k` → `12.3k`, `≥1M` → `1.23M` |
| `label` | small caption under the value |
| `display: "text"` | switch the card to text mode |
| `text` / `list_text` | text-mode body (first non-empty of `text`, `list_text`, `label`) |
| `note` | expandable details popover |
| `link: {url, label?}` | source link rendered in the card footer |

How measures are *computed* is entirely the host's concern — one host runs
python `compute()` scripts server-side; another might proxy a SQL query,
call an analytics API, or return static JSON. Sandboxing user-authored
measure code is likewise a host concern by design.

## Imperative handle

`onReady` receives a `PlatHandle` for chrome that lives outside the
canvas (side panels, refresh buttons):

- `insertMeasure(measureId)` — drop a measure node at the viewport center
- `refetchMeasures()` — re-fetch all cached measure data (call after the host
  refreshes measures out-of-band)
- `zoomToFit()`

## Host-specific UI slots

`renderMeasureCreate` (+ `newMeasureLabel`) plugs a host's own
measure-creation flow into the toolbar's insert-measure menu (e.g. an
analytics-chart import modal). The library only calls
`onCreated({id})` / `onClose()`.

## Reference hosts

The first consumer (vita, this library's origin) runs two adapters against the
same component — a useful template for your own:

- a **full editor host** over a FastAPI backend: doc CRUD with retry-once
  saves + a save-state indicator, an asset blob store, python-scripted
  measures run server-side, and share-link minting;
- a **read-only public-share host**: fetches a doc + cached measure bundle in
  one call, serves measures from the bundle, omits every write capability.
