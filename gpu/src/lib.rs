// Atlas v0.4 — GPU backend C ABI (vex_gpu.dll).
//
// The Vexel runtime loads this library lazily on first GPU use and
// talks to it through plain C functions. Programs that never touch
// the GPU never load it. The ABI is backend-neutral: Atlas sees
// handles, shapes and op codes — never wgpu, CUDA, or driver types.

mod backend;
mod wgpu_backend;

use backend::*;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;
use wgpu_backend::WgpuBackend;

enum GpuState {
    Uninit,
    Ready(Box<dyn GpuBackend>),
    Unavailable,
}

static STATE: Mutex<GpuState> = Mutex::new(GpuState::Uninit);
static LAST_ERROR: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn set_err(msg: &str) {
    if let Ok(mut g) = LAST_ERROR.lock() {
        let mut v = msg.as_bytes().to_vec();
        v.push(0);
        *g = v;
    }
}

fn panic_message(p: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown GPU backend panic".to_string()
    }
}

fn code_for(msg: &str) -> i32 {
    if msg == "-2" {
        ERR_DIV0
    } else if msg.starts_with("Unable to allocate") {
        ERR_OOM
    } else if msg.contains("invalid GPU buffer handle") {
        ERR_HANDLE
    } else if msg.contains("synchronization") {
        ERR_KERNEL
    } else {
        ERR_GENERIC
    }
}

/// Run `f` against the live backend, initializing on first use.
/// Never unwinds across the FFI boundary.
fn with_backend(f: impl FnOnce(&mut dyn GpuBackend) -> i32) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut guard = match STATE.lock() {
            Ok(g) => g,
            Err(_) => {
                set_err("GPU backend state is locked by a failed initialization.");
                return ERR_INIT;
            }
        };
        match &mut *guard {
            GpuState::Unavailable => {
                if LAST_ERROR.lock().map(|g| g.is_empty()).unwrap_or(true) {
                    set_err("GPU unavailable: no supported GPU backend could be initialized on this machine.");
                }
                ERR_INIT
            }
            GpuState::Uninit => match WgpuBackend::init() {
                Ok(b) => {
                    *guard = GpuState::Ready(Box::new(b));
                    match &mut *guard {
                        GpuState::Ready(inner) => f(inner.as_mut()),
                        _ => ERR_INIT,
                    }
                }
                Err(e) => {
                    set_err(&e);
                    *guard = GpuState::Unavailable;
                    ERR_INIT
                }
            },
            GpuState::Ready(inner) => f(inner.as_mut()),
        }
    }));
    match result {
        Ok(code) => code,
        Err(p) => {
            set_err(&format!("GPU backend failure: {}", panic_message(p)));
            ERR_KERNEL
        }
    }
}

fn copy_name(name: &str, buf: *mut u8, len: i32) -> i32 {
    if buf.is_null() || len <= 0 {
        return -1;
    }
    let bytes = name.as_bytes();
    let room = (len - 1).max(0) as usize;
    let n = bytes.len().min(room);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf, n);
        *buf.add(n) = 0;
    }
    n as i32
}

/// 1 when a real GPU backend initialized with at least one device.
#[no_mangle]
pub extern "C" fn vex_gpu_available() -> i32 {
    with_backend(|b| if b.device_count() > 0 { 1 } else { 0 })
}

#[no_mangle]
pub extern "C" fn vex_gpu_count() -> i32 {
    with_backend(|b| b.device_count() as i32)
}

#[no_mangle]
pub extern "C" fn vex_gpu_device_name(idx: i32, buf: *mut u8, len: i32) -> i32 {
    let mut out = -1;
    let code = with_backend(|b| {
        let name = b.device_name(idx.max(0) as usize);
        out = copy_name(&name, buf, len);
        ERR_OK
    });
    if code != ERR_OK { code } else { out }
}

/// Internal diagnostics (which backend is active). Not exposed to Vexel.
#[no_mangle]
pub extern "C" fn vex_gpu_backend_name(buf: *mut u8, len: i32) -> i32 {
    let mut out = -1;
    let code = with_backend(|b| {
        out = copy_name(b.backend_name(), buf, len);
        ERR_OK
    });
    if code != ERR_OK { code } else { out }
}

/// NUL-terminated message for the most recent failure.
#[no_mangle]
pub extern "C" fn vex_gpu_last_error() -> *const u8 {
    match LAST_ERROR.lock() {
        Ok(g) => {
            if g.is_empty() {
                static EMPTY: [u8; 1] = [0];
                EMPTY.as_ptr()
            } else {
                g.as_ptr()
            }
        }
        Err(_) => {
            static EMPTY: [u8; 1] = [0];
            EMPTY.as_ptr()
        }
    }
}

#[no_mangle]
pub extern "C" fn vex_gpu_alloc(nbytes: u64) -> u64 {
    let mut handle = 0u64;
    let code = with_backend(|b| match b.alloc(nbytes) {
        Ok(h) => {
            handle = h;
            ERR_OK
        }
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    });
    if code != ERR_OK {
        0
    } else {
        handle
    }
}

#[no_mangle]
pub extern "C" fn vex_gpu_free(handle: u64) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _ = with_backend(|b| {
            b.free(handle);
            ERR_OK
        });
    }));
}

#[no_mangle]
pub extern "C" fn vex_gpu_write(handle: u64, elem_offset: u64, src: *const f32, n: u64) -> i32 {
    if src.is_null() {
        return ERR_INVALID;
    }
    let slice = unsafe { std::slice::from_raw_parts(src, n as usize) };
    with_backend(|b| match b.write_f32(handle, elem_offset * 4, slice) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_read(handle: u64, elem_offset: u64, dst: *mut f32, n: u64) -> i32 {
    if dst.is_null() {
        return ERR_INVALID;
    }
    let slice = unsafe { std::slice::from_raw_parts_mut(dst, n as usize) };
    with_backend(|b| match b.read_f32(handle, elem_offset * 4, slice) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_binary(op: u32, a: u64, b: u64, spare: u64, out: u64, n: u64) -> i32 {
    with_backend(|be| match be.binary(op, a, b, spare, out, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            let c = code_for(&e);
            set_err(&if e == "-2" { "Division by zero.".to_string() } else { e });
            c
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_binary_scalar(op: u32, a: u64, scalar: f32, out: u64, n: u64, side: u32) -> i32 {
    with_backend(|be| match be.binary_scalar(op, a, scalar, out, n, side) {
        Ok(()) => ERR_OK,
        Err(e) => {
            let c = code_for(&e);
            set_err(&if e == "-2" { "Division by zero.".to_string() } else { e });
            c
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_unary(op: u32, a: u64, out: u64, n: u64) -> i32 {
    with_backend(|be| match be.unary(op, a, out, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_unary_grad(op: u32, a: u64, g: u64, out: u64, n: u64) -> i32 {
    with_backend(|be| match be.unary_grad(op, a, g, out, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_matmul(a: u64, b: u64, out: u64, m: u32, k: u32, nn: u32, ta: u32, tb: u32) -> i32 {
    with_backend(|be| match be.matmul(a, b, out, m, k, nn, ta, tb) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_reduce(op: u32, a: u64, out: u64, n: u64, mean_scale: f32) -> i32 {
    with_backend(|be| match be.reduce(op, a, out, n, mean_scale) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_transpose(a: u64, out: u64, rank: u32, shape: *const u32) -> i32 {
    if shape.is_null() || rank == 0 || rank > 64 {
        return ERR_INVALID;
    }
    let slice = unsafe { std::slice::from_raw_parts(shape, rank as usize) };
    with_backend(|be| match be.transpose(a, out, slice) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_fill(out: u64, value: f32, n: u64) -> i32 {
    with_backend(|be| match be.fill(out, value, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_fill_scaled(src: u64, scale: f32, out: u64, n: u64) -> i32 {
    with_backend(|be| match be.fill_scaled(src, scale, out, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_accum(dst: u64, src: u64, n: u64) -> i32 {
    with_backend(|be| match be.accum(dst, src, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_copy(src: u64, dst: u64, n: u64) -> i32 {
    with_backend(|be| match be.copy(src, dst, n) {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}

#[no_mangle]
pub extern "C" fn vex_gpu_sync() -> i32 {
    with_backend(|be| match be.sync() {
        Ok(()) => ERR_OK,
        Err(e) => {
            set_err(&e);
            code_for(&e)
        }
    })
}
