// ===== Atlas v0.1: Vexel's native tensor engine (CPU, float32) =====
// Tensors store float32 data contiguously (row-major) with shape,
// strides, rank, size, dtype, device, and a contiguous flag. Every op
// validates first and reports located Atlas errors â€” internal traces
// never leak. Tensors are immutable values: all metadata is fixed at
// construction, so stored fields can never disagree.

pub type TensorRef = Rc<RefCell<VexTensor>>;

#[derive(Clone, Debug)]
pub enum AtlasBackwardOp {
    Add,
    Sub,
    Mul,
    Div,
    Matmul,
    Sum,
    Mean,
    Reshape,
    Flatten,
    Transpose,
    Relu,
    Sigmoid,
    Tanh,
    AddBias,
}

// One operand slot: tensors share identity (gradient target),
// scalars only contribute their value (nothing to store into).
#[derive(Clone, Debug)]
pub struct GradInput {
    pub tensor: Option<TensorRef>,
    pub requires: bool,
    pub scalar: Option<f32>,
}

#[derive(Clone, Debug)]
pub struct AutogradMeta {
    pub op: AtlasBackwardOp,
    pub inputs: Vec<GradInput>,
}

// ===== Atlas v0.4: device-aware tensor storage =====
// A tensor lives on the CPU (a contiguous Vec of f32) or on the GPU
// (a reference-counted device buffer). Ops dispatch at their boundary
// on this storage; aliasing views (reshape/flatten/detach) share the
// Rc so a buffer is freed exactly once. Empty tensors stay on the
// CPU: they hold no data to place on a device.

#[derive(Clone, Debug)]
pub enum TensorStorage {
    Cpu(Vec<f32>),
    Gpu(Rc<VgpuBuffer>),
}

#[derive(Clone, Debug)]
pub struct VexTensor {
    pub storage: TensorStorage,
    pub shape: Vec<usize>,
    pub strides: Vec<usize>,
    pub rank: usize,
    pub size: usize,
    pub dtype: String,
    pub contiguous: bool,
    pub requires_grad: bool,
    pub grad: Option<TensorRef>,
    pub meta: Option<AutogradMeta>,
}

thread_local! {
    static ATLAS_LOC: RefCell<(String, u32, u32)> = RefCell::new((String::from("<unknown>"), 0, 0));
    // Fixed seed: random tensors are deterministic across runs
    // (Atlas v0.1 reproducibility; a seed API comes later).
    static ATLAS_RNG: RefCell<u64> = RefCell::new(0x243F6A8885A308D3);
}

// Called once per generated statement so tensor errors name their source.
pub fn vex_atlas_loc(file: &str, line: u32, col: u32) {
    ATLAS_LOC.with(|l| { *l.borrow_mut() = (file.to_string(), line, col); });
}

fn atlas_loc_now() -> (String, u32, u32) {
    ATLAS_LOC.with(|l| l.borrow().clone())
}

fn atlas_err(kind: &str, msg: String) -> String {
    let (f, line, col) = atlas_loc_now();
    format!("Atlas Error\n\nType: {}\n\n{}\nFile: {}\nLine: {}\nColumn: {}", kind, msg, f, line, col)
}

fn atlas_shape_str(shape: &[usize]) -> String {
    format!("[{}]", shape.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(","))
}

// Honest failure when a device dispatch sent the wrong storage through
// a single-device path (should be unreachable; never panic, never lie).
fn atlas_dispatch_err(what: &str) -> String {
    atlas_err("DeviceError", format!("Internal device dispatch error in {}: the tensor's device does not match this operation's path.", what))
}

// Two operands on different devices cannot combine silently.
fn atlas_device_mix(verb: &str, left: &str, right: &str) -> String {
    atlas_err("DeviceError", format!(
        "Cannot {} tensors on different devices (left: {}, right: {}). Move both tensors to the same device first.",
        verb, left, right
    ))
}

impl VexTensor {
    pub fn rank(&self) -> usize { self.rank }
    pub fn size(&self) -> usize { self.size }
    pub fn strides_for(shape: &[usize]) -> Vec<usize> {
        let mut st = vec![1usize; shape.len()];
        let mut s = 1usize;
        for i in (0..shape.len()).rev() {
            st[i] = s;
            s = s.saturating_mul(shape[i]);
        }
        st
    }
    pub fn contiguous_new(data: Vec<f32>, shape: Vec<usize>) -> TensorRef {
        let strides = VexTensor::strides_for(&shape);
        let rank = shape.len();
        let size = data.len();
        Rc::new(RefCell::new(VexTensor {
            storage: TensorStorage::Cpu(data),
            shape,
            strides,
            rank,
            size,
            dtype: String::from("float32"),
            contiguous: true,
            requires_grad: false,
            grad: None,
            meta: None,
        }))
    }
    // Wrap an existing device buffer as a tensor (the buffer may be a
    // shared alias; its Rc keeps it alive exactly as long as needed).
    pub fn gpu_new(buf: Rc<VgpuBuffer>, shape: Vec<usize>) -> TensorRef {
        let strides = VexTensor::strides_for(&shape);
        let rank = shape.len();
        let size = buf.len();
        Rc::new(RefCell::new(VexTensor {
            storage: TensorStorage::Gpu(buf),
            shape,
            strides,
            rank,
            size,
            dtype: String::from("float32"),
            contiguous: true,
            requires_grad: false,
            grad: None,
            meta: None,
        }))
    }
    pub fn is_gpu(&self) -> bool {
        matches!(self.storage, TensorStorage::Gpu(_))
    }
    pub fn device(&self) -> &'static str {
        if self.is_gpu() { "gpu" } else { "cpu" }
    }
    // CPU-side values (only valid on CPU storage; callers dispatch first).
    pub fn cpu_data(&self) -> Result<&[f32], String> {
        match &self.storage {
            TensorStorage::Cpu(v) => Ok(v),
            TensorStorage::Gpu(_) => Err(atlas_dispatch_err("a CPU-only operation")),
        }
    }
    // Device buffer handle (only valid on GPU storage; callers dispatch first).
    pub fn gpu_buf(&self) -> Result<&Rc<VgpuBuffer>, String> {
        match &self.storage {
            TensorStorage::Gpu(b) => Ok(b),
            TensorStorage::Cpu(_) => Err(atlas_dispatch_err("a GPU-only operation")),
        }
    }
    // First value of a size-1 tensor (reductions returning plain numbers).
    pub fn scalar_f32(&self) -> Result<f32, String> {
        match &self.storage {
            TensorStorage::Cpu(v) => Ok(v.first().copied().unwrap_or(0.0)),
            TensorStorage::Gpu(b) => {
                let vals = vgpu_download(b)?;
                Ok(vals.first().copied().unwrap_or(0.0))
            }
        }
    }
    // Host copy (downloads when the tensor lives on the GPU). Used by
    // formatting, JSON, and structural equality — all host reads.
    pub fn to_cpu_vec(&self) -> Result<Vec<f32>, String> {
        match &self.storage {
            TensorStorage::Cpu(v) => Ok(v.clone()),
            TensorStorage::Gpu(b) => vgpu_download(b),
        }
    }
}

fn atlas_rand_next() -> u64 {
    ATLAS_RNG.with(|s| {
        let mut state = s.borrow_mut();
        // xorshift64* (same family as the console RNG, separate stream)
        let mut x = *state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        *state = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    })
}

// Build a tensor from nested Vexel values. Rectangularity and numeric
// leaves validate here (centralized: semantic only checks the shape).
fn atlas_infer_shape(v: &VexVal, depth: usize) -> Result<Vec<usize>, String> {
    if depth > 64 {
        return Err(atlas_err("ShapeError", "Tensor is nested too deep (limit 64).".to_string()));
    }
    match v {
        VexVal::List(rc) => {
            let inner = rc.borrow();
            let mut shape = vec![inner.len()];
            if let Some(first) = inner.first() {
                let mut sub = atlas_infer_shape(first, depth + 1)?;
                shape.append(&mut sub);
            }
            Ok(shape)
        }
        VexVal::Int(_) | VexVal::Float(_) => Ok(vec![]),
        _ => Err(atlas_err("TypeError", format!("Tensor data must be numbers, got {}.", v.type_name()))),
    }
}

fn atlas_fill(v: &VexVal, shape: &[usize], depth: usize, data: &mut Vec<f32>) -> Result<(), String> {
    if depth > 64 {
        return Err(atlas_err("ShapeError", "Tensor is nested too deep (limit 64).".to_string()));
    }
    if depth == shape.len() {
        match v {
            VexVal::Int(i) => { data.push(*i as f32); Ok(()) }
            VexVal::Float(f) => { data.push(*f as f32); Ok(()) }
            _ => Err(atlas_err("TypeError", format!("Tensor data must be numbers, got {}.", v.type_name()))),
        }
    } else {
        match v {
            VexVal::List(rc) => {
                let inner = rc.borrow();
                if inner.len() != shape[depth] {
                    return Err(atlas_err("ShapeError", format!("Tensor rows have mismatched shapes (expected length {} here, got {}).", shape[depth], inner.len())));
                }
                for e in inner.iter() { atlas_fill(e, shape, depth + 1, data)?; }
                Ok(())
            }
            _ => Err(atlas_err("ShapeError", "Tensor rows have mismatched shapes.".to_string())),
        }
    }
}

pub fn vex_tensor_data(v: &VexVal) -> Result<VexVal, String> {
    let shape = atlas_infer_shape(v, 0)?;
    let mut data = Vec::new();
    atlas_fill(v, &shape, 0, &mut data)?;
    Ok(VexVal::Tensor(VexTensor::contiguous_new(data, shape)))
}

fn atlas_shape_arg(v: &VexVal, what: &str) -> Result<Vec<usize>, String> {
    match v {
        VexVal::List(rc) => {
            let inner = rc.borrow();
            let mut dims = Vec::with_capacity(inner.len());
            for e in inner.iter() {
                match e {
                    VexVal::Int(i) => {
                        if *i < 0 {
                            return Err(atlas_err("ShapeError", format!("Tensor shape needs non-negative sizes, got {}.", i)));
                        }
                        dims.push(*i as usize);
                    }
                    _ => return Err(atlas_err("ShapeError", format!("Tensor shape needs integers, got {}.", e.type_name()))),
                }
            }
            Ok(dims)
        }
        _ => Err(atlas_err("TypeError", format!("{} needs a shape list, e.g. zeros [2,3].", what))),
    }
}

pub fn vex_tensor_zeros(v: &VexVal) -> Result<VexVal, String> {
    let shape = atlas_shape_arg(v, "zeros")?;
    let n: usize = shape.iter().product();
    Ok(VexVal::Tensor(VexTensor::contiguous_new(vec![0.0f32; n], shape)))
}

pub fn vex_tensor_ones(v: &VexVal) -> Result<VexVal, String> {
    let shape = atlas_shape_arg(v, "ones")?;
    let n: usize = shape.iter().product();
    Ok(VexVal::Tensor(VexTensor::contiguous_new(vec![1.0f32; n], shape)))
}

pub fn vex_tensor_random(v: &VexVal) -> Result<VexVal, String> {
    let shape = atlas_shape_arg(v, "random tensor")?;
    let n: usize = shape.iter().product();
    let mut data = Vec::with_capacity(n);
    for _ in 0..n {
        let bits = (atlas_rand_next() >> 40) as u32;
        data.push(bits as f32 / 16777216.0);
    }
    Ok(VexVal::Tensor(VexTensor::contiguous_new(data, shape)))
}

fn atlas_scalar_value(v: &VexVal) -> Option<f32> {
    match v {
        VexVal::Int(i) => Some(*i as f32),
        VexVal::Float(f) => Some(*f as f32),
        _ => None,
    }
}

pub fn vex_tensor_arith(op: char, a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    let verb = match op { '+' => "add", '-' => "subtract", '*' => "multiply", '/' => "divide", _ => "combine" };
    let mismatch = |s1: &[usize], s2: &[usize]| {
        atlas_err("ShapeError", format!("Cannot {} tensors.\nLeft shape: {}\nRight shape: {}", verb, atlas_shape_str(s1), atlas_shape_str(s2)))
    };
    let type_msg = || {
        if op == '+' {
            atlas_err("TypeError", format!("Cannot add {} and {}.", a.type_name(), b.type_name()))
        } else {
            atlas_err("TypeError", format!("Operator '{}' requires numbers, got {} and {}.", op, a.type_name(), b.type_name()))
        }
    };
    let apply = |x: f32, y: f32| -> Result<f32, String> {
        match op {
            '+' => Ok(x + y),
            '-' => Ok(x - y),
            '*' => Ok(x * y),
            '/' => {
                if y == 0.0 { return Err(atlas_err("RuntimeError", "Division by zero.".to_string())); }
                Ok(x / y)
            }
            _ => Err(atlas_err("TypeError", format!("Unknown operator '{}'.", op))),
        }
    };
    match (a, b) {
        (VexVal::Tensor(t1), VexVal::Tensor(t2)) => {
            let b1 = t1.borrow();
            let b2 = t2.borrow();
            if b1.shape != b2.shape { return Err(mismatch(&b1.shape, &b2.shape)); }
            let res = if b1.is_gpu() || b2.is_gpu() {
                // Atlas v0.4: both operands must share the device.
                if !(b1.is_gpu() && b2.is_gpu()) {
                    return Err(atlas_device_mix(&verb, b1.device(), b2.device()));
                }
                let n = b1.size;
                let out_buf = vgpu_alloc_rc(n)?;
                vgpu_op_binary(vgpu_arith_op(op), b1.gpu_buf()?, b2.gpu_buf()?, None, &out_buf, n)?;
                VexVal::Tensor(VexTensor::gpu_new(out_buf, b1.shape.clone()))
            } else {
                let mut out = Vec::with_capacity(b1.cpu_data()?.len());
                for (x, y) in b1.cpu_data()?.iter().zip(b2.cpu_data()?.iter()) { out.push(apply(*x, *y)?); }
                VexVal::Tensor(VexTensor::contiguous_new(out, b1.shape.clone()))
            };
            drop(b1);
            drop(b2);
            atlas_track_arith(op, a, b, &res);
            Ok(res)
        }
        (VexVal::Tensor(t), v) => {
            let s = atlas_scalar_value(v).ok_or_else(type_msg)?;
            let bt = t.borrow();
            let res = if bt.is_gpu() {
                let n = bt.size;
                let out_buf = vgpu_alloc_rc(n)?;
                // side 0: tensor OP scalar (the scalar-side div0 check lives in the backend).
                vgpu_op_binary_scalar(vgpu_arith_op(op), bt.gpu_buf()?, s, 0, &out_buf, n)?;
                VexVal::Tensor(VexTensor::gpu_new(out_buf, bt.shape.clone()))
            } else {
                let mut out = Vec::with_capacity(bt.cpu_data()?.len());
                for x in bt.cpu_data()?.iter() { out.push(apply(*x, s)?); }
                VexVal::Tensor(VexTensor::contiguous_new(out, bt.shape.clone()))
            };
            drop(bt);
            atlas_track_arith(op, a, b, &res);
            Ok(res)
        }
        (v, VexVal::Tensor(t)) => {
            let s = atlas_scalar_value(v).ok_or_else(type_msg)?;
            let bt = t.borrow();
            let res = if bt.is_gpu() {
                let n = bt.size;
                let out_buf = vgpu_alloc_rc(n)?;
                // side 1: scalar OP tensor.
                vgpu_op_binary_scalar(vgpu_arith_op(op), bt.gpu_buf()?, s, 1, &out_buf, n)?;
                VexVal::Tensor(VexTensor::gpu_new(out_buf, bt.shape.clone()))
            } else {
                let mut out = Vec::with_capacity(bt.cpu_data()?.len());
                for y in bt.cpu_data()?.iter() { out.push(apply(s, *y)?); }
                VexVal::Tensor(VexTensor::contiguous_new(out, bt.shape.clone()))
            };
            drop(bt);
            atlas_track_arith(op, a, b, &res);
            Ok(res)
        }
        _ => Err(type_msg()),
    }
}

pub fn vex_tensor_matmul(a: &VexVal, b: &VexVal) -> Result<VexVal, String> {
    match (a, b) {
        (VexVal::Tensor(t1), VexVal::Tensor(t2)) => {
            let b1 = t1.borrow();
            let b2 = t2.borrow();
            if b1.shape.len() != 2 || b2.shape.len() != 2 {
                return Err(atlas_err("ShapeError", format!("Matrix multiplication needs 2D tensors.\nLeft shape: {}\nRight shape: {}.", atlas_shape_str(&b1.shape), atlas_shape_str(&b2.shape))));
            }
            let (m, k1) = (b1.shape[0], b1.shape[1]);
            let (k2, n) = (b2.shape[0], b2.shape[1]);
            if k1 != k2 {
                return Err(atlas_err("ShapeError", format!("Matrix shapes do not align: {} and {}. Inner sizes {} and {} must match.", atlas_shape_str(&b1.shape), atlas_shape_str(&b2.shape), k1, k2)));
            }
            let res = if b1.is_gpu() || b2.is_gpu() {
                if !(b1.is_gpu() && b2.is_gpu()) {
                    return Err(atlas_device_mix("matrix-multiply", b1.device(), b2.device()));
                }
                if m > u32::MAX as usize || k1 > u32::MAX as usize || n > u32::MAX as usize {
                    return Err(atlas_err("DeviceError", "Matrix dimensions exceed the GPU's index limits.".to_string()));
                }
                let out_buf = vgpu_alloc_rc(m * n)?;
                vgpu_op_matmul(b1.gpu_buf()?, b2.gpu_buf()?, &out_buf, m as u32, k1 as u32, n as u32, 0, 0)?;
                VexVal::Tensor(VexTensor::gpu_new(out_buf, vec![m, n]))
            } else {
                let ad = b1.cpu_data()?;
                let bd = b2.cpu_data()?;
                let mut out = vec![0.0f32; m * n];
                for i in 0..m {
                    for k in 0..k1 {
                        let aik = ad[i * k1 + k];
                        for j in 0..n {
                            out[i * n + j] += aik * bd[k * n + j];
                        }
                    }
                }
                VexVal::Tensor(VexTensor::contiguous_new(out, vec![m, n]))
            };
            drop(b1);
            drop(b2);
            atlas_track(&res, AtlasBackwardOp::Matmul, vec![atlas_grad_slot(a), atlas_grad_slot(b)]);
            Ok(res)
        }
        _ => Err(atlas_err("TypeError", format!("Operator '@' needs tensors, got {} and {}. Use * for ordinary multiplication.", a.type_name(), b.type_name()))),
    }
}



pub fn vex_tensor_reshape(t: &VexVal, shape_v: &VexVal) -> Result<VexVal, String> {
    let src = match t {
        VexVal::Tensor(x) => x.clone(),
        _ => return Err(atlas_err("TypeError", format!("Only a tensor takes reshape, got {}.", t.type_name()))),
    };
    // A single integer means one dimension (x.reshape n).
    let shape = match shape_v {
        VexVal::Int(i) => {
            if *i < 0 {
                return Err(atlas_err("ShapeError", format!("Tensor shape needs non-negative sizes, got {}.", i)));
            }
            vec![*i as usize]
        }
        _ => atlas_shape_arg(shape_v, "reshape")?,
    };
    let res = {
        let base = src.borrow();
        let want: usize = shape.iter().product();
        if want != base.size {
            return Err(atlas_err("ShapeError", format!("Cannot reshape {} elements into shape {}.", base.size, atlas_shape_str(&shape))));
        }
        match &base.storage {
            TensorStorage::Cpu(v) => VexVal::Tensor(VexTensor::contiguous_new(v.clone(), shape)),
            // GPU: reshape is a metadata-only view over the same buffer.
            TensorStorage::Gpu(b) => VexVal::Tensor(VexTensor::gpu_new(b.clone(), shape)),
        }
    };
    atlas_track(&res, AtlasBackwardOp::Reshape, vec![atlas_grad_slot(t)]);
    Ok(res)
}

pub fn vex_tensor_index(v: &VexVal, idx: &VexVal) -> Result<VexVal, String> {
    let t = match v {
        VexVal::Tensor(x) => x,
        _ => return Err(atlas_err("TypeError", format!("Only a tensor takes indexing here, got {}.", v.type_name()))),
    };
    // Atlas v0.4: indexing reads values, so a GPU tensor is read through
    // a host copy; the result returns to the source tensor's device.
    let host = {
        let b = t.borrow();
        if b.is_gpu() { Some((b.to_cpu_vec()?, b.shape.clone())) } else { None }
    };
    if let Some((data, shape)) = host {
        let tmp = VexTensor::contiguous_new(data, shape);
        let res = vex_tensor_index_inner(&tmp.borrow(), idx)?;
        if let VexVal::Tensor(rt) = &res {
            if rt.borrow().size > 0 {
                move_tensor(rt, "gpu")?;
            }
        }
        return Ok(res);
    }
    vex_tensor_index_inner(&t.borrow(), idx)
}

fn vex_tensor_index_inner(t: &VexTensor, idx: &VexVal) -> Result<VexVal, String> {
    let i = idx.as_int().map_err(|_| atlas_err("TypeError", format!("Tensor index must be an integer, got {}.", idx.type_name())))?;
    if t.shape.is_empty() {
        return Err(atlas_err("IndexError", "Cannot index a scalar tensor.".to_string()));
    }
    let dim = t.shape[0] as i64;
    if i < 0 || i >= dim {
        return Err(atlas_err("IndexError", format!("Tensor index out of bounds: {} (size {}).", i, dim)));
    }
    let data = t.cpu_data()?;
    if t.shape.len() == 1 {
        return Ok(VexVal::Float(data[i as usize] as f64));
    }
    let sub: Vec<usize> = t.shape[1..].to_vec();
    let stride: usize = sub.iter().product();
    let start = i as usize * stride;
    Ok(VexVal::Tensor(VexTensor::contiguous_new(data[start..start + stride].to_vec(), sub)))
}

pub fn vex_tensor_get(v: &VexVal, field: &str) -> Result<VexVal, String> {
    let t = match v {
        VexVal::Tensor(x) => x,
        _ => return Err(atlas_err("TypeError", format!("Only a tensor takes .{}, got {}.", field, v.type_name()))),
    };
    vex_tensor_get_inner(t, field)
}

fn vex_tensor_get_inner(t: &TensorRef, field: &str) -> Result<VexVal, String> {
    match field {
        "shape" => {
            let b = t.borrow();
            let dims: Vec<f32> = b.shape.iter().map(|d| *d as f32).collect();
            let n = b.shape.len();
            drop(b);
            Ok(VexVal::Tensor(VexTensor::contiguous_new(dims, vec![n])))
        }
        "rank" => Ok(VexVal::Int(t.borrow().rank() as i64)),
        "size" => Ok(VexVal::Int(t.borrow().size() as i64)),
        "dtype" => Ok(VexVal::Str(t.borrow().dtype.clone())),
        "device" => Ok(VexVal::Str(t.borrow().device().to_string())),
        "transpose" => {
            let res = {
                let b = t.borrow();
                if b.is_gpu() {
                    if b.rank <= 1 {
                        // Rank 0/1 transposes are the identity: alias the buffer.
                        VexVal::Tensor(VexTensor::gpu_new(b.gpu_buf()?.clone(), b.shape.clone()))
                    } else {
                        let out_buf = vgpu_alloc_rc(b.size)?;
                        vgpu_op_transpose(b.gpu_buf()?, &out_buf, &b.shape)?;
                        let new_shape: Vec<usize> = b.shape.iter().rev().cloned().collect();
                        VexVal::Tensor(VexTensor::gpu_new(out_buf, new_shape))
                    }
                } else {
                    let (d, s) = atlas_transpose_raw(b.cpu_data()?, &b.shape);
                    VexVal::Tensor(VexTensor::contiguous_new(d, s))
                }
            };
            atlas_track(&res, AtlasBackwardOp::Transpose, vec![GradInput { tensor: Some(t.clone()), requires: false, scalar: None }]);
            Ok(res)
        }
        "flatten" => {
            let res = {
                let b = t.borrow();
                match &b.storage {
                    TensorStorage::Cpu(v) => VexVal::Tensor(VexTensor::contiguous_new(v.clone(), vec![b.size])),
                    // GPU: flatten is a metadata-only view over the same buffer.
                    TensorStorage::Gpu(buf) => VexVal::Tensor(VexTensor::gpu_new(buf.clone(), vec![b.size])),
                }
            };
            atlas_track(&res, AtlasBackwardOp::Flatten, vec![GradInput { tensor: Some(t.clone()), requires: false, scalar: None }]);
            Ok(res)
        }
        "sum" => {
            let res = {
                let b = t.borrow();
                if b.size == 0 {
                    return Err(atlas_err("ShapeError", "Cannot compute sum of an empty tensor.".to_string()));
                }
                if b.is_gpu() {
                    let out_buf = vgpu_alloc_rc(1)?;
                    vgpu_op_reduce(VGPU_RED_SUM, b.gpu_buf()?, &out_buf, b.size, 1.0)?;
                    VexVal::Tensor(VexTensor::gpu_new(out_buf, vec![]))
                } else {
                    let v = b.cpu_data()?.iter().fold(0.0f32, |a, x| a + x);
                    VexVal::Tensor(VexTensor::contiguous_new(vec![v], vec![]))
                }
            };
            atlas_track(&res, AtlasBackwardOp::Sum, vec![GradInput { tensor: Some(t.clone()), requires: false, scalar: None }]);
            // Dual behavior: plain number unless tracked (keeps v0.1 code working).
            let tracked = res_requires_grad(&res);
            if tracked {
                Ok(res)
            } else {
                match res {
                    VexVal::Tensor(x) => Ok(VexVal::Float(x.borrow().scalar_f32()? as f64)),
                    _ => Ok(VexVal::Null),
                }
            }
        }
        "mean" => {
            let res = {
                let b = t.borrow();
                if b.size == 0 {
                    return Err(atlas_err("ShapeError", "Cannot compute mean of an empty tensor.".to_string()));
                }
                if b.is_gpu() {
                    let out_buf = vgpu_alloc_rc(1)?;
                    vgpu_op_reduce(VGPU_RED_MEAN, b.gpu_buf()?, &out_buf, b.size, 1.0 / b.size as f32)?;
                    VexVal::Tensor(VexTensor::gpu_new(out_buf, vec![]))
                } else {
                    let d = b.cpu_data()?;
                    let v = d.iter().fold(0.0f32, |a, x| a + x) / d.len() as f32;
                    VexVal::Tensor(VexTensor::contiguous_new(vec![v], vec![]))
                }
            };
            atlas_track(&res, AtlasBackwardOp::Mean, vec![GradInput { tensor: Some(t.clone()), requires: false, scalar: None }]);
            let tracked = res_requires_grad(&res);
            if tracked {
                Ok(res)
            } else {
                match res {
                    VexVal::Tensor(x) => Ok(VexVal::Float(x.borrow().scalar_f32()? as f64)),
                    _ => Ok(VexVal::Null),
                }
            }
        }
        // v0.2: max/min observe values but never track (no backward rule).
        "max" => {
            let b = t.borrow();
            if b.size == 0 {
                return Err(atlas_err("ShapeError", "Cannot compute max of an empty tensor.".to_string()));
            }
            if b.is_gpu() {
                let out_buf = vgpu_alloc_rc(1)?;
                vgpu_op_reduce(VGPU_RED_MAX, b.gpu_buf()?, &out_buf, b.size, 1.0)?;
                let vals = vgpu_download(&out_buf)?;
                Ok(VexVal::Float(vals.first().copied().unwrap_or(0.0) as f64))
            } else {
                Ok(VexVal::Float(b.cpu_data()?.iter().fold(f32::NEG_INFINITY, |a, x| a.max(*x)) as f64))
            }
        }
        "min" => {
            let b = t.borrow();
            if b.size == 0 {
                return Err(atlas_err("ShapeError", "Cannot compute min of an empty tensor.".to_string()));
            }
            if b.is_gpu() {
                let out_buf = vgpu_alloc_rc(1)?;
                vgpu_op_reduce(VGPU_RED_MIN, b.gpu_buf()?, &out_buf, b.size, 1.0)?;
                let vals = vgpu_download(&out_buf)?;
                Ok(VexVal::Float(vals.first().copied().unwrap_or(f32::INFINITY) as f64))
            } else {
                Ok(VexVal::Float(b.cpu_data()?.iter().fold(f32::INFINITY, |a, x| a.min(*x)) as f64))
            }
        }
        // v0.2 autograd members.
        "grad" => match &t.borrow().grad {
            Some(g) => Ok(VexVal::Tensor(g.clone())),
            None => Ok(VexVal::Null),
        },
        "backward" => vex_tensor_backward_value(t),
        "zero_grad" => {
            t.borrow_mut().grad = None;
            Ok(VexVal::Null)
        }
        "detach" => {
            let res = {
                let b = t.borrow();
                match &b.storage {
                    TensorStorage::Cpu(v) => VexVal::Tensor(VexTensor::contiguous_new(v.clone(), b.shape.clone())),
                    // GPU: detach shares the buffer (values are immutable; only the graph is cut).
                    TensorStorage::Gpu(buf) => VexVal::Tensor(VexTensor::gpu_new(buf.clone(), b.shape.clone())),
                }
            };
            Ok(res)
        }
        _ => Err(atlas_err("TypeError", format!("Tensor has no '{}'. Available: shape, rank, size, dtype, device, transpose, reshape, flatten, sum, mean, max, min, grad, backward, zero_grad, detach.", field))),
    }
}

fn res_requires_grad(v: &VexVal) -> bool {
    match v {
        VexVal::Tensor(t) => t.borrow().requires_grad,
        _ => false,
    }
}

fn vex_tensor_backward_value(t: &TensorRef) -> Result<VexVal, String> {
    // Route through the value-level entry so validation stays in one place.
    let v = VexVal::Tensor(t.clone());
    vex_tensor_backward(&v)
}

fn atlas_fmt_elem(f: f32) -> String {
    if !f.is_finite() {
        return format!("{}", f);
    }
    if f.fract() == 0.0 && f.abs() < 1e15 {
        return format!("{}", f as i64);
    }
    format!("{}", f)
}

fn atlas_fmt_nested(data: &[f32], shape: &[usize]) -> String {
    if shape.is_empty() {
        if data.is_empty() { return "[]".to_string(); }
        return atlas_fmt_elem(data[0]);
    }
    if shape.len() == 1 && shape[0] == 0 {
        return "[]".to_string();
    }
    let mut stride = 1usize;
    for d in shape.iter().skip(1) { stride = stride.saturating_mul(*d); }
    let mut parts = Vec::with_capacity(shape[0]);
    for i in 0..shape[0] {
        parts.push(atlas_fmt_nested(&data[i * stride..(i + 1) * stride], &shape[1..]));
    }
    format!("[{}]", parts.join(","))
}

pub fn atlas_format_tensor(t: &VexTensor) -> String {
    // Host read: GPU tensors download here (printing is a host-visible op).
    match t.to_cpu_vec() {
        Ok(d) => atlas_fmt_nested(&d, &t.shape),
        Err(e) => e,
    }
}

// ===== Atlas v0.2 autograd: reverse-mode differentiation =====
// Graphs live on the tensors themselves (shared Rc handles). Forward
// ops snapshot operand identity + flags; backward walks in reverse
// topological order, accumulating into requires_grad inputs. Tensors
// are never mutated in place by ops, so shared inputs are always
// valid snapshots of forward values.

fn atlas_grad_slot(v: &VexVal) -> GradInput {
    match v {
        VexVal::Tensor(t) => GradInput { tensor: Some(t.clone()), requires: false, scalar: None },
        VexVal::Int(i) => GradInput { tensor: None, requires: false, scalar: Some(*i as f32) },
        VexVal::Float(f) => GradInput { tensor: None, requires: false, scalar: Some(*f as f32) },
        _ => GradInput { tensor: None, requires: false, scalar: None },
    }
}

// ===== Atlas v0.5: inference mode =====
// A depth counter for guarded scopes (`with inference { ... }` and
// eval-mode forward): while any guard is alive, atlas_track skips graph
// construction entirely, so no op records gradients. RAII: the guard
// decrements on drop even if the scope errors.
thread_local! {
    static ATLAS_INFER_DEPTH: std::cell::Cell<u32> = std::cell::Cell::new(0);
}

fn vex_inference_active() -> bool {
    ATLAS_INFER_DEPTH.with(|d| d.get() > 0)
}

pub struct VexInferenceGuard;

impl Drop for VexInferenceGuard {
    fn drop(&mut self) {
        ATLAS_INFER_DEPTH.with(|d| d.set(d.get().saturating_sub(1)));
    }
}

pub fn vex_inference_guard() -> VexInferenceGuard {
    ATLAS_INFER_DEPTH.with(|d| d.set(d.get().saturating_add(1)));
    VexInferenceGuard
}

fn atlas_track(out: &VexVal, op: AtlasBackwardOp, mut inputs: Vec<GradInput>) {
    if vex_inference_active() {
        return;
    }
    let rc = match out {
        VexVal::Tensor(x) => x.clone(),
        _ => return,
    };
    let mut any = false;
    for g in inputs.iter_mut() {
        g.requires = match &g.tensor {
            Some(t) => t.borrow().requires_grad,
            None => false,
        };
        if g.requires {
            any = true;
        }
    }
    if !any {
        return;
    }
    let mut o = rc.borrow_mut();
    o.requires_grad = true;
    o.meta = Some(AutogradMeta { op, inputs });
}

fn atlas_track_arith(op: char, a: &VexVal, b: &VexVal, out: &VexVal) {
    let bop = match op {
        '+' => AtlasBackwardOp::Add,
        '-' => AtlasBackwardOp::Sub,
        '*' => AtlasBackwardOp::Mul,
        '/' => AtlasBackwardOp::Div,
        _ => return,
    };
    atlas_track(out, bop, vec![atlas_grad_slot(a), atlas_grad_slot(b)]);
}

// A gradient contribution: host values (CPU path) or a device buffer
// (GPU path). Backward dispatches on this, and the whole graph must
// agree on one device (checked per node).
enum AtlasGradVal {
    Cpu(Vec<f32>),
    Gpu(Rc<VgpuBuffer>, usize),
}

// Accumulate `g` into `target.grad`, creating the gradient tensor on
// the target's device. Length mismatches skip silently (v0.2 parity:
// only compatible gradients combine).
fn atlas_accum_grad(target: &TensorRef, g: AtlasGradVal) -> Result<(), String> {
    let (want, shape, on_gpu) = {
        let tb = target.borrow();
        (tb.size, tb.shape.clone(), tb.is_gpu())
    };
    let g_len = match &g {
        AtlasGradVal::Cpu(v) => v.len(),
        AtlasGradVal::Gpu(_, n) => *n,
    };
    if g_len != want {
        return Ok(());
    }
    if !on_gpu {
        // CPU target: values on the host (uploads a GPU-sourced gradient).
        let vals = match g {
            AtlasGradVal::Cpu(v) => v,
            AtlasGradVal::Gpu(b, _) => vgpu_download(&b)?,
        };
        let mut t = target.borrow_mut();
        let existing = t.grad.clone();
        match existing {
            Some(existing) => {
                let mut eb = existing.borrow_mut();
                match &mut eb.storage {
                    TensorStorage::Cpu(ed) => {
                        if ed.len() == vals.len() {
                            for (a, b) in ed.iter_mut().zip(vals.iter()) {
                                *a += *b;
                            }
                        }
                    }
                    TensorStorage::Gpu(_) => {
                        return Err(atlas_err("DeviceError", "Backward graph mixes devices: a CPU tensor has a GPU gradient.".to_string()));
                    }
                }
            }
            None => {
                t.grad = Some(VexTensor::contiguous_new(vals, shape));
            }
        }
        Ok(())
    } else {
        // GPU target: keep the gradient on the device (uploads a
        // host-sourced seed).
        let gbuf = match g {
            AtlasGradVal::Gpu(b, _) => b,
            AtlasGradVal::Cpu(v) => vgpu_upload(&v)?,
        };
        let mut t = target.borrow_mut();
        let existing = t.grad.clone();
        match existing {
            Some(existing) => {
                let ebuf = {
                    let eb = existing.borrow();
                    match &eb.storage {
                        TensorStorage::Gpu(b) => b.clone(),
                        TensorStorage::Cpu(_) => {
                            return Err(atlas_err("DeviceError", "Backward graph mixes devices: a GPU tensor has a CPU gradient.".to_string()));
                        }
                    }
                };
                if ebuf.len() == want {
                    vgpu_op_accum(&ebuf, &gbuf, want)?;
                }
                Ok(())
            }
            None => {
                let nb = vgpu_alloc_copy(&gbuf, want)?;
                t.grad = Some(VexTensor::gpu_new(nb, shape));
                Ok(())
            }
        }
    }
}

fn atlas_topo_sort(target: &TensorRef) -> Vec<TensorRef> {
    fn visit(node: &TensorRef, seen: &mut std::collections::HashSet<usize>, order: &mut Vec<TensorRef>) {
        let key = Rc::as_ptr(node) as usize;
        if !seen.insert(key) {
            return;
        }
        let inputs: Vec<TensorRef> = {
            let nb = node.borrow();
            match &nb.meta {
                Some(m) => m.inputs.iter().filter_map(|g| g.tensor.clone()).collect(),
                None => Vec::new(),
            }
        };
        for inp in inputs.iter() {
            visit(inp, seen, order);
        }
        order.push(node.clone());
    }
    let mut seen = std::collections::HashSet::new();
    let mut order = Vec::new();
    visit(target, &mut seen, &mut order);
    order
}

fn atlas_matmul_raw(a: &[f32], ma: usize, ka: usize, b: &[f32], kb: usize, nb: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; ma * nb];
    for i in 0..ma {
        for k in 0..ka {
            let aik = a[i * ka + k];
            for j in 0..nb {
                out[i * nb + j] += aik * b[k * nb + j];
            }
        }
    }
    let _ = kb;
    out
}

fn atlas_transpose_raw(data: &[f32], shape: &[usize]) -> (Vec<f32>, Vec<usize>) {
    let r = shape.len();
    if r <= 1 {
        return (data.to_vec(), shape.to_vec());
    }
    let new_shape: Vec<usize> = shape.iter().rev().cloned().collect();
    let old_strides = VexTensor::strides_for(shape);
    let n = data.len();
    let mut out = vec![0.0f32; n];
    let mut coord = vec![0usize; r];
    for (flat, slot) in out.iter_mut().enumerate() {
        let mut rem = flat;
        for d in (0..r).rev() {
            coord[d] = rem % new_shape[d];
            rem /= new_shape[d];
        }
        let mut old_off = 0usize;
        for d in 0..r {
            old_off += coord[d] * old_strides[r - 1 - d];
        }
        *slot = data[old_off];
    }
    (out, new_shape)
}

fn atlas_check_grad_len(what: &str, got: usize, want: usize) -> Result<(), String> {
    if got != want {
        return Err(atlas_err("ShapeError", format!("Incompatible gradient in {}: got {} values, need {}.", what, got, want)));
    }
    Ok(())
}

fn atlas_backward_rule(meta: &AutogradMeta, gout: &[f32], nshape: &[usize]) -> Result<(), String> {
    // Snapshot operand values (short borrows, released before writing).
    struct SlotVal {
        data: Vec<f32>,
        shape: Vec<usize>,
        target: Option<TensorRef>,
        requires: bool,
        scalar: Option<f32>,
    }
    let mut vals: Vec<SlotVal> = Vec::with_capacity(meta.inputs.len());
    for g in meta.inputs.iter() {
        match &g.tensor {
            Some(t) => {
                let tb = t.borrow();
                vals.push(SlotVal {
                    // The per-node device check upstream guarantees CPU storage.
                    data: tb.cpu_data()?.to_vec(),
                    shape: tb.shape.clone(),
                    target: Some(t.clone()),
                    requires: g.requires,
                    scalar: None,
                });
            }
            None => vals.push(SlotVal {
                data: Vec::new(),
                shape: Vec::new(),
                target: None,
                requires: false,
                scalar: g.scalar,
            }),
        }
    }
    let acc = |idx: usize, g: Vec<f32>| -> Result<(), String> {
        if let Some(t) = &vals[idx].target {
            if vals[idx].requires {
                atlas_check_grad_len("backward", g.len(), vals[idx].data.len())?;
                atlas_accum_grad(t, AtlasGradVal::Cpu(g))?;
            }
        }
        Ok(())
    };
    match meta.op {
        AtlasBackwardOp::Add => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    acc(i, gout.to_vec())?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Sub => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    let s: f32 = if i == 1 { -1.0 } else { 1.0 };
                    acc(i, gout.iter().map(|x| x * s).collect())?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Mul => {
            if vals.len() == 2 && vals[0].target.is_some() && vals[1].target.is_some() {
                let (a, b) = (vals[0].data.clone(), vals[1].data.clone());
                acc(0, gout.iter().zip(b.iter()).map(|(g, x)| g * x).collect())?;
                acc(1, gout.iter().zip(a.iter()).map(|(g, x)| g * x).collect())?;
            } else {
                for i in 0..vals.len() {
                    if vals[i].target.is_some() {
                        let co = if i == 0 {
                            vals.get(1).and_then(|v| v.scalar).unwrap_or(1.0)
                        } else {
                            vals.first().and_then(|v| v.scalar).unwrap_or(1.0)
                        };
                        acc(i, gout.iter().map(|g| g * co).collect())?;
                    }
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Div => {
            if vals.len() == 2 && vals[0].target.is_some() && vals[1].target.is_some() {
                let (a, b) = (vals[0].data.clone(), vals[1].data.clone());
                acc(0, gout.iter().zip(b.iter()).map(|(g, x)| g / x).collect())?;
                acc(1, gout.iter().zip(a.iter()).zip(b.iter()).map(|((g, x), y)| g * (-x / (y * y))).collect())?;
            } else {
                for i in 0..vals.len() {
                    if vals[i].target.is_some() {
                        let g: Vec<f32> = if i == 0 {
                            let s = vals.get(1).and_then(|v| v.scalar).unwrap_or(1.0);
                            gout.iter().map(|x| x / s).collect()
                        } else {
                            let s = vals.first().and_then(|v| v.scalar).unwrap_or(1.0);
                            gout.iter().zip(vals[i].data.iter()).map(|(g, x)| g * (-s / (x * x))).collect()
                        };
                        acc(i, g)?;
                    }
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Matmul => {
            if vals.len() != 2 || vals[0].target.is_none() && vals[1].target.is_none() {
                return Ok(());
            }
            let (a, sa) = (vals[0].data.clone(), vals[0].shape.clone());
            let (b, sb) = (vals[1].data.clone(), vals[1].shape.clone());
            if sa.len() != 2 || sb.len() != 2 {
                return Err(atlas_err("ShapeError", "Matrix backward needs 2D operands.".to_string()));
            }
            let (m, k) = (sa[0], sa[1]);
            let n = sb[1];
            // dX = G @ Y^T ; dY = X^T @ G
            let bt = atlas_transpose_raw(&b, &sb).0;
            let at = atlas_transpose_raw(&a, &sa).0;
            if vals[0].target.is_some() {
                acc(0, atlas_matmul_raw(gout, m, n, &bt, n, k))?;
            }
            if vals[1].target.is_some() {
                acc(1, atlas_matmul_raw(&at, k, m, gout, m, n))?;
            }
            Ok(())
        }
        AtlasBackwardOp::Sum => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    let g0 = if gout.is_empty() { 0.0 } else { gout[0] };
                    acc(i, vec![g0; vals[i].data.len()])?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Mean => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    let n = vals[i].data.len().max(1) as f32;
                    let g0 = if gout.is_empty() { 0.0 } else { gout[0] / n };
                    acc(i, vec![g0; vals[i].data.len()])?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Reshape | AtlasBackwardOp::Flatten => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    atlas_check_grad_len("backward", gout.len(), vals[i].data.len())?;
                    acc(i, gout.to_vec())?;
                }
            }
            let _ = nshape;
            Ok(())
        }
        AtlasBackwardOp::Transpose => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    let (gd, _) = atlas_transpose_raw(gout, nshape);
                    atlas_check_grad_len("backward", gd.len(), vals[i].data.len())?;
                    acc(i, gd)?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Relu => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    acc(i, gout.iter().zip(vals[i].data.iter()).map(|(g, x)| if *x > 0.0 { *g } else { 0.0 }).collect())?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Sigmoid => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    acc(i, gout.iter().zip(vals[i].data.iter()).map(|(g, x)| {
                        let y = 1.0 / (1.0 + (-*x).exp());
                        g * y * (1.0 - y)
                    }).collect())?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Tanh => {
            for i in 0..vals.len() {
                if vals[i].target.is_some() {
                    acc(i, gout.iter().zip(vals[i].data.iter()).map(|(g, x)| {
                        let y = x.tanh();
                        g * (1.0 - y * y)
                    }).collect())?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::AddBias => {
            // slot0: x [m, n] — gout passes through unchanged.
            // slot1: bias (n values, stored [1, n] or [n]) — the
            // gradient is the row-sum of gout (correct for any batch).
            if vals.len() == 2 {
                if vals[0].target.is_some() {
                    acc(0, gout.to_vec())?;
                }
                if vals[1].target.is_some() && vals[1].requires {
                    let n = vals[1].data.len();
                    if n == 0 {
                        return Ok(());
                    }
                    if gout.len() % n != 0 {
                        return Err(atlas_err("ShapeError", format!(
                            "Incompatible bias gradient in backward: {} values over a bias of {}.",
                            gout.len(), n
                        )));
                    }
                    let rows = gout.len() / n;
                    let mut sums = vec![0.0f32; n];
                    for r in 0..rows {
                        let base = r * n;
                        for c in 0..n {
                            sums[c] += gout[base + c];
                        }
                    }
                    acc(1, sums)?;
                }
            }
            Ok(())
        }
    }
}

// ===== Atlas v0.4: GPU backward rules =====
// Mirror of atlas_backward_rule for device buffers: every temp is a
// reference-counted buffer freed when the rule returns. Forward passes
// already rejected division by zero, so backward never hits it here
// (matching CPU, which never raises from backward).
fn atlas_backward_rule_gpu(meta: &AutogradMeta, gout: &Rc<VgpuBuffer>, gout_len: usize, nshape: &[usize]) -> Result<(), String> {
    struct GSlot {
        buf: Option<Rc<VgpuBuffer>>,
        shape: Vec<usize>,
        size: usize,
        target: Option<TensorRef>,
        requires: bool,
        scalar: Option<f32>,
    }
    let mut slots: Vec<GSlot> = Vec::with_capacity(meta.inputs.len());
    for g in meta.inputs.iter() {
        match &g.tensor {
            Some(t) => {
                let tb = t.borrow();
                // The per-node device check upstream guarantees GPU storage.
                slots.push(GSlot {
                    buf: Some(tb.gpu_buf()?.clone()),
                    shape: tb.shape.clone(),
                    size: tb.size,
                    target: Some(t.clone()),
                    requires: g.requires,
                    scalar: None,
                });
            }
            None => slots.push(GSlot {
                buf: None,
                shape: Vec::new(),
                size: 0,
                target: None,
                requires: false,
                scalar: g.scalar,
            }),
        }
    }
    let acc = |idx: usize, gbuf: &Rc<VgpuBuffer>, glen: usize| -> Result<(), String> {
        if let Some(t) = &slots[idx].target {
            if slots[idx].requires {
                atlas_check_grad_len("backward", glen, slots[idx].size)?;
                atlas_accum_grad(t, AtlasGradVal::Gpu(gbuf.clone(), glen))?;
            }
        }
        Ok(())
    };
    match meta.op {
        AtlasBackwardOp::Add => {
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    acc(i, gout, gout_len)?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Sub => {
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    if i == 1 {
                        let neg = vgpu_alloc_rc(gout_len)?;
                        vgpu_op_unary(VGPU_UN_NEG, gout, &neg, gout_len)?;
                        acc(i, &neg, gout_len)?;
                    } else {
                        acc(i, gout, gout_len)?;
                    }
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Mul => {
            if slots.len() == 2 && slots[0].target.is_some() && slots[1].target.is_some() {
                // dA = G * B ; dB = G * A
                let a = slots[0].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?.clone();
                let b = slots[1].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?.clone();
                let t0 = vgpu_alloc_rc(gout_len)?;
                vgpu_op_binary(VGPU_OP_MUL, gout, &b, None, &t0, gout_len)?;
                acc(0, &t0, gout_len)?;
                let t1 = vgpu_alloc_rc(gout_len)?;
                vgpu_op_binary(VGPU_OP_MUL, gout, &a, None, &t1, gout_len)?;
                acc(1, &t1, gout_len)?;
            } else {
                for i in 0..slots.len() {
                    if slots[i].target.is_some() {
                        let co = if i == 0 {
                            slots.get(1).and_then(|v| v.scalar).unwrap_or(1.0)
                        } else {
                            slots.first().and_then(|v| v.scalar).unwrap_or(1.0)
                        };
                        let t = vgpu_alloc_rc(gout_len)?;
                        vgpu_op_binary_scalar(VGPU_OP_MUL, gout, co, 0, &t, gout_len)?;
                        acc(i, &t, gout_len)?;
                    }
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Div => {
            if slots.len() == 2 && slots[0].target.is_some() && slots[1].target.is_some() {
                // dA = G / B ; dB = -G * A / B^2 (DIV_DB kernel, G in spare)
                let a = slots[0].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?.clone();
                let b = slots[1].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?.clone();
                let t0 = vgpu_alloc_rc(gout_len)?;
                vgpu_op_binary(VGPU_OP_DIV, gout, b.as_ref(), None, &t0, gout_len)?;
                acc(0, &t0, gout_len)?;
                let t1 = vgpu_alloc_rc(gout_len)?;
                vgpu_op_binary(VGPU_OP_DIV_DB, a.as_ref(), b.as_ref(), Some(gout.as_ref()), &t1, gout_len)?;
                acc(1, &t1, gout_len)?;
            } else {
                for i in 0..slots.len() {
                    if slots[i].target.is_some() {
                        if i == 0 {
                            // d/dx (x / s) = G / s
                            let s = slots.get(1).and_then(|v| v.scalar).unwrap_or(1.0);
                            let t = vgpu_alloc_rc(gout_len)?;
                            vgpu_op_binary_scalar(VGPU_OP_DIV, gout, s, 0, &t, gout_len)?;
                            acc(i, &t, gout_len)?;
                        } else {
                            // d/dx (s / x) = -G * s / x^2 (forward guaranteed x != 0)
                            let s = slots.first().and_then(|v| v.scalar).unwrap_or(1.0);
                            let x = slots[i].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?.clone();
                            let sq = vgpu_alloc_rc(gout_len)?;
                            vgpu_op_binary(VGPU_OP_MUL, x.as_ref(), x.as_ref(), None, &sq, gout_len)?;
                            let num = vgpu_alloc_rc(gout_len)?;
                            vgpu_op_binary_scalar(VGPU_OP_MUL, gout, -s, 0, &num, gout_len)?;
                            let t = vgpu_alloc_rc(gout_len)?;
                            vgpu_op_binary(VGPU_OP_DIV, num.as_ref(), sq.as_ref(), None, &t, gout_len)?;
                            acc(i, &t, gout_len)?;
                        }
                    }
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Matmul => {
            if slots.len() != 2 || (slots[0].target.is_none() && slots[1].target.is_none()) {
                return Ok(());
            }
            let (sa, sb) = (slots[0].shape.clone(), slots[1].shape.clone());
            if sa.len() != 2 || sb.len() != 2 {
                return Err(atlas_err("ShapeError", "Matrix backward needs 2D operands.".to_string()));
            }
            let (m, k) = (sa[0], sa[1]);
            let n = sb[1];
            if m > u32::MAX as usize || k > u32::MAX as usize || n > u32::MAX as usize {
                return Err(atlas_err("DeviceError", "Matrix dimensions exceed the GPU's index limits.".to_string()));
            }
            // dX = G @ Y^T ; dY = X^T @ G (CPU parity).
            if slots[0].target.is_some() {
                let out = vgpu_alloc_rc(m * k)?;
                vgpu_op_matmul(gout, slots[1].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?, &out, m as u32, n as u32, k as u32, 0, 1)?;
                acc(0, &out, m * k)?;
            }
            if slots[1].target.is_some() {
                let out = vgpu_alloc_rc(k * n)?;
                vgpu_op_matmul(slots[0].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?, gout, &out, k as u32, m as u32, n as u32, 1, 0)?;
                acc(1, &out, k * n)?;
            }
            Ok(())
        }
        AtlasBackwardOp::Sum => {
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    let t = vgpu_alloc_rc(slots[i].size)?;
                    vgpu_op_fill_scaled(gout, 1.0, &t, slots[i].size)?;
                    acc(i, &t, slots[i].size)?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Mean => {
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    let scale = 1.0 / slots[i].size.max(1) as f32;
                    let t = vgpu_alloc_rc(slots[i].size)?;
                    vgpu_op_fill_scaled(gout, scale, &t, slots[i].size)?;
                    acc(i, &t, slots[i].size)?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Reshape | AtlasBackwardOp::Flatten => {
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    acc(i, gout, gout_len)?;
                }
            }
            let _ = nshape;
            Ok(())
        }
        AtlasBackwardOp::Transpose => {
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    let t = vgpu_alloc_rc(gout_len)?;
                    if nshape.len() <= 1 {
                        vgpu_op_copy(gout, &t, gout_len)?;
                    } else {
                        vgpu_op_transpose(gout, &t, nshape)?;
                    }
                    acc(i, &t, gout_len)?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::Relu | AtlasBackwardOp::Sigmoid | AtlasBackwardOp::Tanh => {
            let uop = match meta.op {
                AtlasBackwardOp::Relu => VGPU_UN_RELU,
                AtlasBackwardOp::Sigmoid => VGPU_UN_SIGMOID,
                _ => VGPU_UN_TANH,
            };
            for i in 0..slots.len() {
                if slots[i].target.is_some() {
                    let x = slots[i].buf.as_ref().ok_or_else(|| atlas_dispatch_err("backward"))?.clone();
                    let t = vgpu_alloc_rc(slots[i].size)?;
                    vgpu_op_unary_grad(uop, x.as_ref(), gout, &t, slots[i].size)?;
                    acc(i, &t, slots[i].size)?;
                }
            }
            Ok(())
        }
        AtlasBackwardOp::AddBias => {
            // slot0: x — gout passes through unchanged.
            // slot1: bias — row-sum of gout (download, sum, re-upload).
            if slots.len() == 2 {
                if slots[0].target.is_some() {
                    acc(0, gout, gout_len)?;
                }
                if slots[1].target.is_some() && slots[1].requires {
                    let n = slots[1].size;
                    if n == 0 {
                        return Ok(());
                    }
                    if gout_len % n != 0 {
                        return Err(atlas_err("ShapeError", format!(
                            "Incompatible bias gradient in backward: {} values over a bias of {}.",
                            gout_len, n
                        )));
                    }
                    let vals = vgpu_download(gout)?;
                    let rows = gout_len / n;
                    let mut sums = vec![0.0f32; n];
                    for r in 0..rows {
                        let base = r * n;
                        for c in 0..n {
                            sums[c] += vals[base + c];
                        }
                    }
                    let buf = vgpu_upload(&sums)?;
                    acc(1, &buf, n)?;
                }
            }
            Ok(())
        }
    }
}

pub fn vex_tensor_backward(v: &VexVal) -> Result<VexVal, String> {
    let target = match v {
        VexVal::Tensor(x) => x.clone(),
        _ => return Err(atlas_err("TypeError", "backward needs a tensor loss. Reductions only track gradients when their input requires them.".to_string())),
    };
    {
        let tb = target.borrow();
        if tb.size != 1 {
            return Err(atlas_err("ShapeError", format!("backward needs a scalar tensor, got shape {}.", atlas_shape_str(&tb.shape))));
        }
        if tb.meta.is_none() {
            return Err(atlas_err("ShapeError", "Cannot backward: this tensor has no gradient graph. Build it from tensors with gradients (make x require gradients).".to_string()));
        }
    }
    // Seed with ones (accumulates across calls by design; zero_grad clears).
    {
        let n = target.borrow().size;
        atlas_accum_grad(&target, AtlasGradVal::Cpu(vec![1.0f32; n]))?;
    }
    let order = atlas_topo_sort(&target);
    for node in order.iter().rev() {
        let work = {
            let nb = node.borrow();
            let meta = match &nb.meta {
                Some(m) => m.clone(),
                None => continue,
            };
            let gout = match &nb.grad {
                Some(g) => {
                    let gb = g.borrow();
                    match &gb.storage {
                        TensorStorage::Cpu(v) => AtlasGradVal::Cpu(v.clone()),
                        TensorStorage::Gpu(b) => AtlasGradVal::Gpu(b.clone(), gb.size),
                    }
                }
                None => continue,
            };
            let nshape = nb.shape.clone();
            (meta, gout, nshape)
        };
        let (meta, gout, nshape) = work;
        // A node's incoming gradient and its operand slots must share
        // one device: moving tensors mid-graph is a user error we
        // report honestly instead of computing mixed-device results.
        let gout_gpu = matches!(gout, AtlasGradVal::Gpu(..));
        for gin in meta.inputs.iter() {
            if let Some(st) = &gin.tensor {
                if st.borrow().is_gpu() != gout_gpu {
                    return Err(atlas_err(
                        "DeviceError",
                        format!(
                            "Backward graph mixes CPU and GPU tensors (operation {:?}). Move every tensor in the graph to one device before backward.",
                            meta.op
                        ),
                    ));
                }
            }
        }
        match gout {
            AtlasGradVal::Cpu(v) => atlas_backward_rule(&meta, &v, &nshape)?,
            AtlasGradVal::Gpu(b, n) => atlas_backward_rule_gpu(&meta, &b, n, &nshape)?,
        }
    }
    // Intermediates release their grads; gradient sources keep
    // accumulating until zero_grad.
    for node in order.iter() {
        let mut nb = node.borrow_mut();
        if nb.meta.is_some() {
            nb.grad = None;
        }
    }
    Ok(VexVal::Null)
}

pub fn vex_tensor_require_grad(v: &VexVal) -> Result<(), String> {
    match v {
        VexVal::Tensor(t) => {
            t.borrow_mut().requires_grad = true;
            Ok(())
        }
        _ => Err(atlas_err("TypeError", format!("Make require gradients needs a tensor, got {}.", v.type_name()))),
    }
}

pub fn vex_tensor_relu(v: &VexVal) -> Result<VexVal, String> {
    let t = match v {
        VexVal::Tensor(x) => x.clone(),
        _ => return Err(atlas_err("TypeError", format!("relu needs a tensor, got {}.", v.type_name()))),
    };
    let res = {
        let b = t.borrow();
        if b.is_gpu() {
            let out_buf = vgpu_alloc_rc(b.size)?;
            vgpu_op_unary(VGPU_UN_RELU, b.gpu_buf()?, &out_buf, b.size)?;
            VexVal::Tensor(VexTensor::gpu_new(out_buf, b.shape.clone()))
        } else {
            let out: Vec<f32> = b.cpu_data()?.iter().map(|x| if *x > 0.0 { *x } else { 0.0 }).collect();
            VexVal::Tensor(VexTensor::contiguous_new(out, b.shape.clone()))
        }
    };
    atlas_track(&res, AtlasBackwardOp::Relu, vec![atlas_grad_slot(v)]);
    Ok(res)
}

pub fn vex_tensor_sigmoid(v: &VexVal) -> Result<VexVal, String> {
    let t = match v {
        VexVal::Tensor(x) => x.clone(),
        _ => return Err(atlas_err("TypeError", format!("sigmoid needs a tensor, got {}.", v.type_name()))),
    };
    let res = {
        let b = t.borrow();
        if b.is_gpu() {
            let out_buf = vgpu_alloc_rc(b.size)?;
            vgpu_op_unary(VGPU_UN_SIGMOID, b.gpu_buf()?, &out_buf, b.size)?;
            VexVal::Tensor(VexTensor::gpu_new(out_buf, b.shape.clone()))
        } else {
            let out: Vec<f32> = b.cpu_data()?.iter().map(|x| 1.0 / (1.0 + (-*x).exp())).collect();
            VexVal::Tensor(VexTensor::contiguous_new(out, b.shape.clone()))
        }
    };
    atlas_track(&res, AtlasBackwardOp::Sigmoid, vec![atlas_grad_slot(v)]);
    Ok(res)
}

pub fn vex_tensor_tanh(v: &VexVal) -> Result<VexVal, String> {
    let t = match v {
        VexVal::Tensor(x) => x.clone(),
        _ => return Err(atlas_err("TypeError", format!("tanh needs a tensor, got {}.", v.type_name()))),
    };
    let res = {
        let b = t.borrow();
        if b.is_gpu() {
            let out_buf = vgpu_alloc_rc(b.size)?;
            vgpu_op_unary(VGPU_UN_TANH, b.gpu_buf()?, &out_buf, b.size)?;
            VexVal::Tensor(VexTensor::gpu_new(out_buf, b.shape.clone()))
        } else {
            let out: Vec<f32> = b.cpu_data()?.iter().map(|x| x.tanh()).collect();
            VexVal::Tensor(VexTensor::contiguous_new(out, b.shape.clone()))
        }
    };
    atlas_track(&res, AtlasBackwardOp::Tanh, vec![atlas_grad_slot(v)]);
    Ok(res)
}

pub fn atlas_format_json(t: &VexTensor) -> Result<String, String> {
    let data = t.to_cpu_vec()?;
    for v in data.iter() {
        if !v.is_finite() {
            return Err(String::from("Cannot write non-finite tensor value to JSON."));
        }
    }
    Ok(atlas_fmt_nested(&data, &t.shape))
}

// ===== Atlas v0.4: device movement (`move x to gpu` / `move x to cpu`) =====
// Transfers a tensor (or every tensor inside a struct/list) between
// devices. The shared tensor is updated in place, so all aliases see
// the new device; gradients travel with their tensor. The autograd
// graph is preserved (validated at backward), so a graph whose
// tensors all move stays fully functional.

fn move_tensor(t: &TensorRef, target: &str) -> Result<(), String> {
    let want_gpu = match target {
        "gpu" => true,
        "cpu" => false,
        _ => return Err(atlas_err("TypeError", format!("move target must be 'gpu' or 'cpu', got '{}'.", target))),
    };
    let mut b = t.borrow_mut();
    let is_gpu = b.is_gpu();
    if want_gpu == is_gpu {
        return Ok(()); // already there
    }
    if want_gpu && b.size == 0 {
        return Err(atlas_err("DeviceError", "Cannot move an empty tensor to the GPU (it holds no data).".to_string()));
    }
    let grad = b.grad.clone();
    if want_gpu {
        let data = match &b.storage {
            TensorStorage::Cpu(v) => v.clone(),
            TensorStorage::Gpu(_) => return Err(atlas_dispatch_err("move to GPU")),
        };
        // The upload happens before the swap: a failed transfer (e.g.
        // out of memory) leaves the tensor exactly as it was.
        let buf = vgpu_upload(&data)?;
        b.storage = TensorStorage::Gpu(buf);
    } else {
        let buf = match &b.storage {
            TensorStorage::Gpu(bf) => bf.clone(),
            TensorStorage::Cpu(_) => return Err(atlas_dispatch_err("move to CPU")),
        };
        let vals = vgpu_download(&buf)?;
        // Dropping the old storage releases the device buffer when this
        // was the last reference (reshape/flatten aliases may still hold it).
        b.storage = TensorStorage::Cpu(vals);
    }
    drop(b);
    if let Some(g) = grad {
        move_tensor(&g, target)?;
    }
    Ok(())
}

fn move_walk(v: &VexVal, target: &str) -> Result<(), String> {
    match v {
        VexVal::Tensor(t) => move_tensor(t, target),
        VexVal::List(rc) => {
            let items: Vec<VexVal> = rc.borrow().iter().cloned().collect();
            for it in items.iter() {
                move_walk(it, target)?;
            }
            Ok(())
        }
        VexVal::Struct(rc) => {
            let fields: Vec<VexVal> = { rc.borrow().fields.values().cloned().collect() };
            for f in fields.iter() {
                move_walk(f, target)?;
            }
            Ok(())
        }
        _ => Ok(()), // nested non-tensors have no device
    }
}

// `move <expr> to gpu|cpu` — strict at the top level (moving a bare
// number with no device is a user error), tolerant inside containers
// (model fields like names and flags simply stay put).
pub fn vex_move_device(v: &VexVal, target: &str) -> Result<VexVal, String> {
    match target {
        "gpu" | "cpu" => {}
        _ => return Err(atlas_err("TypeError", format!("move target must be 'gpu' or 'cpu', got '{}'.", target))),
    }
    match v {
        VexVal::Tensor(_) | VexVal::List(_) | VexVal::Struct(_) => {
            move_walk(v, target)?;
            Ok(VexVal::Null)
        }
        _ => Err(atlas_err("TypeError", format!("move expects a tensor, struct, list, or model, got {}.", v.type_name()))),
    }
}
