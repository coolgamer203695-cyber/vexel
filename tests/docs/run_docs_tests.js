'use strict';

// Vexel docs tests — every ```vxl block in docs/atlas.md must RUN
// cleanly, every ```vxl-fail block must fail `vexel check`.
// Blocks that `import nn` get nn.vxl copied beside them (imports are
// side-by-side only).
// Usage: node tests/docs/run_docs_tests.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'vexel.js');
const DOC = path.join(ROOT, 'docs', 'atlas.md');

let passed = 0;
let failed = 0;
const failures = [];

function blocks(markdown) {
  const out = [];
  const re = /```(vxl|vxl-fail)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    out.push({ mode: m[1], code: m[2], line: markdown.slice(0, m.index).split('\n').length });
  }
  return out;
}

function sideFiles(code) {
  // Copy every `import <name>` sibling from the repo root.
  const files = {};
  const re = /import\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const src = path.join(ROOT, m[1] + '.vxl');
    if (fs.existsSync(src)) files[m[1] + '.vxl'] = fs.readFileSync(src, 'utf8');
  }
  return files;
}

function runOne(b, idx) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-docs-'));
  try {
    const entry = path.join(tmp, 'block.vxl');
    fs.writeFileSync(entry, b.code, 'utf8');
    for (const [name, content] of Object.entries(sideFiles(b.code))) {
      fs.writeFileSync(path.join(tmp, name), content, 'utf8');
    }
    const args = b.mode === 'vxl-fail' ? ['check', entry] : [entry];
    const r = spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd: tmp, timeout: 300000 });
    const combined = (r.stdout || '') + (r.stderr || '');
    const ok = b.mode === 'vxl-fail' ? r.status !== 0 : r.status === 0;
    if (ok) {
      passed++;
      console.log(`PASS ${b.mode} block ${idx} (line ${b.line})`);
    } else {
      failed++;
      failures.push(`${b.mode} block ${idx} (line ${b.line}): status=${r.status}\n${combined}`);
      console.log(`FAIL ${b.mode} block ${idx} (line ${b.line})`);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

console.log('=== Vexel docs tests (docs/atlas.md) ===');
const all = blocks(fs.readFileSync(DOC, 'utf8'));
all.forEach((b, i) => runOne(b, i + 1));

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
