// Atlas v0.4 — wgpu GPU backend (first real Backend implementation).
//
// Executes Atlas operations on the machine's actual GPU through wgpu
// (Vulkan on this machine; DX12/Metal where wgpu finds them). Nothing
// here is simulated: buffers are device allocations, kernels are WGSL
// compute shaders, and results come back from the GPU.
//
// Synchronization model: every op is encoded and submitted to the
// single ordered queue without waiting. Host reads synchronize (the
// caller needs bytes), and division validation synchronizes so GPU
// programs raise the same "Division by zero." error as CPU programs.
// Everything else stays queued (Atlas v0.4 spec: async execution).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::backend::*;

pub struct WgpuBackend {
    _instance: wgpu::Instance,
    adapter_names: Vec<String>,
    adapter_backend: String,
    device: wgpu::Device,
    queue: wgpu::Queue,
    max_buffer: u64,

    next_handle: u64,
    buffers: HashMap<u64, wgpu::Buffer>,
    /// Idle buffers reusable for any request they can fit (queue is a
    /// single total order, so reuse is always safe relative to work
    /// already submitted).
    pool: Vec<(wgpu::Buffer, u64)>,

    layout: wgpu::BindGroupLayout,
    pipelines: HashMap<&'static str, wgpu::ComputePipeline>,
    params: wgpu::Buffer,
    dummy_ro: wgpu::Buffer,
    dummy_rw: wgpu::Buffer,
    flag: wgpu::Buffer,
    flag_stage: wgpu::Buffer,

    uncaptured: Arc<Mutex<String>>,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
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
}

impl Params {
    fn new() -> Self {
        Params {
            op: 0, n: 0, m: 0, k: 0, nn: 0, ta: 0, tb: 0, rank: 0,
            final_pass: 0, side: 0, scale: 1.0, scalar: 0.0,
            pad0: 0, pad1: 0, pad2: 0, pad3: 0,
        }
    }
}

const ENTRIES: &[&str] = &[
    "binary_main",
    "binary_scalar_main",
    "unary_main",
    "unary_grad_main",
    "matmul_main",
    "reduce_main",
    "transpose_main",
    "fill_main",
    "fill_scaled_main",
    "accum_main",
    "copy_main",
];

const WG_ELEM: u32 = 64;
const WG_TILE: u32 = 16;
const WG_RED: u32 = 256;
const RED_CHUNK: u64 = (WG_RED as u64) * 8; // elements handled per workgroup

fn u32_groups(n: u64, wg: u64) -> Result<u32, String> {
    let g = n.div_ceil(wg);
    if g == 0 { return Ok(1); }
    if g > u32::MAX as u64 {
        return Err(format!("tensor too large for one GPU dispatch ({n} elements)"));
    }
    Ok(g as u32)
}

impl WgpuBackend {
    pub fn init() -> Result<WgpuBackend, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
        }))
        .map_err(|e| format!("no compatible GPU adapter found: {e}"))?;

        let info = adapter.get_info();
        // Enumerate every adapter the instance can see for honest
        // device counts; fall back to the working adapter alone.
        let names: Vec<String> = match instance.enumerate_adapters(wgpu::Backends::all()).len() {
            0 | 1 => vec![info.name.clone()],
            n => {
                let mut v = vec![info.name.clone()];
                for a in instance.enumerate_adapters(wgpu::Backends::all()) {
                    let i = a.get_info();
                    if i.name != info.name || v.contains(&i.name) {
                        if !v.contains(&i.name) { v.push(i.name); }
                        let _ = n;
                    }
                }
                v
            }
        };
        let backend_name = format!("{:?}", info.backend);

        let limits = adapter.limits();
        let max_buffer = limits.max_buffer_size;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("atlas-gpu"),
            required_features: wgpu::Features::empty(),
            required_limits: limits,
            memory_hints: wgpu::MemoryHints::default(),
            trace: Default::default(),
        }))
        .map_err(|e| format!("GPU device request failed: {e}"))?;

        let uncaptured: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let sink = uncaptured.clone();
        device.on_uncaptured_error(Box::new(move |err| {
            if let Ok(mut g) = sink.lock() {
                if g.is_empty() {
                    *g = format!("{err}");
                }
            }
        }));

        // One bind layout for every kernel: fixed slots, dummies for
        // bindings an entry point does not touch.
        let st = |read_only: bool| wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("atlas-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::COMPUTE, ty: st(true), count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::COMPUTE, ty: st(true), count: None },
                wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::COMPUTE, ty: st(false), count: None },
                wgpu::BindGroupLayoutEntry { binding: 3, visibility: wgpu::ShaderStages::COMPUTE, ty: st(false), count: None },
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 5, visibility: wgpu::ShaderStages::COMPUTE, ty: st(true), count: None },
            ],
        });

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("atlas-kernels"),
            source: wgpu::ShaderSource::Wgsl(include_str!("kernels.wgsl").into()),
        });

        // Explicit pipeline layout: every entry point binds through the
        // same atlas-layout (dummies fill the slots a kernel ignores).
        let pipe_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("atlas-pipe-layout"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });

        let mut pipelines = HashMap::new();
        for entry in ENTRIES {
            let p = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipe_layout),
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            });
            pipelines.insert(*entry, p);
        }

        let mk = |label: &str, size: u64, usage: wgpu::BufferUsages| device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage,
            mapped_at_creation: false,
        });
        let params = mk("params", 64, wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
        let dummy_ro = mk("dummy-ro", 4, wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST);
        let dummy_rw = mk("dummy-rw", 4, wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST);
        let flag = mk("div0-flag", 4, wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST);
        let flag_stage = mk("div0-stage", 4, wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST);

        Ok(WgpuBackend {
            _instance: instance,
            adapter_names: names,
            adapter_backend: backend_name,
            device,
            queue,
            max_buffer,
            next_handle: 1,
            buffers: HashMap::new(),
            pool: Vec::new(),
            layout,
            pipelines,
            params,
            dummy_ro,
            dummy_rw,
            flag,
            flag_stage,
            uncaptured,
        })
    }

    fn take_uncaptured(&self) -> Option<String> {
        let mut g = self.uncaptured.lock().ok()?;
        if g.is_empty() { None } else { let s = g.clone(); g.clear(); Some(s) }
    }

    fn buf(&self, h: u64) -> Result<&wgpu::Buffer, String> {
        self.buffers.get(&h).ok_or_else(|| format!("invalid GPU buffer handle {h}"))
    }

    fn write_params(&self, p: &Params) {
        self.queue.write_buffer(&self.params, 0, bytemuck::bytes_of(p));
    }

    fn bind(
        &self,
        a: &wgpu::Buffer,
        b: &wgpu::Buffer,
        dst: &wgpu::Buffer,
        spare: Option<&wgpu::Buffer>,
        shape: Option<&wgpu::Buffer>,
    ) -> wgpu::BindGroup {
        fn e(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer, offset: 0, size: None }),
            }
        }
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &[
                e(0, a),
                e(1, b),
                e(2, dst),
                e(3, spare.unwrap_or(&self.dummy_rw)),
                e(4, &self.params),
                e(5, shape.unwrap_or(&self.dummy_ro)),
            ],
        })
    }

    fn dispatch(&self, entry: &str, groups: (u32, u32, u32), bg: &wgpu::BindGroup) {
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        {
            let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipelines[entry]);
            pass.set_bind_group(0, bg, &[]);
            pass.dispatch_workgroups(groups.0, groups.1, groups.2);
        }
        self.queue.submit([enc.finish()]);
    }

    fn run_simple(&self, entry: &str, n: u64, a: &wgpu::Buffer, b: &wgpu::Buffer, dst: &wgpu::Buffer) -> Result<(), String> {
        let groups = u32_groups(n, WG_ELEM as u64)?;
        let bg = self.bind(a, b, dst, None, None);
        self.dispatch(entry, (groups, 1, 1), &bg);
        self.finish_op(entry)
    }

    /// Surface asynchronous device errors raised since the last check.
    fn finish_op(&self, what: &str) -> Result<(), String> {
        if let Some(msg) = self.take_uncaptured() {
            return Err(format!("GPU kernel failure in {what}: {msg}"));
        }
        Ok(())
    }

    /// Division parity with CPU: forward division by zero must raise
    /// "Division by zero." exactly like the CPU path, so this one op
    /// synchronizes (documented).
    fn check_div_flag(&self) -> Result<(), String> {
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        enc.copy_buffer_to_buffer(&self.flag, 0, &self.flag_stage, 0, 4);
        self.queue.submit([enc.finish()]);

        let slice = self.flag_stage.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| { let _ = tx.send(r); });
        self.device
            .poll(wgpu::PollType::Wait)
            .map_err(|e| format!("GPU synchronization failure: {e}"))?;
        rx.recv()
            .map_err(|_| "GPU synchronization failure: map channel dropped".to_string())?
            .map_err(|e| format!("GPU synchronization failure: {e}"))?;
        let v = {
            let data = slice.get_mapped_range();
            bytemuck::cast_slice::<u8, f32>(&data)[0]
        };
        self.flag_stage.unmap();
        if v != 0.0 {
            return Err(ERR_DIV0.to_string()); // lib maps this code to the CPU-parity message
        }
        Ok(())
    }

    fn alloc_raw(&mut self, nbytes: u64) -> Result<wgpu::Buffer, String> {
        if nbytes == 0 {
            return Err("cannot allocate a zero-byte GPU buffer".to_string());
        }
        if nbytes > self.max_buffer {
            let mb = nbytes / (1024 * 1024);
            let max_mb = self.max_buffer / (1024 * 1024);
            return Err(format!(
                "Unable to allocate tensor.\nRequested: {} MB\nDevice: GPU 0 ({})\nReason: exceeds the device allocation limit of {} MB.",
                mb, self.adapter_names.first().cloned().unwrap_or_else(|| "unknown".into()), max_mb
            ));
        }
        // Reuse the smallest idle buffer that fits.
        let mut best: Option<usize> = None;
        for (i, (_, size)) in self.pool.iter().enumerate() {
            if *size >= nbytes {
                match best {
                    Some(b) if self.pool[b].1 <= *size => {}
                    _ => best = Some(i),
                }
            }
        }
        if let Some(i) = best {
            let (buf, _) = self.pool.swap_remove(i);
            return Ok(buf);
        }
        Ok(self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("atlas-tensor"),
            size: nbytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }))
    }
}

impl GpuBackend for WgpuBackend {
    fn backend_name(&self) -> &'static str {
        "wgpu"
    }

    fn device_count(&self) -> usize {
        self.adapter_names.len()
    }

    fn device_name(&self, idx: usize) -> String {
        self.adapter_names.get(idx).cloned().unwrap_or_default()
    }

    fn max_buffer_size(&self) -> u64 {
        self.max_buffer
    }

    fn alloc(&mut self, nbytes: u64) -> Result<u64, String> {
        let buf = self.alloc_raw(nbytes)?;
        let h = self.next_handle;
        self.next_handle += 1;
        self.buffers.insert(h, buf);
        Ok(h)
    }

    fn free(&mut self, handle: u64) {
        if let Some(buf) = self.buffers.remove(&handle) {
            if self.pool.len() < 32 {
                let size = buf.size();
                self.pool.push((buf, size));
            }
            // Beyond the pool cap the buffer is simply dropped; wgpu
            // keeps in-flight submissions alive internally.
        }
    }

    fn write_f32(&mut self, handle: u64, byte_offset: u64, data: &[f32]) -> Result<(), String> {
        let buf = self.buf(handle)?.clone();
        if byte_offset % 4 != 0 {
            return Err(format!("unaligned host->device offset {byte_offset}"));
        }
        self.queue.write_buffer(&buf, byte_offset, bytemuck::cast_slice(data));
        Ok(())
    }

    fn read_f32(&mut self, handle: u64, byte_offset: u64, out: &mut [f32]) -> Result<(), String> {
        let buf = self.buf(handle)?.clone();
        let nbytes = (out.len() * 4) as u64;
        if byte_offset % 4 != 0 {
            return Err(format!("unaligned device->host offset {byte_offset}"));
        }
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("atlas-read-stage"),
            size: nbytes,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        enc.copy_buffer_to_buffer(&buf, byte_offset, &staging, 0, nbytes);
        self.queue.submit([enc.finish()]);

        let slice = staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| { let _ = tx.send(r); });
        self.device
            .poll(wgpu::PollType::Wait)
            .map_err(|e| format!("GPU synchronization failure: {e}"))?;
        rx.recv()
            .map_err(|_| "GPU synchronization failure: map channel dropped".to_string())?
            .map_err(|e| format!("GPU synchronization failure: {e}"))?;
        {
            let data = slice.get_mapped_range();
            out.copy_from_slice(bytemuck::cast_slice::<u8, f32>(&data));
        }
        staging.unmap();
        self.finish_op("device->host copy")
    }

    fn binary(&mut self, op: u32, a: u64, b: u64, spare: u64, out: u64, n: u64) -> Result<(), String> {
        let (abuf, bbuf, obuf) = (self.buf(a)?.clone(), self.buf(b)?.clone(), self.buf(out)?.clone());
        let div = op == OP_DIV;
        let div_db = op == OP_DIV_DB;
        if div {
            // Clear the flag before the kernel that sets it.
            self.queue.write_buffer(&self.flag, 0, bytemuck::cast_slice(&[0.0f32]));
        }
        if div_db && spare == 0 {
            return Err("division backward requires the incoming gradient buffer".to_string());
        }
        let p = Params { op, n: n as u32, ..Params::new() };
        self.write_params(&p);
        let spare_buf: Option<&wgpu::Buffer> = if div {
            Some(&self.flag)
        } else if div_db {
            Some(self.buf(spare)?)
        } else {
            None
        };
        let bg = self.bind(&abuf, &bbuf, &obuf, spare_buf, None);
        let groups = u32_groups(n, WG_ELEM as u64)?;
        self.dispatch("binary_main", (groups, 1, 1), &bg);
        self.finish_op("element-wise op")?;
        if div {
            self.check_div_flag()?;
        }
        Ok(())
    }

    fn binary_scalar(&mut self, op: u32, a: u64, scalar: f32, out: u64, n: u64, side: u32) -> Result<(), String> {
        let (abuf, obuf) = (self.buf(a)?.clone(), self.buf(out)?.clone());
        // Scalar divisor (side 0: a / s) — the divisor is known here,
        // exactly like the CPU path checks it before computing.
        if op == OP_DIV && side == 0 && scalar == 0.0 {
            return Err(ERR_DIV0.to_string());
        }
        let div_elem = op == OP_DIV && side == 1;
        if div_elem {
            self.queue.write_buffer(&self.flag, 0, bytemuck::cast_slice(&[0.0f32]));
        }
        let p = Params { op, n: n as u32, side, scalar, ..Params::new() };
        self.write_params(&p);
        let spare = if div_elem { Some(&self.flag) } else { None };
        let bg = self.bind(&abuf, &self.dummy_ro, &obuf, spare, None);
        let groups = u32_groups(n, WG_ELEM as u64)?;
        self.dispatch("binary_scalar_main", (groups, 1, 1), &bg);
        self.finish_op("scalar element-wise op")?;
        if div_elem {
            self.check_div_flag()?;
        }
        Ok(())
    }

    fn unary(&mut self, op: u32, a: u64, out: u64, n: u64) -> Result<(), String> {
        let (abuf, obuf) = (self.buf(a)?.clone(), self.buf(out)?.clone());
        let p = Params { op, n: n as u32, ..Params::new() };
        self.write_params(&p);
        self.run_simple("unary_main", n, &abuf, &self.dummy_ro, &obuf)
    }

    fn unary_grad(&mut self, op: u32, a: u64, g: u64, out: u64, n: u64) -> Result<(), String> {
        let (abuf, gbuf, obuf) = (self.buf(a)?.clone(), self.buf(g)?.clone(), self.buf(out)?.clone());
        let p = Params { op, n: n as u32, ..Params::new() };
        self.write_params(&p);
        self.run_simple("unary_grad_main", n, &abuf, &gbuf, &obuf)
    }

    fn matmul(&mut self, a: u64, b: u64, out: u64, m: u32, k: u32, nn: u32, ta: u32, tb: u32) -> Result<(), String> {
        let (abuf, bbuf, obuf) = (self.buf(a)?.clone(), self.buf(b)?.clone(), self.buf(out)?.clone());
        let p = Params { m, k, nn, ta, tb, ..Params::new() };
        self.write_params(&p);
        let gx = nn.div_ceil(WG_TILE);
        let gy = m.div_ceil(WG_TILE);
        let bg = self.bind(&abuf, &bbuf, &obuf, None, None);
        self.dispatch("matmul_main", (gx, gy, 1), &bg);
        self.finish_op("matrix multiplication")
    }

    fn reduce(&mut self, op: u32, a: u64, out: u64, n: u64, mean_scale: f32) -> Result<(), String> {
        let obuf = self.buf(out)?.clone();
        let mut cur = n;
        let mut src = self.buf(a)?.clone();
        let mut owned: Option<u64> = None;
        loop {
            let grid = cur.div_ceil(RED_CHUNK);
            let final_pass = grid <= 1;
            let p = Params {
                op,
                n: cur as u32,
                final_pass: final_pass as u32,
                scale: mean_scale,
                ..Params::new()
            };
            self.write_params(&p);
            if final_pass {
                let dst = if owned.is_some() { obuf.clone() } else { obuf.clone() };
                let bg = self.bind(&src, &self.dummy_ro, &dst, None, None);
                self.dispatch("reduce_main", (1, 1, 1), &bg);
                if let Some(h) = owned.take() {
                    self.free(h);
                }
                return self.finish_op("reduction");
            }
            // Intermediate partials: allocate before freeing so the
            // pooled buffer can never alias the live source.
            let ph = self.alloc((grid * 4) as u64)?;
            let pbuf = self.buf(ph)?.clone();
            let bg = self.bind(&src, &self.dummy_ro, &pbuf, None, None);
            self.dispatch("reduce_main", (grid as u32, 1, 1), &bg);
            if let Some(h) = owned.take() {
                self.free(h);
            }
            owned = Some(ph);
            src = pbuf;
            cur = grid;
        }
    }

    fn transpose(&mut self, a: u64, out: u64, shape: &[u32]) -> Result<(), String> {
        let rank = shape.len();
        if rank < 2 || rank > 64 {
            return Err(format!("transpose on GPU supports rank 2..=64, got rank {rank}"));
        }
        let n: u64 = shape.iter().map(|d| *d as u64).product();
        let (abuf, obuf) = (self.buf(a)?.clone(), self.buf(out)?.clone());
        let shape_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("atlas-shape"),
            size: (rank * 4) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue.write_buffer(&shape_buf, 0, bytemuck::cast_slice(shape));
        let p = Params { n: n as u32, rank: rank as u32, ..Params::new() };
        self.write_params(&p);
        let groups = u32_groups(n, WG_ELEM as u64)?;
        let bg = self.bind(&abuf, &self.dummy_ro, &obuf, None, Some(&shape_buf));
        self.dispatch("transpose_main", (groups, 1, 1), &bg);
        self.finish_op("transpose")
    }

    fn fill(&mut self, out: u64, value: f32, n: u64) -> Result<(), String> {
        let obuf = self.buf(out)?.clone();
        let p = Params { n: n as u32, scalar: value, ..Params::new() };
        self.write_params(&p);
        self.run_simple("fill_main", n, &self.dummy_ro, &self.dummy_ro, &obuf)
    }

    fn fill_scaled(&mut self, src: u64, scale: f32, out: u64, n: u64) -> Result<(), String> {
        let (sbuf, obuf) = (self.buf(src)?.clone(), self.buf(out)?.clone());
        let p = Params { n: n as u32, scale, ..Params::new() };
        self.write_params(&p);
        self.run_simple("fill_scaled_main", n, &sbuf, &self.dummy_ro, &obuf)
    }

    fn accum(&mut self, dst: u64, src: u64, n: u64) -> Result<(), String> {
        let (dbuf, sbuf) = (self.buf(dst)?.clone(), self.buf(src)?.clone());
        let p = Params { n: n as u32, ..Params::new() };
        self.write_params(&p);
        self.run_simple("accum_main", n, &sbuf, &self.dummy_ro, &dbuf)
    }

    fn copy(&mut self, src: u64, dst: u64, n: u64) -> Result<(), String> {
        let (sbuf, dbuf) = (self.buf(src)?.clone(), self.buf(dst)?.clone());
        let p = Params { n: n as u32, ..Params::new() };
        self.write_params(&p);
        self.run_simple("copy_main", n, &sbuf, &self.dummy_ro, &dbuf)
    }

    fn sync(&mut self) -> Result<(), String> {
        self.device
            .poll(wgpu::PollType::Wait)
            .map_err(|e| format!("GPU synchronization failure: {e}"))?;
        self.finish_op("synchronize")
    }
}
