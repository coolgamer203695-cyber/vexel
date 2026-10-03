'use strict';

// Vexel 2.9 feature tests — enums, null safety, pattern matching.
// Usage: node tests/v29/run_v29_tests.js
// Mirrors tests/run_tests.js harness; does not modify the 2.2 suite.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'vexel.js');

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function runProgram(files, entry, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const r = spawnSync('node', [BIN, path.join(tmp, entry)], {
      encoding: 'utf8', cwd: tmp, input: opts.input,
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function ok(name, files, entry, expected, opts) {
  const r = runProgram(files, entry, opts);
  const got = r.stdout.replace(/\r\n/g, '\n');
  if (r.status !== 0 || got !== expected.replace(/\r\n/g, '\n')) {
    failed++;
    failures.push(`${name}:\nExpected:\n${JSON.stringify(expected)}\nGot:\n${JSON.stringify(got)}\nstatus=${r.status}\nSTDERR:\n${r.stderr}`);
    console.log(`FAIL ${name}`);
    return;
  }
  passed++;
  console.log(`PASS ${name}`);
}

function checkFails(name, files, entry, mustContain) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const r = spawnSync('node', [BIN, 'check', path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp });
    const combined = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0 || (mustContain && !combined.includes(mustContain))) {
      failed++;
      failures.push(`${name}: expected check failure containing '${mustContain}'.\nGot status=${r.status}\n${combined}`);
      console.log(`FAIL ${name}`);
      return;
    }
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function runCli(name, files, entry, cliArgs, expected) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const r = spawnSync('node', [BIN, path.join(tmp, entry), ...cliArgs], { encoding: 'utf8', cwd: tmp });
    const got = (r.stdout || '').replace(/\r\n/g, '\n');
    if (r.status !== 0 || got !== expected.replace(/\r\n/g, '\n')) {
      failed++;
      failures.push(`${name}:\nExpected:\n${JSON.stringify(expected)}\nGot:\n${JSON.stringify(got)}\nstatus=${r.status}\nSTDERR:\n${r.stderr}`);
      console.log(`FAIL ${name}`);
      return;
    }
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function checkOk(name, files, entry) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const r = spawnSync('node', [BIN, 'check', path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp });
    if (r.status !== 0) {
      failed++;
      failures.push(`${name}: expected check OK.\n${r.stdout}${r.stderr}`);
      console.log(`FAIL ${name}`);
      return;
    }
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

console.log('=== Vexel 2.9: enums ===');
ok('enum basic + print', { 'm.vxl': 'enum State {\n    idle\n    running\n}\nstate = State.idle\nprint state\nstate = State.running\nprint state\n' }, 'm.vxl', 'idle\nrunning\n');
ok('enum conditions + functions', { 'm.vxl': 'enum State {\n    idle\n    done\n}\nfunction isDone s {\n    return s = State.done\n}\nprint isDone State.done\nprint isDone State.idle\n' }, 'm.vxl', 'true\nfalse\n');
ok('enum in struct', { 'm.vxl': 'enum Color {\n    red\n    blue\n}\nstruct Pixel {\n    color\n}\np = Pixel {\n    color = Color.red\n}\nprint p.color\np.color = Color.blue\nprint p.color\n' }, 'm.vxl', 'red\nblue\n');
ok('enum across modules', {
  'm.vxl': 'import lib/game\nprint game.mode\n',
  'lib/game.vxl': 'public enum Mode {\n    easy\n    hard\n}\npublic mode = Mode.hard\n',
}, 'm.vxl', 'hard\n');
checkFails('enum unknown value', { 'm.vxl': 'enum S {\n    a\n}\nx = S.bogus\n' }, 'm.vxl', "has no value 'bogus'");
checkFails('enum wrong-type assign', { 'm.vxl': 'enum S {\n    a\n}\nx = S.a\nx = "hi"\n' }, 'm.vxl', 'Type mismatch');
checkFails('enum as value', { 'm.vxl': 'enum S {\n    a\n}\nx = S\n' }, 'm.vxl', 'cannot be used as a value');
checkFails('enum duplicate', { 'm.vxl': 'enum S {\n    a\n}\nenum S {\n    b\n}\n' }, 'm.vxl', 'Duplicate enum');
checkFails('enum empty', { 'm.vxl': 'enum S {\n}\n' }, 'm.vxl', 'at least one value');
checkFails('enum clashes with struct', { 'm.vxl': 'struct S {\n    a\n}\nenum S {\n    b\n}\n' }, 'm.vxl', 'already defined as struct');
checkFails('private enum hidden', {
  'm.vxl': 'import lib/game\nprint game.Mode.hard\n',
  'lib/game.vxl': 'enum Mode {\n    easy\n    hard\n}\n',
}, 'm.vxl', 'private');

console.log('=== Vexel 2.9: null safety ===');
ok('null compare idiom', { 'm.vxl': 'x = null\nif x = null {\n    print "nil"\n} else {\n    print "val"\n}\n' }, 'm.vxl', 'nil\n');
ok('null prints', { 'm.vxl': 'x = null\nprint x\n' }, 'm.vxl', 'null\n');
checkFails('null arithmetic', { 'm.vxl': 'x = null\nprint x + 1\n' }, 'm.vxl', 'NullSafetyError');
checkFails('null field read', { 'm.vxl': 'x = null\nprint x.name\n' }, 'm.vxl', 'NullSafetyError');
checkFails('null index', { 'm.vxl': 'x = null\nprint x[0]\n' }, 'm.vxl', 'NullSafetyError');
checkFails('null write-through field', { 'm.vxl': 'x = null\nx.name = 1\n' }, 'm.vxl', 'NullSafetyError');
checkFails('null write-through index', { 'm.vxl': 'x = null\nx[0] = 1\n' }, 'm.vxl', 'NullSafetyError');
checkFails('null make', { 'm.vxl': 'x = null\nmake x number\n' }, 'm.vxl', 'NullSafetyError');
checkFails('null copy taint', { 'm.vxl': 'x = null\ny = x\nprint y + 1\n' }, 'm.vxl', 'NullSafetyError');
checkOk('null cleared by reassign via any', { 'm.vxl': 'x = null\nprint x\n' }, 'm.vxl');

console.log('=== Vexel 2.9: match ===');
ok('match enum bare + qualified', { 'm.vxl': 'enum S {\n    a\n    b\n    c\n}\ns = State.b\n'.replace(/State/g, 'S') + 'match s {\n    a {\n        print "A"\n    }\n    S.b {\n        print "B"\n    }\n    _ {\n        print "other"\n    }\n}\n' }, 'm.vxl', 'B\n');
ok('match literals + default', { 'm.vxl': 'n = 7\nmatch n {\n    1 {\n        print "one"\n    }\n    7 {\n        print "seven"\n    }\n    _ {\n        print "other"\n    }\n}\n' }, 'm.vxl', 'seven\n');
ok('match string no default', { 'm.vxl': 'c = "go"\nmatch c {\n    "stop" {\n        print "S"\n    }\n    "go" {\n        print "G"\n    }\n}\n' }, 'm.vxl', 'G\n');
ok('match null arm', { 'm.vxl': 'x = null\nmatch x {\n    null {\n        print "nil"\n    }\n    _ {\n        print "val"\n    }\n}\n' }, 'm.vxl', 'nil\n');
ok('match in function', { 'm.vxl': 'function label n {\n    match n {\n        1 {\n            return "one"\n        }\n        _ {\n            return "many"\n        }\n    }\n}\nprint label 1\nprint label 9\n' }, 'm.vxl', 'one\nmany\n');
checkFails('match default not last', { 'm.vxl': 'n = 1\nmatch n {\n    _ {\n        print "d"\n    }\n    1 {\n        print "one"\n    }\n}\n' }, 'm.vxl', 'must be last');
checkFails('match dup arm', { 'm.vxl': 'n = 1\nmatch n {\n    1 {\n        print "a"\n    }\n    1 {\n        print "b"\n    }\n}\n' }, 'm.vxl', 'Duplicate match arm');
checkFails('match bad enum value', { 'm.vxl': 'enum S {\n    a\n}\ns = S.a\nmatch s {\n    b {\n        print "x"\n    }\n}\n' }, 'm.vxl', 'has no value');
checkFails('match literal on enum', { 'm.vxl': 'enum S {\n    a\n}\ns = S.a\nmatch s {\n    1 {\n        print "x"\n    }\n}\n' }, 'm.vxl', 'Enum.value arms');
checkFails('match bare on integer', { 'm.vxl': 'n = 1\nmatch n {\n    one {\n        print "x"\n    }\n}\n' }, 'm.vxl', 'only matches enum values');

console.log('=== Vexel 2.9: terminal ===');
ok('terminal session + capture', { 'm.vxl': 'terminal {\n    cd "."\n    run "echo Hi"\n}\nout = run "echo Cap"\nprint "got:" + out\n' }, 'm.vxl', 'Hi\ngot:Cap\n\n');
ok('terminal session persists cd', { 'm.vxl': 'terminal {\n    run "mkdir t_s"\n    cd "t_s"\n    run "echo data > inner.txt"\n    cd ".."\n}\nprint file read "t_s/inner.txt"\ndir delete "t_s"\nprint "done"\n' }, 'm.vxl', 'data \n\ndone\n');
ok('terminal failures are catchable', { 'm.vxl': 'try {\n    terminal {\n        cd "no-such-dir-xyz"\n    }\n} error {\n    print error.message\n}\ntry {\n    run "exit 3"\n} error {\n    print error.message\n}\n' }, 'm.vxl', 'cd: directory not found: no-such-dir-xyz\nrun exited with code 3: exit 3\n');
checkFails('cd outside terminal', { 'm.vxl': 'cd "docs"\n' }, 'm.vxl', 'inside terminal');
checkFails('terminal junk rejected', { 'm.vxl': 'terminal {\n    print "hi"\n}\n' }, 'm.vxl', "Only 'cd' and 'run'");

console.log('=== Vexel 2.9: filesystem ===');
ok('file write/read/append/size/exists', { 'm.vxl': 'file write "hi" to "a.txt"\nfile append "!" to "a.txt"\nprint file read "a.txt"\nprint file size "a.txt"\nprint file exists "a.txt"\nprint file exists "zz-nope.txt"\nfile delete "a.txt"\nprint file exists "a.txt"\n' }, 'm.vxl', 'hi!\n3\ntrue\nfalse\nfalse\n');
ok('file copy/move', { 'm.vxl': 'file write "data" to "b.txt"\nfile copy "b.txt" to "c.txt"\nprint file exists "b.txt"\nfile move "c.txt" to "d.txt"\nprint file exists "c.txt"\nprint file read "d.txt"\nfile delete "b.txt"\nfile delete "d.txt"\nprint "ok"\n' }, 'm.vxl', 'true\nfalse\ndata\nok\n');
ok('dir move removes source', { 'm.vxl': 'dir create "e1/sub"\ndir move "e1" to "e2"\nprint dir exists "e1"\nprint dir exists "e2"\ndir delete "e2"\nprint "ok"\n' }, 'm.vxl', 'false\ntrue\nok\n');
ok('dir create/list/copy/move/delete', { 'm.vxl': 'dir create "d1/sub"\nprint dir exists "d1"\nprint dir list "d1"\ndir copy "d1" to "d2"\ndir move "d2" to "d3"\nprint dir list "d3"\ndir delete "d1"\ndir delete "d3"\nprint "ok"\n' }, 'm.vxl', 'true\n[sub]\n[sub]\nok\n');
ok('fs failures are catchable', { 'm.vxl': 'try {\n    print file read "zz-nope.txt"\n} error {\n    print error.message\n}\ntry {\n    print dir list "zz-nope"\n} error {\n    print error.message\n}\n' }, 'm.vxl', 'File not found: zz-nope.txt\nDirectory not found: zz-nope\n');
checkFails('file write needs text', { 'm.vxl': 'file write 42 to "a.txt"\n' }, 'm.vxl', 'needs text');

console.log('=== Vexel 2.9: UI backend (check stage) ===');
checkOk('ui enum + match + assert', { 'm.vxl': 'create a window titled "W"\nenum Mode {\n    easy\n    hard\n}\nmode = Mode.hard\nlabel = add a text titled "x"\nmatch mode {\n    easy {\n        label.text = "E"\n    }\n    hard {\n        label.text = "H"\n    }\n}\nassert mode = Mode.hard\nwindow.show\n' }, 'm.vxl');
checkOk('ui http post + timeout', { 'm.vxl': 'create a window titled "W"\nhttp timeout 10\ntask f {\n    resp = http post "https://example.com/x", "a=1"\n    result = resp.status\n}\nwindow.show\n' }, 'm.vxl');
checkFails('ui wait-handle needs polling', { 'm.vxl': 'create a window titled "W"\ntask f {\n    result = 1\n}\nwait f\nwindow.show\n' }, 'm.vxl', 'Poll');

console.log('=== Vexel 2.9: incremental builds ===');
(function incremental() {
  const { spawnSync: sp } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'print "v1"\n', 'utf8');
    const b1 = sp('node', [BIN, 'build', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    const b2 = sp('node', [BIN, 'build', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    if (b1.status !== 0 || !(b1.stdout || '').includes('Built ') || b2.status !== 0 || !(b2.stdout || '').includes('Up to date')) {
      failed++;
      failures.push(`incremental skip.\n1:${b1.stdout}${b1.stderr}\n2:${b2.stdout}${b2.stderr}`);
      console.log('FAIL incremental skip');
    } else {
      passed++;
      console.log('PASS incremental skip');
    }
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'print "v2"\n', 'utf8');
    const b3 = sp('node', [BIN, 'build', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    const exe = path.join(tmp, process.platform === 'win32' ? 'm.exe' : 'm');
    const run = sp(exe, [], { encoding: 'utf8', cwd: tmp });
    if (b3.status !== 0 || !(b3.stdout || '').includes('Built ') || run.stdout !== 'v2\n') {
      failed++;
      failures.push(`incremental rebuild.\n${b3.stdout}${b3.stderr}\nrun:${run.stdout}${run.stderr}`);
      console.log('FAIL incremental rebuild');
    } else {
      passed++;
      console.log('PASS incremental rebuild');
    }
    const c = sp('node', [BIN, 'clean'], { encoding: 'utf8', cwd: tmp });
    const cacheGone = !fs.existsSync(path.join(tmp, '.vexel-cache'));
    const exeGone = !fs.existsSync(exe);
    if (c.status !== 0 || !cacheGone || !exeGone) {
      failed++;
      failures.push(`clean removes artifacts.\n${c.stdout}${c.stderr}`);
      console.log('FAIL clean removes artifacts');
    } else {
      passed++;
      console.log('PASS clean removes artifacts');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();

console.log('=== Vexel 2.9: UI additions (check stage) ===');
checkOk('toolbar separator + group', { 'm.vxl': 'create a window titled "W"\nbar = add a toolbar\nbar.x = 0\nbar.y = 0\nbar.width = 400\nbar.height = 40\nsave = bar.add a button titled "Save"\nbar.add separator\ngrp = bar.add group "Edit"\ncut = grp.add a button titled "Cut"\nwindow.show\n' }, 'm.vxl');
checkOk('table selected + change + clear', { 'm.vxl': 'create a window titled "W"\ngrid = add a table\ngrid.add column "Name"\ngrid.add row ["Zen", 25]\ngrid.selected = 0\nprint grid.selected\nprint grid.selected_index\ngrid.on change {\n    print event.value\n}\ngrid.clear\nwindow.show\n' }, 'm.vxl');
checkOk('button shortcut', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "Save"\nb.shortcut = "Ctrl+S"\nb.on click {\n    print "saved"\n}\nwindow.show\n' }, 'm.vxl');
checkFails('separator needs toolbar', { 'm.vxl': 'create a window titled "W"\nbox = add a list\nbox.add separator\nwindow.show\n' }, 'm.vxl', 'Only a toolbar takes separators');
checkFails('bad shortcut modifier', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.shortcut = "Hyper+S"\nwindow.show\n' }, 'm.vxl', 'Unknown shortcut modifier');
checkFails('shortcut needs key', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.shortcut = "Ctrl+"\nwindow.show\n' }, 'm.vxl', 'needs a key');
(function debugDpi() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'create a window titled "W"\nb = add a button titled "Go"\nb.x = 20\nb.y = 20\nb.width = 463\nb.height = 45\nwindow.show\n', 'utf8');
    const r = spawnSync('node', [BIN, 'debug', '--dpi', 'all', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    const out = (r.stdout || '');
    if (r.status !== 0 || !out.includes('DPI 100%') || !out.includes('DPI 200%') || !out.includes('fractional')) {
      failed++;
      failures.push(`debug dpi matrix.\n${out}${r.stderr}`);
      console.log('FAIL debug dpi matrix');
      return;
    }
    passed++;
    console.log('PASS debug dpi matrix');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();
(function debugOverlap() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'create a window titled "W"\na = add a button titled "A"\na.x = 10\na.y = 10\na.width = 200\na.height = 60\nb = add a button titled "B"\nb.x = 100\nb.y = 30\nb.width = 200\nb.height = 60\nwindow.show\n', 'utf8');
    const r = spawnSync('node', [BIN, 'debug', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    const out = (r.stdout || '');
    if (r.status !== 0 || !out.includes('overlaps')) {
      failed++;
      failures.push(`debug overlap warning.\n${out}${r.stderr}`);
      console.log('FAIL debug overlap warning');
      return;
    }
    passed++;
    console.log('PASS debug overlap warning');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();

console.log('=== Vexel 2.9: CLI arguments ===');
runCli('args forwarded + indexed', { 'm.vxl': 'print args.length\nprint args[0]\nname = args[1]\nprint "Hi " + name\n' }, 'm.vxl', ['Zen', 'Dev'], '2\nZen\nHi Dev\n');
runCli('args empty list', { 'm.vxl': 'print args.length\nif args.length = 0 {\n    print "none"\n}\n' }, 'm.vxl', [], '0\nnone\n');
checkOk('args shadowed by user var', { 'm.vxl': 'args = 5\nprint args\n' }, 'm.vxl');

console.log('=== Vexel 2.9: projects ===');
(function projectRootWalk() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'vexel.project'), JSON.stringify({ name: 'p', version: '1.0.0', main: 'main.vxl' }), 'utf8');
    fs.writeFileSync(path.join(tmp, 'main.vxl'), 'print "from-root"\n', 'utf8');
    fs.mkdirSync(path.join(tmp, 'sub', 'deep'), { recursive: true });
    const r = spawnSync('node', [BIN, 'check'], { encoding: 'utf8', cwd: path.join(tmp, 'sub', 'deep') });
    if (r.status !== 0 || !((r.stdout || '').includes('OK:'))) {
      failed++;
      failures.push(`project root walk:\n${r.stdout}${r.stderr}`);
      console.log('FAIL project root walk');
      return;
    }
    passed++;
    console.log('PASS project root walk');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();

console.log('=== Vexel 2.9: vexel check ===');
(function checkOutput() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'print "hi"\n', 'utf8');
    const r = spawnSync('node', [BIN, 'check', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    const out = (r.stdout || '');
    const stages = ['Vexel Check', '✓ Parsing', '✓ Type checking', '✓ Modules', '✓ Code generation', '0 errors', '0 warnings'];
    const missing = stages.filter((s) => !out.includes(s));
    if (r.status !== 0 || missing.length) {
      failed++;
      failures.push(`check staged output missing: ${missing.join(', ')}.\n${out}${r.stderr}`);
      console.log('FAIL check staged output');
      return;
    }
    passed++;
    console.log('PASS check staged output');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();
(function checkDupImportWarning() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'import lib/a\nimport lib/a\nprint "x"\n', 'utf8');
    fs.mkdirSync(path.join(tmp, 'lib'));
    fs.writeFileSync(path.join(tmp, 'lib', 'a.vxl'), 'print "a"\n', 'utf8');
    const r = spawnSync('node', [BIN, 'check', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
    const out = (r.stdout || '');
    if (r.status !== 0 || !out.includes('1 warning') || !out.includes('imported twice')) {
      failed++;
      failures.push(`check dup-import warning.\n${out}${r.stderr}`);
      console.log('FAIL check dup-import warning');
      return;
    }
    passed++;
    console.log('PASS check dup-import warning');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
})();

console.log('=== Vexel 2.9: testing system ===');
function runTestCmd(files, entry) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    return spawnSync('node', [BIN, 'test', path.join(tmp, entry)], { encoding: 'utf8', cwd: tmp });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}
(function testRunnerPass() {
  const r = runTestCmd({ 'm.vxl': 'function add a, b {\n    return a + b\n}\ntest "addition" {\n    result = add 5, 3\n    assert result = 8\n}\ntest "truth" {\n    assert true\n}\n' }, 'm.vxl');
  const out = (r.stdout || '').replace(/\r\n/g, '\n');
  if (r.status !== 0 || !out.includes('Vexel Test Runner') || !out.includes('2 passed') || !out.includes('0 failed')) {
    failed++;
    failures.push(`test runner pass.\nstatus=${r.status}\n${out}${r.stderr}`);
    console.log('FAIL test runner pass');
    return;
  }
  passed++;
  console.log('PASS test runner pass');
})();
(function testRunnerFail() {
  const r = runTestCmd({ 'm.vxl': 'test "bad math" {\n    assert 1 = 2\n}\ntest "good" {\n    assert 1 = 1\n}\n' }, 'm.vxl');
  const out = (r.stdout || '').replace(/\r\n/g, '\n');
  if (r.status === 0 || !out.includes('1 passed') || !out.includes('1 failed') || !out.includes('Assertion failed (m.vxl line 2)')) {
    failed++;
    failures.push(`test runner fail.\nstatus=${r.status}\n${out}${r.stderr}`);
    console.log('FAIL test runner fail');
    return;
  }
  passed++;
  console.log('PASS test runner fail');
})();
(function testRunnerEmpty() {
  const r = runTestCmd({ 'm.vxl': 'print "no tests here"\n' }, 'm.vxl');
  const out = (r.stdout || '').replace(/\r\n/g, '\n');
  if (r.status !== 0 || !out.includes('No tests found.') || !out.includes('0 passed')) {
    failed++;
    failures.push(`test runner empty.\nstatus=${r.status}\n${out}${r.stderr}`);
    console.log('FAIL test runner empty');
    return;
  }
  passed++;
  console.log('PASS test runner empty');
})();
checkFails('assert needs boolean', { 'm.vxl': 'test "x" {\n    assert 42\n}\n' }, 'm.vxl', 'Assert needs a boolean');
checkFails('return in test', { 'm.vxl': 'test "x" {\n    return 1\n}\n' }, 'm.vxl', 'Cannot return from a test');
checkFails('duplicate test name', { 'm.vxl': 'test "a" {\n    assert true\n}\ntest "a" {\n    assert true\n}\n' }, 'm.vxl', 'Duplicate test');
checkFails('test in function', { 'm.vxl': 'function f {\n    test "x" {\n        assert true\n    }\n}\n' }, 'm.vxl', 'not allowed inside a function');

console.log('=== Vexel 2.9: diagnostics ===');
checkFails('did-you-mean name', { 'm.vxl': 'name = "Zen"\nprint naem\n' }, 'm.vxl', "Did you mean 'name'");
checkFails('reassign notes previous', { 'm.vxl': 'name = "Zen"\nname = 25\n' }, 'm.vxl', 'previously inferred as string at line 1');

console.log('=== Vexel 2.9: console tasks ===');
ok('task compute + wait + result', { 'm.vxl': 'task calc {\n    total = 0\n    n = 1\n    repeat till n = 6 {\n        total = total + n\n        n = n + 1\n    }\n    result = total\n}\nwait calc\nprint calc.state\nprint calc.result\n' }, 'm.vxl', 'completed\n15\n');
ok('task cancel', { 'm.vxl': 'task slow {\n    wait 30 seconds\n    result = "done"\n}\nrepeat till slow.state = "running" {\n}\nslow.cancel\nwait slow\nprint slow.state\n' }, 'm.vxl', 'cancelled\n');
ok('task failure surfaces', { 'm.vxl': 'task bad {\n    error "boom"\n}\nwait bad\nprint bad.state\nprint bad.error.message\n' }, 'm.vxl', 'failed\nboom\n');
ok('task sees globals snapshot', { 'm.vxl': 'base = 100\ntask read {\n    result = base + 23\n}\nwait read\nprint read.result\n' }, 'm.vxl', '123\n');
checkFails('return in task', { 'm.vxl': 'task t {\n    return 1\n}\n' }, 'm.vxl', 'Cannot return from a task');
checkFails('wait needs handle', { 'm.vxl': 'x = 5\nwait x\n' }, 'm.vxl', 'task handle');

console.log('=== Vexel 2.9: HTTP ===');
const HTTP_PORT = 18099;
// The echo server runs as a separate process: spawnSync blocks this
// process's event loop, so an in-process server could never answer.
function httpUp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-srv-'));
  const srvFile = path.join(dir, 'srv.js');
  fs.writeFileSync(srvFile, `'use strict';\nrequire('http').createServer((req, res) => {\n  let body = '';\n  req.on('data', (c) => { body += c; });\n  req.on('end', () => {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ method: req.method, path: req.url, echo: body, tok: req.headers['tok'] || null }));\n  });\n}).listen(${HTTP_PORT}, '127.0.0.1');\n`, 'utf8');
  const child = require('child_process').spawn('node', [srvFile], { stdio: 'ignore', detached: false });
  const probe = `require('net').connect(${HTTP_PORT},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),800);`;
  for (let i = 0; i < 60; i++) {
    const r = require('child_process').spawnSync('node', ['-e', probe]);
    if (r.status === 0) break;
  }
  return { child, dir };
}
(function () {
  const srv = httpUp();
  try {
    ok('http get', { 'm.vxl': `resp = http get "http://127.0.0.1:${HTTP_PORT}/items"\nprint resp.status\nprint resp.text\n` }, 'm.vxl', '200\n{"method":"GET","path":"/items","echo":"","tok":null}\n');
    ok('http post text + headers', { 'm.vxl': `resp = http post "http://127.0.0.1:${HTTP_PORT}/items", "name=zen", { tok = "abc" }\nprint resp.status\nprint resp.text\n` }, 'm.vxl', '200\n{"method":"POST","path":"/items","echo":"name=zen","tok":"abc"}\n');
    ok('http post json object', { 'm.vxl': `p = {\n    name = "Zen"\n}\nresp = http put "http://127.0.0.1:${HTTP_PORT}/j", p\nprint resp.status\n` }, 'm.vxl', '200\n');
    ok('http patch + delete', { 'm.vxl': `a = http patch "http://127.0.0.1:${HTTP_PORT}/p", "x"\nprint a.status\nb = http delete "http://127.0.0.1:${HTTP_PORT}/p"\nprint b.status\nhttp timeout 5\nprint "t-ok"\n` }, 'm.vxl', '200\n200\nt-ok\n');
    ok('http failures catchable', { 'm.vxl': 'try {\n    resp = http get "http://"\n} error {\n    print error.message\n}\ntry {\n    resp = http get "not a url"\n} error {\n    print error.message\n}\ntry {\n    resp = http get "https://127.0.0.1:1/secure"\n} error {\n    print error.message\n}\n' }, 'm.vxl', "HTTP Error: Invalid URL 'http://'.\nConsole programs reach http:// URLs only. Build a desktop app for https://.\nConsole programs reach http:// URLs only. Build a desktop app for https://.\n");
    checkFails('http url must be string', { 'm.vxl': 'resp = http get 42\n' }, 'm.vxl', 'must be a string');
    checkFails('http body type', { 'm.vxl': 'resp = http post "http://x", 42\n' }, 'm.vxl', 'must be text or an object');
    checkFails('http get no body', { 'm.vxl': 'resp = http get "http://x", "body", { a = "b" }\n' }, 'm.vxl', 'optional headers only');
  } finally {
    try { srv.child.kill(); } catch (e) { /* ignore */ }
    try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  console.log('=== Vexel 2.9: live UI (best effort) ===');
  try {
    if (process.platform !== 'win32') throw new Error('no-desktop');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel29-uilive-'));
    try {
      fs.writeFileSync(path.join(tmp, 'm.vxl'), [
        'create a window titled "VexLive29"',
        'set window position to 100, 100',
        'window.width = 500',
        'window.height = 400',
        'save = add a button titled "Save"',
        'save.x = 20',
        'save.y = 20',
        'save.width = 150',
        'save.height = 45',
        'save.shortcut = "Ctrl+S"',
        'grid = add a table',
        'grid.x = 20',
        'grid.y = 80',
        'grid.width = 440',
        'grid.height = 160',
        'grid.add column "Name"',
        'grid.add row ["Zen", 25]',
        'grid.add row ["Alex", 30]',
        'status = add a text titled "ready"',
        'status.x = 20',
        'status.y = 255',
        'status.width = 440',
        'status.height = 30',
        'save.on click {',
        '    status.text = "saved!"',
        '}',
        'grid.on change {',
        '    status.text = "row " + event.value',
        '}',
        'after 8 seconds {',
        '    json write status.text to "probe.json"',
        '}',
        'window.show',
      ].join('\n'), 'utf8');
      const b = spawnSync('node', [BIN, 'build', path.join(tmp, 'm.vxl')], { encoding: 'utf8', cwd: tmp });
      const exe = path.join(tmp, 'm.exe');
      if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
      const probe = `
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Clicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public const int DOWN = 0x02, UP = 0x04;
}
'@;
        Add-Type -AssemblyName System.Windows.Forms;
        $p = Start-Process -FilePath "${exe.replace(/\\/g, '\\\\')}" -WorkingDirectory "${tmp.replace(/\\/g, '\\\\')}" -PassThru;
        for ($i = 0; $i -lt 40 -and ($p.MainWindowHandle -eq 0); $i++) { Start-Sleep -Milliseconds 250; $p.Refresh() };
        Start-Sleep -Milliseconds 2500;
        $r = New-Object Clicker+RECT;
        [Clicker]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null;
        [Clicker]::SetForegroundWindow($p.MainWindowHandle) | Out-Null;
        Start-Sleep -Milliseconds 500;
        [Clicker]::SetCursorPos($r.L + 8 + 240, $r.T + 31 + 145);
        Start-Sleep -Milliseconds 300;
        [Clicker]::mouse_event([Clicker]::DOWN, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 100;
        [Clicker]::mouse_event([Clicker]::UP, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 800;
        [System.Windows.Forms.SendKeys]::SendWait("^s");
        Start-Sleep -Milliseconds 9000;
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { };
      `;
      spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe], { encoding: 'utf8', timeout: 120000 });
      const got = fs.existsSync(path.join(tmp, 'probe.json')) ? fs.readFileSync(path.join(tmp, 'probe.json'), 'utf8') : '';
      // Row click selects row 2 ("row 1"), then Ctrl+S saves ("saved!").
      if (got === '"saved!"') {
        passed++;
        console.log('PASS live table click + shortcut');
      } else {
        throw new Error('no-interaction (got ' + JSON.stringify(got) + ')');
      }
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    skipped++;
    console.log('SKIP live table click + shortcut (' + e.message + ')');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('---\n' + f);
    process.exit(1);
  }
})();
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('---\n' + f);
  process.exit(1);
}
