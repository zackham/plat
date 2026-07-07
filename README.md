# plat

An embeddable infinite-canvas React library for presenting work: screenshots,
text, arrows, frames with Figma-style auto-layout, and **measures** — live
data values rendered as cards, fed by your application.

A *plat* is a plan drawn to scale. This one is for laying out evidence:
product flows annotated with real conversion numbers, experiment variants next
to their results, agent-produced work arranged spatially instead of buried in
prose.

Built **programmatic-first**: the document format is plain JSON
([`FORMAT.md`](./FORMAT.md)) that any process — including an AI agent — can
emit, with a capable interactive editor on top.

## The shape

```tsx
import { Plat, type PlatHost } from "plat"

const host: PlatHost = {
  loadDoc: async () => myBackend.loadDoc(canvasId),
  saveDoc: async (doc) => myBackend.saveDoc(canvasId, doc),
  uploadAsset: async (blob) => ({ src: await myBackend.storeBlob(blob) }),
  measures: { get: async (id) => myBackend.measure(id) },
}

<Plat host={host} onReady={(handle) => { /* insertMeasure, refetchMeasures, zoomToFit */ }} />
```

`Plat` renders and edits **one document**, and everything it needs arrives
through that one `host` adapter — the library never fetches, never knows URLs,
never handles auth or storage. Omit a capability and its UI disappears:

| omitted | effect |
|---|---|
| `saveDoc` | view-only |
| `uploadAsset` | no image insert / paste |
| `measures.refresh` | no refresh button |
| `measures.list` | no insert-measure picker |
| `share` | no share button |

A read-only public share viewer and the full editor are the same component
with different hosts. The boundary is enforced mechanically by
[`src/__tests__/boundary.test.ts`](./src/__tests__/boundary.test.ts).

## Bring your own nodes

The content layer is open: register a **custom node type** — a chat, a
markdown document, a chart — and the engine gives it drag, resize, snapping,
arrows, auto-layout, undo, and persistence for free. Interactive content
(text selection, scrolling, inputs) coexists with canvas gestures via one
marker (`platInteractive`), and the **runtime api** lets your app or the node
itself create/connect/stream/zoom programmatically. See
[`NODES.md`](./NODES.md), and
[`examples/rabbithole-lite`](./examples/rabbithole-lite) — a working
rabbithole-style "select text → branch → answer streams into a linked card"
app in ~350 lines of host code.

## Measures

The distinctive piece. A measure node stores only an id; your app supplies
`{name, latest: {result, error, refreshed_at}}` where `result` is an open dict
with rendering conventions (`value`, `label`, `note`, `link`, text mode).
*How* a measure is computed — a SQL query, an analytics API, a python script,
static JSON — is entirely your concern, and so is sandboxing if your users
author them. The library defines the contract and renders what conforms.
Details in [`EMBEDDING.md`](./EMBEDDING.md).

## Styling & themes

```ts
import "plat/plat.css"
```

One stylesheet, no CSS framework required in the host. Everything is scoped
under `.plat-root` and driven by `--plat-*` design tokens — dark mode is built
in (`<Plat theme="dark">` or `"auto"`), and custom theming is overriding
tokens in your own CSS. Details in [`HOSTING.md`](./HOSTING.md).

## Multi-writer safety

Saves carry an optional base **revision**; a revision-aware host rejects a
stale save and the editor freezes with a reload banner instead of silently
clobbering the other writer (two tabs, or an agent editing alongside you).
Hosts that don't care simply ignore the field — last-writer-wins, as before.

## Docs

| Doc | What it covers |
|---|---|
| [`EMBEDDING.md`](./EMBEDDING.md) | the `PlatHost` adapter contract, the runtime api, measures, revisions |
| [`NODES.md`](./NODES.md) | custom node types + the interactive-content protocol |
| [`HOSTING.md`](./HOSTING.md) | build integration, styles/theming, and the gotchas |
| [`AUTHORING.md`](./AUTHORING.md) | building plats programmatically (agents welcome) |
| [`FORMAT.md`](./FORMAT.md) | the `plat` document format — the programmatic-authoring API |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | how the engine works: store, camera, interactions, rendering, history |
| [`CHANGELOG.md`](./CHANGELOG.md) | release notes |

## Example

Two runnable hosts, each `npm install && npm run dev`:

- [`examples/basic`](./examples/basic) — minimal host: ~100-line
  `localStorage` adapter, fake measures, theme toggle.
- [`examples/rabbithole-lite`](./examples/rabbithole-lite) — the platform
  showcase: a custom streaming-markdown document node, select-text→branch,
  headless curve edges, camera tweens.

## Current state & caveats

- **Consumed as source** (`exports` points at `src/index.ts`): your bundler
  compiles it (Vite works out of the box). No prebuilt dist yet.
- React ≥ 18 peer dependency; `lucide-react` for icons.
- No rotation, by design — that's what keeps the group/frame model flat.

## Development

```
npm install
npm test          # vitest (jsdom)
npm run typecheck
npm run lint
```
