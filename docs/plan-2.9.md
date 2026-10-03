# Vexel 2.9 implementation plan

Target: Vexel 2.9.0, backward compatible with 2.2 programs. All syntax is
contextual (IDENT shapes, mirroring `json`/`every`/`task` precedent) — no new
reserved lexer keywords, no imports for builtins, no FFI, no macros, no units.

## Syntax decisions (one design each)

- Enums: `enum State { idle running finished }` (newline/comma separated),
  `state = State.running`. Runtime: tagged string; static `enum State` type.
- Null safety: no new syntax. Definite-null flow taint: using a variable
  known to hold `null` in arithmetic/field/index/length/number/make fails
  with NullSafetyError. `= null`/`== null`/`!= null` always allowed.
- Match: `match subject { literal { } Enum.value { } value { } null { } _ { } }`.
  `_` default must be last. Desugared to `==` chains in both backends.
- Terminal: `terminal { cd "dir" run "cmd" }`, plus `out = run "cmd"`
  (captures stdout). Persistent cwd session per block. Non-zero exit,
  bad dirs, missing exes are catchable errors. Host shell internally
  (`cmd /C` / `sh -c`), never exposed.
- Filesystem: `file write/read/append/delete/copy/move/exists/size`,
  `dir create/delete/exists/list/copy/move` (mirrors `json read/write`).
- CLI args: `args` list builtin (user definitions shadow it, like `paste`).
  CLI forwards trailing args to the built exe.
- Tests: `test "name" { ... }`, `assert <bool-expr>`, `vexel test`
  compiles a test runner (console only; UI programs get a clear error).
- Tasks: console-backend tasks (threads + snapshot globals) plus
  `wait <handle>` (console only; UI gets a clear BackendError pointing at
  timer polling). Task facets stay state/result/error/cancel.
- HTTP: `http <get|post|put|patch|delete> url [, body [, headers]]`
  (object/list bodies JSON-encode), `http timeout <secs>`. Console std-only
  backend serves `http://`; `https://` there is a clear catchable error.
- Projects: root walk-up, `src/main.vxl` fallback, bare `vexel check/test`.
- Check: staged `Vexel Check` output (parsing, type checking, modules,
  UI validation) with real warning detectors (dup imports, UI geometry).
- Diagnostics: previous-type/location notes on reassignment errors,
  did-you-mean suggestions for unknown names, stable caret format.
- Incremental: content-hash build cache + up-to-date skip + `vexel clean`.
- UI: shortcuts (`control.shortcut = "Ctrl+S"`), toolbar separators/groups,
  table selection readout, window registry ops, `--dpi` debug matrix,
  layout validation additions. Manual positioning untouched.

## Order

Phase 2 (enums/null/match) → 3 (terminal/fs) → 4 (args/projects) →
5 (check/test/diagnostics) → 6 (tasks/http) → 7 (incremental) →
8 (UI) → 9 (docs/examples/version) → 10 (regression + report).
