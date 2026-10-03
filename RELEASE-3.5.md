# Vexel 3.5.0 — Atlas Autograd v0.2 + Neural Networks v0.3 (completion report)

All numbers below come from actual executed runs in this session
(Windows, Node v26.4.0, rustc 1.97.1). Nothing is projected.

## Version

`vexel version` reports `vexel 3.5.0` (package.json, bin/vexel.js,
website/version.json + index.html, README header all updated).

## What was built

### Atlas v0.2 — autograd

- `make <name> require gradients` — new two-word `make` mode. Flags
  a tensor for tracking (works on locals and globals; a non-tensor
  is a compile-time TypeError).
- Every tensor now carries `requires_grad`, `grad` (tensor or
  `null`) and an optional op record. Tensors are shared
  (`Rc<RefCell<..>>`), so struct fields, function arguments and
  variables all see the same gradients.
- Forward ops record a graph: `+ - * /`, `@`, `reshape`, `flatten`,
  `transpose`, `sum`, `mean`, and the activations below.
- `loss.backward` — topological backward from a scalar, seed `1`,
  per-op rules (13 of them), gradients **accumulate** until
  `x.zero_grad`. Intermediate grads are released afterwards; leaf
  grads persist (same rule every autograd engine uses).
- Members: `x.grad` (`null` before the first backward),
  `loss.backward`, `x.zero_grad`, `x.detach` (values without
  history).
- Reductions are dual-behaved: a tracked input yields a scalar
  tensor you can `backward`; an untracked one yields a plain number,
  so every v0.1 program keeps working unchanged. `max`/`min` never
  track.
- Activations `relu`, `sigmoid`, `tanh` — builtins (contextual
  names, user definitions still win), forward and backward.
- Honest errors: `backward` on a non-scalar or a graph-less tensor
  is a caught ShapeError; `make ... require gradients` on a number
  fails at check time.

### Atlas v0.3 — neural networks

- `nn.vxl` (repo root) — a training library written in Vexel itself:
  `Layer { w b }`, `nn.linear n, m` (weights created with
  gradients on), `nn.forward` (`x @ w + b`), `nn.relu_layer` /
  `nn.sigmoid_layer` / `nn.tanh_layer`, `nn.mse`, `nn.step layer, lr`
  (SGD — detaches the new weights so they are fresh leaves, the
  PyTorch `.data` idiom), `nn.zero layer`.
- `nn_train.vxl` (repo root) — batch-1 SGD fitting `y = 2x` from two
  points. Executed: loss `2.07 → 9e-5` across 500 steps, learned
  `w = 1.9949`, `b = 0.0133`, predictions `2.0082 / 5.9980`.
  Output is deterministic (fixed-seed RNG).
- Imports are side-by-side only, so `nn.vxl` ships as a plain module
  to copy beside your program — documented honestly (packaged
  libraries arrive with VPA, roadmap).

Deliberately NOT built (roadmap): batching >1, GPU, model save/load,
seed API, broadcasting, negative indexes, reshape `-1`, N-D matmul,
optimizers beyond SGD (momentum/Adam).

## Test results (factual)

| Suite | Result |
|---|---|
| Atlas (tests/atlas, executes natively; 3.4 had 39) | 67/67 |
| Native test file (atlas_tests.vxl; 3.4 had 13 blocks) | 19/19 |
| Docs (NEW automated: tests/docs/run_docs_tests.js) | 30/30 |
| Compiler console (tests/run_tests.js) | 43/43 |
| UI (tests/ui) | 70/70 |
| v29 (tests/v29) | 85/85, 1 env skip |
| Praxis static (tests/praxis) | 33/33 |
| Examples check (root / ui / ax) | 34/35, 12/12, 14/14 |
| Playground (atlas_playground.vxl end-to-end) | passes |
| nn_train.vxl end-to-end | passes (converges) |

Regressions introduced: 0. The one examples failure
(`examples/chess.vxl`) is pre-existing (documented since 3.0 — it
uses `r`, now a contextual keyword).

One pre-existing test bug fixed: the UI suite's `vexel version` check
hardcoded `3.0.0` and broke at every version bump; it now accepts any
semantic version.

Run fast verification with:

```bash
node tests/atlas/run_atlas_tests.js
node tests/docs/run_docs_tests.js
vexel test atlas_tests.vxl
vexel nn_train.vxl
```

Full suites: `npm test` (needs time + toolchains).

## What was verified live (not just compiled)

- The spec example end-to-end: `x = tensor [2,3]` → `make x require
  gradients` → `y = x * x` → `loss = y.sum` → `loss.backward` →
  `x.grad` prints `[4,6]`.
- Chain rules: `(x+x)*(x+x)` → `[16,24]`; mean scales by 1/n;
  mul-backward returns the other operand; add-backward returns ones;
  scalar-tensor math both sides.
- Structural ops backward: matmul+reshape → `[5,6,5,6]`,
  transpose/flatten → ones where expected.
- Activations backward: relu `[0,1]`, sigmoid `[0.25,0.19661193]`,
  tanh `[1,0.41997433]` — matching hand-computed derivatives.
- **Finite-difference check**: central differences (`h = 0.002`)
  against autograd for `sum(sigmoid(x) * x)` at `x = [0.3, -0.7]` —
  both components agree within `1e-3` (runner + native assert).
- Accumulation: two backwards double the gradient; `zero_grad`
  clears to `null`; `detach` cuts history (untracked sum still works).
- Error paths: non-scalar backward, backward on a plain number,
  `make require gradients` on an integer (static), forward/MSE shape
  mismatches in the NN library — each naming file/line/column.
- NN: forward shapes, one-step SGD math checked by hand
  (`w_new = w - lr*grad` matches printed values to all digits),
  repeated steps keep training (the detach fix), `nn.zero` clears,
  full training converges to the true line.
- Determinism: identical programs produce byte-identical output
  across runs (all NN test expectations are exact).

## Design notes

- Optimizer updates must produce **leaves**: `nw = (w - lr*g).detach`
  then `make nw require gradients`. Without detach, the new tensor
  carries an op record and the next `backward` treats it as an
  intermediate and releases its grad — exactly how PyTorch treats
  non-leaf `.grad`. Documented in docs/atlas.md limits.
- `sum`/`mean` typing is `any` at check time (tensor when tracked,
  number when not); everything downstream still type-checks, and the
  runtime picks the real value.
- The module bootstrap function is generated as `<module>__init` — a
  user function named `init` in a module collides with it (known
  quirk; `nn.linear` avoids it).

## Known limitations (honest)

- Batch 1 only: one sample per step (batching is roadmap).
- No broadcasting; shapes must match exactly.
- Non-leaf grads are released after `backward` (by design).
- `nn.vxl` must sit beside the importing program (side-by-side
  imports only).
- f32 storage: values print shortest-roundtrip (occasionally long).
- Tensors in UI programs fail loudly (Atlas is console-first).
- `print a / b` still parses as a file path (long-standing Vexel
  rule — compute into a variable first).
