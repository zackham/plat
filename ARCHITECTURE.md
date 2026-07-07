# Engine architecture

Current-state description of the canvas engine. The document format is spec'd
in [`FORMAT.md`](./FORMAT.md); the host boundary in [`EMBEDDING.md`](./EMBEDDING.md).

## Data model

A canvas is a flat list of nodes (`types.ts`): box nodes (`image`, `text`,
`measure`, `link`, `group`, `frame`) sharing `{id,type,x,y,w,h,index,parentId}`
plus `arrow` nodes with two endpoints. All coordinates are absolute page-space
— containers are membership (`parentId`), not coordinate spaces. There is no
rotation, which is what keeps the group/frame model flat and simple.

- **z-order** is the store's `order` array (doc array order), not `index`.
- **`index`** is a sortable fractional string used only as flow order inside
  auto-layout containers.
- **group** = invisible membership + computed bbox. **frame** = titled,
  bordered, clipping container. Either becomes an **auto-layout container**
  (flex-style, `layout.ts`) when it carries a `layout` block — layout is
  orthogonal to chrome.

## Store (`store.ts`)

External store consumed via `useSyncExternalStore` — immutable updates that
replace only changed node objects, so each node subscribes to its own slice
and pan/zoom re-renders only the camera transform, not the nodes.

History is a full-snapshot undo stack (docs are small; cap 100):

- `commit(fn)` — instant mutation, one undo step.
- `beginGesture()` → ephemeral `patchNodes(...)` edits → `commitGesture()`
  (pushes the *start* snapshot only if something changed) / `cancelGesture()`
  (aborts and restores). Camera/selection/tool are never in history.
- A **layout reconciler** is injected (`layoutCommands.reconcileLayout`) and
  runs after every committed mutation so auto-layout frames re-settle and hug
  sizes can never drift.

## Camera & input (`camera.ts`, Plat pointer handlers)

Camera `{x, y, z}`; world layer renders under one CSS transform
(`scale(z) translate(x, y)`), `screenToPage`/`pageToScreen` convert
container-relative points. Zoom-to-cursor keeps the cursor's page point fixed;
z clamps to [0.1, 8]. Wheel: `ctrlKey` (trackpad pinch or ctrl+wheel) zooms to
cursor, shift pans horizontally, otherwise two-finger pan; deltas normalized
per `deltaMode`. Gestures run through a single state machine
(`idle | pan | pinch | translate | resize | marquee | arrowing | arrowHandle |
framing`) with a ~4 screen-px drag threshold, pointer capture, and abort on
`pointercancel`/Escape (restores the gesture-start snapshot).

Snapping: candidates are every other node's edges/centers, hysteresis
(engage 6px/z, release 10px/z), computed against RAW positions with guides
drawn in the world layer.

## Rendering (Plat)

Inside the camera-transformed world div:

1. **SVG arrow layer** — bound endpoints resolve from node bounds each render;
   a bound endpoint is never translated directly, and baking to flat coords
   happens only when the bound node is deleted.
2. **HTML node layer** (`React.memo`) — renderers are looked up in
   `NODE_RENDERERS: Record<type, Component>` (`nodes/index.tsx`); frames render
   recursively as clipping containers.
3. **Overlay** — selection box + 8 resize handles, snap guides, marquee; sizes
   divided by z so they stay constant screen-size.

**Extensibility:** a new node type = a variant in `types.ts` + a renderer
registered in `nodes/index.tsx`. Positioning, selection, resize, snapping and
history come for free.

## Measures (`host.ts`, `measureData.ts`, `nodes/MeasureNode.tsx`)

A measure node stores only `measureId` (+`fontScale`). Data arrives through
the host's `MeasureSource`; `MeasureDataStore` adds the reactive layer
(fetch-once per id, per-id subscriptions, refresh, bulk refetch). Rendering
conventions for the result payload live in `measureFormat.ts` and are part of
the public contract (see EMBEDDING.md).

## Auto-layout (`layout.ts`, `reflow` in host repos)

Single-axis flex: `dir`, `gap`, per-side `padding`, `justify`, `align`,
per-axis `hug|fixed` sizing, nesting via recursion, `layoutIgnore` + arrows
excluded from flow. **There is no reflow-on-load** — opening a canvas never
moves anything; settling happens on edit (reconciler) or explicitly when
authoring headlessly. Host apps that author docs
headlessly from python can port the engine (the origin host maintains such a
port); parity is pinned by the golden fixtures in
`src/__tests__/fixtures/layout-parity.json`.

## Persistence

The library never persists. It loads once per mount (`host.loadDoc`), then
debounce-autosaves the whole doc (700ms) through a latest-wins serialized
queue to `host.saveDoc`, with a final keepalive-style flush on unmount/tab
close (`{final: true}`). Failed loads render an error screen — never an empty
canvas, so a transient load failure can't clobber the stored doc on the next
autosave. When the host implements the revision protocol (EMBEDDING.md), each
save carries the base revision; a conflict freezes autosave behind a reload
banner rather than overwriting the other writer.

## Styling

All chrome styling lives in `plat.css`: semantic classes (`.plat-toolbar`,
`.plat-measure`, …) driven by `--plat-*` tokens scoped under `.plat-root`,
with dark values keyed off `data-plat-theme`. Components carry no utility
classes (enforced by the boundary test); geometry stays in inline styles, and
chrome colors inside those inline styles reference tokens via `var()` so
overlays re-theme too.
