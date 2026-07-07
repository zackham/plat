# Hosting plat — integration guide

The adapter contract is in [`EMBEDDING.md`](./EMBEDDING.md); this doc is the
practical side: getting the package into your build, the styles, the theme,
and the gotchas the first host hit so you don't have to.

## Installing

plat ships as **source** (`exports` → `src/index.ts`); your bundler compiles
it. Vite works with zero config. Three ways in:

1. **GitHub dependency** (simplest for consumers):
   ```
   npm i github:zackham/plat
   ```
2. **Sibling checkout + alias** (best while you're iterating on plat itself):
   ```ts
   // vite.config.ts
   resolve: {
     alias: { plat: path.resolve(__dirname, "../plat/src") },
     dedupe: ["react", "react-dom", "lucide-react"],   // see gotcha #1
   },
   server: {
     fs: { allow: [".", path.resolve(__dirname, "../plat")] },  // gotcha #3
   }
   ```
   plus `"paths": { "plat": ["../plat/src/index.ts"] }` in tsconfig.
3. **npm workspace / file: dep** — works like any linked package; the same
   dedupe note applies.

## Styles & theme

Import the stylesheet once, anywhere in your app:

```ts
import "plat/plat.css"
```

That's the entire styling story — **no Tailwind or other CSS framework is
required** in the host. Everything is scoped under `.plat-root` and driven by
`--plat-*` custom properties.

- **Dark mode**: `<Plat theme="dark">`, or `theme="auto"` to follow the OS.
- **Custom theming**: override any token in your own CSS, e.g.
  ```css
  .plat-root { --plat-accent: #0ea5e9; }
  [data-plat-theme="dark"].plat-root { --plat-canvas-bg: #06090f; }
  ```
- Theming covers the **chrome** (toolbar, panels, selection, measure cards).
  Node *content* colors (text color, arrow color) are document data and render
  as authored, in both themes.

## Layout

`<Plat>` fills its parent: the root is `position: relative; flex: 1; min-height: 0`.
Give it a flex column (or any sized box) to live in — a zero-height parent
renders a zero-height canvas.

## Gotchas (each of these cost the first host real debugging time)

1. **Duplicate React when consuming source from a checkout.** plat's checkout
   has its own `node_modules` (dev deps for its test suite). Without
   `resolve.dedupe: ["react", "react-dom"]`, imports inside plat source
   resolve React *there*, you get two React copies, and context identity
   silently breaks. The symptom is the error
   `useStore outside PlatStoreContext` (or hook errors) with no other clue.
2. **Save-conflict handling.** If your backend implements the revision
   protocol (EMBEDDING.md), your `saveDoc` must NOT retry a conflict response
   — map it to `PlatSaveConflictError` immediately. Retrying a 409 just
   re-conflicts and delays the banner.
3. **Vite `server.fs.allow`.** A sibling checkout lives outside your project
   root; the dev server refuses to serve it until you allow the path.
4. **SSR**: plat is a client component (pointer events, localStorage for tiny
   UI prefs). Render it client-side; there's no SSR output worth having for an
   interactive canvas.

## The two reference hosts

The origin app runs both against the same component — a useful template:

- **Editor host**: doc CRUD against its API (with retry-once + a save-state
  indicator), an asset blob store, server-computed measures, share-link
  minting, revision conflicts mapped from HTTP 409.
- **Public share host**: one fetch returns `{doc, measures}`; `loadDoc` serves
  the doc, `measures.get` reads the bundle, every write capability omitted —
  the canvas renders view-only automatically.

And [`examples/basic`](./examples/basic) in this repo is a complete minimal
host over `localStorage` you can run with `npm install && npm run dev`.
