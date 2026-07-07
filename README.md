# plat

**An embeddable infinite-canvas platform.** Bring your own node types — a
markdown document, a chat, a live metric, anything you can render in React —
and plat gives them drag, resize, zoom, snapping, bound edges, auto-layout,
undo, and persistence for free. Your app keeps auth, storage, and compute;
plat owns the canvas.

A *plat* is a plan drawn to scale. What goes on it is your call: agent-built
work products, product flows annotated with live conversion numbers, a
rabbithole of streaming answers, a KPI wall someone can rearrange.

Three ideas carry the whole design:

1. **One adapter in** — a `PlatHost` of plain promises is the only data
   boundary. No fetches, no URLs, no framework assumptions inside the canvas.
2. **Open content, owned structure** — content node types are pluggable
   (built-ins ride the same registry as yours); groups, frames, and arrows
   stay engine-owned so every node composes.
3. **Programmatic-first** — the document is plain JSON any process or agent
   can emit, and a runtime api (`create`/`connect`/`stream`/`zoomTo`…) drives
   a live canvas the way a user would, undo included.

## Sixty seconds

```tsx
import { Plat, definePlatNodeType, platInteractive, usePlatApi } from "plat"
import type { PlatHost } from "plat"
import "plat/plat.css"

// 1. your node type — plat has never heard of "notes.card"
const noteType = definePlatNodeType({
  type: "notes.card",
  defaultSize: { w: 320, h: 120 },
  behaviors: { autoHeight: true },
  render: ({ node }) => {
    const api = usePlatApi()
    const { text } = node.props as { text: string }
    return (
      <div className="my-card">
        <div {...platInteractive}>{text}</div>{/* selectable, scrollable */}
        <button
          {...platInteractive}
          onClick={() => {
            const [child] = api.create({ type: "notes.card", x: node.x + node.w + 120, y: node.y })
            api.connect(node.id, child.id, { kind: "curve", arrowhead: "none" })
            void api.zoomTo(child.id, { animate: 300 })
          }}
        >
          branch
        </button>
      </div>
    )
  },
})

// 2. your storage — any backend, or just localStorage
const host: PlatHost = {
  loadDoc: async () => myBackend.loadDoc(id),
  saveDoc: async (doc) => myBackend.saveDoc(id, doc),
}

// 3. a canvas
<Plat host={host} nodeTypes={[noteType]} />
```

The proof is [`examples/rabbithole-lite`](./examples/rabbithole-lite): a
[Rabbithole](https://rabbithole.ing/)-style "select text → branch → the answer streams into a
linked card" app — recursion, camera glides, one-undo-step streams, dark mode — in
~350 lines of host code, none of them canvas code. Details in
[`NODES.md`](./NODES.md).

## The host adapter

`Plat` renders and edits **one document**; everything it needs arrives
through the `host` — plain promises your app implements. Capabilities are
optional; omit one and its UI disappears:

| omitted | effect |
|---|---|
| `saveDoc` | view-only |
| `uploadAsset` | no image insert / paste |
| `measures` / `measures.refresh` / `measures.list` | no live-data cards / refresh / picker |
| `share` | no share button |

A read-only public share viewer and the full editor are the same component
with different hosts. The boundary is enforced mechanically by
[`src/__tests__/boundary.test.ts`](./src/__tests__/boundary.test.ts).

## Measures — the flagship built-in

Live data as canvas nodes. A measure node stores only an id; your app supplies
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
  showcase, an homage to [Rabbithole](https://rabbithole.ing/): a custom streaming-markdown
  document node, select-text→branch, headless curve edges, camera tweens.

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
