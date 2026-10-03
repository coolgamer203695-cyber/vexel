# Vexel 3.7.0 — Atlas Model Loading v0.5 (completion report)

All numbers below come from actual executed runs in this session
(Windows, Node v26.4.0, rustc 1.97.1, NVIDIA GeForce RTX 5050,
Vulkan). Nothing is projected.

## Version

`vexel version` reports `vexel 3.7.0` (package.json, bin/vexel.js,
website/version.json + index.html, README header all updated).

## What was built

### Language surface (parser + semantics)

- Five new nodes: `load model "<dir>"`, `create model <config>`,
  `model info "<dir>"`, `save model <m> to "<dir>"`, and
  `with inference { ... }`. Value forms type as `Model`;
  `create model` takes a config **object** (a string argument fails
  `vexel check` with guidance to `load model`).
- New `Model` type with members `mode`, `path`, `configuration`,
  `parameters`, `info` (statically typed info fields) and calls
  `m.forward <tensor>`, `m.eval`, `m.train`. Fields are read-only —
  assignment fails the checker with a pointer to `eval`/`train`.
- `info` / `eval` / `train` on `any` bases resolve through a
  hijack-safe branch: non-Model values keep their old field/method
  behavior (user structs, widgets).
- All five constructs are gated on `import atlas`
  (`<what> needs the Atlas model library. Add: import atlas`).
- `move <expr> to gpu|cpu` now statically accepts models (message:
  `tensor, struct, list, or model`); runtime container walk moves the
  parameter tensors in place.

### Runtime (four new files, always compiled into console builds)

- `atlas_format.rs` — the native `model.atlas` container: little-endian
  `ATLS | u32 version | u32 flags | u32 count | u64 header_len |
  header JSON | f32 data | u32 CRC32 (IEEE 0xEDB88320)`. Every read is
  bounds-checked with checked arithmetic (64 MiB header cap, 1,000,000
  tensor cap); truncation, bad magic, unknown version/flags, and
  checksum failures each get their own FormatError. Packing is
  deterministic — the same model saves byte-identically.
- `atlas_safetensors.rs` — SafeTensors reader: 8-byte LE header length,
  JSON header, F32/F16/BF16 (converted to f32); truncated/inverted/
  oversized headers are FormatErrors, unknown dtypes are
  UnsupportedErrors.
- `atlas_hf.rs` — honest Hugging Face boundary: a HF `config.json`
  (carries `architectures`/`model_type`) is refused with conversion
  guidance; an `org/name` path that doesn't exist on disk is refused
  as a repo id. Atlas v0.5 never touches the network.
- `atlas_model.rs` — config parse/normalize/validate (format,
  format_version, arch ∈ {linear, mlp}, layer chain, activations
  none/relu/sigmoid/tanh), canonical parameter layout
  (`linear → w,b` / `mlp → layers.i.w, layers.i.b`), deterministic
  random init (fixed-seed stream, uniform [0,1), zeros bias),
  weight loading with priority `model.atlas > safetensors index
  shards > model.safetensors`, atomic save (temp + rename per file:
  config.json, model.atlas, metadata.json), `info` structs, rank-1/
  rank-2 forward with squeeze, and `vex_model_member_get`.

### Inference mode

- Thread-local inference depth + `VexelInferenceGuard` (Drop
  decrements). `eval` mode and `with inference { ... }` run forward
  under the guard: `atlas_track` returns immediately, so no graph is
  recorded. A later `backward` on an inference result fails loudly
  (`decimal has no field 'backward'`) instead of silently training.

### Autograd

- New `AtlasBackwardOp::AddBias` with row-broadcast forward
  (`x + broadcast(b)` — the result is x plus bias, correct for any
  batch) and two rules: CPU (slot0 = gout passthrough, slot1 =
  row-sum) and GPU (download → row-sum → upload). This makes model
  bias gradients correct for rank-2 batches: verified
  `b.grad.sum = 2`, `w.grad.sum = 10` on a 2-sample batch.

### Codegen

- Console builds always append the four model runtime files (no AST
  sniffing); `collectRustLocals` walks `InferenceStmt` so variables
  assigned inside the block stay visible outside (Rust block scoping).
- Emissions: `vex_model_load/create/info`, `vex_model_save`,
  `vex_model_forward`, `vex_model_member_get` (forward/eval/train),
  and the inference-guard block.
- Avalonia backend rejects every model construct with an explicit
  console-only error (`... console-only in v0.5.`) instead of a
  generic "not supported" message.

### GPU placement

- `move m to gpu` transfers the parameter list in place.
- `forward` places a **copy** of the input on the model's device (the
  caller's tensor is never mutated), so mixed CPU input + GPU model
  just works. GPU and CPU results agree within f32 shader tolerance —
  the demo compares with `1e-3`, not bitwise equality.

### Library, docs, example

- `atlas.vxl` (repo root, importable from anywhere via the root
  fallback in `resolveImport`): `version`, `default_config`,
  `describe`, `exists`.
- `docs/atlas.md`: new "Models (v0.5)" section — 9 new executable
  blocks (docs suite 35 → 44), plus honest limits updated to v0.5.
- `docs/model_format.md`: complete on-disk reference (config schema,
  model.atlas byte layout + CRC, metadata.json, SafeTensors + shard
  index rules, weight priority, HF boundary, what a save does/doesn't
  contain).
- `examples/model_demo.vxl`: create → forward (rank-1 + batch) →
  backward → eval/inference → save/load roundtrip → GPU placement.

## Test results (all executed)

| suite | result |
| --- | --- |
| console (tests/run_tests.js) | 43 / 43 |
| UI (tests/ui) | 70 / 70 |
| v2.9 (tests/v29) | 86 / 86 |
| Praxis (tests/praxis) | 33 / 33 |
| Atlas v0.1–v0.4 (tests/atlas) | 67 / 67 |
| GPU v0.4 (tests/gpu) | 45 / 45 |
| docs (tests/docs, atlas.md) | 44 / 44 |
| **models v0.5 (tests/model, new)** | **51 / 51** |
| **total (`npm test`)** | **439 / 439, 0 failed** |

The new model suite covers: config validation (arch/chain/
activation/missing keys), forward shapes + squeeze + batch, arity and
member diagnostics, eval/train switching, inference-guard proof,
batched backward gradients, save→load exact roundtrip, nested saves,
atomic-corruption cases (bad magic, flipped data byte → checksum),
missing config/weights, SafeTensors (single, sharded, unsafe shard
path, shape mismatch, truncated file), weight priority, info/describe/
exists, the atlas-import gate for all five constructs, UI rejection,
and GPU placement (auto-skip without a GPU).

## Honest limits (v0.5)

- `linear` and `mlp` only; Hugging Face configs/repo ids are refused
  with guidance — no network, ever. Conversion tooling is roadmap.
- Saves contain config + weights (+ metadata); no optimizer state or
  training history.
- Models are console-only (UI programs fail with a console-only
  error); GPU still needs a real adapter.
- `create model` / `random tensor` share the fixed-seed stream on
  purpose — deterministic across runs, no seed API yet.

Full details: `docs/atlas.md` (Models section + Limits of v0.5) and
`docs/model_format.md`.
