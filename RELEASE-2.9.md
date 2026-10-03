# Vexel 2.9.0 — Release Report

All numbers below come from actual executed runs on 2026-09-19
(Windows, Node v26.4.0, rustc 1.97.1, .NET 8 SDK). Nothing is projected.

## Vexel version

`vexel version` reports `vexel 2.9.0` (package.json 2.9.0).

## Test results

| Suite | Result |
|---|---|
| Compiler tests (tests/run_tests.js — lexer, parser, types, functions, structs, modules, errors, programs) | 43/43 |
| Runtime tests (same run: end-to-end native execution, exact stdout) | included in 43/43 |
| UI tests (tests/ui/run_ui_tests.js — widgets, diagnostics, codegen, Avalonia builds, live windows, timers, tasks, pixels, CLI) | 70/70, 0 skipped |
| CLI tests (version/create/run/debug in UI suite; check/run/test/args in v29 suite) | all passing |
| Project tests (create/run, root walk-up, project test/run) | all passing |
| Incremental compilation tests (skip, rebuild-on-change, clean) | 3/3 |
| Regression tests (full 2.2 suites re-run, 0 allowed) | 43/43 + 70/70 |
| Documentation tests (13/13 v2.9.md code blocks compile; 1 intentional-error block fails as documented) | 13/13 |
| New feature tests (tests/v29/run_v29_tests.js) | 86/86, 0 skipped |

Regressions: 0.

Totals: 199 passed, 0 failed, 0 skipped across the three suites
(43 + 70 + 86).

Run everything with: `npm test`
(`node tests/run_tests.js && node tests/ui/run_ui_tests.js && node tests/v29/run_v29_tests.js`).

## What was verified live (not just compiled)

- Enums + match run as native exes; error paths (unknown value,
  wrong-type assign, bad arms) fail `vexel check` with the documented
  messages.
- Terminal sessions: mkdir/cd/run persistence proved by files created
  in changed directories; exit codes, bad dirs and missing exes proved
  catchable.
- Filesystem: all 14 operations executed; move proved to remove the
  source (a copy-paste codegen bug found and fixed during testing).
- CLI args forwarded and indexed; empty-args and out-of-range behavior
  verified.
- Test runner: pass/fail/empty suites executed with correct exit codes.
- Console tasks: compute/wait/result, cancel, failure, snapshot
  Globals — all executed.
- HTTP: GET/POST/PUT/PATCH/DELETE + JSON bodies + headers + timeout
  against a local server; invalid-URL/unreachable/https-console cases
  verified.
- Incremental: build → "Up to date" skip → rebuild-on-change →
  rebuilt exe runs new code → clean removes exe + cache.
- UI: toolbar/group/separator, table render + programmatic + clicked
  selection, change events, Ctrl+S shortcut — all proved with
  screenshots, OS clicks, SendKeys and file probes. DataGrid rendering
  failure found and fixed (custom core-controls table).
- DPI matrix (`--dpi all`) and overlap warnings verified on purpose-
  built cases.

## Known limitations (honest, documented in docs/v2.9.md)

- Task snapshots/results cross threads as data; exotic values may not
  round-trip — keep task results to plain data.
- Console HTTP serves `http://` only (no TLS in the std-only backend);
  `https://` there is a clear error. Desktop builds do full `http(s)`.
- `wait <handle>` is console-only; UI programs poll `handle.state`
  from a timer (compiler directs this).
- `vexel test` is console-only; UI programs get guidance to test
  console modules.
- Match has no exhaustiveness requirement; `_` default recommended.
- Null tracking is definite-null (no branch narrowing); `any` values
  still need `if x = null` guards.
- No FFI, no macros, no unit types (by design, unchanged).
- Toolbar groups are labeled strips (no collapsible groups).
- Table column widths are proportional (min 100px) with scrolling;
  no interactive column resizing in 2.9.

## Compatibility notes (intentional, all with clear errors)

Documented in docs/v2.9.md: console tasks now run (were an error),
`wait x` re-purposed to task-wait, `test`/`assert`/`run`/`cd`/
`file`/`dir` shapes are reserved, tables render and programmatic
selection notifies, enums coerce in string joins, `vexel check`
output is staged, `vexel debug` accepts `--dpi`. One latent 2.2 bug
fixed along the way: UI `if/else` codegen referenced an undefined
variable.
