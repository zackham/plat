# Changelog

Notable changes to plat. Format loosely follows [Keep a Changelog](https://keepachangelog.com);
versions follow semver (pre-1.0: minor bumps may break).

## [0.3.0] — 2026-07-06

The platform release: the content layer opens up. plat now hosts node types
it has never heard of — and gives your app a full runtime controller. The
proof lives in `examples/rabbithole-lite`: a [Rabbithole](https://rabbithole.ing/)-style
"select text → branch → the answer streams into a linked card" app in ~350
lines of host code, none of them canvas code.

### Added

- **Custom node types** (`definePlatNodeType` + the `nodeTypes` prop): a
  renderer, `defaultProps`/`defaultSize`, and behaviors (`resizable`,
  `minSize`, `autoHeight`) per type. Custom ids MUST be dotted
  ("yourapp.card") — the namespace keeps TypeScript's node union fully
  discriminated and shared docs collision-free. On disk a custom node is a
  plain box with an opaque `props` bag; unregistered types render a legible
  placeholder (degrade, never crash, never drop data). Built-in content types
  (image/text/measure/link) are registered through this exact machinery —
  measures are now "just a node type", extracted onto the public API.
  Structural types (group/frame/arrow) remain engine-owned.
- **The interactive-content protocol** (`platInteractive`): mark any region
  inside a renderer that owns its own input. Pointerdown there never starts a
  canvas gesture (native selection/focus/click proceed; the node still gets
  selected), wheel scrolls the region while it can consume the delta, and
  keyboard shortcuts stand down while focus is inside. "Drag by the header,
  select text in the body" falls out naturally. MeasureNode's stopPropagation
  hacks were replaced by the protocol (dogfood #1).
- **`PlatApi` — the runtime controller** handed to `onReady` (PlatHandle is
  now an alias) and reachable inside renderers via `usePlatApi()`:
  `create`/`updateNode`/`updateProps`/`remove`/`connect`, `batch` (one undo
  step), `beginEphemeral`/`endEphemeral` (a whole stream = ONE undo step),
  selection get/set, camera get/set + tweened `zoomTo`/`zoomToFit`,
  `clientToPage`/`pageToClient`, and `on("change"|"selection"|"camera")`
  subscriptions. Everything routes through the editor's own commit/gesture
  machinery, so api mutations are undoable exactly like user edits.
- **`autoHeight` behavior**: content-driven node height (ResizeObserver →
  ephemeral patches; never pollutes undo; single-selection resize offers e/w
  handles only).
- **Curve edges**: arrow `kind: "curve"` (soft cubic) + `arrowhead: "none"`
  for tree-link styling.
- **`examples/rabbithole-lite`** — the acceptance test for all of the above,
  live-verified: custom streaming-markdown document node, branch-from-
  selection with lenses, headless curve edges, camera glides, dark mode,
  recursion, localStorage persistence with the revision protocol.
- **NODES.md** (node types + interaction protocol) and a full runtime-api
  section in EMBEDDING.md; FORMAT/AUTHORING/README updated. 14 new tests
  (registry, fallback, protocol, api mutations/undo semantics/events/camera
  math) — 128 total.

### Changed

- `Props.onReady` now receives the full `PlatApi` (superset of the old
  three-method handle — existing hosts keep working unchanged).

## [0.2.0] — 2026-07-06

The "ready for more hosts" release: styling stands alone, concurrent writers
can't clobber each other, programmatic authoring is first-class, and the repo
now carries a runnable reference host.

### Added

- **`plat.css` — standalone stylesheet.** All chrome styling moved out of
  utility classes into semantic classes driven by `--plat-*` design tokens,
  scoped under `.plat-root`. Hosts import `plat/plat.css` once; **no Tailwind
  (or any CSS framework) is required anymore.** Chrome colors inside inline
  geometry styles reference tokens too, so overlays re-theme.
- **Dark mode & theming.** `<Plat theme="light" | "dark" | "auto">` ("auto"
  follows the OS); custom themes are token overrides in host CSS. Node
  *content* colors are document data and render as authored — except unset
  defaults (text/arrow with no explicit color), which now follow the theme.
- **Multi-writer save safety (optional revision protocol).**
  `PlatDoc.revision` carries the writer's base revision; a revision-aware
  host rejects a stale base (`PlatSaveConflictError` / `isSaveConflict`,
  `SaveDocResult`) and the editor freezes autosave behind a
  "changed elsewhere — Reload" banner instead of silently clobbering the
  other writer. Fully backward compatible: hosts and writers that ignore
  revisions keep last-writer-wins behavior.
- **`settleDoc(nodes)`** — first-class headless auto-layout settle for
  programmatic authoring (there is deliberately no reflow-on-load). Parity
  with the origin host's python port is pinned by shared golden fixtures.
- **`examples/basic`** — a complete minimal host: Vite app with a ~100-line
  `localStorage` adapter (including the revision protocol), data-URL assets,
  fake refreshable measures, seed doc authored via `settleDoc`, and
  light/dark/auto + read-only toggles.
- **Docs**: `HOSTING.md` (build integration, styles/theming, the
  duplicate-React and `fs.allow` gotchas), `AUTHORING.md` (programmatic
  authoring guide + recipes, written for agents as much as humans);
  `EMBEDDING.md` gained the revision-protocol spec; `README`/`ARCHITECTURE`
  updated to match.
- **Lint boundary**: eslint flat config enforcing the host-agnostic import
  boundary at editor time (CI runs it); the boundary test additionally
  rejects any reappearance of framework utility classes.

### Changed

- Read-only mode no longer renders no-op undo/redo controls.
- `arrowPrefs` storage key is now `plat:lastArrowKind`, with an explicit SSR
  guard (previous arrow-kind preference resets once).
- `MeasureDataStore` stores its source via plain field assignment so the
  library stays erasable-syntax-only (compatible with type-stripping hosts).

### Fixed

- `StylePanel` no longer defines components during render (React remount
  thrash on every panel re-render).
- Zero-specificity element reset (`:where`) so single-class component styles
  can never lose to the library's own button reset.

## [0.1.0] — 2026-07-06

Initial release, extracted from [vita](https://github.com/zackham/vita) where
the engine runs in production as both a full editor and a read-only public
share viewer.

- From-scratch React infinite canvas: images, text, arrows (straight/elbow,
  node-bound endpoints), links, groups, frames with Figma-style auto-layout,
  snapping, multi-select, undo/redo, copy/paste incl. image paste, PNG export.
- `plat` JSON document format (`FORMAT.md`) — flat node list, absolute
  coordinates, z-order by array order.
- `PlatHost` adapter as the single data boundary, with capability gating
  (omit `saveDoc` ⇒ view-only, etc.) and live measures via `MeasureSource`.
- 111-test suite incl. mock-host mount roundtrips, an import-boundary guard,
  and cross-language golden layout fixtures.
