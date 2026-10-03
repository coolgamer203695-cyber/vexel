'use strict';

// Vexel 3.4 Atlas tests — every test executes natively (rustc) unless
// marked check-only. Static failures use `check`; runtime failures run
// the program and expect a non-zero exit with the Atlas error text.
// Usage: node tests/atlas/run_atlas_tests.js

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-atlas-'));
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

function tDeterministic(name, files, entry) {
  // Same program twice must print byte-identical output (Atlas RNG
  // is fixed-seed by design; catches accidental time-seeding).
  const runOnce = () => withTmpFiles(files, (tmp) => {
    const r = spawnSync('node', [BIN, path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    return { status: r.status, out: norm(r.stdout), err: r.stderr };
  });
  const a = runOnce();
  const b = runOnce();
  if (a.status === 0 && b.status === 0 && a.out === b.out) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    failures.push(`${name}: status=${a.status}/${b.status}\nrun1=${JSON.stringify(a.out)}\nrun2=${JSON.stringify(b.out)}\nSTDERR:\n${b.err}`);
    console.log(`FAIL ${name}`);
  }
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

console.log('=== Vexel 3.4 Atlas tests ===\n--- creation + shape ---');

tRun('create 1d + shape/rank/size', {
  'main.vxl': 'x = tensor [1,2,3]\nprint x\nprint x.shape\nprint x.rank\nprint x.size\n',
}, 'main.vxl', '[1,2,3]\n[3]\n1\n3\n');

tRun('create 2d + shape', {
  'main.vxl': 'x = tensor [[1,2,3],[4,5,6]]\nprint x\nprint x.shape\nprint x.rank\nprint x.size\n',
}, 'main.vxl', '[[1,2,3],[4,5,6]]\n[2,3]\n2\n6\n');

tRun('create scalar + empty + dtype/device', {
  'main.vxl': 'd = tensor 5\nprint d\nprint d.rank\nprint d.size\nprint d.dtype\nprint d.device\ne = tensor []\nprint e\nprint e.size\n',
}, 'main.vxl', '5\n0\n1\nfloat32\ncpu\n[]\n0\n');

tRun('create 3d', {
  'main.vxl': 'c = tensor [[[1,2],[3,4]],[[5,6],[7,8]]]\nprint c.rank\nprint c.size\nprint c\n',
}, 'main.vxl', '3\n8\n[[[1,2],[3,4]],[[5,6],[7,8]]]\n');

tRun('zeros + ones', {
  'main.vxl': 'print zeros [2,2]\nprint ones [1,3]\nprint zeros []\nprint zeros [2,2].sum\n',
}, 'main.vxl', '[[0,0],[0,0]]\n[[1,1,1]]\n0\n0\n');

console.log('\n--- indexing ---');

tRun('index 1d + nested 2d/3d', {
  'main.vxl': 'x = tensor [[10,20],[30,40]]\nprint x[1][0]\nprint x[0]\nprint x[1][1]\nc = tensor [[[1,2],[3,4]],[[5,6],[7,8]]]\nprint c[1][0][1]\n',
}, 'main.vxl', '30\n[10,20]\n40\n6\n');

tRunFails('index out of bounds', {
  'main.vxl': 'x = tensor [[10,20],[30,40]]\nprint x[5]\n',
}, 'main.vxl', 'Tensor index out of bounds');

tCheckFails('index assign rejected', {
  'main.vxl': 'x = tensor [1,2]\nx[0] = 5\n',
}, 'main.vxl', 'immutable');

console.log('\n--- element-wise math ---');

tRun('add/sub/mul/div tensor-tensor', {
  'main.vxl': 'a = tensor [1,2,3]\nb = tensor [4,5,6]\nprint a + b\nprint b - a\nprint a * b\nq = b / a\nprint q\n',
}, 'main.vxl', '[5,7,9]\n[3,3,3]\n[4,10,18]\n[4,2.5,2]\n');

tRun('scalar math both sides', {
  'main.vxl': 'm = tensor [1.5,2.5]\nprint m * 2\nprint 2 * m\nprint 10 - m\nprint m / 2\nprint m + 0.5\n',
}, 'main.vxl', '[3,5]\n[3,5]\n[8.5,7.5]\n[0.75,1.25]\n[2,3]\n');

tRunFails('shape mismatch add', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [1,2,3]\nprint a + b\n',
}, 'main.vxl', 'ShapeError');

tRunFails('shape mismatch message detail', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [1,2,3]\nprint a + b\n',
}, 'main.vxl', 'Left shape: [2]');

tRunFails('divide by zero', {
  'main.vxl': 'a = tensor [1,2]\nprint a / 0\n',
}, 'main.vxl', 'Division by zero');

tCheckFails('tensor plus string', {
  'main.vxl': 'a = tensor [1]\nprint a + "hi"\n',
}, 'main.vxl', 'Cannot add tensor and string');

tCheckFails('tensor modulo', {
  'main.vxl': 'a = tensor [1]\nprint a % 2\n',
}, 'main.vxl', 'requires integers');

console.log('\n--- matmul ---');

tRun('matmul 2x2', {
  'main.vxl': 'a = tensor [[1,2],[3,4]]\nb = tensor [[5,6],[7,8]]\nprint a @ b\n',
}, 'main.vxl', '[[19,22],[43,50]]\n');

tRun('matmul 2x3 by 3x2', {
  'main.vxl': 'a = tensor [[1,2,3],[4,5,6]]\nb = tensor [[7,8],[9,10],[11,12]]\nprint a @ b\n',
}, 'main.vxl', '[[58,64],[139,154]]\n');

tRunFails('matmul shape mismatch', {
  'main.vxl': 'a = tensor [[1,2,3],[4,5,6]]\nb = tensor [[1,2],[3,4]]\nprint a @ b\n',
}, 'main.vxl', 'do not align');

tRunFails('matmul needs 2d', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [1,2]\nprint a @ b\n',
}, 'main.vxl', 'needs 2D tensors');

tCheckFails('at needs tensors', {
  'main.vxl': 'print 2 @ 3\n',
}, 'main.vxl', "Operator '@' needs tensors");

console.log('\n--- utilities ---');

tRun('transpose + reshape + flatten', {
  'main.vxl': 'x = tensor [[10,20],[30,40]]\nprint x.transpose\nprint x.flatten\nrr = x.reshape [4]\nprint rr\nprint rr.reshape [2,2]\n',
}, 'main.vxl', '[[10,30],[20,40]]\n[10,20,30,40]\n[10,20,30,40]\n[[10,20],[30,40]]\n');

tRun('transpose 3d data order', {
  'main.vxl': 'c = tensor [[[1,2,3],[4,5,6]]]\nprint c.transpose.shape\nprint c.transpose\n',
}, 'main.vxl', '[3,2,1]\n[[[1],[4]],[[2],[5]],[[3],[6]]]\n');

tCheckFails('static shape mismatch add', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [1,2,3]\nprint a + b\n',
}, 'main.vxl', 'ShapeError');

tCheckFails('static matmul misalign', {
  'main.vxl': 'a = tensor [[1,2,3],[4,5,6]]\nb = tensor [[1,2],[3,4]]\nprint a @ b\n',
}, 'main.vxl', 'do not align');

tCheckFails('static bad reshape', {
  'main.vxl': 'x = tensor [1,2,3]\nprint x.reshape [2,2]\n',
}, 'main.vxl', 'Cannot reshape 3 elements into shape [2,2]');

tDeterministic('random deterministic across runs', {
  'main.vxl': 't = random tensor [2,3]\nprint t\n',
}, 'main.vxl');

tRunFails('bad reshape', {
  'main.vxl': 'x = tensor [1,2,3]\nprint x.reshape [4]\n',
}, 'main.vxl', 'Cannot reshape 3 elements into shape [4]');

console.log('\n--- reductions ---');

tRun('sum/mean/max/min', {
  'main.vxl': 'x = tensor [1,2,3,4]\nprint x.sum\nprint x.mean\nprint x.max\nprint x.min\nm = tensor [[1,2],[3,4]]\nprint m.sum\n',
}, 'main.vxl', '10\n2.5\n4\n1\n10\n');

tRunFails('reduce empty', {
  'main.vxl': 'e = tensor []\nprint e.sum\n',
}, 'main.vxl', 'empty tensor');

console.log('\n--- random ---');

tRun('random shape + range', {
  'main.vxl': 't = random tensor [2,3]\nprint t.shape\nprint t.rank\nprint t.size\nprint t.min >= 0\nprint t.max < 1\n',
}, 'main.vxl', '[2,3]\n2\n6\ntrue\ntrue\n');

console.log('\n--- errors + types ---');

tRunFails('ragged literal', {
  'main.vxl': 'x = tensor [[1,2],[3]]\nprint x\n',
}, 'main.vxl', 'mismatched shapes');

tCheckFails('string data', {
  'main.vxl': 'x = tensor ["a"]\nprint x\n',
}, 'main.vxl', 'must be numbers');

tCheckFails('unknown member', {
  'main.vxl': 'x = tensor [1]\nprint x.foo\n',
}, 'main.vxl', "Tensor has no 'foo'");

tCheckFails('zeros needs list', {
  'main.vxl': 'print zeros 5\n',
}, 'main.vxl', 'shape list');

tCheckFails('random needs shape', {
  'main.vxl': 'print random [4,4]\n',
}, 'main.vxl', 'random tensor [4,4]');

tCheckFails('reassign type mismatch', {
  'main.vxl': 'x = tensor [1,2]\nx = "hi"\n',
}, 'main.vxl', 'Type mismatch');

console.log('\n--- autograd (v0.2) ---');

tRun('grad x*x sum backward', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\ny = x * x\nloss = y.sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[4,6]\n');

tRun('zero_grad clears grad', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\ny = x * x\nloss = y.sum\nloss.backward\nx.zero_grad\nprint x.grad\n',
}, 'main.vxl', 'null\n');

tRun('chain add+mul backward', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\na = x + x\nb = a * a\nloss = b.sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[16,24]\n');

tRun('mean backward scales by 1/n', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nloss = (x * x).mean\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[2,3]\n');

tRun('mul grad = other operand', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [3,4]\nmake a require gradients\nloss = (a * b).sum\nloss.backward\nprint a.grad\n',
}, 'main.vxl', '[3,4]\n');

tRun('add grad = ones', {
  'main.vxl': 'a = tensor [1,2]\nb = tensor [3,4]\nmake a require gradients\nloss = (a + b).sum\nloss.backward\nprint a.grad\n',
}, 'main.vxl', '[1,1]\n');

tRun('scalar-tensor math backward both sides', {
  'main.vxl': 'x = tensor [1,2]\nmake x require gradients\nloss = (x * 3 + 2).sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[3,3]\n');

tRun('grad accumulates across backward calls', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nloss = (x * x).sum\nloss.backward\nloss.backward\nprint x.grad\nx.zero_grad\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[8,12]\n[4,6]\n');

tRun('matmul + reshape backward', {
  'main.vxl': 'w = tensor [1,2,3,4]\nmake w require gradients\nx0 = tensor [5,6]\nx = x0.reshape [2,1]\nm = w.reshape [2,2]\np = m @ x\nloss = p.sum\nloss.backward\nprint w.grad\n',
}, 'main.vxl', '[5,6,5,6]\n');

tRun('transpose + flatten backward', {
  'main.vxl': 'q = tensor [1,2,3,4]\nmake q require gradients\nloss = q.reshape [2,2].transpose.sum\nloss.backward\nprint q.grad\nq.zero_grad\nloss2 = q.flatten.sum\nloss2.backward\nprint q.grad\n',
}, 'main.vxl', '[1,1,1,1]\n[1,1,1,1]\n');

tRun('detach cuts the graph', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nd = x.detach\nprint d\nprint d == x\nprint (d * d).sum\n',
}, 'main.vxl', '[2,3]\ntrue\n13\n');

tRunFails('backward on non-scalar', {
  'main.vxl': 'x = tensor [2,3]\nmake x require gradients\nloss = x * x\nloss.backward\n',
}, 'main.vxl', 'backward needs a scalar tensor');

tRunFails('backward on a plain number loss', {
  'main.vxl': 'x = tensor [2,3]\nloss = x.sum\nloss.backward\n',
}, 'main.vxl', "has no field 'backward'");

tCheckFails('make require gradients needs tensor', {
  'main.vxl': 'n = 5\nmake n require gradients\n',
}, 'main.vxl', 'Make require gradients needs a tensor');

tRun('finite difference matches autograd', {
  'main.vxl': 'base = tensor [0.3, -0.7]\nmake base require gradients\nf = (sigmoid base * base).sum\nf.backward\ng = base.grad\nxp = tensor [0.301, -0.7]\nxm = tensor [0.299, -0.7]\nfp = (sigmoid xp * xp).sum\nfm = (sigmoid xm * xm).sum\nn0 = (fp - fm) / 0.002\nyp = tensor [0.3, -0.699]\nym = tensor [0.3, -0.701]\nfp2 = (sigmoid yp * yp).sum\nfm2 = (sigmoid ym * ym).sum\nn1 = (fp2 - fm2) / 0.002\nd0 = n0 - g[0]\nd1 = n1 - g[1]\nprint d0 < 0.001\nprint d0 > -0.001\nprint d1 < 0.001\nprint d1 > -0.001\n',
}, 'main.vxl', 'true\ntrue\ntrue\ntrue\n');

console.log('\n--- activations (v0.2) ---');

tRun('relu forward + backward', {
  'main.vxl': 'rv = tensor [-1,2]\nprint relu rv\nmake rv require gradients\nloss = relu rv\nloss.sum.backward\nprint rv.grad\n',
}, 'main.vxl', '[0,2]\n[0,1]\n');

tRun('sigmoid forward + backward', {
  'main.vxl': 's = tensor [0,1]\nprint sigmoid s\nmake s require gradients\nloss = sigmoid s\nloss.sum.backward\nprint s.grad\n',
}, 'main.vxl', '[0.5,0.7310586]\n[0.25,0.19661193]\n');

tRun('tanh forward + backward', {
  'main.vxl': 't = tensor [0,1]\nprint tanh t\nmake t require gradients\nloss = tanh t\nloss.sum.backward\nprint t.grad\n',
}, 'main.vxl', '[0,0.7615942]\n[1,0.41997433]\n');

tRun('activation chain relu mul', {
  'main.vxl': 'x = tensor [-1,2]\nmake x require gradients\nh = relu x\nloss = (h * h).sum\nloss.backward\nprint x.grad\n',
}, 'main.vxl', '[0,4]\n');

tCheckFails('relu needs tensor', {
  'main.vxl': 'print relu 5\n',
}, 'main.vxl', 'needs a tensor');

tCheckFails('activation arity', {
  'main.vxl': 'x = tensor [1]\nprint relu x, x\n',
}, 'main.vxl', 'needs one tensor');

console.log('\n--- neural networks (v0.3) ---');

// The library and the example live at the repo root (imports are
// side-by-side only), so tests inject their real contents.
const NN_LIB = fs.readFileSync(path.join(ROOT, 'nn.vxl'), 'utf8');
const NN_TRAIN = fs.readFileSync(path.join(ROOT, 'nn_train.vxl'), 'utf8');

tRun('nn init shapes + forward', {
  'nn.vxl': NN_LIB,
  'main.vxl': 'import nn\nlayer = nn.linear 2, 1\nprint layer.w.shape\nprint layer.b.shape\n',
}, 'main.vxl', '[2,1]\n[1,1]\n');

tRun('nn forward + mse backward + grads', {
  'nn.vxl': NN_LIB,
  'main.vxl': 'import nn\nlayer = nn.linear 1, 1\nx = tensor [[3]]\nt = tensor [[6]]\np = nn.forward layer, x\nprint ["p", p]\nloss = nn.mse p, t\nloss.backward\nprint ["wgrad", layer.w.grad]\nprint ["bgrad", layer.b.grad]\nnn.zero layer\nprint ["zeroed", layer.w.grad]\n',
}, 'main.vxl', '[p, [[1.6823334]]]\n[wgrad, [[-25.905998]]]\n[bgrad, [[-8.635333]]]\n[zeroed, null]\n');

tRun('nn sgd steps keep training (detach fix)', {
  'nn.vxl': NN_LIB,
  'main.vxl': 'import nn\nlayer = nn.linear 1, 1\nx = tensor [[3]]\ntarget = tensor [[6]]\ni = 0\nrepeat 3 {\n  pred = nn.forward layer, x\n  loss = nn.mse pred, target\n  loss.backward\n  print ["iter", i, "loss", loss, "wgrad", layer.w.grad]\n  nn.step layer, 0.01\n  i = i + 1\n}\n',
}, 'main.vxl', '[iter, 0, loss, 18.642244, wgrad, [[-25.905998]]]\n[iter, 1, loss, 11.931038, wgrad, [[-20.7248]]]\n[iter, 2, loss, 7.6358633, wgrad, [[-16.57984]]]\n');

tRun('nn relu_layer forward + backward', {
  'nn.vxl': NN_LIB,
  'main.vxl': 'import nn\nlayer = nn.linear 2, 2\nx = tensor [[-1, 3]]\npre = nn.relu_layer layer, x\nprint ["pre", pre]\nloss = pre.sum\nloss.backward\nprint ["wgrad", layer.w.grad]\nprint ["bgrad", layer.b.grad]\n',
}, 'main.vxl', '[pre, [[0.39643753,0.7037644]]]\n[wgrad, [[-1,-1],[3,3]]]\n[bgrad, [[1,1]]]\n');

tRun('nn_train example converges', {
  'nn.vxl': NN_LIB,
  'nn_train.vxl': NN_TRAIN,
}, 'nn_train.vxl', [
  '[step, 0, loss, 2.0713606]',
  '[step, 60, loss, 0.04248723]',
  '[step, 120, loss, 0.017632827]',
  '[step, 180, loss, 0.007317917]',
  '[step, 240, loss, 0.0030370308]',
  '[step, 300, loss, 0.0012604228]',
  '[step, 360, loss, 0.0005230943]',
  '[step, 420, loss, 0.00021709163]',
  '[step, 480, loss, 0.00009009655]',
  '[final loss, 0.0000041690155]',
  '[prediction for 1, [[2.0081978]]]',
  '[prediction for 3, [[5.997958]]]',
  '[learned w, [[1.9948802]]]',
  '[learned b, [[0.013317589]]]',
].join('\n') + '\n');

tRunFails('nn forward shape mismatch', {
  'nn.vxl': NN_LIB,
  'main.vxl': 'import nn\nlayer = nn.linear 2, 1\nprint nn.forward layer, tensor [[1,2,3]]\n',
}, 'main.vxl', 'do not align');

tRunFails('nn mse shape mismatch', {
  'nn.vxl': NN_LIB,
  'main.vxl': 'import nn\nprint nn.mse tensor [[1,2]], tensor [[3]]\n',
}, 'main.vxl', 'Cannot subtract tensors');

console.log('\n--- integration ---');

tRun('tensor through functions + equality', {
  'main.vxl': 'function show t {\n print t.shape\n print t.size\n return t.sum\n}\na = tensor [[1,2],[3,4]]\nprint show a\nprint a == tensor [[1,2],[3,4]]\nprint a == tensor [[1,2],[3,5]]\n',
}, 'main.vxl', '[2,2]\n4\n10\ntrue\nfalse\n');

tRun('user names win over builtins', {
  'main.vxl': 'zeros = [10,20,30]\nprint zeros[0]\nprint zeros[2]\ntensor = [7,8]\nprint tensor[1]\n',
}, 'main.vxl', '10\n30\n8\n');

tCheckFails('UI plus tensor is loud', {
  'main.vxl': 'create a window titled "T"\nx = tensor [1,2]\nwindow.show\n',
}, 'main.vxl', 'not supported by the Avalonia backend');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
