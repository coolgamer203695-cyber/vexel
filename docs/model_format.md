# Atlas model format (v0.5)

An Atlas model folder is plain files on disk — no database, no
runtime state. `save model m to "<folder>"` writes three files,
`load model "<folder>"` reads them back, and `model info "<folder>"`
reads only the config. Everything below is the exact on-disk
layout; nothing is hidden or simulated.

## Folder layout

```
my-model/
  config.json      architecture + layer shapes (JSON, human-readable)
  model.atlas      binary weights (native container, CRC32-protected)
  metadata.json    summary written alongside (informational)
```

`model.atlas` may be replaced by SafeTensors files (see below) —
many open toolchains speak SafeTensors. Weight priority when more
than one source exists:

1. `model.atlas` (native)
2. `model.safetensors.index.json` (sharded SafeTensors)
3. `model.safetensors` (single file)

If none exists, load fails: `No weights found in '<folder>':
expected model.atlas, model.safetensors, or
model.safetensors.index.json.`

Writes are atomic: each file is written to a temp name and renamed
into place, and folders are created as needed. Saving the same model
twice produces identical bytes (deterministic canonical order).

## config.json

Required keys:

| key              | type   | rules                                                        |
| ---------------- | ------ | ------------------------------------------------------------ |
| `format`         | string | must be `"atlas-model"`                                      |
| `format_version` | int    | must be `1` (newer versions refuse with guidance)           |
| `arch`           | string | `"linear"` (exactly one layer) or `"mlp"` (a chain)          |
| `layers`         | list   | layer objects, see below                                     |

Optional: `name` (string, defaults to `"model"`).

Each layer is `{ "in": n, "out": n, "activation": "..." }` with
`activation` one of `none`, `relu`, `sigmoid`, `tanh`. Validation:

- layer 0's `in` is the model's input size;
- layer *i*'s `in` must equal layer *i-1*'s `out`
  (`Layer sizes do not chain: ...`);
- `linear` takes exactly one layer, `mlp` at least one;
- parameter counts are derived: `linear` → `in*out + out`,
  `mlp` → sum over layers.

Example (`atlas.default_config 2, 3, 1`):

```json
{
  "format": "atlas-model",
  "format_version": 1,
  "name": "mlp-relu",
  "arch": "mlp",
  "layers": [
    { "in": 2, "out": 3, "activation": "relu" },
    { "in": 3, "out": 1, "activation": "none" }
  ]
}
```

`save` writes the normalized config (every layer filled in), so a
reloaded folder is self-describing.

## model.atlas (binary container)

Little-endian throughout:

```
offset  size      content
0       4         magic "ATLS"
4       4         u32 format version (= 1)
8       4         u32 flags (must be 0 in v1)
12      4         u32 tensor count
16      8         u64 header length (bytes)
24      H         header JSON (UTF-8, no trailing NUL)
24+H    D         tensor data (f32 LE, concatenated in header order)
24+H+D  4         u32 CRC32 (IEEE 802.3, poly 0xEDB88320, reflected)
```

The CRC covers every byte before the trailing checksum — a truncated
or corrupted file fails with `model.atlas failed its checksum (the
file is corrupted).` instead of decoding into garbage. The header is
capped at 64 MiB, the tensor count at 1,000,000; every offset is
re-checked against the real buffer with checked arithmetic, so a
hostile file can never panic the runtime.

Header JSON:

```json
{
  "tensors": {
    "layers.0.w": { "shape": [2,3], "offset": 0,  "nbytes": 24, "dtype": "f32" },
    "layers.0.b": { "shape": [1,3], "offset": 24, "nbytes": 12, "dtype": "f32" }
  }
}
```

`offset` is byte offset into the data region, `nbytes` =
`product(shape) * 4`. Tensor names follow the canonical parameter
order: `linear` → `w`, `b`; `mlp` → `layers.<i>.w`,
`layers.<i>.b` per layer.

Read errors are specific: bad magic (`Not an Atlas model file: bad
magic (expected ATLS).`), truncation at the header or data region,
unknown format version or feature flags, shape/offset overflow, and
the checksum above. Shapes that don't match config.json report the
tensor by name.

## metadata.json

```json
{
  "format": "atlas-metadata",
  "format_version": 1,
  "name": "mlp-relu",
  "arch": "mlp",
  "parameters": 13
}
```

Informational only — load never trusts it; `config.json` is the
source of truth.

## SafeTensors

Atlas reads the standard SafeTensors layout: 8-byte little-endian
header length, UTF-8 JSON header (`{name: {dtype, shape,
data_offsets}}`), then raw data. Supported dtypes: `F32`, `F16`,
`BF16` (converted to f32); anything else fails with an
`UnsupportedError` naming the dtype. Files must be complete —
truncated headers, inverted offsets, and oversized headers are
`FormatError`s.

Tensor names must match the canonical names above; a name or shape
that doesn't match config.json reports
`Weight '<name>' has shape ... but the config expects ...` or
`Weights are missing '<name>' ... this folder does not match its
config.json.`

### Sharded: model.safetensors.index.json

```json
{
  "weight_map": {
    "layers.0.w": "shard-00001.safetensors",
    "layers.0.b": "shard-00002.safetensors"
  }
}
```

All listed shards are read (sorted order) and merged; a tensor
appearing in two shards is a `FormatError`. Shard paths must be
relative single file names — anything containing `..`, a backslash,
a leading `/`, or `:` is refused as an unsafe shard path. An index
without a `weight_map` object, or with an empty map, is a
`FormatError`.

## Hugging Face boundary (honest)

Atlas v0.5 never touches the network and never half-loads:

- A `config.json` that looks like a Hugging Face config (it carries
  `architectures` or `model_type` instead of Atlas keys) is refused
  with an error explaining that Atlas supports `linear`/`mlp` only
  and that weights must be converted to an Atlas folder first.
- A path like `org/name` that doesn't exist on disk is treated as a
  repo id and refused: download the files yourself and point at the
  folder.

Conversion tooling is on the roadmap; until then these two errors
are the whole integration story — deliberate and loud.

## What a save contains (and doesn't)

Saved: architecture config, parameter tensors, mode-agnostic weight
bytes. Not saved: optimizer state, loss history, RNG state, Python
pickles, or anything executable. `load` always starts the model in
`eval` mode with `requires_grad` off; call `m.train` to fine-tune.
