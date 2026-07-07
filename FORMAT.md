# plat file format

Canonical spec of the canvas document format — the programmatic-authoring API:
any process that emits this JSON can build a canvas without touching the
editor. Lives next to the code (`types.ts` is the source of truth; this doc
tracks it).

> Authoritative types: `src/types.ts`.
> Auto-layout engine: `src/layout.ts`.

---

## 1. Document envelope & storage

A canvas is a flat list of nodes.

```jsonc
{
  "format": "plat",
  "version": 1,
  "nodes": [ /* AnyNode[] — see §3 */ ]
}
```

- **On disk:** `data/canvases/<project_id>/canvases/<canvas_id>.v2.json`
- **API:** `GET` / `PUT` `…/api/v1/canvases/projects/<project_id>/canvases/<canvas_id>/doc`
  with the envelope `{ "doc": { format, version, nodes } }`.
- **Z-order = array order.** A node's paint order (back→front) is its position in
  the `nodes` array. There is no separate z-index field.
- The editor autosaves the whole doc on change; partial writes aren't a thing —
  PUT the full `nodes` array.

---

## 2. Coordinates & common fields

**All coordinates are absolute page-space** (no parent-relative transforms).
A frame renders its members by subtracting the frame origin at *render* time only;
the stored `x/y` of every node is absolute.

Every non-arrow node ("box node") shares `BoxBase`:

| field | type | req | meaning |
|---|---|---|---|
| `id` | string | ✓ | unique node id. Convention: `shape:<rand>` (any unique string works). |
| `type` | string | ✓ | `image` \| `text` \| `measure` \| `link` \| `group` \| `frame` |
| `x`,`y` | number | ✓ | absolute top-left, page units |
| `w`,`h` | number | ✓ | size, page units. Images are `objectFit:fill` — the src is stretched to `w`×`h`, so set `w/h` to control aspect. |
| `index` | string | ✓ | **sortable fractional index.** In an auto-layout frame this is the **flow order** of the child (see §4). It is **NOT z-order.** For free nodes it's currently unused for ordering — set `""` or any value. |
| `parentId` | string\|null | – | id of the containing `group`/`frame`, or null/omitted for a top-level node |
| `layoutIgnore` | boolean | – | member of an auto-layout frame but **excluded from the flow** (keeps its own absolute coords, doesn't feed hug sizing). Figma's "ignore auto layout". No effect outside a layout frame. |

Arrows have their own shape (§3.7).

---

## 3. Node types

### 3.1 image
```jsonc
{ "id","type":"image","x","y","w","h","index","parentId"?,
  "src": "/api/v1/canvases/projects/<pid>/assets/<assetId>",
  "assetId"?: "asset:…", "name"?: "label" }
```
`src` is stretched to `w`×`h`. Upload blobs via `PUT …/assets/<assetId>`; reuse a
card's node id when replacing so bound arrows stay attached.

### 3.2 text
```jsonc
{ "id","type":"text","x","y","w","h","index","parentId"?,
  "text": "string", "fontSize": 22, "color"?: "#334155", "align"?: "left"|"center" }
```
Text is clipped to `w`×`h` (no auto-grow — size the box to fit). This is true for
the whole engine, layout or not.

### 3.3 measure
```jsonc
{ "id","type":"measure","x","y","w","h","index","parentId"?,
  "measureId": "m_xxxxxxxx", "fontScale"?: 1 }
```
Renders a project measure's latest value. Box is fixed `w`×`h` (content scales via
`fontScale`, the box does not).

### 3.4 link
```jsonc
{ "id","type":"link","x","y","w","h","index","parentId"?,
  "url": "https://…", "label"?: "Open funnel", "fontSize"?, "color"? }
```
Clickable pill (opens in a new tab when viewing).

### 3.5 group
```jsonc
{ "id","type":"group","x","y","w","h","index","parentId"? }
```
Invisible container; members reference it via `parentId`. Its bounds are computed
live as the union of members (the stored `x/y/w/h` is a fallback).

### 3.6 frame  (and auto-layout — see §4)
```jsonc
{ "id","type":"frame","x","y","w","h","index","parentId"?,
  "name": "Frame title",
  "layout"?: { /* §4 — presence makes it an auto-layout container */ } }
```
A titled, bordered, **clipping** container. Members reference it via `parentId`.
Without `layout` it's a free-form frame (members positioned manually). With
`layout` it auto-arranges its flow children (§4).

### 3.7 arrow
```jsonc
{ "id","type":"arrow","index","parentId"?,
  "start": { "x","y", "binding"?: { "nodeId","anchor":{x,y}∈[0,1], "isPrecise"? } | null },
  "end":   { "x","y", "binding"? | null },
  "color"?: "#334155", "kind"?: "straight"|"elbow", "elbowMid"?: 0..1 }
```
A **bound** endpoint (`binding.nodeId` set) follows that node; its `x/y` are
ignored while bound. To keep an arrow attached when replacing a card with an image,
**reuse the card's node id**. Arrows are never auto-layout flow items.

---

## 4. Auto-layout (`frame.layout` / `group.layout`)

A **group OR frame** with a `layout` object is an **auto-layout container**
(flex-style). Its **flow children** — box members with `parentId === container.id`,
`layoutIgnore` falsy, sorted by `index` — are positioned automatically; the
container can **hug** (size to fit) or stay **fixed**. Nesting works (a layout
container can contain layout containers).

**Auto-layout is orthogonal to chrome.** The only difference between the two
container types is what they draw: a **frame** is titled + bordered + clipping; a
**group** is invisible (no border, no title). So use a **group** for pure nested
layout scaffolding (rows/columns) you don't want to litter the canvas with
borders, and a **frame** only when you actually want a labeled, bordered box (e.g.
an outer card, or an "iOS vs Android" divider). Headless authoring helpers:
`mkgroup` vs `mkframe` in `canvases.autolayout`.

```jsonc
"layout": {
  "dir": "h" | "v",                 // flow direction: row | column
  "gap": 16,                        // page units between adjacent flow children
  "padding": { "t":24,"r":24,"b":24,"l":24 },
  "justify": "start"|"center"|"end"|"space-between",  // along dir
  "align":   "start"|"center"|"end",                  // perpendicular to dir
  "sizing":  { "main": "hug"|"fixed", "cross": "hug"|"fixed" }
}
```

Semantics (mirrors the engine in `layout.ts`):
- **main axis** = along `dir` (width for `h`, height for `v`); **cross axis** = the
  other one.
- **`sizing.main`/`sizing.cross`**: `hug` → the frame's size on that axis is
  derived from its children (content + padding); `fixed` → keep the frame's stored
  `w`/`h` on that axis and distribute/align children within it.
- **`justify`** distributes children along the main axis (only visible when the
  container is `fixed` on the main axis and larger than its content; `space-between`
  puts the first child at the start pad and the last flush to the end pad).
- **`align`** positions each child on the cross axis within the line.
- **`gap`** is the space between adjacent flow children; **`padding`** is inside the
  frame border.
- **flow order is `index`** (ascending, lexicographic string compare), **not**
  geometry and **not** z-order. Reordering = changing `index`.
- **`layoutIgnore: true`** members and **arrows** stay where they are and don't
  affect sizing — use this for a free-floating caption or an annotation arrow that
  must not be swept into the row.
- An **empty** hug frame keeps a small min box (24×24) so it stays selectable.

### Hug vs fixed cheat-sheet
- A row of screenshots that should tightly wrap them: `dir:"h"`, `sizing:{main:"hug",cross:"hug"}`.
- A fixed-width column the items fill the height of: `dir:"v"`, `sizing:{main:"hug",cross:"fixed"}` with a set `w`.
- A toolbar that spreads items across a set width: `sizing:{main:"fixed",…}`, `justify:"space-between"`.

---

## 5. Authoring auto-layout frames programmatically

There is **no reflow-on-load** (by design — opening a canvas never moves anything).
So a script that writes a layout frame must also **settle the child coordinates**,
or the positions on disk won't match the layout until the editor reflows. Two
supported workflows:

**A. Author + settle with the Python helper (recommended for scripts).**
1. Write the frame with its `layout` block, and each child with `parentId` = frame
   id and an **ascending `index`** in the order you want them to flow.
2. Run the reflow helper, which ports `layout.ts` and rewrites every child's
   `x/y` and the frame's hug `w/h` to the settled layout:
   ```
   PYTHONPATH=scripts uv run python -m canvases.reflow <project_id> <canvas_id>
   ```
   (or call `canvases.reflow.reflow_doc(doc)` in-process). Idempotent.
3. PUT/save the settled doc.

Index generation: any ascending strings work (`"a0" < "a1" < "a2" …`). For inserts
between two children, pick a string between their indices (fractional indexing).

**B. Author already-settled.** Compute the positions yourself (the math in §4 is
simple for hug rows/columns) and write final `x/y/w/h`. The `layout` block should
still be present so the editor maintains the layout on subsequent edits.

> Do **not** rely on opening the canvas in the editor to fix positions — it won't.
> Convert-to-layout in the *UI* settles once on the user's explicit action; headless
> authoring uses the reflow helper above.

### Minimal examples

Horizontal hug row of two screenshots with a 24px gap:
```jsonc
{ "id":"f1","type":"frame","name":"Variants","x":100,"y":100,"w":0,"h":0,"index":"a0",
  "layout":{"dir":"h","gap":24,"padding":{"t":16,"r":16,"b":16,"l":16},
            "justify":"start","align":"center","sizing":{"main":"hug","cross":"hug"}} }
{ "id":"img1","type":"image","x":0,"y":0,"w":300,"h":650,"index":"a0","parentId":"f1","src":"…" }
{ "id":"img2","type":"image","x":0,"y":0,"w":300,"h":650,"index":"a1","parentId":"f1","src":"…" }
```
(after reflow: img1 at (116,116), img2 at (440,116), frame w=648 h=682)

Nested — a row of two captioned columns (column = image over a label):
```jsonc
{ "id":"row","type":"frame","name":"Compare","x":0,"y":0,"w":0,"h":0,"index":"a0",
  "layout":{"dir":"h","gap":40,"padding":{"t":0,"r":0,"b":0,"l":0},
            "justify":"start","align":"start","sizing":{"main":"hug","cross":"hug"}} }
{ "id":"colA","type":"frame","name":"A","x":0,"y":0,"w":0,"h":0,"index":"a0","parentId":"row",
  "layout":{"dir":"v","gap":8,"padding":{"t":0,"r":0,"b":0,"l":0},
            "justify":"start","align":"center","sizing":{"main":"hug","cross":"hug"}} }
{ "id":"imgA","type":"image","x":0,"y":0,"w":300,"h":650,"index":"a0","parentId":"colA","src":"…" }
{ "id":"capA","type":"text","x":0,"y":0,"w":300,"h":40,"index":"a1","parentId":"colA",
  "text":"Control","fontSize":18,"align":"center" }
/* colB / imgB / capB analogous, parentId chain row→colB→… */
```

---

## 6. Invariants for safe authoring

- A node's `parentId` must reference an existing `group`/`frame` (or be null).
- Don't put a node's `id` in two places; ids are unique.
- A frame without `layout` behaves exactly as before — adding `layout` is the only
  thing that turns on auto-layout (purely additive; existing canvases are untouched
  unless you add it).
- `layoutIgnore` only matters inside a layout frame.
- After editing a layout frame's children/props, re-run the reflow helper (§5A) so
  coordinates and hug sizes stay consistent.
