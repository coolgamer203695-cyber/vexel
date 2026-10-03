'use strict';

// Vexel 3.6 Atlas v0.4 GPU tests — real GPU execution only. When the
// backend cannot load or no adapter exists, the suite prints SKIP and
// exits 0 (honest skip: never pretend GPU work happened).
// Usage: node tests/gpu/run_gpu_tests.js
// Force-skip (verifies the skip path): VEXEL_GPU_BACKEND=C:\missing.dll node tests/gpu/run_gpu_tests.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'vexel.js');

let passed = 0;
let failed = 0;
const failures = [];

function withTmpFiles(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-gpu-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    return fn(tmp);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function norm(s) {
  return (s || '').replace(/\r\n/g, '\n');
}

function runProgram(source, entry = 'main.vxl') {
  return withTmpFiles({ [entry]: source }, (tmp) => {
    const r = spawnSync('node', [BIN, path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    return { status: r.status, out: norm(r.stdout), err: norm(r.stderr), combined: norm(r.stdout) + norm(r.stderr) };
  });
}

function tRun(name, files, entry, expectedStdout) {
  withTmpFiles(files, (tmp) => {
    const r = spawnSync('node', [BIN, path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    const got = norm(r.stdout);
    const want = expectedStdout.replace(/\r\n/g, '\n');
    if (r.status === 0 && got === want) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: status=${r.status}\nExpected:\n${JSON.stringify(want)}\nGot:\n${JSON.stringify(got)}\nSTDERR:\n${r.stderr}`);
      console.log(`FAIL ${name}`);
    }
  });
}

function tRunFails(name, files, entry, mustContain) {
  withTmpFiles(files, (tmp) => {
    const r = spawnSync('node', [BIN, path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    const combined = norm(r.stdout) + norm(r.stderr);
    if (r.status !== 0 && (!mustContain || combined.includes(mustContain))) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: expected runtime failure containing '${mustContain}'\nstatus=${r.status}\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

function tCheckFails(name, files, entry, mustContain) {
  withTmpFiles(files, (tmp) => {
    const r = spawnSync('node', [BIN, 'check', path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 60000 });
    const combined = norm(r.stdout) + norm(r.stderr);
    if (r.status !== 0 && (!mustContain || combined.includes(mustContain))) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: expected check failure containing '${mustContain}'\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

// ---------------- probe: honest skip ----------------

console.log('=== Vexel 3.6 Atlas v0.4 GPU tests ===');

const probe = runProgram('print gpu available\n');
const available = probe.status === 0 && probe.out.trim() === 'true';

if (!available) {
  // Recover why: a move attempt surfaces the loader/device reason.
  const why = runProgram('a = tensor [1]\nmove a to gpu\n');
  const msg = (why.combined.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join('\n  ')) ||
    `probe status=${probe.status} out=${JSON.stringify(probe.out)} err=${JSON.stringify(probe.err)}`;
  console.log('SKIP: GPU backend unavailable on this machine — no GPU tests were run.');
  console.log('  Reason:');
  console.log(`  ${msg}`);
  process.exit(0);
}

console.log('--- availability ---');

tRun('gpu available is true', {
  'main.vxl': 'print gpu available\n',
}, 'main.vxl', 'true\n');

// count and name are machine-dependent — validate shape, not exact text.
{
  const r = runProgram('print gpu count\nprint gpu name\n');
  const lines = norm(r.out).trim().split('\n');
  const count = parseInt(lines[0], 10);
  if (r.status === 0 && Number.isInteger(count) && count >= 1 && (lines[1] || '').trim().length > 0) {
    passed++;
    console.log('PASS gpu count >= 1 and name non-empty');
  } else {
    failed++;
    failures.push(`gpu count/name: status=${r.status} out=${JSON.stringify(r.out)}`);
    console.log('FAIL gpu count >= 1 and name non-empty');
  }
}

console.log('\n--- device movement ---');

tRun('move roundtrip keeps values', {
  'main.vxl': 'a = tensor [1,2,3]\nprint a.device\nmove a to gpu\nprint a.device\nprint a\nmove a to cpu\nprint a.device\nprint a\n',
}, 'main.vxl', 'cpu\ngpu\n[1,2,3]\ncpu\n[1,2,3]\n');

tRun('double move to gpu is fine', {
  'main.vxl': 'a = tensor [1,2]\nmove a to gpu\nmove a to gpu\nprint a.device\nprint a\n',
}, 'main.vxl', 'gpu\n[1,2]\n');

tRun('equality compares values across devices', {
  'main.vxl': 'a = tensor [1,2,3]\nb = tensor [1,2,3]\nmove b to gpu\nprint a == b\nprint a == tensor [9,9,9]\n',
}, 'main.vxl', 'true\nfalse\n');

tRunFails('move empty tensor is a DeviceError', {
  'main.vxl': 'e = tensor []\nmove e to gpu\n',
}, 'main.vxl', 'Cannot move an empty tensor to the GPU');

tCheckFails('move needs a tensor/struct/list', {
  'main.vxl': 'n = 5\nmove n to gpu\n',
}, 'main.vxl', 'move expects a tensor, struct, list, or model');

tRunFails('mixed devices in arithmetic are a DeviceError', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [3,4]\nmove a to gpu\nprint a + b\n',
}, 'main.vxl', 'different devices');

tRunFails('mixed devices in matmul are a DeviceError', {
  'main.vxl': 'a = tensor [[1,2],[3,4]]\nb = tensor [[5,6],[7,8]]\nmove a to gpu\nprint a @ b\n',
}, 'main.vxl', 'different devices');

console.log('\n--- element-wise math on GPU ---');

// Note: `print b / a` would parse as a file path (language rule) — divide
// into a variable first, exactly like the CPU suite does.
tRun('add/sub/mul/div tensor-tensor', {
  'main.vxl': 'a = tensor [1,2,3]\nb = tensor [4,5,6]\nmove a to gpu\nmove b to gpu\nprint a + b\nprint b - a\nprint a * b\nq = b / a\nprint q\n',
}, 'main.vxl', '[5,7,9]\n[3,3,3]\n[4,10,18]\n[4,2.5,2]\n');

tRun('scalar math both sides', {
  'main.vxl': 'm = tensor [1.5,2.5]\nmove m to gpu\nprint m * 2\nprint 2 * m\nprint 10 - m\nprint m / 2\nprint m + 0.5\n',
}, 'main.vxl', '[3,5]\n[3,5]\n[8.5,7.5]\n[0.75,1.25]\n[2,3]\n');

tRunFails('divide by zero (GPU, exact CPU message)', {
  'main.vxl': 'a = tensor [1,2]\nzb = tensor [1,0]\nmove a to gpu\nmove zb to gpu\nq = a / zb\nprint q\n',
}, 'main.vxl', 'Division by zero.');

tRunFails('scalar divide by zero (GPU)', {
  'main.vxl': 'a = tensor [1,2]\nmove a to gpu\nprint a / 0\n',
}, 'main.vxl', 'Division by zero.');

tRunFails('shape mismatch on GPU', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [1,2,3]\nmove a to gpu\nmove b to gpu\nprint a + b\n',
}, 'main.vxl', 'Left shape: [2]');

console.log('\n--- matmul on GPU ---');

tRun('matmul 2x2', {
  'main.vxl': 'a = tensor [[1,2],[3,4]]\nb = tensor [[5,6],[7,8]]\nmove a to gpu\nmove b to gpu\nprint a @ b\n',
}, 'main.vxl', '[[19,22],[43,50]]\n');

tRun('matmul 2x3 by 3x2', {
  'main.vxl': 'a = tensor [[1,2,3],[4,5,6]]\nb = tensor [[7,8],[9,10],[11,12]]\nmove a to gpu\nmove b to gpu\nprint a @ b\n',
}, 'main.vxl', '[[58,64],[139,154]]\n');

tRunFails('matmul shape mismatch on GPU', {
  'main.vxl': 'a = tensor [[1,2,3],[4,5,6]]\nb = tensor [[1,2],[3,4]]\nmove a to gpu\nmove b to gpu\nprint a @ b\n',
}, 'main.vxl', 'do not align');

console.log('\n--- utilities on GPU ---');

tRun('transpose + reshape + flatten', {
  'main.vxl': 'x = tensor [[10,20],[30,40]]\nmove x to gpu\nprint x.transpose\nprint x.flatten\nrr = x.reshape [4]\nmove rr to cpu\nprint rr\nprint rr.reshape [2,2]\n',
}, 'main.vxl', '[[10,30],[20,40]]\n[10,20,30,40]\n[10,20,30,40]\n[[10,20],[30,40]]\n');

tRun('transpose 3d data order', {
  'main.vxl': 'c = tensor [[[1,2,3],[4,5,6]]]\nmove c to gpu\nprint c.transpose.shape\nprint c.transpose\n',
}, 'main.vxl', '[3,2,1]\n[[[1],[4]],[[2],[5]],[[3],[6]]]\n');

tRun('sum/mean/max/min', {
  'main.vxl': 'x = tensor [1,2,3,4]\nmove x to gpu\nprint x.sum\nprint x.mean\nprint x.max\nprint x.min\nm = tensor [[1,2],[3,4]]\nmove m to gpu\nprint m.sum\n',
}, 'main.vxl', '10\n2.5\n4\n1\n10\n');

tRun('index + row on GPU (host reads)', {
  'main.vxl': 'x = tensor [[10,20],[30,40]]\nmove x to gpu\nprint x[1][0]\nprint x[0]\nrow = x[1]\nprint row.device\n',
}, 'main.vxl', '30\n[10,20]\ngpu\n');

tRun('detach on GPU keeps values', {
  'main.vxl': 'x = tensor [2,3]\nmove x to gpu\nd = x.detach\nprint d\nprint d == x\nprint (d * d).sum\n',
}, 'main.vxl', '[2,3]\ntrue\n13\n');

console.log('\n--- activations on GPU ---');

tRun('relu + sigmoid + tanh forward', {
  'main.vxl': 'neg = tensor [-1, 2]\nmove neg to gpu\nprint relu neg\ns = tensor [0,1]\nmove s to gpu\nprint sigmoid s\nt = tensor [0,1]\nmove t to gpu\nprint tanh t\n',
}, 'main.vxl', '[0,2]\n[0.5,0.7310586]\n[0,0.7615942]\n');

console.log('\n--- autograd on GPU (v0.2 on device) ---');

tRun('grad x*x sum backward', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\nloss = (x * x).sum\nloss.backward\nprint x.grad.device\nprint x.grad\n',
}, 'main.vxl', 'gpu\n[4,6]\n');

tRun('zero_grad clears grad', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\nloss = (x * x).sum\nloss.backward\nx.zero_grad\nprint x.grad\n',
}, 'main.vxl', 'null\n');

tRun('chain add+mul backward', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\na = x + x\nloss = (a * a).sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[16,24]\n');

tRun('mean backward scales by 1/n', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\nloss = (x * x).mean\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[2,3]\n');

tRun('mul grad = other operand', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [3,4]\nmake a require gradients\nmove a to gpu\nmove b to gpu\nloss = (a * b).sum\nloss.backward\nprint a.grad\n',
}, 'main.vxl', '[3,4]\n');

tRun('add grad = ones', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [3,4]\nmake a require gradients\nmove a to gpu\nmove b to gpu\nloss = (a + b).sum\nloss.backward\nprint a.grad\n',
}, 'main.vxl', '[1,1]\n');

tRun('scalar-tensor math backward both sides', {
  'main.vxl': 'x = tensor [1,2]\nmake x require gradients\nmove x to gpu\nloss = (x * 3 + 2).sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[3,3]\n');

tRun('grad accumulates across backward calls', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\nloss = (x * x).sum\nloss.backward\nloss.backward\nprint x.grad\nx.zero_grad\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[8,12]\n[4,6]\n');

tRun('matmul + reshape backward', {
  'main.vxl': 'w = tensor [1,2,3,4]\nmake w require gradients\nmove w to gpu\nx0 = tensor [5,6]\nx = x0.reshape [2,1]\nmove x to gpu\nm = w.reshape [2,2]\np = m @ x\nloss = p.sum\nloss.backward\nprint w.grad\n',
}, 'main.vxl', '[5,6,5,6]\n');

tRun('transpose + flatten backward', {
  'main.vxl': 'q = tensor [1,2,3,4]\nmake q require gradients\nmove q to gpu\nloss = q.reshape [2,2].transpose.sum\nloss.backward\nprint q.grad\nq.zero_grad\nloss2 = q.flatten.sum\nloss2.backward\nprint q.grad\n',
}, 'main.vxl', '[1,1,1,1]\n[1,1,1,1]\n');

tRun('division backward both operands', {
  'main.vxl': 'da = tensor [6,8]\ndb = tensor [2,4]\nmake da require gradients\nmake db require gradients\nmove da to gpu\nmove db to gpu\nloss = (da / db).sum\nloss.backward\nprint da.grad\nprint db.grad\n',
}, 'main.vxl', '[0.5,0.25]\n[-1.5,-0.5]\n');

tRun('relu backward', {
  'main.vxl': 'x = tensor [-1,2]\nmake x require gradients\nmove x to gpu\nh = relu x\nloss = (h * h).sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[0,4]\n');

tRun('sigmoid forward + backward', {
  'main.vxl': 's = tensor [0,1]\nmake s require gradients\nmove s to gpu\nloss = sigmoid s\nloss.sum.backward\nprint s.grad\n',
}, 'main.vxl', '[0.25,0.19661193]\n');

tRun('tanh backward within f32 tolerance (GPU shader vs CPU)', {
  'main.vxl': 't = tensor [0,1]\nmake t require gradients\nmove t to gpu\nloss = tanh t\nloss.sum.backward\nd0 = t.grad[0] - 1\nd1 = t.grad[1] - 0.41997433\nprint d0 < 0.000001\nprint d0 > -0.000001\nprint d1 < 0.000001\nprint d1 > -0.000001\n',
}, 'main.vxl', 'true\ntrue\ntrue\ntrue\n');

tRunFails('detach cuts the graph (same error as CPU)', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\nd = x.detach\nloss = (d * d).sum\nloss.backward\n',
}, 'main.vxl', 'decimal has no field');

tRunFails('backward on non-scalar', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nmove x to gpu\nloss = x * x\nloss.backward\n',
}, 'main.vxl', 'backward needs a scalar tensor');

tRunFails('cross-device multiply fails before backward', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\ny = tensor [2,3]\nmove x to gpu\nloss = (x * y).sum\nloss.backward\n',
}, 'main.vxl', 'different devices');

console.log('\n--- model movement (structs + lists) ---');

tRun('move a struct of tensors', {
  'main.vxl': 'struct Model {\n w\n b\n}\nm = Model {\n w = tensor [1,2]\n b = tensor [10,20]\n}\nmove m to gpu\nprint m.w.device\nprint m.w\nmove m to cpu\nprint m.w.device\nprint m.b\n',
}, 'main.vxl', 'gpu\n[1,2]\ncpu\n[10,20]\n');

tRun('arithmetic after moving a struct', {
  'main.vxl': 'struct Model {\n w\n b\n}\nm = Model {\n w = tensor [1,2]\n b = tensor [10,20]\n}\nmove m to gpu\ns = m.w + m.b\nmove s to cpu\nprint s\nprint m.w.device\n',
}, 'main.vxl', '[11,22]\ngpu\n');

tRun('move a list of tensors', {
  'main.vxl': 'l = [tensor [1,2], tensor [3,4]]\nmove l to gpu\nt0 = l[0]\nt1 = l[1]\nprint t0.device\nprint t0 + t1\n',
}, 'main.vxl', 'gpu\n[4,6]\n');

console.log('\n--- UI backend honesty ---');

tCheckFails('UI rejects move to gpu', {
  'main.vxl': 'create a window titled "T"\nl = [1,2]\nmove l to gpu\nwindow.show\n',
}, 'main.vxl', 'console-only');

tCheckFails('UI rejects gpu info', {
  'main.vxl': 'create a window titled "T"\ny = gpu available\nwindow.show\n',
}, 'main.vxl', 'GPU info');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
