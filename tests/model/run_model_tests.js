'use strict';

// Vexel 3.7 Atlas v0.5 model tests — create/load/save, forward,
// modes, inference guard, formats (model.atlas / SafeTensors / shards),
// honest Hugging Face boundaries, GPU placement, static diagnostics.
// Usage: node tests/model/run_model_tests.js

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-model-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.isBuffer(content) ? content : content);
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

function tDeterministic(name, files, entry) {
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

// Run a setup program (e.g. save a model), optionally mutate the tmp
// folder (corrupt a byte, drop extra weight files), then run the
// assertion program.
function tRunAfter(name, files, setupEntry, setupSrc, mutate, entry, expectedStdout) {
  withTmpFiles(Object.assign({}, files, { [setupEntry]: setupSrc }), (tmp) => {
    const r1 = spawnSync('node', [BIN, path.join(tmp, setupEntry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    if (r1.status !== 0) {
      failed++;
      failures.push(`${name}: setup failed\n${norm(r1.stdout)}${norm(r1.stderr)}`);
      console.log(`FAIL ${name} (setup)`);
      return;
    }
    if (mutate) {
      try { mutate(tmp); } catch (e) {
        failed++;
        failures.push(`${name}: mutate failed: ${e.message}`);
        console.log(`FAIL ${name} (mutate)`);
        return;
      }
    }
    const r2 = spawnSync('node', [BIN, path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    const got = norm(r2.stdout);
    const want = expectedStdout.replace(/\r\n/g, '\n');
    if (r2.status === 0 && got === want) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: status=${r2.status}\nExpected:\n${JSON.stringify(want)}\nGot:\n${JSON.stringify(got)}\nSTDERR:\n${r2.stderr}`);
      console.log(`FAIL ${name}`);
    }
  });
}

// Same setup+mutate flow, but the assertion program must FAIL with
// the given message (corruption tests).
function tRunAfterFails(name, files, setupEntry, setupSrc, mutate, entry, mustContain) {
  withTmpFiles(Object.assign({}, files, { [setupEntry]: setupSrc }), (tmp) => {
    const r1 = spawnSync('node', [BIN, path.join(tmp, setupEntry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    if (r1.status !== 0) {
      failed++;
      failures.push(`${name}: setup failed\n${norm(r1.stdout)}${norm(r1.stderr)}`);
      console.log(`FAIL ${name} (setup)`);
      return;
    }
    if (mutate) {
      try { mutate(tmp); } catch (e) {
        failed++;
        failures.push(`${name}: mutate failed: ${e.message}`);
        console.log(`FAIL ${name} (mutate)`);
        return;
      }
    }
    const r2 = spawnSync('node', [BIN, path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    const combined = norm(r2.stdout) + norm(r2.stderr);
    if (r2.status !== 0 && (!mustContain || combined.includes(mustContain))) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: expected runtime failure containing '${mustContain}'\nstatus=${r2.status}\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

function gpuAvailable() {
  return withTmpFiles({ 'main.vxl': 'print gpu available\n' }, (tmp) => {
    const r = spawnSync('node', [BIN, path.join(tmp, 'main.vxl')], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    return norm(r.stdout).trim() === 'true';
  });
}

// ---- fixtures ----

const ATLAS_LIB = fs.readFileSync(path.join(ROOT, 'atlas.vxl'), 'utf8');
const A = { 'atlas.vxl': ATLAS_LIB };

// Vexel linear 2->1 config object literal (object fields need commas).
const LIN = '{ format = "atlas-model", format_version = 1, name = "lin", arch = "linear", layers = [{in = 2, out = 1, activation = "none"}] }';
// The same config as config.json on disk.
const LIN_JSON = JSON.stringify({
  format: 'atlas-model', format_version: 1, name: 'stest',
  arch: 'linear', layers: [{ in: 2, out: 1, activation: 'none' }],
});

function safetensorsBuf(tensors) {
  const header = {};
  const parts = [];
  let off = 0;
  for (const [name, t] of Object.entries(tensors)) {
    const bytes = Buffer.alloc(t.data.length * 4);
    t.data.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    header[name] = { dtype: 'F32', shape: t.shape, data_offsets: [off, off + bytes.length] };
    parts.push(bytes);
    off += bytes.length;
  }
  const h = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(h.length));
  return Buffer.concat([len, h, ...parts]);
}

// ---- tests ----

console.log('=== Vexel 3.7 Atlas v0.5 model tests ===\n--- create + config ---');

tRun('create + info + members', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'm = create model atlas.default_config 4, 8, 2',
    'i = m.info',
    'print i.name',
    'print i.arch',
    'print i.layers',
    'print i.parameters',
    'print i.weights',
    'print i.format_version',
    'print m.mode',
    'print "[" + m.path + "]"',
    'print m.parameters.length',
    'print m.configuration.name',
  ].join('\n') + '\n',
}), 'main.vxl', 'mlp-relu\nmlp\n2\n58\ntrue\n1\ntrain\n[]\n4\nmlp-relu\n');

tRun('create linear + forward shape', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    `cfg = ${LIN}`,
    'm = create model cfg',
    'print m.info.parameters',
    'print m.info.arch',
    'y = m.forward tensor [1,2]',
    'print y.rank',
    'print y.size',
    'print y.shape',
  ].join('\n') + '\n',
}), 'main.vxl', '3\nlinear\n1\n1\n[1]\n');

tRun('forward batch input', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    `cfg = ${LIN}`,
    'm = create model cfg',
    'y = m.forward tensor [[1,2],[3,4]]',
    'print y.rank',
    'print y.shape',
    'print y.size',
  ].join('\n') + '\n',
}), 'main.vxl', '2\n[2,1]\n2\n');

tDeterministic('create forward deterministic across runs', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nprint m.forward tensor [1,2]\n`,
}), 'main.vxl');

tRunFails('config chain mismatch', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'cfg = { format = "atlas-model", format_version = 1, name = "bad", arch = "mlp", layers = [{in = 4, out = 8, activation = "none"}, {in = 4, out = 2, activation = "none"}] }',
    'm = create model cfg',
  ].join('\n') + '\n',
}), 'main.vxl', 'Layer sizes do not chain: layer 0 outputs 8 but layer 1 expects input 4');

tRunFails('unknown architecture rejected', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'cfg = { format = "atlas-model", format_version = 1, name = "cnn", arch = "cnn", layers = [{in = 2, out = 1, activation = "none"}] }',
    'm = create model cfg',
  ].join('\n') + '\n',
}), 'main.vxl', "Architecture 'cnn' is not supported by Atlas v0.5");

tRunFails('linear takes one layer', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'cfg = { format = "atlas-model", format_version = 1, name = "deep", arch = "linear", layers = [{in = 2, out = 3, activation = "none"}, {in = 3, out = 1, activation = "none"}] }',
    'm = create model cfg',
  ].join('\n') + '\n',
}), 'main.vxl', "Architecture 'linear' takes exactly one layer, got 2");

tRunFails('unknown activation rejected', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'cfg = { format = "atlas-model", format_version = 1, name = "gelu", arch = "linear", layers = [{in = 2, out = 1, activation = "gelu"}] }',
    'm = create model cfg',
  ].join('\n') + '\n',
}), 'main.vxl', "activation 'gelu' is not supported");

tRunFails('missing arch rejected', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'cfg = { format = "atlas-model", format_version = 1, name = "noarch", layers = [{in = 2, out = 1, activation = "none"}] }',
    'm = create model cfg',
  ].join('\n') + '\n',
}), 'main.vxl', "Config is missing required field 'arch'");

tCheckFails('create model rejects a path string', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = create model "some/folder"\n',
}), 'main.vxl', 'create model takes a config object, not a path');

console.log('\n--- forward errors ---');

tRunFails('forward input size mismatch', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nprint m.forward tensor [1,2,3]\n`,
}), 'main.vxl', "Model 'lin' expects input size 2, got 3.");

tRunFails('forward rank 3 rejected', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nprint m.forward tensor [[[1,2]],[[3,4]]]\n`,
}), 'main.vxl', 'forward expects input shape [size] or [batch, size]');

tCheckFails('forward arity', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nx = tensor [1,2]\nprint m.forward x, x\n`,
}), 'main.vxl', 'forward expects 1 input tensor but got 2');

tCheckFails('forward needs a tensor arg', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nprint m.forward 5\n`,
}), 'main.vxl', 'forward needs a tensor input, got integer.');

tCheckFails('bare forward rejected', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nprint m.forward\n`,
}), 'main.vxl', 'forward needs an input tensor, e.g. m.forward x.');

tCheckFails('unknown model member', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nprint m.optimizer\n`,
}), 'main.vxl', "Model has no 'optimizer'");

console.log('\n--- modes + training ---');

tRun('eval/train switch', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nm.eval\nprint m.mode\nm.train\nprint m.mode\n`,
}), 'main.vxl', 'eval\ntrain\n');

tRunFails('eval forward has no gradient graph', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    `cfg = ${LIN}`,
    'm = create model cfg',
    'm.eval',
    'loss = (m.forward tensor [1,2]).sum',
    'loss.backward',
  ].join('\n') + '\n',
}), 'main.vxl', "decimal has no field 'backward'");

tRunFails('inference guard blocks tracking', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    `cfg = ${LIN}`,
    'm = create model cfg',
    'with inference {',
    '  y = m.forward tensor [1,2]',
    '}',
    'loss = y.sum',
    'loss.backward',
  ].join('\n') + '\n',
}), 'main.vxl', "decimal has no field 'backward'");

tRun('train forward backward produces grads', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    `cfg = ${LIN}`,
    'm = create model cfg',
    'y = m.forward tensor [0.5, 0.5]',
    'loss = y.sum',
    'loss.backward',
    'print m.parameters[1].grad.sum',
    'print m.parameters[0].grad.sum',
  ].join('\n') + '\n',
}), 'main.vxl', '1\n1\n');

tRun('with inference runs its body', Object.assign({}, A, {
  'main.vxl': 'import atlas\nwith inference {\n  print 5\n}\n',
}), 'main.vxl', '5\n');

tCheckFails('model fields are read-only', Object.assign({}, A, {
  'main.vxl': `import atlas\ncfg = ${LIN}\nm = create model cfg\nm.path = "x"\n`,
}), 'main.vxl', 'Model fields are read-only');

tCheckFails('save model expects a Model', Object.assign({}, A, {
  'main.vxl': 'import atlas\nn = 5\nsave model n to "d"\n',
}), 'main.vxl', 'save model expects a Model, got integer.');

tCheckFails('model path must be a string', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model 5\n',
}), 'main.vxl', 'Model path must be a string, got integer.');

console.log('\n--- save + load ---');

tRun('save then load roundtrip', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'm = create model atlas.default_config 2, 3, 1',
    'save model m to "mdir"',
    'print "[" + m.path + "]"',
    'm2 = load model "mdir"',
    'print m2.mode',
    'print m2.parameters.length',
    'print atlas.exists("mdir")',
    'print (m.forward tensor [1,2]) == (m2.forward tensor [1,2])',
    'print atlas.describe(model info "mdir")',
  ].join('\n') + '\n',
}), 'main.vxl', '[mdir]\neval\n4\ntrue\ntrue\nmlp-relu [mlp] 2 layers, 13 parameters (weights on disk, format v1)\n');

tRun('save creates nested folders', Object.assign({}, A, {
  'main.vxl': [
    'import atlas',
    'm = create model atlas.default_config 2, 3, 1',
    'save model m to "deep/nested/folder"',
    'print atlas.exists("deep/nested/folder")',
    'm3 = load model "deep/nested/folder"',
    'print m3.mode',
  ].join('\n') + '\n',
}), 'main.vxl', 'true\neval\n');

tRunFails('load missing folder', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "nope"\n',
}), 'main.vxl', "does not exist.");

tRunFails('load a plain file', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "f.txt"\n',
  'f.txt': 'not a folder\n',
}), 'main.vxl', 'is a file.');

tRunFails('load folder without config.json', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\n',
  'd/keep.txt': 'x\n',
}), 'main.vxl', 'is missing config.json');

tRunFails('Hugging Face config is honest', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "hf"\n',
  'hf/config.json': '{"architectures":["LlamaForCausalLM"],"model_type":"llama"}',
}), 'main.vxl', 'looks like a Hugging Face model');

tRunFails('HF repo id does not download', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "meta-llama/Llama-3.2-1B"\n',
}), 'main.vxl', 'looks like a Hugging Face repo id');

tRunFails('bad model.atlas magic', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\n',
  'd/config.json': LIN_JSON,
  'd/model.atlas': Buffer.concat([Buffer.from('AAAA', 'ascii'), Buffer.alloc(64, 0x41)]),
}), 'main.vxl', 'bad magic (expected ATLS)');

tRunAfterFails('corrupted model.atlas checksum', { 'main.vxl': 'import atlas\nm = load model "mdir"\nprint m.mode\n' },
  'setup.vxl',
  `import atlas\ncfg = ${LIN}\nm = create model cfg\nsave model m to "mdir"\n`,
  (tmp) => {
    const p = path.join(tmp, 'mdir', 'model.atlas');
    const buf = fs.readFileSync(p);
    const headerLen = Number(buf.readBigUInt64LE(16));
    const dataStart = 24 + headerLen;
    if (dataStart >= buf.length - 4) throw new Error('no data region to corrupt');
    buf[dataStart] = buf[dataStart] ^ 0xff;
    fs.writeFileSync(p, buf);
  },
  'main.vxl',
  'failed its checksum');

tRunFails('config with no weights', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\n',
  'd/config.json': LIN_JSON,
}), 'main.vxl', 'No weights found in');

console.log('\n--- SafeTensors ---');

tRun('load safetensors weights', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\nprint m.mode\nprint m.forward tensor [1,2]\n',
  'd/config.json': LIN_JSON,
  'd/model.safetensors': safetensorsBuf({ w: { shape: [2, 1], data: [0.5, 0.5] }, b: { shape: [1, 1], data: [0] } }),
}), 'main.vxl', 'eval\n[1.5]\n');

tRunAfter('model.atlas wins over safetensors',
  { 'main.vxl': 'import atlas\nma = load model "adir"\nmb = load model "sdir"\nprint mb.forward tensor [1,2]\nprint (ma.forward tensor [1,2]) == (mb.forward tensor [1,2])\n' },
  'setup.vxl',
  `import atlas\ncfg = ${LIN}\nm = create model cfg\nsave model m to "adir"\n`,
  (tmp) => {
    fs.writeFileSync(path.join(tmp, 'adir', 'model.safetensors'),
      safetensorsBuf({ w: { shape: [2, 1], data: [9, 9] }, b: { shape: [1, 1], data: [9] } }));
    fs.mkdirSync(path.join(tmp, 'sdir'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sdir', 'config.json'), LIN_JSON);
    fs.writeFileSync(path.join(tmp, 'sdir', 'model.safetensors'),
      safetensorsBuf({ w: { shape: [2, 1], data: [9, 9] }, b: { shape: [1, 1], data: [9] } }));
  },
  'main.vxl',
  '[36]\nfalse\n');

tRun('sharded safetensors index', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\nprint m.forward tensor [1,2]\n',
  'd/config.json': LIN_JSON,
  'd/model.safetensors.index.json': JSON.stringify({
    weight_map: { w: 'shard-0.safetensors', b: 'shard-1.safetensors' },
  }),
  'd/shard-0.safetensors': safetensorsBuf({ w: { shape: [2, 1], data: [1, 0] } }),
  'd/shard-1.safetensors': safetensorsBuf({ b: { shape: [1, 1], data: [0] } }),
}), 'main.vxl', '[1]\n');

tRunFails('unsafe shard path rejected', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\n',
  'd/config.json': LIN_JSON,
  'd/model.safetensors.index.json': JSON.stringify({ weight_map: { w: '../evil.safetensors' } }),
}), 'main.vxl', 'unsafe shard path');

tRunFails('safetensors shape mismatch', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\n',
  'd/config.json': LIN_JSON,
  'd/model.safetensors': safetensorsBuf({ w: { shape: [3, 1], data: [1, 2, 3] }, b: { shape: [1, 1], data: [0] } }),
}), 'main.vxl', "Weight 'w' has shape [3,1] but the config expects [2,1].");

tRunFails('tiny safetensors file', Object.assign({}, A, {
  'main.vxl': 'import atlas\nm = load model "d"\n',
  'd/config.json': LIN_JSON,
  'd/model.safetensors': Buffer.alloc(4),
}), 'main.vxl', 'too small to be a SafeTensors file');

console.log('\n--- info + exists ---');

tRun('exists true/false + describe config-only', Object.assign({}, A, {
  'main.vxl': 'import atlas\nprint atlas.exists("d")\nprint atlas.exists("nope")\nprint atlas.describe(model info "d")\n',
  'd/config.json': LIN_JSON,
}), 'main.vxl', 'true\nfalse\nstest [linear] 1 layers, 3 parameters (config only, no weights, format v1)\n');

tRunFails('model info missing folder', Object.assign({}, A, {
  'main.vxl': 'import atlas\nprint model info "nope"\n',
}), 'main.vxl', 'does not exist.');

console.log('\n--- static diagnostics ---');

tCheckFails('load model needs the atlas import', { 'main.vxl': 'm = load model "d"\n' },
  'main.vxl', 'load model needs the Atlas model library. Add: import atlas');

tCheckFails('create model needs the atlas import', { 'main.vxl': 'm = create model { a = 1 }\n' },
  'main.vxl', 'create model needs the Atlas model library. Add: import atlas');

tCheckFails('save model needs the atlas import', { 'main.vxl': 'n = 5\nsave model n to "d"\n' },
  'main.vxl', 'save model needs the Atlas model library. Add: import atlas');

tCheckFails('model info needs the atlas import', { 'main.vxl': 'print model info "d"\n' },
  'main.vxl', 'model info needs the Atlas model library. Add: import atlas');

tCheckFails('with inference needs the atlas import', { 'main.vxl': 'with inference {\n  print 1\n}\n' },
  'main.vxl', 'with inference needs the Atlas model library. Add: import atlas');

tCheckFails('UI rejects load model', Object.assign({}, A, {
  'main.vxl': 'import atlas\ncreate a window titled "T"\nx = load model "d"\nwindow.show\n',
}), 'main.vxl', 'console-only in v0.5');

tCheckFails('UI rejects with inference', Object.assign({}, A, {
  'main.vxl': 'import atlas\ncreate a window titled "T"\nwith inference {\n  print 1\n}\nwindow.show\n',
}), 'main.vxl', 'console-only in v0.5');

tCheckFails('move rejects a plain integer', { 'main.vxl': 'n = 5\nmove n to gpu\n' },
  'main.vxl', 'move expects a tensor, struct, list, or model');

console.log('\n--- GPU placement ---');

if (gpuAvailable()) {
  tRun('move model to gpu + forward', Object.assign({}, A, {
    'main.vxl': [
      'import atlas',
      'm = create model atlas.default_config 2, 3, 1',
      'yc = m.forward tensor [1,2]',
      'move m to gpu',
      'yg = m.forward tensor [1,2]',
      'print yg.device',
      'print yc == yg',
      'save model m to "mdir"',
      'print atlas.exists("mdir")',
      'm2 = load model "mdir"',
      'print m2.mode',
    ].join('\n') + '\n',
  }), 'main.vxl', 'gpu\ntrue\ntrue\neval\n');
} else {
  console.log('SKIP move model to gpu + forward (no GPU)');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
