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

## The revision protocol (optional multi-writer safety)

Without it, saves are last-writer-wins: two tabs, or an agent editing next to
the editor, can silently clobber each other. Opting in:

1. Store a `revision` number on the doc. On save, treat the incoming
   `doc.revision` as the writer's **base**: reject if it doesn't match the
   stored revision, otherwise store the doc under `stored + 1` and return
   `{revision: stored + 1}` from `saveDoc`.
2. Reject by throwing `PlatSaveConflictError` (exported), or any error with
   `code: "plat/conflict"`. Do NOT transport-retry a conflict.
3. The editor then freezes autosave and shows a "changed elsewhere — Reload"
   banner; Reload re-runs `loadDoc` and resumes.

Writers that send no `revision` (older agents, scripts) are accepted
last-writer-wins and still move the revision forward — the protocol degrades
gracefully in both directions. Programmatic writers should GET-then-PUT the
doc with its `revision` field echoed unchanged (AUTHORING.md).

Note the residual race: unless your backend's check-and-set is atomic, two
same-base saves can both pass. The protocol's job is stopping the
*human-scale* clobber; make the check atomic if your host is truly
multi-user-concurrent.

## The runtime api (PlatApi)

`onReady` hands out the full runtime controller (`PlatHandle` is its
compatibility alias); `usePlatApi()` reaches the same object from inside
custom node renderers. Everything routes through the editor's own
commit/gesture machinery, so api mutations are undoable exactly like user
edits.

```ts
// document
api.getDoc(); api.getNode(id)
api.create({ type, x, y, ...fields }, { select? })   // defaults from the node type
api.updateNode(id, patch, { history? })              // history:false = ephemeral
api.updateProps(id, partialProps, { history? })      // shallow-merge custom props
api.remove(ids)
api.connect(fromId, toId, { kind?, arrowhead?, fromAnchor?, toAnchor?, color? })
api.batch(fn)                                        // several ops, one undo step
api.beginEphemeral(); …history:false updates…; api.endEphemeral()
                                                     // a whole stream = ONE undo step
// selection & camera
api.getSelection(); api.select(ids)
api.getCamera(); api.setCamera(partial)
await api.zoomTo(nodeIdOrBox, { animate?, padding?, maxZoom? })  // tweened
api.zoomToFit(); api.clientToPage(p); api.pageToClient(p); api.viewportCenterPage()
// events
const off = api.on("change" | "selection" | "camera", cb)
// measures
api.insertMeasure(measureId); api.refetchMeasures()
```

The streaming pattern (LLM answers, live logs): `beginEphemeral()`, patch
every chunk with `{history: false}`, `endEphemeral()` — the user sees text
arrive live, and undo removes the whole answer in one step. One ephemeral
session at a time (it shares the editor's gesture snapshot); keep streams
short or serialize them.

## Host-specific UI slots

`theme` selects the built-in light/dark/auto chrome theme (HOSTING.md covers
token overrides). `renderMeasureCreate` (+ `newMeasureLabel`) plugs a host's own
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
