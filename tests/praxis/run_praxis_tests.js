'use strict';

// Vexel 3.0 Praxis tests — static only (no display, no .NET SDK, no rustc).
// Every test runs `vexel check` or `vexel debug` on a small program and
// asserts on the result. Backend source presence (Notify/Confirm/Prompt)
// is asserted by reading VexAx.cs directly — those are real modal/toast
// implementations, not stubs.
// Usage: node tests/praxis/run_praxis_tests.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'vexel.js');

let passed = 0;
let failed = 0;
const failures = [];

function vexel(args, opts = {}) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    cwd: (opts && opts.cwd) || ROOT,
    timeout: 60000,
  });
}

function withTmpFiles(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-praxis-'));
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

function tCheck(name, files, entry) {
  withTmpFiles(files, (tmp) => {
    const r = vexel(['check', path.join(tmp, entry)], { cwd: tmp });
    if (r.status === 0) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: check failed\n${r.stdout}\n${r.stderr}`);
      console.log(`FAIL ${name}`);
    }
  });
}

function tCheckFails(name, files, entry, mustContain) {
  withTmpFiles(files, (tmp) => {
    const r = vexel(['check', path.join(tmp, entry)], { cwd: tmp });
    const combined = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 && (!mustContain || combined.includes(mustContain))) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: expected failure containing '${mustContain}'\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

function tDebug(name, files, entry, mustContain, mustNotContain, extraArgs) {
  withTmpFiles(files, (tmp) => {
    const args = ['debug'].concat(extraArgs || []).concat([path.join(tmp, entry)]);
    const r = vexel(args, { cwd: tmp });
    const combined = (r.stdout || '') + (r.stderr || '');
    const missing = (mustContain || []).filter((s) => !combined.includes(s));
    const forbidden = (mustNotContain || []).filter((s) => combined.includes(s));
    if (r.status === 0 && missing.length === 0 && forbidden.length === 0) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: debug mismatch\nmissing=${JSON.stringify(missing)}\nforbidden=${JSON.stringify(forbidden)}\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

console.log('=== Vexel 3.0 Praxis tests (static) ===\n--- widget creation ---');

tCheck('basic UI syntax preserved', {
  'main.vxl': 'create a window titled "My App"\nbutton = add a button titled "Click Me"\ninput = add an input box titled "Your name"\noutput = add an output box\nbutton.on click {\n    output.text = input.text\n}\nwindow.show\n',
}, 'main.vxl');

tCheck('switch creation', {
  'main.vxl': 'create a window titled "T"\nsw = add a switch titled "Power"\nsw.checked = true\nwindow.show\n',
}, 'main.vxl');

tCheck('radio group', {
  'main.vxl': 'create a window titled "T"\na = add a radio button titled "A"\na.group = "g"\nb = add a radio button titled "B"\nb.group = "g"\nwindow.show\n',
}, 'main.vxl');

tCheck('numeric input', {
  'main.vxl': 'create a window titled "T"\nn = add a numeric input\nn.value = 5\nn.minimum = 0\nn.maximum = 10\nn.step = 1\nwindow.show\n',
}, 'main.vxl');

tCheck('search box', {
  'main.vxl': 'create a window titled "T"\ns = add a search box titled "Search..."\ns.text = "hi"\nwindow.show\n',
}, 'main.vxl');

tCheck('card + child', {
  'main.vxl': 'create a window titled "T"\nc = add a card titled "Card"\nt = add a text titled "Hi" to c\nwindow.show\n',
}, 'main.vxl');

tCheck('statusbar', {
  'main.vxl': 'create a window titled "T"\nb = add a status bar titled "Ready"\nb.text = "Go"\nwindow.show\n',
}, 'main.vxl');

tCheck('separator', {
  'main.vxl': 'create a window titled "T"\ns = add a separator\nwindow.show\n',
}, 'main.vxl');

tCheck('context menu add+show', {
  'main.vxl': 'create a window titled "T"\nm = add a context menu\nitem = m.add "Hello"\nbtn = add a button titled "Show"\nbtn.on click {\n    m.show\n}\nwindow.show\n',
}, 'main.vxl');

console.log('\n--- hierarchy + layout ---');

tDebug('layout determinism x=30,120,210,300', {
  'main.vxl': 'create a window titled "L"\na = add a button titled "1"\na.x = 30\na.y = 20\na.width = 80\na.height = 30\nb = add a button titled "2"\nb.x = 120\nb.y = 20\nb.width = 80\nb.height = 30\nc = add a button titled "3"\nc.x = 210\nc.y = 20\nc.width = 80\nc.height = 30\nd = add a button titled "4"\nd.x = 300\nd.y = 20\nd.width = 80\nd.height = 30\nwindow.show\n',
}, 'main.vxl', ['a: button x=30 y=20 w=80 h=30', 'b: button x=120 y=20 w=80 h=30', 'c: button x=210 y=20 w=80 h=30', 'd: button x=300 y=20 w=80 h=30'], ['WARN']);

tCheck('percent + fill', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nset b width to 50 percent\nset b height to fill\nwindow.show\n',
}, 'main.vxl');

tCheck('scroll area + child', {
  'main.vxl': 'create a window titled "T"\ns = add a scroll area\ns.x = 10\ns.y = 10\ns.width = 300\ns.height = 200\nb = add a button titled "In" to s\nwindow.show\n',
}, 'main.vxl');

tCheck('center + minmax', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nb.center\nwindow.width = 800\nwindow.show\n',
}, 'main.vxl');

console.log('\n--- events + focus ---');

tCheck('switch change event', {
  'main.vxl': 'create a window titled "T"\nsw = add a switch titled "P"\nout = add an output box\nsw.on change {\n    out.text = "x"\n}\nwindow.show\n',
}, 'main.vxl');

tCheck('search key press', {
  'main.vxl': 'create a window titled "T"\ns = add a search box titled "S"\ns.on key press {\n    print key\n}\nwindow.show\n',
}, 'main.vxl');

tCheck('button mouse event object', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nb.on mouse move {\n    print event.button\n}\nwindow.show\n',
}, 'main.vxl');

tCheck('focus method + focused read', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nb.focus\nprint b.focused\nwindow.show\n',
}, 'main.vxl');

tCheckFails('focused is read-only', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nb.focused = true\nwindow.show\n',
}, 'main.vxl', 'read-only');

console.log('\n--- dialogs + notifications ---');

tCheck('show message + warning', {
  'main.vxl': 'create a window titled "T"\nshow message "Hi"\nshow warning "Careful"\nwindow.show\n',
}, 'main.vxl');

tCheck('show confirmation + input dialog', {
  'main.vxl': 'create a window titled "T"\nshow confirmation "Sure?"\nshow input dialog "Name?"\nwindow.show\n',
}, 'main.vxl');

tCheck('confirm + prompt functions', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nb.on click {\n    ok = confirm "Sure?"\n    name = prompt "Name?"\n    print ok\n}\nwindow.show\n',
}, 'main.vxl');

tCheck('notifications', {
  'main.vxl': 'create a window titled "T"\nshow notification "Saved"\nshow notification success "Done" for 2 seconds\nwindow.show\n',
}, 'main.vxl');

console.log('\n--- animation ---');

tCheck('animate block linear', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nanimate b {\n    move to x 200\n    duration 1 second\n}\nwindow.show\n',
}, 'main.vxl');

tCheck('animate smooth easing', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nanimate b {\n    move to x 200\n    ease smooth\n    duration 1 second\n}\nwindow.show\n',
}, 'main.vxl');

tCheckFails('unknown easing rejected', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "B"\nanimate b {\n    move to x 200\n    ease bounce\n    duration 1 second\n}\nwindow.show\n',
}, 'main.vxl', 'Unknown easing');

console.log('\n--- icons + typography + a11y ---');

tCheck('button icon + tooltip + description', {
  'main.vxl': 'create a window titled "T"\nb = add a button titled "Save"\nb.icon = "save"\nb.tooltip = "Save file"\nb.description = "Saves the file"\nwindow.show\n',
}, 'main.vxl');

tCheckFails('icon on switch rejected', {
  'main.vxl': 'create a window titled "T"\nsw = add a switch titled "P"\nsw.icon = "save"\nwindow.show\n',
}, 'main.vxl', "Cannot set 'icon'");

tCheck('typography props', {
  'main.vxl': 'create a window titled "T"\nt = add a text titled "Hi"\nt.font_size = 22\nt.bold = true\nt.italic = true\nt.alignment = "center"\nwindow.show\n',
}, 'main.vxl');

console.log('\n--- windows + DPI ---');

tCheck('multi-window', {
  'main.vxl': 'create a window titled "Main"\nwin2 = create a window titled "Second"\nwin2.width = 400\nbtn = add a button titled "Open"\nbtn.on click {\n    win2.show\n}\nwindow.show\n',
}, 'main.vxl');

tDebug('dpi matrix scales uniformly', {
  'main.vxl': 'create a window titled "L"\na = add a button titled "1"\na.x = 30\na.y = 20\na.width = 80\na.height = 30\nwindow.show\n',
}, 'main.vxl', ['DPI 100%', 'DPI 200%', 'a: 30.0 20.0 80.0 30.0'], null, ['--dpi', 'all']);

console.log('\n--- backend source (real implementations) ---');

function tSource(name, mustContain) {
  const p = path.join(ROOT, 'runtime', 'ui', 'backend', 'avalonia', 'VexAx.cs');
  let src = '';
  try { src = fs.readFileSync(p, 'utf8'); } catch (e) { /* ignore */ }
  const missing = mustContain.filter((s) => !src.includes(s));
  if (missing.length === 0) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    failures.push(`${name}: missing in VexAx.cs: ${missing.join(', ')}`);
    console.log(`FAIL ${name}`);
  }
}

tSource('backend has Notify/Confirm/Prompt/InputBox', [
  'public static void Notify(',
  'public static bool Confirm(',
  'public static string Prompt(',
  'private static string InputBox(',
]);

tSource('backend has context menu + tooltip + icon', [
  'public static MenuFlyout NewContextMenu(',
  'public static object AddChildItem(',
  'ToolTip.SetTip',
  'Praxis.IconPath',
]);

function tPraxis(name, mustContain) {
  const p = path.join(ROOT, 'runtime', 'ui', 'backend', 'avalonia', 'Praxis.cs');
  let src = '';
  try { src = fs.readFileSync(p, 'utf8'); } catch (e) { /* ignore */ }
  const missing = mustContain.filter((s) => !src.includes(s));
  if (missing.length === 0) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    failures.push(`${name}: missing in Praxis.cs: ${missing.join(', ')}`);
    console.log(`FAIL ${name}`);
  }
}

tPraxis('praxis engine has tree/layout/ease/a11y/icons/render', [
  'public class Node',
  'Proportional(',
  'EaseByName',
  'SetA11y',
  'IconPath',
  'LogRect',
]);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
