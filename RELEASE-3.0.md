# Vexel 3.0.0 — Praxis Foundation (completion report)

All numbers below come from actual runs in this session
(Windows, Node v26.4.0, rustc 1.97.1, .NET 8 runtime only — no .NET SDK).
Nothing is projected. Live UI builds were not possible here; UI validation
is via `vexel check` / `vexel debug` plus backend source assertions.

## Version

`vexel version` reports `vexel 3.0.0` (package.json 3.0.0, bin/vexel.js 3.0.0).

## Test results (factual)

| Suite | Result |
|---|---|
| Praxis tests (tests/praxis/run_praxis_tests.js — static check/debug + source) | 33/33 |
| UI check regression (examples/ui) | 12/12 |
| UI check regression (examples/ax) | 14/14 |
| Console/file check regression (examples/*.vxl) | 34/35 (1 pre-existing failure, see below) |
| Documentation tests (docs/v3.md code blocks via vexel check) | 15/15 |
| Showcase (showcase.vxl check + debug + --dpi all) | passes, 0 warnings |
| Layout determinism (x=30,120,210,300 + DPI matrix) | passes |
| Event tests (click/mouse/key/change/focus) | included in 33/33 |
| Animation tests (linear/smooth/reject unknown) | included in 33/33 |
| Window tests (multi-window create/show) | included in 33/33 |
| Accessibility tests (description/tooltip/focused) | included in 33/33 |
| Full native suites (tests/run_tests.js, tests/ui/run_ui_tests.js, tests/v29) | NOT run to completion here (each native compile needs minutes; UI live builds need the .NET 8 SDK which is absent) |
| Performance tests (100/500/1000 controls, live timing) | NOT measured (no SDK to run the app) |

Regressions introduced by this session: 0.
Pre-existing failure (unchanged, not a regression): `examples/chess.vxl`
uses `r` as a variable, colliding with the `r from 1 to 100` random syntax
(SyntaxError line 275). It failed before these changes for the same reason.

Run fast verification with:

```bash
node tests/praxis/run_praxis_tests.js
vexel check showcase.vxl
vexel debug --dpi all showcase.vxl
```

Full suites (need time + toolchains):

```bash
npm test
```

## What was verified live (not just compiled)

- Console pipeline end-to-end: `print "hello 3.0"` built via rustc and ran.
- UI `check`/`debug` on basic syntax, layout determinism, percent/fill,
  scroll areas, center, animations, dialogs, notifications, icons, tooltips,
  typography, multi-window, DPI matrix — all via the real compiler.
- Backend sources contain real implementations (read, not assumed):
  `VexAx.Notify` (non-blocking toast), `Confirm`/`Prompt`/`InputBox`
  (modal), `ContextAdd`/`ContextShow`, tooltip/icon paths, `Praxis`
  tree/layout/ease/a11y/render-log.
- Docs: all 15 `v3.md` snippets pass `vexel check`.
- Showcase: 35 widgets, 22 event handlers, 4 tab pages, 2 windows —
  `check` clean, `debug` clean, DPI matrix clean.

## Completed features (real, checkable)

- Version 3.0.0 + preserved CLI (version/check/run/build/clean/debug).
- Praxis engine file with widget tree, deterministic layout helpers,
  easing, a11y metadata, icon registry, render-command log.
- New controls: switch, radio (+group), numeric, search, card (+children),
  statusbar, separator, context menu (+add/show) — all checkable, all with
  backend constructors.
- Icon/tooltip/description/focused props wired through semantic + backend.
- Dialogs: show message/warning/confirmation/input dialog + confirm/prompt/ask.
- Notifications: show notification [kind] [for N seconds] → non-blocking toast.
- Animation: block form with linear/smooth easing, non-blocking timers.
- Layout: deterministic x/y/width/height, percent/fill, center, min/max,
  scroll areas, parent-relative sizing (overflow fix preserved).
- Events: click/mouse/key/change/focus/blur with typed `event`/`key` objects.
- Windows: multi-window create/show, props, deterministic shutdown.
- DPI: logical coordinates + `debug --dpi all` matrix with blur-risk flags.
- Showcase expanded to Buttons/Text/Inputs/Checkboxes/Sliders/Progress/
  Dropdowns/Lists/Trees/Tables/Tabs/Cards/Toolbars/Menus/Dialogs/
  Notifications/Layouts/Scrolling/Animations/Windows/Keyboard/Accessibility.
- Docs: new `docs/v3.md` (15/15 compile), README + website version to 3.0.0.

## Partially completed / honest gaps

- GPU-ready rendering is an abstraction foundation (render-command log,
  batching-ready structure), not a GPU renderer. No expensive effects added.
- Toasts are topmost windows, not composited layers.
- Table columns are proportional; no interactive resize or virtualization yet
  (architecture prepared, not implemented).
- No list/tree virtualization yet (scrolling + clipping real, virtualization deferred).
- Dark visual language is the default theme path (`use theme "dark"` in the
  showcase); no theme switching UI was added per spec (existing `use theme`
  preserved for compatibility).

## Known limitations

- UI `build`/`run` need the .NET 8 SDK. This machine has only the .NET 8
  runtime, so those commands fail with a clear toolchain error. `check`/`debug`
  are the supported validation path here.
- `vexel test` and `wait <task>` remain console-only by design.
- `examples/chess.vxl` fails check (pre-existing `r` variable collision).
- `vexel clean` in the repo root removes built `.exe`/native siblings
  (expected); sources are untouched and rebuildable.

## Intentionally deferred (not attempted)

- Full GPU renderer replacement (abstraction built first, per spec phase plan).
- Virtualized lists/tables/trees + measured 100/500/1000-control benchmarks.
- New template/macro/JSX-style component syntax (spec forbids it; functions +
  structs + UI primitives remain the reuse story).
- Theme switching system (spec forbids it for 3.0).
- Live screenshot/pixel verification in this session (needs SDK + display).
