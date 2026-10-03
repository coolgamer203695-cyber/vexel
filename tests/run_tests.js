'use strict';

// Vexel v0.1 test suite — runs compiler checks + native execution tests.
// Usage: node tests/run_tests.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'vexel.js');

let passed = 0;
let failed = 0;
const failures = [];

function vexel(args, opts = {}) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || ROOT,
    input: opts.input,
  });
}

function runProgram(name, files, entry, opts = {}) {
  // files: { relPath: content }, entry: relPath of main file
  // Returns { stdout, stderr, status }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const entryAbs = path.join(tmp, entry);
    const r = spawnSync('node', [BIN, entryAbs], {
      encoding: 'utf8',
      cwd: tmp,
      input: opts.input,
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status, tmp };
  } finally {
    // Keep tmp on failure for debugging? Remove always for cleanliness.
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function assertOutput(name, files, entry, expectedStdout, opts = {}) {
  const r = runProgram(name, files, entry, opts);
  // vexel bare-run prints program stdout to stdout; compiler messages to stdout/stderr.
  // Compare trimmed lines (ignore trailing spaces, allow flexible newlines).
  const got = (r.stdout || '').replace(/\r\n/g, '\n');
  const want = expectedStdout.replace(/\r\n/g, '\n');
  if (r.status !== 0) {
    failed++;
    failures.push(`${name}: expected exit 0 but got ${r.status}\nSTDOUT:\n${got}\nSTDERR:\n${r.stderr}`);
    console.log(`FAIL ${name} (non-zero exit)`);
    return;
  }
  if (got !== want) {
    failed++;
    failures.push(`${name}:\nExpected:\n${JSON.stringify(want)}\nGot:\n${JSON.stringify(got)}\nSTDERR:\n${r.stderr}`);
    console.log(`FAIL ${name}`);
    return;
  }
  passed++;
  console.log(`PASS ${name}`);
}

function assertCheckFails(name, files, entry, mustContain) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const entryAbs = path.join(tmp, entry);
    const r = spawnSync('node', [BIN, 'check', entryAbs], { encoding: 'utf8', cwd: tmp });
    const combined = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0) {
      failed++;
      failures.push(`${name}: expected check to fail but it passed.`);
      console.log(`FAIL ${name} (should have failed)`);
      return;
    }
    if (mustContain && !combined.includes(mustContain)) {
      failed++;
      failures.push(`${name}: error output missing '${mustContain}'.\nGot:\n${combined}`);
      console.log(`FAIL ${name} (wrong error)`);
      return;
    }
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function assertRunFails(name, files, entry, mustContain) {
  // Compiles OK but runtime fails (non-zero exit) OR compile fails — either way, error expected.
  // For runtime errors outside try, program exits non-zero with message on stderr.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-test-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const entryAbs = path.join(tmp, entry);
    const r = spawnSync('node', [BIN, entryAbs], { encoding: 'utf8', cwd: tmp });
    const combined = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0) {
      failed++;
      failures.push(`${name}: expected runtime failure but exited 0.\nOutput:\n${combined}`);
      console.log(`FAIL ${name} (should have failed at runtime)`);
      return;
    }
    if (mustContain && !combined.includes(mustContain)) {
      failed++;
      failures.push(`${name}: runtime output missing '${mustContain}'.\nGot:\n${combined}`);
      console.log(`FAIL ${name} (wrong runtime error)`);
      return;
    }
    passed++;
    console.log(`PASS ${name}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function testLexer() {
  const { lex } = require('../compiler/lexer/lexer.js');
  // Comments ignored, positions tracked
  const src = '// hello\nprint "Hi" // trailing\nx = 10';
  const { tokens } = lex(src, 'test.vxl');
  const kinds = tokens.map((t) => t.type + ':' + t.value);
  const hasPrint = kinds.some((k) => k === 'KEYWORD:print');
  const hasString = kinds.some((k) => k === 'STRING:Hi');
  if (hasPrint && hasString) {
    passed++;
    console.log('PASS lexer: comments/positions');
  } else {
    failed++;
    failures.push('lexer: missing tokens ' + JSON.stringify(kinds));
    console.log('FAIL lexer: comments/positions');
  }
  // Keywords present
  const needed = ['print', 'if', 'else', 'repeat', 'till', 'function', 'return', 'import', 'public', 'try', 'error'];
  const { KEYWORDS } = require('../compiler/lexer/lexer.js');
  const missing = needed.filter((k) => !KEYWORDS.has(k));
  if (missing.length === 0) {
    passed++;
    console.log('PASS lexer: keywords');
  } else {
    failed++;
    failures.push('lexer keywords missing: ' + missing.join(','));
    console.log('FAIL lexer: keywords');
  }
}

function testParser() {
  const { lex } = require('../compiler/lexer/lexer.js');
  const { parse } = require('../compiler/parser/parser.js');
  const src = 'x = 10\nprint x + 1\nif x > 5 {\n print "big"\n}';
  try {
    const { tokens, lines } = lex(src, 'test.vxl');
    const ast = parse(tokens, lines, 'test.vxl');
    const types = ast.body.map((s) => s.type);
    if (types.includes('VarAssign') && types.includes('PrintStmt') && types.includes('IfStmt')) {
      passed++;
      console.log('PASS parser: AST nodes');
    } else {
      failed++;
      failures.push('parser AST missing nodes: ' + JSON.stringify(types));
      console.log('FAIL parser: AST nodes');
    }
  } catch (e) {
    failed++;
    failures.push('parser threw: ' + (e.format ? e.format() : e.message));
    console.log('FAIL parser: AST nodes');
  }
}

console.log('=== Vexel v0.1 tests ===\n--- lexer/parser ---');
testLexer();
testParser();

console.log('\n--- programs ---');
assertOutput('hello', { 'main.vxl': 'print "Hello World!"\n' }, 'main.vxl', 'Hello World!\n');
assertOutput('variables', { 'main.vxl': 'name = "Zen"\nprint name\nx = 10\ny = 20\nprint x + y\n' }, 'main.vxl', 'Zen\n30\n');
assertOutput('arithmetic precedence', { 'main.vxl': 'print 10 + 2 * 3\nprint (10 + 2) * 3\nprint 10 % 3\n' }, 'main.vxl', '16\n36\n1\n');
assertOutput('conditions', { 'main.vxl': 'age = 18\nif age >= 18 {\n print "Adult"\n} else if age >= 13 {\n print "Teen"\n} else {\n print "Child"\n}\n' }, 'main.vxl', 'Adult\n');
assertOutput('logic and/or/not', { 'main.vxl': 'age = 20\nready = true\nif age >= 18 and ready {\n print "A"\n}\nif not ready {\n print "B"\n} else {\n print "C"\n}\n' }, 'main.vxl', 'A\nC\n');
assertOutput('repeat count', { 'main.vxl': 'repeat 3 {\n print "Vexel"\n}\n' }, 'main.vxl', 'Vexel\nVexel\nVexel\n');
assertOutput('repeat till', { 'main.vxl': 'x = 0\nrepeat till x = 3 {\n print x\n x = x + 1\n}\n' }, 'main.vxl', '0\n1\n2\n');
assertOutput('functions', { 'main.vxl': 'function hello {\n print "Hi"\n}\nhello\nfunction add a, b {\n return a + b\n}\nprint add 2, 3\n' }, 'main.vxl', 'Hi\n5\n');
assertOutput('function scope is local', { 'main.vxl': 'x = 1\nfunction test {\n x = 99\n print x\n}\ntest\nprint x\n' }, 'main.vxl', '99\n1\n');
assertOutput('lists', { 'main.vxl': 'names = ["Zen", "Alex"]\nprint names[0]\nnames[1] = "Mike"\nprint names[1]\nnames.add "Sarah"\nprint names.length\nprint names[2]\n' }, 'main.vxl', 'Zen\nMike\n3\nSarah\n');
assertOutput('index-from list (1.1.0)', { 'main.vxl': 'list = ["Rock", "Scissors", "Paper"]\nprint [0] from list\nprint [2] from list\n' }, 'main.vxl', 'Rock\nPaper\n');
assertOutput('list remove', { 'main.vxl': 'a = [1, 2, 3]\na.remove 1\nprint a[0]\nprint a[1]\nprint a.length\n' }, 'main.vxl', '1\n3\n2\n');
assertOutput('strings', { 'main.vxl': 'name = "Zen"\nprint "Hello " + name\nprint length of name\nprint [1] from name\nmake name upper\nprint name\n' }, 'main.vxl', 'Hello Zen\n3\ne\nZEN\n');
assertOutput('structs', { 'main.vxl': 'struct Player {\n name\n age\n}\nplayer = Player {\n name = "Zen"\n age = 25\n}\nprint player.name\nplayer.age = 26\nprint player.age\n' }, 'main.vxl', 'Zen\n26\n');
assertOutput('number of', { 'main.vxl': 'print number of "42"\nprint number of "3.5"\nprint number of 7\nnumber = "11"\nprint number of number\n' }, 'main.vxl', '42\n3.5\n7\n11\n');
assertOutput('number of invalid caught', { 'main.vxl': 'try {\n print number of "abc"\n} error {\n print error\n}\n' }, 'main.vxl', 'Cannot convert "abc" to a number.\n');
assertOutput('calculator', {
  'main.vxl': 'add input "First:"\nset output = first\nadd input "Second:"\nset output = second\ntry {\n a = number of first\n} error {\n print error\n a = 0\n}\ntry {\n b = number of second\n} error {\n print error\n b = 0\n}\nfunction add x, y {\n return x + y\n}\nprint add a, b\n',
}, 'main.vxl', 'First:Second:25\n', { input: '20\n5\n' });
assertOutput('random range', { 'main.vxl': 'x = r from 1 to 10\nif x >= 1 and x <= 10 {\n print "ok"\n} else {\n print "bad"\n}\n' }, 'main.vxl', 'ok\n');
assertOutput('input', { 'main.vxl': 'add input "Name?"\nset output = who\nprint "Hi " + who\n' }, 'main.vxl', 'Name?Hi Zen\n', { input: 'Zen\n' });
assertOutput('output as var', { 'main.vxl': 'output = 1\nprint output\n' }, 'main.vxl', '1\n');
assertOutput('file read', { 'main.vxl': 'print data/info.txt\n', 'data/info.txt': 'Hello from Vexel!\n' }, 'main.vxl', 'Hello from Vexel!\n');
assertOutput('try file missing', { 'main.vxl': 'try {\n print data/missing.txt\n} error {\n print error\n}\n' }, 'main.vxl', 'File not found: data/missing.txt\n');
assertOutput('error raise', { 'main.vxl': 'function divide a, b {\n if b = 0 {\n  error "Cannot divide by zero"\n }\n return a / b\n}\ntry {\n print divide 10, 0\n} error {\n print error\n}\n' }, 'main.vxl', 'Cannot divide by zero\n');
assertOutput('branch-assigned local (hoist)', { 'main.vxl': 'function pick n {\n if n = 1 {\n  out = "one"\n } else if n = 2 {\n  out = "two"\n } else {\n  out = "other"\n }\n return out\n}\nprint pick 1\nprint pick 2\nprint pick 9\n' }, 'main.vxl', 'one\ntwo\nother\n');
assertOutput('loop-assigned local (hoist)', { 'main.vxl': 'function build {\n acc = ""\n i = 0\n repeat till i = 3 {\n  acc = acc + "x"\n  i = i + 1\n }\n return acc\n}\nprint build\n' }, 'main.vxl', 'xxx\n');
assertOutput('modules', {
  'main.vxl': 'import entities/player\nprint player.name\nplayer.greet\n',
  'entities/player.vxl': 'public name = "Zen"\npublic function greet {\n print "Hello"\n}\nfunction secret {\n print "no"\n}\n',
}, 'main.vxl', 'Zen\nHello\n');
assertOutput('import executes once', {
  'main.vxl': 'import entities/test\nimport entities/test\nprint "done"\n',
  'entities/test.vxl': 'print "Module executed"\n',
}, 'main.vxl', 'Module executed\ndone\n');
assertOutput('print module source (no exec)', {
  'main.vxl': 'print entities/player\n',
  'entities/player.vxl': 'public name = "Zen"\n',
}, 'main.vxl', 'public name = "Zen"\n');

console.log('\n--- types/errors ---');
assertCheckFails('reassign different type', { 'main.vxl': 'age = 25\nage = "Zen"\n' }, 'main.vxl', 'Type mismatch');
assertCheckFails('int has no field', { 'main.vxl': 'age = 25\nprint age.name\n' }, 'main.vxl', 'has no field');
assertCheckFails('undefined var', { 'main.vxl': 'print missing\n' }, 'main.vxl', 'Undefined variable');
assertCheckFails('function scope', { 'main.vxl': 'function test {\n x = 10\n}\ntest\nprint x\n' }, 'main.vxl', 'Undefined variable');
assertCheckFails('private access', {
  'main.vxl': 'import entities/player\nplayer.secret\n',
  'entities/player.vxl': 'public name = "Zen"\nfunction secret {\n print "x"\n}\n',
}, 'main.vxl', 'private');
assertCheckFails('arity', { 'main.vxl': 'function add a, b {\n return a + b\n}\nprint add 1\n' }, 'main.vxl', 'expects 2');
assertCheckFails('return outside', { 'main.vxl': 'return 1\n' }, 'main.vxl', 'outside function');
assertCheckFails('circular', {
  'main.vxl': 'import mod_a\n',
  'mod_a.vxl': 'import mod_b\n',
  'mod_b.vxl': 'import mod_a\n',
}, 'main.vxl', 'Circular import');
assertCheckFails('struct missing field', { 'main.vxl': 'struct P {\n a\n b\n}\nx = P {\n a = 1\n}\n' }, 'main.vxl', 'Missing field');assertCheckFails('struct unknown field', { 'main.vxl': 'struct P {\n a\n}\nx = P {\n a = 1\n b = 2\n}\n' }, 'main.vxl', 'has no field');
assertCheckFails('number of bool', { 'main.vxl': 'print number of true\n' }, 'main.vxl', 'Cannot convert');
assertRunFails('list bounds runtime', { 'main.vxl': 'a = [1]\nprint a[5]\n' }, 'main.vxl', 'Index out of bounds');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
