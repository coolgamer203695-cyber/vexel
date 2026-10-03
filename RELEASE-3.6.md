# Vexel 3.6.0 — Atlas GPU Acceleration v0.4 (completion report)

All numbers below come from actual executed runs in this session
(Windows, Node v26.4.0, rustc 1.97.1, cargo 1.97.1, NVIDIA GeForce
RTX 5050, Vulkan 1.4.341, driver 610.88). Nothing is projected.

## Version

`vexel version` reports `vexel 3.6.0` (package.json, bin/vexel.js,
website/version.json + index.html, README header all updated).

## What was built

### The GPU backend (`gpu/` crate → `vex_gpu.dll`)

- A standalone Rust crate compiled as a cdylib with a small C ABI
  (wgpu 25: Vulkan/DX12/Metal). The runtime loads it lazily via
  `LoadLibraryW`/`dlopen`, so programs that never touch the GPU never
  load it.
- ABI: binary ops (`+ - * /`, plus a spare lane for division
  gradients), unary ops (relu/sigmoid/tanh/neg + their gradients),
  matmul, multi-pass reductions (sum/mean/max/min), transpose (2D and
  N-D), fills/accum/copies/sync, availability/count/name, and a
  last-error string. Error codes cover div0/OOM/unsupported/invalid.
- Division is the only synchronizing op (flag-buffer check). CUDA was
  evaluated and rejected (nvcc unusable without vcvars); wgpu on this
  machine's RTX 5050 is the shipped path.
- ABI locked and tested from PowerShell directly: div0 returns
  `code=-2, Division by zero.`, transpose 2D/3D, multi-pass mean of
  1..100000 = `50000.5`, matmul, activations, reduce, relu-grad.

### Device layer (`runtime/atlas_gpu.rs`)

- `VexTensor.storage` is now `TensorStorage::Cpu(Vec<f32>) |
  TensorStorage::Gpu(Rc<VgpuBuffer>)` — one tensor, one device, no
  shadow copies. `Drop` frees device buffers exactly once.
- Loader search order: `VEXEL_GPU_BACKEND` (explicit override — a set
  override must win or fail loudly, no silent fallback) → beside the
  executable → working directory → `.vexel-cache/gpu/`. Failures
  name every path tried.
- Availability (`vgpu_available/count/name`) never raises: missing
  backend or adapter reads as `false / 0 / ""`.
- Error mapping keeps CPU message parity, including
  `Division by zero.` and OOM text.

### Language surface

- `move <expr> to gpu|cpu` — contextual statement (parsing only
  commits after seeing `to`, so ordinary programs are untouched).
  Accepts tensors, structs, and lists (structs/lists transfer their
  inner tensors, in place — aliases and gradients see the new
  device). Anything else is a check-time TypeError; `any` defers to
  runtime.
- `gpu available` / `gpu count` / `gpu name` — contextual expressions
  (typed boolean/integer/string).
- Honest errors: mixing devices in an operation is a `DeviceError`
  (`Cannot divide tensors on different devices (left: gpu, right:
  cpu)...`); moving an empty tensor to the GPU is a `DeviceError`;
  moving a non-tensor fails at check time.
- UI (Avalonia) backend rejects both constructs with explicit
  console-only messages instead of a generic "not supported".

### GPU execution paths

- Element-wise math (both operand orders, tensor/tensor and
  tensor/scalar), matmul, activations, reductions, transpose,
  reshape/flatten (aliases of the same device buffer), and indexing
  (honest host round-trip that returns to the source device).
- `print`, `==`, and formatting are host reads: equality compares
  values across devices (a bug found and fixed — it previously
  returned false for identical CPU/GPU tensors).
- Autograd runs on the device: a dual `AtlasGradVal` (CPU vec or GPU
  buffer), a full `atlas_backward_rule_gpu` covering every forward
  rule (add/sub/mul/div incl. scalar composition, matmul with
  transpose flags, sum/mean fills, reshape/flatten/transpose,
  relu/sigmoid/tanh gradients), gradient accumulation on-device, and
  a per-node device consistency check at `backward` (mismatched
  devices raise `DeviceError`; the graph is never cleared on `move`).

### Build integration

- `rustcBuild` now runs `ensureGpuBackend(outExe)` after every
  successful compile: it finds the `gpu/` crate, rebuilds it with
  cargo only when a source file is newer than the DLL (mtime walk,
  silent, verified), copies `vex_gpu.dll` beside the program, and
  refreshes `.vexel-cache/gpu/`. Entirely non-fatal — no cargo or no
  GPU just means honest unavailability.

## Test results (factual)

| Suite | Result |
|---|---|
| GPU (NEW tests/gpu/run_gpu_tests.js; real GPU work only) | 45/45 |
| GPU honest skip (forced via bad `VEXEL_GPU_BACKEND`) | SKIP, exit 0, reason printed |
| Atlas (tests/atlas) | 67/67 |
| Native test file (atlas_tests.vxl) | 19/19 |
| Docs (docs/atlas.md — +5 new GPU blocks) | 35/35 |
| Compiler console (tests/run_tests.js) | 43/43 |
| UI (tests/ui) | 70/70 |
| v29 (tests/v29) | 85 passed, 0 failed, 1 env skip |
| Praxis static (tests/praxis) | 33/33 |
| Examples check (root) | 35/36 (only pre-existing `chess.vxl`) |
| `examples/gpu_demo.vxl` end-to-end | passes (all work on GPU) |

`npm test` runs everything including the GPU suite between atlas and
docs; the GPU suite skips with exit 0 on machines without a backend,
so the full pipeline stays green honestly.

## What was verified live (not just compiled)

- Availability: `gpu available` → `true`, `gpu count` → `3`,
  `gpu name` → `NVIDIA GeForce RTX 5050`.
- Movement round-trips (`cpu → gpu → cpu`) preserving values;
  double-move idempotent; struct and list models move in one
  statement and their fields compute on the device.
- GPU math matches CPU byte-for-byte in printed output: add/sub/mul/
  div, scalar both sides (`10 - m`, `m * 2` …), matmul 2×2 and
  2×3@3×2, sum/mean/max/min, transpose 2D and 3D, reshape/flatten,
  indexing and rows, relu/sigmoid/tanh forward.
- **Autograd parity**: leaf `sum(x*x)` → `[4,6]`; chain → `[16,24]`;
  mean scaling; mul/add rules; scalar composition; accumulation
  (`[8,12]` then reset `[4,6]`); matmul+reshape → `[5,6,5,6]`;
  transpose/flatten ones; division both operands →
  `[0.5,0.25] / [-1.5,-0.5]`; activation backward — all identical to
  the CPU suite. Gradients stay on the GPU (`x.grad.device` = `gpu`).
- Error parity: GPU division by zero fails with exactly
  `Division by zero.`; mixed-device ops, empty moves, non-scalar
  backward, and check-time type errors all match the CPU wording.
- Honest skip path: with `VEXEL_GPU_BACKEND` pointing at a missing
  file the suite prints `SKIP ... no GPU tests were run` plus the
  loader reason and exits 0.
- UI honesty: `move ... to gpu` and `gpu available` in UI programs
  fail `vexel check` with explicit console-only messages.

## Bug fixes found by the GPU work (all covered by tests)

- Cross-device equality compared devices instead of values — now by
  value, with downloads as host reads.
- Nested indexing (`x[1][0]` on a GPU tensor) fell through the
  generic indexer and raised a CPU-only dispatch error — the generic
  indexer now delegates to the dispatching one.
- The loader's cache candidate missed the `gpu/` subdirectory.
- An explicit `VEXEL_GPU_BACKEND` used to fall back silently when it
  failed to load; it now fails loudly (the basis of the honest-skip
  test).

## Design notes

- One tensor, one device: operations never silently download; the
  only host transfers are `print`/`==`/formatting (reads), indexing
  (returns to the source device), and explicit `move`.
- Graph bookkeeping survives movement: `move` preserves
  `requires_grad`, grads, and op records (meta is deliberately not
  cleared), so you can build on CPU, move, and `backward` — or move
  first. Mixed-device graphs fail at `backward` with `DeviceError`,
  never silently.
- Empty tensors stay on the CPU (no data to upload); moving one is a
  loud `DeviceError` rather than a fake success.
- Division-by-zero is checked on both host and device with identical
  text; GPU backward never trips it (forward already rejected zeros).
- The DLL is a build artifact like an exe: mtime-freshness via cargo,
  copied beside every program, cache copy for in-place runs.

## Known limitations (honest)

- The GPU needs a real wgpu adapter (Vulkan/DX12/Metal); without one,
  `gpu available` is `false` and `move ... to gpu` fails with the
  paths tried — nothing fakes GPU work.
- `print`, `==`, and indexing download GPU tensors (honest but
  costly); keep graphs on the GPU between prints.
- GPU-vs-CPU float output can differ in the last f32 ulp (e.g. tanh
  backward: shader vs host math) — tests use tolerance there and
  exact strings elsewhere.
- Console-only in v0.4: UI programs reject `move` and `gpu` info.
- Batch 1, no broadcasting, no negative indexes, no reshape `-1`,
  no model save/load, no seed API (all carried over from v0.3).
- `nn.vxl` moves to the GPU by moving `layer.w`, `layer.b`, and the
  data — a one-line-per-tensor operation (documented).
- `print a / b` still parses as a file path (long-standing Vexel
  rule — compute into a variable first).

Run fast verification with:

```bash
node tests/gpu/run_gpu_tests.js      # 45/45 (or honest SKIP)
node tests/atlas/run_atlas_tests.js  # 67/67
node tests/docs/run_docs_tests.js    # 35/35
vexel examples/gpu_demo.vxl
```

Full suites: `npm test` (needs time + toolchains).
