// ===== Atlas v0.4: GPU device layer (lazy backend loader) =====
//
// Loads the GPU backend library (vex_gpu.dll / libvex_gpu.so) on the
// first GPU use and talks to it through a small C ABI of buffers and
// op codes. Programs that never touch the GPU never load it. Nothing
// here knows wgpu/CUDA/Vulkan: the ABI is backend-neutral, so future
// backends slot in behind the same library interface. Every failure
// comes back as a located Atlas error; division reports exactly the
// CPU's "Division by zero." RuntimeError.

// ABI result codes (mirrors gpu/src/backend.rs).
const VGPU_OK: i32 = 0;
const VGPU_DIV0: i32 = -2;
const VGPU_OOM: i32 = -3;
const VGPU_INIT: i32 = -5;

// Binary op codes (mirrors gpu/src/backend.rs).
pub const VGPU_OP_ADD: u32 = 0;
pub const VGPU_OP_SUB: u32 = 1;
pub const VGPU_OP_MUL: u32 = 2;
pub const VGPU_OP_DIV: u32 = 3;
pub const VGPU_OP_DIV_DB: u32 = 4;
// Unary forward op codes.
pub const VGPU_UN_RELU: u32 = 0;
pub const VGPU_UN_SIGMOID: u32 = 1;
pub const VGPU_UN_TANH: u32 = 2;
pub const VGPU_UN_NEG: u32 = 3;
// Reduction op codes.
pub const VGPU_RED_SUM: u32 = 0;
pub const VGPU_RED_MEAN: u32 = 1;
pub const VGPU_RED_MAX: u32 = 2;
pub const VGPU_RED_MIN: u32 = 3;

// Map a Vexel arithmetic operator onto the backend's op code.
pub fn vgpu_arith_op(op: char) -> u32 {
    match op {
        '+' => VGPU_OP_ADD,
        '-' => VGPU_OP_SUB,
        '*' => VGPU_OP_MUL,
        '/' => VGPU_OP_DIV,
        _ => VGPU_OP_ADD,
    }
}

// Map a Vexel activation onto the backend's unary op code.
pub fn vgpu_unary_op(op: char) -> u32 {
    match op {
        'r' => VGPU_UN_RELU,
        's' => VGPU_UN_SIGMOID,
        't' => VGPU_UN_TANH,
        'n' => VGPU_UN_NEG,
        _ => VGPU_UN_RELU,
    }
}

// ----- backend library loader -------------------------------------------------

struct VgpuApi {
    available: unsafe extern "C" fn() -> i32,
    count: unsafe extern "C" fn() -> i32,
    device_name: unsafe extern "C" fn(i32, *mut u8, i32) -> i32,
    last_error: unsafe extern "C" fn() -> *const u8,
    alloc: unsafe extern "C" fn(u64) -> u64,
    free: unsafe extern "C" fn(u64),
    write: unsafe extern "C" fn(u64, u64, *const f32, u64) -> i32,
    read: unsafe extern "C" fn(u64, u64, *mut f32, u64) -> i32,
    binary: unsafe extern "C" fn(u32, u64, u64, u64, u64, u64) -> i32,
    binary_scalar: unsafe extern "C" fn(u32, u64, f32, u64, u64, u32) -> i32,
    unary: unsafe extern "C" fn(u32, u64, u64, u64) -> i32,
    unary_grad: unsafe extern "C" fn(u32, u64, u64, u64, u64) -> i32,
    matmul: unsafe extern "C" fn(u64, u64, u64, u32, u32, u32, u32, u32) -> i32,
    reduce: unsafe extern "C" fn(u32, u64, u64, u64, f32) -> i32,
    transpose: unsafe extern "C" fn(u64, u64, u32, *const u32) -> i32,
    fill: unsafe extern "C" fn(u64, f32, u64) -> i32,
    fill_scaled: unsafe extern "C" fn(u64, f32, u64, u64) -> i32,
    accum: unsafe extern "C" fn(u64, u64, u64) -> i32,
    copy: unsafe extern "C" fn(u64, u64, u64) -> i32,
    sync: unsafe extern "C" fn() -> i32,
}

// OS dynamic-loader shims (kernel32 on Windows, libdl elsewhere).
#[cfg(windows)]
mod vgpu_os {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryW(lp: *const u16) -> *mut core::ffi::c_void;
        fn GetProcAddress(module: *mut core::ffi::c_void, name: *const i8) -> *mut core::ffi::c_void;
    }
    pub unsafe fn load(path: &str) -> Result<usize, String> {
        let mut wide: Vec<u16> = std::ffi::OsStr::new(path).encode_wide().collect();
        wide.push(0);
        let h = LoadLibraryW(wide.as_ptr());
        if h.is_null() {
            Err(format!("cannot load {}", path))
        } else {
            Ok(h as usize)
        }
    }
    pub unsafe fn sym(lib: usize, name: *const i8) -> *mut core::ffi::c_void {
        GetProcAddress(lib as *mut core::ffi::c_void, name)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod vgpu_os {
    #[link(name = "dl")]
    extern "C" {
        fn dlopen(path: *const i8, flags: i32) -> *mut core::ffi::c_void;
        fn dlsym(lib: *mut core::ffi::c_void, name: *const i8) -> *mut core::ffi::c_void;
    }
    pub unsafe fn load(path: &str) -> Result<usize, String> {
        let c = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
        let h = dlopen(c.as_ptr(), 1 /* RTLD_LAZY */);
        if h.is_null() {
            Err(format!("cannot load {}", path))
        } else {
            Ok(h as usize)
        }
    }
    pub unsafe fn sym(lib: usize, name: *const i8) -> *mut core::ffi::c_void {
        dlsym(lib as *mut core::ffi::c_void, name)
    }
}

#[cfg(target_os = "macos")]
mod vgpu_os {
    extern "C" {
        fn dlopen(path: *const i8, flags: i32) -> *mut core::ffi::c_void;
        fn dlsym(lib: *mut core::ffi::c_void, name: *const i8) -> *mut core::ffi::c_void;
    }
    pub unsafe fn load(path: &str) -> Result<usize, String> {
        let c = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
        let h = dlopen(c.as_ptr(), 1);
        if h.is_null() {
            Err(format!("cannot load {}", path))
        } else {
            Ok(h as usize)
        }
    }
    pub unsafe fn sym(lib: usize, name: *const i8) -> *mut core::ffi::c_void {
        dlsym(lib as *mut core::ffi::c_void, name)
    }
}

fn vgpu_lib_file() -> &'static str {
    if cfg!(windows) {
        "vex_gpu.dll"
    } else if cfg!(target_os = "macos") {
        "libvex_gpu.dylib"
    } else {
        "libvex_gpu.so"
    }
}

fn vgpu_open_lib() -> Result<usize, String> {
    let file = vgpu_lib_file();
    let mut tried: Vec<String> = Vec::new();
    // 1. Explicit override (tests, custom backends). A set override must
    //    win or fail loudly — no silent fallback to other locations.
    if let Ok(p) = std::env::var("VEXEL_GPU_BACKEND") {
        return match unsafe { vgpu_os::load(&p) } {
            Ok(h) => Ok(h),
            Err(e) => Err(format!("GPU backend '{}' could not be loaded ({}).", p, e)),
        };
    }
    // 2. Beside the executable (the Vexel build copies it there).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(file).to_string_lossy().to_string();
            match unsafe { vgpu_os::load(&p) } {
                Ok(h) => return Ok(h),
                Err(e) => tried.push(format!("{} ({})", p, e)),
            }
        }
    }
    // 3. Working directory, then the build cache.
    if let Ok(cwd) = std::env::current_dir() {
        let direct = cwd.join(file).to_string_lossy().to_string();
        match unsafe { vgpu_os::load(&direct) } {
            Ok(h) => return Ok(h),
            Err(e) => tried.push(format!("{} ({})", direct, e)),
        }
        let cached = cwd.join(".vexel-cache").join("gpu").join(file).to_string_lossy().to_string();
        match unsafe { vgpu_os::load(&cached) } {
            Ok(h) => return Ok(h),
            Err(e) => tried.push(format!("{} ({})", cached, e)),
        }
    }
    if tried.is_empty() {
        Err(format!("GPU backend '{}' was not found.", file))
    } else {
        Err(format!("GPU backend '{}' was not found (looked in: {}).", file, tried.join("; ")))
    }
}

unsafe fn vgpu_bind(lib: usize) -> Result<VgpuApi, String> {
    macro_rules! sym {
        ($name:expr) => {{
            let c = std::ffi::CString::new($name).expect("static symbol name");
            let p = vgpu_os::sym(lib, c.as_ptr()) as usize;
            if p == 0 {
                return Err(format!("GPU backend '{}' is missing symbol '{}' (a different Vexel version?).", vgpu_lib_file(), $name));
            }
            p
        }};
    }
    Ok(VgpuApi {
        available: std::mem::transmute(sym!("vex_gpu_available")),
        count: std::mem::transmute(sym!("vex_gpu_count")),
        device_name: std::mem::transmute(sym!("vex_gpu_device_name")),
        last_error: std::mem::transmute(sym!("vex_gpu_last_error")),
        alloc: std::mem::transmute(sym!("vex_gpu_alloc")),
        free: std::mem::transmute(sym!("vex_gpu_free")),
        write: std::mem::transmute(sym!("vex_gpu_write")),
        read: std::mem::transmute(sym!("vex_gpu_read")),
        binary: std::mem::transmute(sym!("vex_gpu_binary")),
        binary_scalar: std::mem::transmute(sym!("vex_gpu_binary_scalar")),
        unary: std::mem::transmute(sym!("vex_gpu_unary")),
        unary_grad: std::mem::transmute(sym!("vex_gpu_unary_grad")),
        matmul: std::mem::transmute(sym!("vex_gpu_matmul")),
        reduce: std::mem::transmute(sym!("vex_gpu_reduce")),
        transpose: std::mem::transmute(sym!("vex_gpu_transpose")),
        fill: std::mem::transmute(sym!("vex_gpu_fill")),
        fill_scaled: std::mem::transmute(sym!("vex_gpu_fill_scaled")),
        accum: std::mem::transmute(sym!("vex_gpu_accum")),
        copy: std::mem::transmute(sym!("vex_gpu_copy")),
        sync: std::mem::transmute(sym!("vex_gpu_sync")),
    })
}

// The loader runs exactly once per process; failures are sticky so a
// missing backend never turns into a retry storm.
fn vgpu_api() -> Result<&'static VgpuApi, String> {
    static API: std::sync::OnceLock<Result<VgpuApi, String>> = std::sync::OnceLock::new();
    match API.get_or_init(|| vgpu_open_lib().and_then(|lib| unsafe { vgpu_bind(lib) })) {
        Ok(api) => Ok(api),
        Err(e) => Err(e.clone()),
    }
}

fn vgpu_last(api: &VgpuApi) -> String {
    unsafe {
        let p = (api.last_error)();
        if p.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(p as *const i8).to_string_lossy().into_owned()
        }
    }
}

// Turn a backend result code + message into a located Atlas error.
// Division maps to the CPU-identical RuntimeError so programs behave
// the same on either device.
fn vgpu_code_err(api: &VgpuApi, what: &str, code: i32) -> String {
    if code == VGPU_DIV0 {
        return atlas_err("RuntimeError", "Division by zero.".to_string());
    }
    let msg = vgpu_last(api);
    match code {
        VGPU_OOM => {
            if msg.is_empty() {
                atlas_err("DeviceError", "Unable to allocate tensor on the GPU (out of memory).".to_string())
            } else if msg.to_lowercase().contains("allocate") || msg.to_lowercase().contains("memory") {
                atlas_err("DeviceError", msg)
            } else {
                atlas_err("DeviceError", format!("GPU out of memory during {}: {}", what, msg))
            }
        }
        VGPU_INIT => atlas_err(
            "DeviceError",
            format!("GPU is not available: {}", if msg.is_empty() { "the device failed to initialize.".to_string() } else { msg }),
        ),
        _ => atlas_err(
            "DeviceError",
            format!("GPU {} failed: {}", what, if msg.is_empty() { format!("error code {}", code) } else { msg }),
        ),
    }
}

// ----- availability (never raises; used by `gpu available` etc.) -------------

pub fn vgpu_available() -> bool {
    match vgpu_api() {
        Ok(api) => unsafe { (api.available)() == 1 },
        Err(_) => false,
    }
}

pub fn vgpu_count() -> i32 {
    match vgpu_api() {
        Ok(api) => {
            let n = unsafe { (api.count)() };
            if n < 0 { 0 } else { n }
        }
        Err(_) => 0,
    }
}

pub fn vgpu_name() -> String {
    match vgpu_api() {
        Ok(api) => {
            let mut buf = [0u8; 512];
            let n = unsafe { (api.device_name)(0, buf.as_mut_ptr(), buf.len() as i32) };
            if n <= 0 {
                String::new()
            } else {
                String::from_utf8_lossy(&buf[..n as usize]).into_owned()
            }
        }
        Err(_) => String::new(),
    }
}

// Why the GPU is unavailable (None when it is available). Used to
// build honest error messages for `move x to gpu` and GPU ops.
pub fn vgpu_unavailable_reason() -> Option<String> {
    match vgpu_api() {
        Ok(api) => {
            if unsafe { (api.available)() == 1 } {
                None
            } else {
                let e = vgpu_last(api);
                Some(if e.is_empty() {
                    "no supported GPU device was found on this machine.".to_string()
                } else {
                    e
                })
            }
        }
        Err(e) => Some(e),
    }
}

// Common prefix for GPU failures raised at a Vexel call site.
fn vgpu_device_down(prefix: &str) -> String {
    let why = vgpu_unavailable_reason().unwrap_or_else(|| "the device is not available.".to_string());
    atlas_err("DeviceError", format!("{} {}", prefix, why))
}

// ----- device buffers ---------------------------------------------------------

// A live device buffer. The handle is released exactly once when the
// last reference drops (aliases such as reshape views share it).
#[derive(Debug)]
pub struct VgpuBuffer {
    handle: u64,
    len: usize,
}

impl VgpuBuffer {
    pub fn handle(&self) -> u64 {
        self.handle
    }
    pub fn len(&self) -> usize {
        self.len
    }
}

impl Drop for VgpuBuffer {
    fn drop(&mut self) {
        if let Ok(api) = vgpu_api() {
            unsafe {
                (api.free)(self.handle);
            }
        }
    }
}

fn vgpu_alloc_fail(msg: &str, len: usize) -> String {
    let mb = (len as u64).saturating_mul(4).saturating_add(1048575) / 1048576;
    let lower = msg.to_lowercase();
    if msg.is_empty() {
        atlas_err("DeviceError", format!("Unable to allocate tensor.\nRequested: {} MB\nReason: GPU allocation failed.", mb))
    } else if lower.contains("unable to allocate") || lower.contains("out of memory") || lower.contains("memory allocation") {
        atlas_err("DeviceError", msg.to_string())
    } else {
        atlas_err("DeviceError", format!("GPU allocation failed: {}", msg))
    }
}

fn vgpu_alloc_raw(len: usize) -> Result<VgpuBuffer, String> {
    if len == 0 {
        return Err(atlas_err("DeviceError", "GPU backend cannot hold an empty tensor.".to_string()));
    }
    let api = match vgpu_api() {
        Ok(a) => a,
        Err(e) => return Err(atlas_err("DeviceError", e)),
    };
    let h = unsafe { (api.alloc)((len as u64).saturating_mul(4)) };
    if h == 0 {
        return Err(vgpu_alloc_fail(&vgpu_last(api), len));
    }
    Ok(VgpuBuffer { handle: h, len })
}

pub fn vgpu_alloc_rc(len: usize) -> Result<std::rc::Rc<VgpuBuffer>, String> {
    Ok(std::rc::Rc::new(vgpu_alloc_raw(len)?))
}

// Host -> device: allocates a buffer and uploads the values (queued).
pub fn vgpu_upload(data: &[f32]) -> Result<std::rc::Rc<VgpuBuffer>, String> {
    if data.is_empty() {
        return Err(atlas_err("DeviceError", "Cannot move an empty tensor to the GPU (it holds no data).".to_string()));
    }
    let api = match vgpu_api() {
        Ok(a) => a,
        Err(_) => return Err(vgpu_device_down("Cannot move a tensor to the GPU.")),
    };
    let buf = vgpu_alloc_raw(data.len())?;
    let code = unsafe { (api.write)(buf.handle(), 0, data.as_ptr(), data.len() as u64) };
    if code != VGPU_OK {
        return Err(vgpu_code_err(api, "upload", code));
    }
    Ok(std::rc::Rc::new(buf))
}

// Device -> host: synchronizes (the caller needs the values now).
pub fn vgpu_download(buf: &VgpuBuffer) -> Result<Vec<f32>, String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let mut out = vec![0.0f32; buf.len()];
    let code = unsafe { (api.read)(buf.handle(), 0, out.as_mut_ptr(), buf.len() as u64) };
    if code != VGPU_OK {
        return Err(vgpu_code_err(api, "download", code));
    }
    Ok(out)
}

// Device -> device copy into a fresh buffer (used to seed gradients).
pub fn vgpu_alloc_copy(src: &VgpuBuffer, len: usize) -> Result<std::rc::Rc<VgpuBuffer>, String> {
    if len != src.len() {
        return Err(atlas_err("DeviceError", format!("GPU copy size mismatch: source has {} values, destination needs {}.", src.len(), len)));
    }
    let out = vgpu_alloc_rc(len)?;
    vgpu_op_copy(src, &out, len)?;
    Ok(out)
}

// ----- queued ops (async; host reads and division validate sync) --------------

fn vgpu_check(api: &VgpuApi, what: &str, code: i32) -> Result<(), String> {
    if code == VGPU_OK {
        Ok(())
    } else {
        Err(vgpu_code_err(api, what, code))
    }
}

pub fn vgpu_op_binary(op: u32, a: &VgpuBuffer, b: &VgpuBuffer, spare: Option<&VgpuBuffer>, out: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let s = match spare {
        Some(x) => x.handle(),
        None => 0,
    };
    let code = unsafe { (api.binary)(op, a.handle(), b.handle(), s, out.handle(), n as u64) };
    vgpu_check(api, "element-wise op", code)
}

pub fn vgpu_op_binary_scalar(op: u32, a: &VgpuBuffer, scalar: f32, side: u32, out: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.binary_scalar)(op, a.handle(), scalar, out.handle(), n as u64, side) };
    vgpu_check(api, "element-wise op", code)
}

pub fn vgpu_op_unary(op: u32, a: &VgpuBuffer, out: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.unary)(op, a.handle(), out.handle(), n as u64) };
    vgpu_check(api, "element-wise op", code)
}

pub fn vgpu_op_unary_grad(op: u32, a: &VgpuBuffer, g: &VgpuBuffer, out: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.unary_grad)(op, a.handle(), g.handle(), out.handle(), n as u64) };
    vgpu_check(api, "gradient op", code)
}

pub fn vgpu_op_matmul(a: &VgpuBuffer, b: &VgpuBuffer, out: &VgpuBuffer, m: u32, k: u32, nn: u32, ta: u32, tb: u32) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.matmul)(a.handle(), b.handle(), out.handle(), m, k, nn, ta, tb) };
    vgpu_check(api, "matrix multiplication", code)
}

pub fn vgpu_op_reduce(op: u32, a: &VgpuBuffer, out: &VgpuBuffer, n: usize, mean_scale: f32) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.reduce)(op, a.handle(), out.handle(), n as u64, mean_scale) };
    vgpu_check(api, "reduction", code)
}

pub fn vgpu_op_transpose(a: &VgpuBuffer, out: &VgpuBuffer, shape: &[usize]) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let dims: Vec<u32> = shape.iter().map(|&d| d as u32).collect();
    let code = unsafe { (api.transpose)(a.handle(), out.handle(), dims.len() as u32, dims.as_ptr()) };
    vgpu_check(api, "transpose", code)
}

pub fn vgpu_op_fill(out: &VgpuBuffer, value: f32, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.fill)(out.handle(), value, n as u64) };
    vgpu_check(api, "fill", code)
}

pub fn vgpu_op_fill_scaled(src: &VgpuBuffer, scale: f32, out: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.fill_scaled)(src.handle(), scale, out.handle(), n as u64) };
    vgpu_check(api, "gradient fill", code)
}

pub fn vgpu_op_accum(dst: &VgpuBuffer, src: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.accum)(dst.handle(), src.handle(), n as u64) };
    vgpu_check(api, "gradient accumulation", code)
}

pub fn vgpu_op_copy(src: &VgpuBuffer, dst: &VgpuBuffer, n: usize) -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.copy)(src.handle(), dst.handle(), n as u64) };
    vgpu_check(api, "copy", code)
}

pub fn vgpu_op_sync() -> Result<(), String> {
    let api = vgpu_api().map_err(|e| atlas_err("DeviceError", e))?;
    let code = unsafe { (api.sync)() };
    vgpu_check(api, "synchronization", code)
}
