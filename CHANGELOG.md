# Changelog

Notable changes to plat. Format loosely follows [Keep a Changelog](https://keepachangelog.com);
versions follow semver (pre-1.0: minor bumps may break).

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
