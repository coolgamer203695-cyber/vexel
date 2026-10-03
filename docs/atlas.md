# Atlas — Vexel's Native Tensor Engine

**Vexel → Programming Language. Praxis → UI Engine. Atlas → AI Engine.**

Atlas is the mathematical foundation: a real tensor type with
automatic differentiation, built into the language. No imports, no
Python, no frameworks. Every snippet below was executed against the
3.7 compiler (not just compiled).

## Tensor basics

`tensor` builds natively from values. No import — it works like
`string` or `number`:

```vxl
x = tensor [1,2,3]
print x
```

```vxl
y = tensor [[1,2],[3,4]]
print y
```

Scalars work too:

```vxl
d = tensor 5
print d
```

Tensors hold 32-bit floats on the CPU (`x.dtype` reports `float32`,
`x.device` reports `cpu`). Whole numbers print cleanly.

## Shapes

Every tensor exposes shape, rank, size, dtype and device:

```vxl
x = tensor [[1,2,3],[4,5,6]]
print x.shape
print x.rank
print x.size
```

`shape` prints like `[2,3]` and supports indexing (`x.shape[0]`).
`rank` counts dimensions, `size` counts all elements.

## Indexing

Indexing starts at 0 and is bounds-checked. Indexing a matrix gives
a row tensor, so `x[0][1]` chains naturally:

```vxl
x = tensor [[10,20],[30,40]]
print x[1][0]
print x[0]
```

Out-of-range indexes fail with an Atlas bounds error naming the size.

## Math

`+ - * /` work element by element, plus scalars on either side:

```vxl
a = tensor [1,2,3]
b = tensor [4,5,6]
print a + b
print b - a
print a * b
```

```vxl
m = tensor [1.5,2.5]
print m * 2
print 10 - m
```

Shapes must match exactly — `[2]+[3]` is a ShapeError, never silent
garbage. Division by zero is an error, mirroring plain Vexel numbers.

## Matrix multiplication

`@` is reserved for matrix multiplication (never `*`):

```vxl
a = tensor [[1,2],[3,4]]
b = tensor [[5,6],[7,8]]
print a @ b
```

Shapes validate before running: inner sizes must match and both
sides must be 2D, otherwise a ShapeError explains both shapes.

## Transpose

```vxl
x = tensor [[10,20],[30,40]]
print x.transpose
```

Transpose reverses all dimensions, so it works past 2D:

```vxl
c = tensor [[[1,2,3],[4,5,6]]]
print c.transpose.shape
print c.transpose
```

## Reshape

```vxl
x = tensor [[10,20],[30,40]]
rr = x.reshape [4]
print rr
print rr.reshape [2,2]
```

Reshape keeps the element count — mismatches fail cleanly (at check
time when both shapes are already known, otherwise when it runs):

```vxl
x = tensor [1,2,3]
n = 2
try {
    print x.reshape [n,2]
} error {
    print error.message
}
```

## Flatten

Flatten is reshape down to one dimension:

```vxl
x = tensor [[10,20],[30,40]]
print x.flatten
```

## Reductions

```vxl
x = tensor [1,2,3,4]
print x.sum
print x.mean
print x.max
print x.min
```

Reductions cover the whole tensor and return plain numbers.
Reducing an empty tensor is an error.

## Random tensors

```vxl
t = random tensor [2,3]
print t.shape
print t.rank
print t.size
```

Values fall in [0,1). Atlas uses a fixed seed, so random
tensors are identical on every run — on purpose, for reproducible
tests. A seed API arrives later.

## zeros and ones

```vxl
print zeros [2,2]
print ones [1,3]
```

Shapes are lists of non-negative integers (`zeros []` is scalar 0).

## Errors

Atlas errors name file, line and column, and never leak internals:

```vxl
function addem p, q {
    return p + q
}
a = tensor [1,2]
b = tensor [1,2,3]
try {
    print addem a, b
} error {
    print error.message
}
print "still running"
```

Caught errors expose message, type, file, line and column, like all
Vexel errors. (Shapes the compiler already knows fail even earlier,
at `vexel check` time — before anything runs.) Tensors are
immutable: `x[0] = 5` fails at compile time with guidance instead.

## Working with functions

Tensor values flow through functions like any other value:

```vxl
function show t {
    print t.shape
    print t.size
    return t.sum
}
a = tensor [[1,2],[3,4]]
print show a
```

## Gradients (autograd)

Flag a tensor with `make ... require gradients` and every operation
built from it is tracked. Then reduce to a scalar and call
`backward`:

```vxl
x = tensor [2, 3]
make x require gradients
y = x * x
loss = y.sum
loss.backward
print x.grad
```

Prints `[4,6]` — the derivative of x² is 2x. The rules:

- `x.grad` is `null` until the first `backward` (then a tensor with
  x's shape).
- Gradients **accumulate** across `backward` calls — `zero_grad`
  clears them:

```vxl
x = tensor [2, 3]
make x require gradients
loss = (x * x).sum
loss.backward
loss.backward
print x.grad
x.zero_grad
print x.grad
```

- `backward` starts from a scalar. Reduce with `sum` or `mean`
  (mean scales gradients by 1/n automatically):

```vxl
x = tensor [2, 3]
make x require gradients
loss = (x * x).mean
loss.backward
print x.grad
```

- `detach` cuts a tensor off the graph — the values stay, the
  history does not:

```vxl
x = tensor [2, 3]
make x require gradients
d = x.detach
print (d * d).sum
```

- Backward on a non-scalar, or on a value with no graph, is a
  caught ShapeError — never silent no-ops:

```vxl
x = tensor [2, 3]
make x require gradients
try {
    loss = x * x
    loss.backward
} error {
    print error.type
}
```

The chain rule is automatic through `+ - * /`, `@`, `reshape`,
`transpose`, `flatten`, `sum`, `mean`, and the activations below.
`max`/`min` observe values but do not track.

## Activations

`relu`, `sigmoid` and `tanh` are builtins (contextual names — yours
still win). They work forwards and backwards:

```vxl
x = tensor [-1, 0, 2]
print relu x
print sigmoid x
print tanh x
```

```vxl
x = tensor [-1, 2]
make x require gradients
h = relu x
loss = h.sum
loss.backward
print x.grad
```

Prints `[0,1]`: relu passes positive gradients, blocks negative
inputs.

## Neural networks

Vexel 3.5 ships `nn.vxl` — a small training library written in Vexel
itself, using nothing but the gradients above. Imports are
side-by-side, so copy `nn.vxl` next to your program:

```vxl
import nn

layer = nn.linear 1, 1
x = tensor [[3]]
target = tensor [[6]]
pred = nn.forward layer, x
loss = nn.mse pred, target
loss.backward
print layer.w.grad
```

The API:

- `nn.linear n, m` — a `Layer` with weights `[n,m]` and bias
  `[1,m]`, both ready for gradients.
- `nn.forward layer, x` — `x @ w + b` (x is `[batch, n]`;
  batch 1 in this release).
- `nn.relu_layer layer, x`, `nn.sigmoid_layer`, `nn.tanh_layer` —
  the same with an activation.
- `nn.mse pred, target` — mean squared error, tracked when its
  inputs are.
- `nn.step layer, lr` — one SGD update. It **detaches** the new
  weights, so they are fresh leaves for the next iteration.
- `nn.zero layer` — clear both gradients.

A full fit of `y = 2x` from two points, batch 1 (this is
`nn_train.vxl` at the repo root — output is deterministic):

```vxl
import nn

layer = nn.linear 1, 1

i = 0
repeat 500 {
    x = tensor [[1]]
    target = tensor [[2]]
    if i % 2 = 1 {
        x = tensor [[3]]
        target = tensor [[6]]
    }
    pred = nn.forward layer, x
    loss = nn.mse pred, target
    if i % 60 = 0 {
        print ["step", i, "loss", loss]
    }
    loss.backward
    nn.step layer, 0.02
    i = i + 1
}
print ["learned w", layer.w]
print ["learned b", layer.b]
```

The loss falls from `2.07` to about `9e-5`; the learned weights come
out at `w ≈ 1.99, b ≈ 0.01` — the line through `(1,2)` and `(3,6)`.

## GPU acceleration (v0.4)

Atlas runs real work on your GPU. The backend (`vex_gpu.dll`, built
from `gpu/` with wgpu) is a separate library that the compiler builds
on demand with cargo and copies beside your program — nothing to
install by hand.

Ask about the machine first (these never fail, even with no GPU):

```vxl
print gpu available
print gpu count
print gpu name
```

`move x to gpu` sends a tensor; `move x to cpu` brings it back.
Everything above keeps working on the GPU: math, matmul, reductions,
transpose, reshape, indexing, activations — and full autograd.

```vxl
if gpu available {
    a = tensor [1,2,3]
    move a to gpu
    print a.device
    b = a * 2 + 1
    move b to cpu
    print b
}
```

Training moves as a one-liner per tensor — gradients stay on the
device that made them:

```vxl
if gpu available {
    x = tensor [[1,2]]
    make x require gradients
    move x to gpu
    w = tensor [[0.5,0.5],[0.5,0.5]]
    move w to gpu
    loss = (x @ w).sum
    loss.backward
    print x.grad.device
    print x.grad
}
```

Whole models move: a struct or list of tensors transfers in one
statement (each inner tensor moves):

```vxl
if gpu available {
    l = [tensor [1,2], tensor [3,4]]
    move l to gpu
    t0 = l[0]
    print t0.device
    print t0 + l[1]
}
```

The rules, stated plainly:

- **Both operands must agree.** Mixing devices is a `DeviceError`,
  never a silent download:
  `Cannot divide tensors on different devices (left: gpu, right: cpu).`
- **Host reads are honest.** `print`, `==`, and indexing read GPU
  tensors back to the CPU — equality compares values across devices;
  printing costs a transfer, so keep a graph on the GPU between prints.
- **Errors match the CPU exactly**, down to the message:
  dividing by zero on the GPU still says `Division by zero.`
- **No GPU? Nothing pretends.** `gpu available` prints `false`,
  guarded blocks skip, and the test suite reports `SKIP` and exits 0.
  A failed `move` names every location that was tried.

`nn.vxl` works on the GPU too — move the layer and the data:

```vxl
import nn

if gpu available {
    layer = nn.linear 1, 1
    x = tensor [[3]]
    target = tensor [[6]]
    move layer.w to gpu
    move layer.b to gpu
    move x to gpu
    move target to gpu
    pred = nn.forward layer, x
    loss = nn.mse pred, target
    loss.backward
    print layer.w.grad.device
}
```

## Models (v0.5)

Vexel 3.7 loads and runs real neural networks from disk. A model is a
value: create one from a config, or `load` a saved folder, then call
`forward`. Everything below executes — weights come from files or a
fixed-seed initializer, outputs are computed, nothing is simulated.

Model syntax needs the Atlas model library:

```vxl
import atlas

m = create model atlas.default_config 4, 8, 2
print m.mode
print m.info.parameters
```

`atlas.default_config in, hidden, out` builds a 2-layer MLP config.
`create model` also accepts your own config object (keys `format`,
`format_version`, `name`, `arch`, `layers`), a config from
`json read`, or a helper's result — never a path: a string argument
fails `vexel check` with a pointer to `load model`.

### Forward

```vxl
import atlas

cfg = { format = "atlas-model", format_version = 1, name = "tiny", arch = "mlp", layers = [{in = 3, out = 5, activation = "relu"}, {in = 5, out = 1, activation = "none"}] }
m = create model cfg
print (m.forward tensor [[0.1, 0.2, 0.3]]).shape
print m.forward tensor [0.1, 0.2, 0.3]
```

A rank-1 input `[size]` squeezes to `[out]`; a rank-2 input
`[batch, size]` keeps its batch. `arch` is `linear` (exactly one
layer) or `mlp` (a chain — each layer's `in` must equal the previous
`out`); activations are `none`, `relu`, `sigmoid`, `tanh`. The first
layer's `in` must match the input size — mismatches name the model
and both sizes.

### Modes and inference

```vxl
import atlas

m = create model atlas.default_config 2, 3, 1
x = tensor [1, 2]
train_out = m.forward x
m.eval
eval_out = m.forward x
print train_out == eval_out
m.train
```

`create` starts in `train` mode: `forward` records the gradient
graph. `m.eval` switches to inference mode — identical numbers, no
graph — and `m.train` switches back and re-enables gradients on the
parameters (so a loaded model can be fine-tuned). `with inference`
runs any block the same way, without tracking:

```vxl
import atlas

m = create model atlas.default_config 2, 3, 1
with inference {
    y = m.forward tensor [1, 2]
}
print y
print y.sum
```

Inside `with inference` (and in `eval` mode) results carry no graph,
so a later `backward` fails instead of silently training.

### Training

```vxl
import atlas

m = create model { format = "atlas-model", format_version = 1, name = "fit", arch = "linear", layers = [{in = 1, out = 1, activation = "none"}] }
x = tensor [2]
y = m.forward x
loss = y.sum
loss.backward
print m.parameters[0].grad.sum
print m.parameters[1].grad.sum
```

In train mode `forward` records every op, `backward` fills
`m.parameters[i].grad` (weight grads are `xᵀg`, bias grads row-sum
`g` — correct for batches: a rank-2 batch trains in one step). Write
your own loop and nudge weights with `.detach` (as `nn.step` does);
in-place updates without detaching clear non-leaf grads, matching
every autograd engine.

### Save and load

```vxl
import atlas

m = create model atlas.default_config 2, 3, 1
save model m to "my-model"
print atlas.exists("my-model")

back = load model "my-model"
print back.mode
print atlas.describe(back.info)
print (m.forward tensor [1, 2]) == (back.forward tensor [1, 2])
```

`save model m to "<folder>"` writes `config.json`, `model.atlas`
(binary weights + CRC32) and `metadata.json`, creating folders as
needed — each file lands via temp + rename, so an interrupted save
never leaves a half-file. `load model` validates everything, starts
in `eval` mode, and round-trips exactly (the equality prints
`true`). `model info "<folder>"` reads config only, without touching
the weights.

### Members

```vxl
import atlas

m = create model atlas.default_config 4, 8, 2
print m.mode
print m.configuration.name
print m.parameters.length
m.eval
print m.mode
m.train
print m.mode
```

Model members: `mode`, `path`, `configuration`, `parameters`, `info`,
plus the calls `m.forward <tensor>`, `m.eval`, `m.train`. Fields are
read-only — assigning one fails `vexel check`:

```vxl-fail
import atlas

m = create model atlas.default_config 4, 8, 2
m.path = "other"
```

### SafeTensors, Hugging Face, GPU

Folders may hold `model.safetensors` (F32/F16/BF16) or a sharded
`model.safetensors.index.json` instead of `model.atlas` — priority is
native first, then shards, then the single file — and every tensor's
name and shape must match the config. `docs/model_format.md` documents
the on-disk layouts.

Hugging Face folders fail loudly on purpose: a HF `config.json` gets
an error explaining that Atlas supports `linear`/`mlp` only and never
touches the network, and an `org/name` repo id tells you to download
the files yourself. Nothing is silently half-loaded; conversion
tooling is on the roadmap.

Moving a model moves its parameters, and `forward` places each input
on the model's device automatically:

```vxl
import atlas

if gpu available {
    m = create model atlas.default_config 2, 3, 1
    move m to gpu
    z = m.forward tensor [1, 2]
    print z.device
}
```

(Without a GPU the block does nothing — nothing is faked.)

## Names are yours

`tensor`, `zeros`, `ones` and `random` are contextual, not reserved.
Your own variables keep working:

```vxl
zeros = [10,20,30]
print zeros[0]
```

## Examples

A small end-to-end program using several features together:

```vxl
a = tensor [[1,2],[3,4]]
b = tensor [[5,6],[7,8]]
print a @ b
print a.transpose + b.transpose
print (a @ b).sum
```

Static shapes also catch mistakes before anything runs:

```vxl-fail
a = tensor [1,2]
b = tensor [1,2,3]
print a + b
```

(The last one fails `vexel check` with a ShapeError naming both
shapes — the same error you would get at runtime.)

## Limits of v0.5 (honest)

- Hand-written training loops are single-sample (no built-in
  optimizer or dataloader — roadmap). Model `forward` accepts a
  rank-2 batch, and its bias grads row-sum correctly, so batched
  model training works today through the generic ops.
- No broadcasting: shapes must match exactly.
- `@` needs 2D tensors; reductions cover whole tensors only.
- No negative indexes, no reshape `-1` inference yet.
- The GPU needs a real adapter (wgpu: Vulkan/DX12/Metal). Without
  one, `gpu available` prints `false` and `move ... to gpu` fails
  loudly with the paths it tried — nothing fakes GPU work.
- `print`, `==`, and indexing download GPU tensors to the host (honest
  but costly); GPU-to-GPU math never does.
- Empty tensors stay on the CPU; moving one to the GPU is a
  `DeviceError`.
- Models: `linear` and `mlp` only; `model.atlas`/SafeTensors are
  loaded locally only — Hugging Face configs and repo ids are refused
  with guidance (no network, ever). Saved folders hold config and
  weights, not optimizer state or training history.
- No seed API yet: `create model` and `random tensor` share the
  fixed-seed stream on purpose (deterministic across runs).
- Optimizer updates must detach: build new weights with
  `.detach` (as `nn.step` does) or the next `backward` clears their
  grads — this matches how every autograd engine treats non-leaf
  tensors.
- `nn.vxl` is a plain Vexel module (copy it beside your program);
  packaged libraries arrive with VPA (roadmap).
- Tensors and models in UI programs fail loudly (Atlas is
  console-first), and so do `move ... to gpu` and `gpu available`
  (GPU and models are console-only in v0.5).
- `print a / b` with `/` reads as a file path (long-standing Vexel
  rule) — compute into a variable first, then print it.
