# Vexel 3.4.0 — Atlas Core v0.1 (completion report)

All numbers below come from actual executed runs in this session
(Windows, Node v26.4.0, rustc 1.97.1). Nothing is projected. The .NET
8 SDK is absent here, so UI *builds* could not run; UI *checks* run
without it and all pass.

## Version

`vexel version` reports `vexel 3.4.0` (package.json, bin/vexel.js,
website/version.json + index.html, README header all updated).

## What was built

Atlas v0.1, exactly the spec's scope — no more, no less:

- Native `tensor` type: `tensor [...]` / `tensor 5` / `zeros [...]` /
  `ones [...]` / `random tensor [...]`. No import (user definitions
  of these names always win; verified by test).
- Scalar, 1D, 2D, 3D, N-D. Internally (runtime/atlas.rs, its own
  subsystem file): contiguous float32 data + shape + row-major
  strides + rank + size + dtype (`float32`) + device (`cpu`) +
  contiguous flag, all fixed at construction (tensors immutable).
- Static shapes: literals/constructs with known skeletons fail fast
  at `vexel check` (add/matmul/reshape mismatches); anything dynamic
  widens to unknown and validates at runtime — never false-positives
  (reassignment and branches widen; verified by test).
- Shape system: `x.shape` (prints `[2,3]`, indexable), `x.rank`,
  `x.size`, `x.dtype`, `x.device`.
- Indexing `x[0]`, `x[0][1]` with bounds checking (IndexError + loc).
- Element-wise `+ - * /`: tensor/tensor (exact shapes) and both
  scalar sides. `/` mirrors Vexel numbers (division by zero errors).
- `@` matrix multiplication (2D, validated, i-k-j loop).
- `transpose` (all dims reversed, materialized), `reshape`
  (count-checked), `flatten`.
- `sum`/`mean`/`max`/`min` (full-tensor numbers; empty errors).
- `zeros`/`ones`/`random tensor` (fixed-seed deterministic [0,1)).
- Located Atlas errors (`Atlas Error / Type: ShapeError|TypeError|
  IndexError|RuntimeError` + message + File/Line/Column) via a
  per-statement source hook; user names shadow builtins.
- Tensors are immutable values (index/member assignment fails at
  compile time with guidance). Structural `==` works.
- UI programs using tensors fail loudly at check (BackendError).
- Caught errors report their true kind: `error.type` is `ShapeError` /
  `IndexError` / etc. for Atlas failures (previously every caught error
  said `RuntimeError`), verified by native `test` blocks.

Deliberately NOT built (roadmap): autograd, networks, optimizers,
GPU, HF/tokenizers/models, fine-tuning, CUDA/ROCm/Metal, seed API,
broadcasting, negative indexes, reshape `-1`, N-D matmul, `show`
theme-style sugar. `print a / b` still parses as a file path
(long-standing Vexel rule — compute into a variable first).

## Test results (factual)

| Suite | Result |
|---|---|
| Atlas (tests/atlas, NEW — all execute natively) | 39/39 |
| Compiler console (tests/run_tests.js) | 43/43 |
| v29 (tests/v29) | 86/86 |
| Praxis static (tests/praxis) | 33/33 |
| Examples check (root / ui / ax) | 34/35, 12/12, 14/14 |
| Docs (docs/atlas.md blocks executed) | 21/21 |
| Playground (atlas_playground.vxl runs end-to-end) | passes |
| `vexel test` with tensor asserts | passes |
| Native test file (atlas_tests.vxl, 13 blocks) | 13/13 |

Regressions introduced: 0. The one examples failure
(`examples/chess.vxl`) is pre-existing (documented since 3.0).
The UI build suite (tests/ui live steps) needs the .NET SDK and
could not run here; UI *checks* all pass.

Run fast verification with:

```bash
node tests/atlas/run_atlas_tests.js
vexel check atlas_playground.vxl
vexel atlas_playground.vxl
```

Full suites: `npm test` (needs time + toolchains).

## What was verified live (not just compiled)

- `[[19,22],[43,50]]` matmul, reductions, transpose/reshape/flatten,
  scalar math both sides, 3D indexing, zeros/ones/random (values +
  determinism across runs), structural equality, tensors through
  functions, structural display of every rank.
- Every error path executed: shape mismatch ([2]+[3]), ragged
  literals, bad reshape, matmul misalignment, non-2D matmul,
  bounds, div-by-zero, empty reduction, bad data/shapes/members,
  index assignment, UI+tensor loud failure — each naming
  file/line/column.
- try/catch captures Atlas errors (`error.message` prints the full
  located error; the program continues).
- Determinism: identical random-tensor programs produce
  byte-identical output across runs.

## Design notes for v0.2+ (no rewrite needed)

- `VexTensor` is additive: autograd needs grad buffers + op tape
  alongside it, not instead of it. Strides/flag already stored for
  lazy transpose/reshape later.
- Fixed-seed RNG is one thread-local initializer away from a seed API.
- `vex_field_get`/`vex_index_get`/`vex_add`-family already dispatch
  on tensors, so `any`-typed values (function params, JSON) work.
- `vex_json_stringify` serializes tensors as nested arrays
  (task results + files keep working).

## Known limitations (honest)

- Random tensors are deterministic (documented v0.1 choice).
- f32 storage: `0.1 + 0.2`-style values print shortest-roundtrip
  (honest, occasionally long). Tests use binary-exact values.
- No broadcasting, no negative indexes, `@` is 2D-only, reductions
  are full-tensor, reshape has no `-1`.
- `x.shape` is a rank-1 tensor (prints `[2,3]` exactly); `length of`
  does not accept tensors (use `x.size`).
- UI + tensors = clear BackendError (Atlas is console-first in v0.1).
