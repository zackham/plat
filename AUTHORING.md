# Authoring plats programmatically

plat is programmatic-first: the document is plain JSON (spec:
[`FORMAT.md`](./FORMAT.md)), so any process — a script, a backend job, an AI
agent — can build or edit a plat without mounting the editor. This guide is
the practical patterns; it's aimed as much at agents as at humans.

The general loop:

1. read the doc (however your host stores it),
2. add/modify nodes (plain JSON),
3. **settle auto-layout** (`settleDoc` — see below),
4. persist.

## The envelope

```jsonc
{ "format": "plat", "version": 1, "nodes": [ /* AnyNode[] */ ] }
```

- **Z-order = array order** (back → front). There is no z-index field.
- **All coordinates are absolute page-space.** Containers are membership
  (`parentId`), not coordinate systems.
- Save the **whole doc** — partial writes aren't a thing.
- If your host uses the revision protocol, echo the doc's `revision` field
  back unchanged when you save; the host bumps it (see EMBEDDING.md).

## Node cheat sheet

| type | essentials |
|---|---|
| `text` | `text`, `fontSize`; box clips (no auto-grow) — size `w/h` to fit |
| `image` | `src` (host asset URL); stretched to `w`×`h`, so set them to the image's aspect |
| `measure` | `measureId` — a pointer; data comes from the host at render time |
| `link` | `url`, `label?` — clickable pill |
| `frame` | `name`, optional `layout` → titled, bordered, clipping container |
| `group` | invisible container; add `layout` for chrome-less layout scaffolding |
| `arrow` | `start`/`end` endpoints; `binding.nodeId` makes an endpoint follow a node; `kind:"curve"` + `arrowhead:"none"` for tree links |
| `yourapp.*` | any dotted type = a custom node: `props` is an opaque bag owned by the host's registered type (NODES.md) — write it like any box |

Ids: any unique string (`"n_" + random` is the editor's convention).

## Auto-layout + settleDoc

A `frame` or `group` with a `layout` block is a flex-style container; its flow
children are the box nodes with `parentId` set to it, ordered by their
`index` string (ascending — `"000000"`, `"000001"`, … works fine).

**There is no reflow-on-load** — opening a plat never moves anything. So after
writing layout containers you must settle coordinates yourself:

```ts
import { settleDoc } from "plat"

doc.nodes = settleDoc(doc.nodes)   // idempotent; returns a new array
```

(Python hosts: the origin host maintains a line-for-line port of the layout
engine, pinned to `settleDoc` by the shared golden fixtures in
`src/__tests__/fixtures/layout-parity.json` — porting it is ~200 lines if you
need settle server-side in another language.)

## Recipes

### A row of screenshots with captions

Row frame → one column *group* per screenshot (image over caption). Groups
keep the scaffolding invisible; the outer frame gives the row a title.

```jsonc
{ "id":"row","type":"frame","name":"Onboarding","x":0,"y":0,"w":0,"h":0,"index":"a0",
  "layout":{"dir":"h","gap":40,"padding":{"t":16,"r":16,"b":16,"l":16},
            "justify":"start","align":"start","sizing":{"main":"hug","cross":"hug"}} }
{ "id":"colA","type":"group","x":0,"y":0,"w":0,"h":0,"index":"a0","parentId":"row",
  "layout":{"dir":"v","gap":8,"padding":{"t":0,"r":0,"b":0,"l":0},
            "justify":"start","align":"center","sizing":{"main":"hug","cross":"hug"}} }
{ "id":"shotA","type":"image","x":0,"y":0,"w":300,"h":650,"index":"a0","parentId":"colA","src":"…" }
{ "id":"capA","type":"text","x":0,"y":0,"w":300,"h":40,"index":"a1","parentId":"colA",
  "text":"Welcome screen","fontSize":16,"align":"center" }
/* colB… then settleDoc */
```

### An experiment card with a metrics column

Screenshot flow on the left, a vertical column of `measure` nodes on the
right, one arrow annotating the step that changed. Measures are 240×160 by
default; the metrics column is just another `dir:"v"` container of measure
nodes.

### A KPI grid

Outer `dir:"v"` frame of `dir:"h"` group rows, each row holding 3–4 measure
nodes. No images at all — plat as a live dashboard the editor can annotate.

### Annotating without disturbing layout

`layoutIgnore: true` keeps a node inside a container but out of the flow
(free-positioned, doesn't affect hug sizing) — for callout text or arrows that
must not be swept into the row. Arrows are never flow items.

### Keeping arrows attached across replacements

A bound arrow endpoint follows `binding.nodeId`. When you replace a
placeholder card with a real screenshot, **reuse the old node's id** and every
arrow pointing at it stays attached.

## Measures, programmatically

The doc only stores `measureId` pointers — creating measures and computing
their values is host API territory (the plat library never computes). The
render conventions for a measure's `result` payload (`value`, `label`,
`display:"text"`, `note`, `link`) are in EMBEDDING.md; `formatValue` /
`pickValue` / `pickText` are exported so your pipeline can preview exactly
what the card will show.

## Sanity checklist before persisting

- every `parentId` references an existing `group`/`frame` (or is null/absent)
- ids unique; flow children have ascending `index` strings
- ran `settleDoc` after any layout-container change
- text boxes sized to their content (they clip)
- image `w/h` matches the source aspect (src is stretched)
