// Atlas v0.4 GPU kernels (WGSL) — compiled and executed on the real GPU
// by the wgpu backend. One module, one bind layout, one params uniform.
//
// Bindings (shared by every entry point):
//   0 src_a   storage read      primary input
//   1 src_b   storage read      secondary input
//   2 dst     storage read_write output
//   3 spare   storage read_write third input (grad paths) / unused
//   4 params  uniform           op parameters
//   5 shape   storage read u32  tensor shape (transpose)
// Unused bindings are backed by dummy buffers at bind time.

struct Params {
    op: u32,
    n: u32,
    m: u32,
    k: u32,
    nn: u32,
    ta: u32,
    tb: u32,
    rank: u32,
    final_pass: u32,
    side: u32,
    scale: f32,
    scalar: f32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
    pad3: u32,
};

@group(0) @binding(0) var<storage, read> src_a: array<f32>;
@group(0) @binding(1) var<storage, read> src_b: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@group(0) @binding(3) var<storage, read_write> spare: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read> shape_buf: array<u32>;

// ---- op codes (mirrored in runtime/atlas_gpu.rs and gpu/src/abi.rs) ----
// binary:    0 add, 1 sub, 2 mul, 3 div, 4 grad_div_b (out = c * (-a/(b*b)))
// scalar:    0 add, 1 sub, 2 mul, 3 div (side 0 => a OP s, 1 => s OP a)
// unary:     0 relu, 1 sigmoid, 2 tanh, 3 neg
// unary_grad:0 relu, 1 sigmoid, 2 tanh
// reduce:    0 sum, 1 mean, 2 max, 3 min

fn apply_binary(op: u32, x: f32, y: f32) -> f32 {
    switch op {
        case 0u: { return x + y; }
        case 1u: { return x - y; }
        case 2u: { return x * y; }
        case 3u: { return x / y; }
        default: { return x; }
    }
}

fn apply_unary(op: u32, x: f32) -> f32 {
    switch op {
        case 0u: { return max(x, 0.0); }
        case 1u: { return 1.0 / (1.0 + exp(-x)); }
        case 2u: { return tanh(x); }
        case 3u: { return -x; }
        default: { return x; }
    }
}

fn apply_unary_grad(op: u32, x: f32, g: f32) -> f32 {
    switch op {
        case 0u: { return select(0.0, g, x > 0.0); }
        case 1u: { let y = 1.0 / (1.0 + exp(-x)); return g * y * (1.0 - y); }
        case 2u: { let y = tanh(x); return g * (1.0 - y * y); }
        default: { return g; }
    }
}

fn combine(op: u32, acc: f32, v: f32) -> f32 {
    switch op {
        case 2u: { return max(acc, v); }
        case 3u: { return min(acc, v); }
        default: { return acc + v; }
    }
}

fn init_accum(op: u32) -> f32 {
    switch op {
        case 2u: { return -3.0e38; }
        case 3u: { return 3.0e38; }
        default: { return 0.0; }
    }
}

// ---- element-wise binary (tensor op tensor) ----
@compute @workgroup_size(64)
fn binary_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    let a = src_a[i];
    let b = src_b[i];
    if (params.op == 3u) {
        // Division validates like the CPU path: flag element-wise
        // division by zero (spare holds the flag buffer for op 3).
        if (b == 0.0) { spare[0] = 1.0; }
        dst[i] = a / b;
    } else if (params.op == 4u) {
        // dL/db for c = a / b:  g * (-a / (b*b)); spare = g
        dst[i] = spare[i] * (-a / (b * b));
    } else {
        dst[i] = apply_binary(params.op, a, b);
    }
}

// ---- element-wise with scalar ----
@compute @workgroup_size(64)
fn binary_scalar_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    let a = src_a[i];
    let s = params.scalar;
    if (params.op == 3u) {
        if (params.side == 1u) {
            if (a == 0.0) { spare[0] = 1.0; }
            dst[i] = s / a;
        } else {
            if (s == 0.0) { spare[0] = 1.0; }
            dst[i] = a / s;
        }
    } else if (params.side == 1u) {
        dst[i] = apply_binary(params.op, s, a);
    } else {
        dst[i] = apply_binary(params.op, a, s);
    }
}

// ---- unary forward ----
@compute @workgroup_size(64)
fn unary_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    dst[i] = apply_unary(params.op, src_a[i]);
}

// ---- unary backward: out = grad(element, gout) ----
@compute @workgroup_size(64)
fn unary_grad_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    dst[i] = apply_unary_grad(params.op, src_a[i], src_b[i]);
}

// ---- matrix multiply, row-major, optional transposes ----
// dst[m x nn] = op(a)[m x k] @ op(b)[k x nn]
//   ta: a stored as k x m, read transposed; tb: b stored as nn x k.
var<workgroup> tile_a: array<f32, 256>;
var<workgroup> tile_b: array<f32, 256>;

@compute @workgroup_size(16, 16)
fn matmul_main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>,
) {
    let row0 = wid.y * 16u;
    let col0 = wid.x * 16u;
    let lr = lid.y;
    let lc = lid.x;
    var acc = 0.0;
    let tiles = (params.k + 15u) / 16u;
    for (var t = 0u; t < tiles; t = t + 1u) {
        let ck = t * 16u + lc;
        let ar = row0 + lr;
        var av = 0.0;
        if (ar < params.m && ck < params.k) {
            if (params.ta == 1u) {
                av = src_a[ck * params.m + ar];
            } else {
                av = src_a[ar * params.k + ck];
            }
        }
        let br = t * 16u + lr;
        let bc = col0 + lc;
        var bv = 0.0;
        if (br < params.k && bc < params.nn) {
            if (params.tb == 1u) {
                bv = src_b[bc * params.k + br];
            } else {
                bv = src_b[br * params.nn + bc];
            }
        }
        tile_a[lr * 16u + lc] = av;
        tile_b[lr * 16u + lc] = bv;
        workgroupBarrier();
        for (var kk = 0u; kk < 16u; kk = kk + 1u) {
            acc = acc + tile_a[lr * 16u + kk] * tile_b[kk * 16u + lc];
        }
        workgroupBarrier();
    }
    if (row0 + lr < params.m && col0 + lc < params.nn) {
        dst[(row0 + lr) * params.nn + (col0 + lc)] = acc;
    }
}

// ---- tree reduction: any n, multi-pass from the host ----
var<workgroup> red: array<f32, 256>;

@compute @workgroup_size(256)
fn reduce_main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>,
) {
    let n = params.n;
    let chunk = 256u * 8u;
    let base = wid.x * chunk;
    var acc = init_accum(params.op);
    var i = base + lid.x;
    let stop = base + chunk;
    loop {
        if (i >= n || i >= stop) { break; }
        acc = combine(params.op, acc, src_a[i]);
        i = i + 256u;
    }
    red[lid.x] = acc;
    workgroupBarrier();
    var s = 128u;
    loop {
        if (s == 0u) { break; }
        if (lid.x < s) {
            let other = lid.x + s;
            if (other < 256u) {
                red[lid.x] = combine(params.op, red[lid.x], red[other]);
            }
        }
        workgroupBarrier();
        s = s / 2u;
    }
    if (lid.x == 0u) {
        var v = red[0];
        if (params.final_pass == 1u && params.op == 1u) {
            v = v * params.scale;
        }
        dst[wid.x] = v;
    }
}

// ---- generic N-D transpose (row-major, matches CPU atlas_transpose_raw) ----
@compute @workgroup_size(64)
fn transpose_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let flat = gid.x;
    if (flat >= params.n) { return; }
    let r = params.rank;
    // shape_buf holds the INPUT shape; the output shape is its reverse.
    // Decompose `flat` over the output shape (row-major: last dim first),
    // then accumulate the input offset with input strides — exactly the
    // CPU reference algorithm.
    var rem = flat;
    var in_off = 0u;
    for (var step = 0u; step < r; step = step + 1u) {
        let d = r - 1u - step;
        let out_dim = shape_buf[r - 1u - d];
        let c = rem % out_dim;
        rem = rem / out_dim;
        // input stride for axis d: prod(shape_buf[d+1..r]) where the
        // coordinate maps to out axis d -> input axis r-1-d with stride
        // old_strides[r-1-d] = prod(shape_buf[r-d .. r]).
        var stride = 1u;
        for (var t = r - d; t < r; t = t + 1u) {
            stride = stride * shape_buf[t];
        }
        in_off = in_off + c * stride;
    }
    dst[flat] = src_a[in_off];
}

// ---- fill with scalar ----
@compute @workgroup_size(64)
fn fill_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    dst[i] = params.scalar;
}

// ---- out[i] = src[0] * scale (sum/mean backward) ----
@compute @workgroup_size(64)
fn fill_scaled_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    dst[i] = src_a[0] * params.scale;
}

// ---- dst += src (gradient accumulation) ----
@compute @workgroup_size(64)
fn accum_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    dst[i] = dst[i] + src_a[i];
}

// ---- dst = src (device-to-device copy) ----
@compute @workgroup_size(64)
fn copy_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.n) { return; }
    dst[i] = src_a[i];
}
