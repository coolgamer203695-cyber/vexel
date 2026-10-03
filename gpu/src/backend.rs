// Atlas v0.4 — GPU backend abstraction.
//
// The Vexel-facing API only ever says "cpu" / "gpu". Internally Atlas
// talks to this Backend trait, so future backends (CUDA, ROCm, Metal)
// slot in without touching Tensor or the autograd engine. v0.4 ships
// exactly one real backend: wgpu (Vulkan/DX12/Metal via the OS driver).

/// ABI result codes (mirrored by runtime/atlas_gpu.rs).
pub const ERR_OK: i32 = 0;
pub const ERR_GENERIC: i32 = -1;
pub const ERR_DIV0: i32 = -2;
pub const ERR_OOM: i32 = -3;
pub const ERR_HANDLE: i32 = -4;
pub const ERR_INIT: i32 = -5;
pub const ERR_KERNEL: i32 = -6;
pub const ERR_NO_DEVICE: i32 = -7;
pub const ERR_UNSUPPORTED: i32 = -8;
pub const ERR_INVALID: i32 = -9;

/// Binary element-wise op codes (WGSL kernels.wgsl mirrors these).
pub const OP_ADD: u32 = 0;
pub const OP_SUB: u32 = 1;
pub const OP_MUL: u32 = 2;
pub const OP_DIV: u32 = 3;
/// dL/db for out = a / b, with the gradient arriving in `spare`.
pub const OP_DIV_DB: u32 = 4;

/// Unary forward op codes.
pub const UN_RELU: u32 = 0;
pub const UN_SIGMOID: u32 = 1;
pub const UN_TANH: u32 = 2;
pub const UN_NEG: u32 = 3;

/// Reduction op codes.
pub const RED_SUM: u32 = 0;
pub const RED_MEAN: u32 = 1;
pub const RED_MAX: u32 = 2;
pub const RED_MIN: u32 = 3;

/// Every GPU capability Atlas uses goes through this interface.
/// Implementations queue work asynchronously and only synchronize
/// when the caller needs results back on the host (`read`, `sync`,
/// and division validation, which must match CPU error semantics).
pub trait GpuBackend: Send {
    /// Internal identifier (never exposed to Vexel programs).
    fn backend_name(&self) -> &'static str;
    fn device_count(&self) -> usize;
    fn device_name(&self, idx: usize) -> String;
    /// Device allocation ceiling (used to fail honestly before a
    /// doomed allocation instead of crashing).
    fn max_buffer_size(&self) -> u64;

    fn alloc(&mut self, nbytes: u64) -> Result<u64, String>;
    fn free(&mut self, handle: u64);
    /// Host -> device (queued, not synchronized).
    fn write_f32(&mut self, handle: u64, byte_offset: u64, data: &[f32]) -> Result<(), String>;
    /// Device -> host (synchronizes: the caller needs the bytes now).
    fn read_f32(&mut self, handle: u64, byte_offset: u64, out: &mut [f32]) -> Result<(), String>;

    /// Element-wise binary. `spare` is only read by OP_DIV_DB (the
    /// incoming gradient); pass 0 elsewhere.
    fn binary(&mut self, op: u32, a: u64, b: u64, spare: u64, out: u64, n: u64) -> Result<(), String>;
    fn binary_scalar(&mut self, op: u32, a: u64, scalar: f32, out: u64, n: u64, side: u32) -> Result<(), String>;
    fn unary(&mut self, op: u32, a: u64, out: u64, n: u64) -> Result<(), String>;
    fn unary_grad(&mut self, op: u32, a: u64, g: u64, out: u64, n: u64) -> Result<(), String>;
    /// out[m x nn] = op(a)[m x k] @ op(b)[k x nn], row-major.
    fn matmul(&mut self, a: u64, b: u64, out: u64, m: u32, k: u32, nn: u32, ta: u32, tb: u32) -> Result<(), String>;
    /// Full-tensor reduction to a single value (multi-pass on device).
    fn reduce(&mut self, op: u32, a: u64, out: u64, n: u64, mean_scale: f32) -> Result<(), String>;
    /// Generic N-D transpose (row-major, CPU-parity semantics).
    fn transpose(&mut self, a: u64, out: u64, shape: &[u32]) -> Result<(), String>;
    fn fill(&mut self, out: u64, value: f32, n: u64) -> Result<(), String>;
    fn fill_scaled(&mut self, src: u64, scale: f32, out: u64, n: u64) -> Result<(), String>;
    fn accum(&mut self, dst: u64, src: u64, n: u64) -> Result<(), String>;
    fn copy(&mut self, src: u64, dst: u64, n: u64) -> Result<(), String>;

    /// Wait for queued GPU work (host reads already synchronize).
    fn sync(&mut self) -> Result<(), String>;
}
