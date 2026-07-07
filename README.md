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
| [`EMBEDDING.md`](./EMBEDDING.md) | the `PlatHost` adapter contract + the measure data contract + revisions |
| [`HOSTING.md`](./HOSTING.md) | build integration, styles/theming, and the gotchas |
| [`AUTHORING.md`](./AUTHORING.md) | building plats programmatically (agents welcome) |
| [`FORMAT.md`](./FORMAT.md) | the `plat` document format — the programmatic-authoring API |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | how the engine works: store, camera, interactions, rendering, history |
| [`CHANGELOG.md`](./CHANGELOG.md) | release notes |

## Example

[`examples/basic`](./examples/basic) is a complete minimal host — a Vite app
with a ~100-line `localStorage` adapter, fake measures, and a theme toggle:

```
cd examples/basic && npm install && npm run dev
```

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
