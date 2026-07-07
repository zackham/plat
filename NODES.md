# Custom node types

plat's content layer is open: your app can put **anything** in a node — a
markdown document, a chat, a chart, a form — and the engine gives it drag,
resize, snapping, grouping, arrows, auto-layout, undo, and persistence for
free. [`examples/rabbithole-lite`](./examples/rabbithole-lite) is a complete worked
example — streaming markdown documents with branch-from-selection, modeled on
[Rabbithole](https://rabbithole.ing/).

Structural types are the one closed set: `group`, `frame`, and `arrow` define
containment and connection semantics the whole engine reasons about, and
cannot be redefined. Content is open; structure is owned.

## Defining a type

```tsx
import { definePlatNodeType, platInteractive, usePlatApi } from "plat"

const chatNode = definePlatNodeType({
  type: "acme.chat",                       // MUST contain a dot (see below)
  defaultProps: { messages: [] },          // seeds api.create
  defaultSize: { w: 420, h: 260 },
  behaviors: { autoHeight: true, minSize: 200 },
  render: ({ node, readOnly }) => <ChatCard node={node} readOnly={readOnly} />,
})

<Plat host={host} nodeTypes={[chatNode]} />
```

On disk the node is plain JSON — a normal box plus an opaque `props` bag:

```jsonc
{ "id": "n_1", "type": "acme.chat", "x": 100, "y": 100, "w": 420, "h": 260,
  "index": "", "props": { "messages": [] } }
```

**Why the dot?** `"acme.chat"`, never `"chat"`. The dotted namespace is load-
bearing twice over: it keeps TypeScript's node union fully discriminated (a
dotted id can never collide with a built-in literal, so narrowing stays
exact), and it keeps independently-developed node types from colliding in
shared documents. `definePlatNodeType` enforces it at registration; the type
system enforces it on documents.

Built-in content types (`image`, `text`, `measure`, `link`) are registered
through this same machinery — a host can even override their renderers.
Unregistered types in a doc render as a legible placeholder (type id +
"unregistered node type"): degrade, never crash, never drop data.

## The renderer contract

Your component renders **inside** the positioned box (fill it; plat owns
position/size). It receives `{ node, readOnly }`; everything else comes from
hooks — `usePlatApi()` for mutations/camera, or your own contexts (they flow
through, `<Plat>` is a normal React subtree).

## Interactive content — `platInteractive`

By default, pointer events on a node select and drag it — right for images,
wrong for a text you want to select or a button you want to click. Mark any
region that owns its own input:

```tsx
<div {...platInteractive} className="chat-scroll">…</div>
```

Inside such a region:

- **pointerdown** never starts a canvas gesture (no drag, no marquee) and is
  not prevented — native text selection, focus, and clicks work. The owning
  node still gets selected, so selection follows attention.
- **wheel** scrolls the region natively whenever a scrollable element inside
  it can still consume the delta; otherwise the canvas zoom/pan takes over.
  (Ctrl/⌘-wheel always zooms the canvas.)
- **keyboard** shortcuts stand down while focus is in an input, textarea,
  contenteditable, or anything inside an interactive region — Delete while
  typing deletes a character, not the node.

Everything *outside* interactive regions (card chrome, headers, padding)
drags the node — so "drag by the header, select text in the body" falls out
naturally.

## Behaviors

| behavior | effect |
|---|---|
| `resizable: false` | no resize handles when this node is the sole selection |
| `minSize: n` | resize clamp (page units) when resized alone; engine floor is 8 |
| `autoHeight: true` | content drives height: the node renders height-auto, plat measures it (ResizeObserver) and keeps `h` in sync as ephemeral patches — sizing never pollutes undo. Single-selection resize offers e/w handles only. |

`autoHeight` is the right default for document/chat-like cards; give the
scrollable inner region a `max-height` so very long content scrolls instead
of growing forever (see rabbithole-lite's CSS).

## The runtime api in renderers

`usePlatApi()` works inside any renderer — a card can spawn siblings, connect
edges, move the camera:

```tsx
const api = usePlatApi()
const onBranch = () => {
  const [child] = api.create({ type: "acme.chat", x: node.x + node.w + 160, y: node.y })
  api.connect(node.id, child.id, { kind: "curve", arrowhead: "none" })
  void api.zoomTo(child.id, { animate: 300 })
}
```

See EMBEDDING.md § "The runtime api" for the full surface (streaming updates,
batching, events, coordinate conversion).
