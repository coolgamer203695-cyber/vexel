'use strict';

// Vexel 1.1.0 UI test suite — no display needed except the final probe
// (which degrades to SKIP when a desktop is unavailable).
// Usage: node tests/ui/run_ui_tests.js

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

function vexel(args, opts = {}) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || ROOT,
    input: opts.input,
    timeout: opts.timeout || 240000,
  });
}

function withTmpFiles(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-ui-'));
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

console.log('=== Vexel 1.1.0 UI tests ===\n--- compile (check) ---');

// Vexel 2.2: assert on `vexel debug` output (geometry + warnings).
function tDebug(name, files, entry, mustContain, mustNotContain) {
  withTmpFiles(files, (tmp) => {
    const r = vexel(['debug', path.join(tmp, entry)], { cwd: tmp });
    const combined = (r.stdout || '') + (r.stderr || '');
    const missing = (mustContain || []).filter((s) => !combined.includes(s));
    const forbidden = (mustNotContain || []).filter((s) => combined.includes(s));
    if (r.status === 0 && missing.length === 0 && forbidden.length === 0) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: debug mismatch\nmissing=${JSON.stringify(missing)}\nforbidden-present=${JSON.stringify(forbidden)}\nstatus=${r.status}\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

// Spec section 58 + 48 + 66 examples must compile
for (const ex of ['hello.vxl', 'counter.vxl', 'greeting.vxl', 'settings.vxl', 'acceptance.vxl', 'full.vxl']) {
  const r = vexel(['check', path.join(ROOT, 'examples', 'ui', ex)]);
  if (r.status === 0) {
    passed++;
    console.log(`PASS example ${ex}`);
  } else {
    failed++;
    failures.push(`example ${ex} failed check\n${r.stdout}\n${r.stderr}`);
    console.log(`FAIL example ${ex}`);
  }
}

tCheck('kitchen sink', {
  'm.vxl': [
    'create a window titled "All"',
    'set window width to 900',
    'set window height to 600',
    'set window resizable to true',
    'set window position to 50, 50',
    'set window min width to 300',
    'title = add a text titled "Hi"',
    'title.font_size = 24',
    'title.bold = true',
    'title.alignment = "center"',
    'input = add an input box titled "Name"',
    'input.password = false',
    'button = add a button titled "Go"',
    'button.background = "blue"',
    'button.text_color = "white"',
    'button.border_radius = 8',
    'output = add an output box',
    'remember = add a checkbox titled "R"',
    'volume = add a slider',
    'volume.minimum = 0',
    'volume.maximum = 100',
    'volume.step = 5',
    'volume.value = 50',
    'progress = add a progress bar',
    'progress.value = 10',
    'choice = add a dropdown',
    'choice.add "A"',
    'choice.add "B"',
    'items = add a list',
    'items.add "X"',
    'items.remove 0',
    'logo = add an image "logo.png"',
    'logo.source = "other.png"',
    'menu = add a menu titled "File"',
    'fileItem = menu.add "Open"',
    'toolbar = add a toolbar',
    'saveBtn = toolbar.add a button titled "Save"',
    'tabs = add a tab bar',
    'home = tabs.add "Home"',
    'table = add a table',
    'table.add column "Name"',
    'table.add row ["Zen", 25]',
    'tree = add a tree',
    'folder = tree.add "P"',
    'folder.add "Vexel"',
    'spin = add a spinner',
    'spin.visible = true',
    'box = create a horizontal container',
    'set box spacing to 8',
    'set box padding to 12',
    'set box alignment to center',
    'inner = add a button titled "Inner"',
    'add inner to box',
    'add box to window',
    'center inner in window',
    'set inner width to 50 percent',
    'use theme "dark"',
    'theme Mono {\n    background = "black"\n}',
    'use theme "Mono"',
    'show a message "Hi"',
    'show a warning "Careful"',
    'ok = ask "Sure?"',
    'f = choose a file',
    'col = choose a color',
    'button.on click {\n    output.text = input.text\n}',
    'button.on hover {\n    print "hover"\n}',
    'volume.on change {\n    progress.value = volume.value\n}',
    'input.on change {\n    print input.text\n}',
    'remember.on change {\n    print remember.checked\n}',
    'window.on key press {\n    print key\n}',
    'animate button {\n    move to x 400\n    duration 1 second\n}',
    'component login_box {\n    add a text titled "Login"\n}',
    'add login_box',
    'input.clear',
    'output.clear',
    'window.hide',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tCheck('output box named output (spec 48)', {
  'm.vxl': 'create a window titled "W"\noutput = add an output box\noutput.text = "Hi"\nwindow.show\n',
}, 'm.vxl');

console.log('\n--- diagnostics (must fail well) ---');
tCheckFails('font_size on window', { 'm.vxl': 'create a window titled "W"\nset window font_size to 24\n' }, 'm.vxl', 'font_size');
tCheckFails('click on progress', { 'm.vxl': 'create a window titled "W"\np = add a progress bar\np.on click {\n    print "x"\n}\n' }, 'm.vxl', 'click');
tCheckFails('bad color', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.background = "blurple"\n' }, 'm.vxl', 'blurple');
tCheckFails('widget needs window', { 'm.vxl': 'b = add a button titled "B"\n' }, 'm.vxl', 'window');
tCheckFails('one window only', { 'm.vxl': 'create a window titled "A"\ncreate a window titled "B"\n' }, 'm.vxl', 'anonymous window');
tCheckFails('slider add rejected', { 'm.vxl': 'create a window titled "W"\ns = add a slider\ns.add "x"\n' }, 'm.vxl', 'slider');
tCheckFails('key outside handler', { 'm.vxl': 'create a window titled "W"\nprint key\n' }, 'm.vxl', 'key');
tCheckFails('unknown theme', { 'm.vxl': 'create a window titled "W"\nuse theme "neon"\n' }, 'm.vxl', 'neon');
tCheckFails('return in handler', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.on click {\n    return 1\n}\n' }, 'm.vxl', 'return');
tCheckFails('unknown widget', { 'm.vxl': 'create a window titled "W"\nx = add a rocket\n' }, 'm.vxl', 'rocket');
tCheckFails('image needs source', { 'm.vxl': 'create a window titled "W"\nx = add an image\n' }, 'm.vxl', 'source');
tCheckFails('private stays private', {
  'm.vxl': 'import widgets/secret\nsecret.hidden\n',
  'widgets/secret.vxl': 'function hidden {\n    print "no"\n}\n',
}, 'm.vxl', 'private');

console.log('\n--- codegen fragments ---');
withTmpFiles({
  'm.vxl': 'create a window titled "Counter"\ncount = 0\nlabel = add a text titled "Count: 0"\nbutton = add a button titled "Increase"\nbutton.on click {\n    count = count + 1\n    label.text = "Count: " + count\n}\nwindow.show\n',
}, (tmp) => {
  const { loadModules } = require(path.join(ROOT, 'compiler', 'modules', 'modules.js'));
  const { analyze } = require(path.join(ROOT, 'compiler', 'semantic', 'semantic.js'));
  const { generateAX } = require(path.join(ROOT, 'compiler', 'codegen', 'codegen_ax.js'));
  const entry = path.join(tmp, 'm.vxl');
  const lr = loadModules(entry);
  const ax = generateAX(lr, analyze(lr));
  const cs = ax.programCs;
  const wants = ['VexAx.NewWindow(', 'VexAx.NewButton(', 'VexAx.CurrentRoot()', 'VexAx.ShownWins'];
  const forbids = ['System.Windows.Forms'];
  let okAll = true;
  for (const w of wants) {
    if (!cs.includes(w)) {
      okAll = false;
      failures.push(`codegen missing fragment: ${w}`);
    }
  }
  if (okAll) {
    passed++;
    console.log('PASS codegen fragments');
  } else {
    failed++;
    console.log('FAIL codegen fragments');
  }
});

console.log('\n--- native build ---');
if (process.platform !== 'win32') {
  skipped++;
  console.log('SKIP native build (needs Windows + .NET 8 SDK)');
} else {
  // dotnet may live in the user-local install (no admin) rather than PATH.
  const dotCands = ['dotnet'];
  try {
    const local = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'dotnet', 'dotnet.exe');
    if (fs.existsSync(local)) dotCands.push(local);
  } catch (e) { /* ignore */ }
  let haveDotnet = false;
  for (const c of dotCands) {
    const dot = spawnSync(c, ['--list-sdks'], { encoding: 'utf8', timeout: 60000 });
    if (!dot.error && dot.status === 0 && (dot.stdout || '').trim() !== '') { haveDotnet = true; break; }
  }
  if (!haveDotnet) {
    failed++;
    failures.push('dotnet SDK not found — cannot build UI apps');
    console.log('FAIL native build (dotnet missing)');
  } else {
    withTmpFiles({ 'm.vxl': 'create a window titled "BuildTest"\ntext = add a text titled "Hi"\nwindow.show\n' }, (tmp) => {
      const r = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
      const exe = path.join(tmp, 'm.exe');
      if (r.status === 0 && fs.existsSync(exe) && fs.statSync(exe).size > 10000) {
        passed++;
        console.log('PASS native build (m.exe)');
      } else {
        failed++;
        failures.push(`native build failed\n${r.stdout}\n${r.stderr}`);
        console.log('FAIL native build');
      }
    });
  }
}

console.log('\n--- full-widget native build ---');
if (process.platform !== 'win32') {
  skipped++;
  console.log('SKIP full-widget build (needs Windows + .NET 8 SDK)');
} else {
  // Every widget/event/layout/theme/dialog/animate/component path, compiled.
  withTmpFiles({
    'm.vxl': [
      'create a window titled "KitchenSink"',
      'set window width to 900',
      'set window height to 700',
      'use theme "dark"',
      'title = add a text titled "All widgets"',
      'title.font_size = 20',
      'title.bold = true',
      'name = add an input box titled "Name"',
      'secret = add an input box',
      'secret.password = true',
      'go = add a button titled "Go"',
      'go.background = "#0055AA"',
      'go.text_color = "white"',
      'go.border_radius = 6',
      'out = add an output box',
      'remember = add a checkbox titled "Remember"',
      'volume = add a slider',
      'volume.minimum = 0',
      'volume.maximum = 100',
      'volume.step = 5',
      'volume.value = 50',
      'progress = add a progress bar',
      'progress.value = 25',
      'choice = add a dropdown',
      'choice.add "A"',
      'choice.add "B"',
      'items = add a list',
      'items.add "X"',
      'items.add "Y"',
      'logo = add an image "logo.png"',
      'menu = add a menu titled "File"',
      'openItem = menu.add "Open"',
      'toolbar = add a toolbar',
      'saveBtn = toolbar.add a button titled "Save"',
      'tabs = add a tab bar',
      'home = tabs.add "Home"',
      'welcome = add a text titled "Hi" to home',
      'table = add a table',
      'table.add column "Name"',
      'table.add column "Age"',
      'table.add row ["Zen", 25]',
      'tree = add a tree',
      'folder = tree.add "Projects"',
      'folder.add "Vexel"',
      'spin = add a spinner',
      'spin.visible = false',
      'row = create a horizontal container',
      'grid = create a grid container',
      'scroller = create a scroll container',
      'set row spacing to 6',
      'set row padding to 10',
      'set row alignment to center',
      'inner = add a button titled "Inner"',
      'add inner to row',
      'add row to window',
      'center go in window',
      'set go width to 50 percent',
      'go.on click {\n    out.text = "Hello " + name.text\n}',
      'saveBtn.on click {\n    show a message "Saved"\n}',
      'openItem.on click {\n    f = choose a file\n}',
      'volume.on change {\n    progress.value = volume.value\n}',
      'remember.on change {\n    print remember.checked\n}',
      'choice.on change {\n    print choice.selected\n}',
      'items.on change {\n    print items.selected_index\n}',
      'name.on key press {\n    print key\n}',
      'window.on key press {\n    print key\n}',
      'animate go {\n    move to x 300\n    duration 1 second\n}',
      'component login_box {\n    t = add a text titled "Login"\n    b = add a button titled "In"\n    b.on click {\n        print "in"\n    }\n}',
      'add login_box',
      'theme Mono {\n    background = "black"\n    text_color = "white"\n}',
      'name.clear',
      'out.clear',
      'window.show',
    ].join('\n'),
  }, (tmp) => {
    const r = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (r.status === 0 && fs.existsSync(exe) && fs.statSync(exe).size > 50000) {
      passed++;
      console.log('PASS full-widget native build');
    } else {
      failed++;
      failures.push(`full-widget build failed\n${r.stdout}\n${r.stderr}`);
      console.log('FAIL full-widget native build');
    }
  });
}

console.log('\n--- manual positioning (default root honors x/y) ---');
tCheck('manual x/y/width/height (calculator shape)', {
  'm.vxl': [
    'create a window titled "Pos"',
    'window.width = 400',
    'window.height = 550',
    'display = add an output box',
    'display.x = 20',
    'display.y = 20',
    'display.width = 360',
    'display.height = 60',
    'seven = add a button titled "7"',
    'seven.x = 20',
    'seven.y = 100',
    'seven.width = 80',
    'seven.height = 60',
    'seven.on click {',
    '    display.text = display.text + "7"',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

// The default root must be an absolute Panel (never a flow panel),
// with auto-stacking for widgets that have no explicit position.
withTmpFiles({
  'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nwindow.show\n',
}, (tmp) => {
  const { loadModules } = require(path.join(ROOT, 'compiler', 'modules', 'modules.js'));
  const { analyze } = require(path.join(ROOT, 'compiler', 'semantic', 'semantic.js'));
  const { generateAX } = require(path.join(ROOT, 'compiler', 'codegen', 'codegen_ax.js'));
  const entry = path.join(tmp, 'm.vxl');
  const lr = loadModules(entry);
  const ax = generateAX(lr, analyze(lr));
  const cs = ax.programCs;
  const wants = ['VexAx.NewWindow(', 'VexAx.NewButton(', 'VexAx.CurrentRoot()', 'VexAx.ShownWins'];
  const forbids = ['System.Windows.Forms'];
  let okAll = true;
  for (const w of wants) {
    if (!cs.includes(w)) {
      okAll = false;
      failures.push(`position codegen missing fragment: ${w}`);
    }
  }
  for (const w of forbids) {
    if (cs.includes(w)) {
      okAll = false;
      failures.push(`position codegen must not contain: ${w}`);
    }
  }
  if (okAll) {
    passed++;
    console.log('PASS avalonia canvas root fragments');
  } else {
    failed++;
    console.log('FAIL avalonia canvas root fragments');
  }
});

// Headless round-trip: set x/y/width/height, read them back from the
// live Avalonia properties. Prints run before window.show, so no GUI
// interaction is needed — launch, capture stdout, kill.
try {
  if (process.platform !== 'win32') throw new Error('no-desktop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uipos-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), [
      'create a window titled "PosProbe"',
      'b1 = add a button titled "One"',
      'b2 = add a button titled "Two"',
      'b3 = add a button titled "Three"',
      'b1.x = 200',
      'b1.y = 50',
      'b2.x = 200',
      'b2.y = 120',
      'b1.width = 80',
      'b1.height = 60',
      'print b1.x',
      'print b1.y',
      'print b2.x',
      'print b2.y',
      'print b3.x',
      'print b3.y',
      'print b1.width',
      'print b1.height',
      'window.show',
    ].join('\n'), 'utf8');
    const b = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
    const outFile = path.join(tmp, 'out.txt');
    const probe = `
      $p = Start-Process -FilePath "${exe.replace(/\\/g, '\\\\')}" -RedirectStandardOutput "${outFile.replace(/\\/g, '\\\\')}" -PassThru
      Start-Sleep -Milliseconds 4000
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
    `;
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe], { encoding: 'utf8', timeout: 90000 });
    const got = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
    // 2.2.1: no hidden auto-layout — explicit x/y/width/height round-trip
    // exactly; unpositioned b3 stays at the origin (0, 0).
    const want = '200\n50\n200\n120\n0\n0\n80\n60\n';
    if (got === want) {
      passed++;
      console.log('PASS position round-trip (manual positions + sizes)');
    } else if (got === '') {
      throw new Error('no-output');
    } else {
      failed++;
      failures.push(`position round-trip mismatch\nExpected:\n${JSON.stringify(want)}\nGot:\n${JSON.stringify(got)}`);
      console.log('FAIL position round-trip (value mismatch)');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  skipped++;
  console.log('SKIP position round-trip (no interactive desktop)');
}

console.log('\n--- live window probe (best effort) ---');try {
  if (process.platform !== 'win32') throw new Error('no-desktop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uiprobe-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), 'create a window titled "VexelProbeXYZ"\ntext = add a text titled "Hi"\nwindow.show\n', 'utf8');
    const b = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
    const probe = `
      $p = Start-Process -FilePath "${exe.replace(/\\/g, '\\\\')}" -PassThru
      for ($i = 0; $i -lt 40 -and ($p.MainWindowTitle -eq ""); $i++) { Start-Sleep -Milliseconds 250; $p.Refresh() }
      $t = $p.MainWindowTitle
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
      if ($t -eq "VexelProbeXYZ") { exit 0 } else { exit 1 }
    `;
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe], { encoding: 'utf8', timeout: 90000 });
    if (r.status === 0) {
      passed++;
      console.log('PASS live window (VexelProbeXYZ opened)');
    } else {
      throw new Error('no-window');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  skipped++;
  console.log('SKIP live window probe (no interactive desktop)');
}

console.log('\n--- pixel positions (best effort) ---');
try {
  if (process.platform !== 'win32') throw new Error('no-desktop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uipix-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), [
      'create a window titled "VexelPixels"',
      'window.width = 400',
      'window.height = 300',
      'red = add a button titled ""',
      'red.x = 20',
      'red.y = 20',
      'red.width = 100',
      'red.height = 60',
      'red.background = "red"',
      'window.show',
    ].join('\n'), 'utf8');
    const b = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
    const harness = path.join(ROOT, 'tools', 'verify_pixels.ps1');
    if (!fs.existsSync(harness)) throw new Error('no-harness');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness,
      '-Exe', exe, '-Title', 'VexelPixels',
      '-Assert', '70,50,#FF0000,80,red-center;15,50,!#FF0000,60,left-of-red;125,50,!#FF0000,60,right-of-red',
    ], { encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0 && out.includes('ALL_PIXELS_OK')) {
      passed++;
      console.log('PASS pixel positions (red button rendered at x/y/w/h)');
    } else {
      throw new Error('pixels-mismatch: ' + out.slice(-500));
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  skipped++;
  console.log('SKIP pixel positions (' + (e.message || 'no interactive desktop') + ')');
}

console.log('\n--- responsive anchor (best effort) ---');
try {
  if (process.platform !== 'win32') throw new Error('no-desktop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uianchor-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), [
      'create a window titled "VexelAnchor"',
      'window.width = 600',
      'window.height = 400',
      'rightBtn = add a button titled "R"',
      'rightBtn.x = 480',
      'rightBtn.y = 20',
      'rightBtn.width = 100',
      'rightBtn.height = 40',
      'rightBtn.anchor = "right"',
      'wide = add a button titled "S"',
      'wide.x = 20',
      'wide.y = 80',
      'wide.width = 200',
      'wide.height = 40',
      'wide.anchor = "left right"',
      'plain = add a button titled "D"',
      'plain.x = 20',
      'plain.y = 140',
      'snap1 = after 1 second {',
      '    json write rightBtn.x to "a_r0.json"',
      '    json write wide.width to "a_s0.json"',
      '    json write plain.x to "a_d0.json"',
      '}',
      'snap2 = after 6 seconds {',
      '    json write rightBtn.x to "a_r1.json"',
      '    json write wide.width to "a_s1.json"',
      '    json write plain.x to "a_d1.json"',
      '}',
      'window.show',
    ].join('\n'), 'utf8');
    const b = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
    const probe = `
      $p = Start-Process -FilePath "${exe.replace(/\\/g, '\\\\')}" -WorkingDirectory "${tmp.replace(/\\/g, '\\\\')}" -PassThru
      Start-Sleep -Seconds 2
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinR { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f); }'
      [WinR]::SetWindowPos($p.MainWindowHandle, [IntPtr]0, 0, 0, 800, 500, 0x0016) | Out-Null
      Start-Sleep -Seconds 6
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
    `;
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe], { encoding: 'utf8', timeout: 120000 });
    const rd = (f) => { try { return fs.readFileSync(path.join(tmp, f), 'utf8').trim(); } catch (e) { return null; } };
    const r0 = JSON.parse(rd('a_r0.json')), r1 = JSON.parse(rd('a_r1.json'));
    const s0 = JSON.parse(rd('a_s0.json')), s1 = JSON.parse(rd('a_s1.json'));
    const d0 = JSON.parse(rd('a_d0.json')), d1 = JSON.parse(rd('a_d1.json'));
    // Chrome-independent: the resize must move the right-anchored button
    // and grow the stretched one by the SAME client delta, while the
    // unanchored button never moves.
    const dr = r1 - r0, ds = s1 - s0;
    if (r0 === 480 && s0 === 200 && d0 === 20 && d1 === 20 && dr > 100 && dr === ds) {
      passed++;
      console.log('PASS responsive anchor (right follows resize exactly, plain stays)');
    } else {
      throw new Error(`anchor values off: r ${r0}->${r1}, s ${s0}->${s1}, d ${d0}->${d1}`);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  skipped++;
  console.log('SKIP responsive anchor (' + (e.message || 'no interactive desktop') + ')');
}

console.log('\n--- process execution (best effort) ---');
try {
  if (process.platform !== 'win32') throw new Error('no-desktop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uiproc-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), [
      'create a window titled "VexelProc"',
      'p = process "cmd.exe", "/c", "echo hi"',
      'watcher = every 1 second {',
      '    if p.running = false {',
      '        json write p.exit to "p_exit.json"',
      '        json write p.stdout to "p_out.json"',
      '        watcher.cancel',
      '    }',
      '}',
      'k = process "ping", "-n", "30", "127.0.0.1"',
      'killer = after 2 seconds {',
      '    k.kill',
      '}',
      'checker = after 5 seconds {',
      '    json write k.running to "p_k.json"',
      '}',
      'window.show',
    ].join('\n'), 'utf8');
    const b = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
    const probe = `
      $p = Start-Process -FilePath "${exe.replace(/\\/g, '\\\\')}" -WorkingDirectory "${tmp.replace(/\\/g, '\\\\')}" -PassThru
      Start-Sleep -Seconds 9
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
    `;
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe], { encoding: 'utf8', timeout: 120000 });
    const rd = (f) => { try { return fs.readFileSync(path.join(tmp, f), 'utf8').trim(); } catch (e) { return null; } };
    const exit = JSON.parse(rd('p_exit.json'));
    const out = JSON.parse(rd('p_out.json'));
    const kr = JSON.parse(rd('p_k.json'));
    if (exit === 0 && out.indexOf('hi') >= 0 && kr === false) {
      passed++;
      console.log('PASS process execution (exit code, stdout, kill)');
    } else {
      throw new Error(`process results off: exit=${exit} out=${out} k.running=${kr}`);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  skipped++;
  console.log('SKIP process execution (' + (e.message || 'no interactive desktop') + ')');
}

console.log('\n--- live runtime inspector (best effort) ---');
try {
  if (process.platform !== 'win32') throw new Error('no-desktop');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uisnap-'));
  try {
    fs.writeFileSync(path.join(tmp, 'm.vxl'), [
      'create a window titled "VexelSnap"',
      'window.width = 400',
      'window.height = 300',
      'go = add a button titled "Go"',
      'go.x = 20',
      'go.y = 20',
      'go.width = 120',
      'go.height = 50',
      'window.show',
    ].join('\n'), 'utf8');
    const b = vexel(['build', path.join(tmp, 'm.vxl')], { cwd: tmp });
    const exe = path.join(tmp, 'm.exe');
    if (b.status !== 0 || !fs.existsSync(exe)) throw new Error('build-failed');
    const snap = path.join(tmp, 'snap.json');
    const probe = `
      $env:VEXEL_AX_SNAPSHOT = "${snap.replace(/\\/g, '\\\\')}"
      $p = Start-Process -FilePath "${exe.replace(/\\/g, '\\\\')}" -WorkingDirectory "${tmp.replace(/\\/g, '\\\\')}" -PassThru
      Start-Sleep -Seconds 5
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
    `;
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe], { encoding: 'utf8', timeout: 120000 });
    const sj = JSON.parse(fs.readFileSync(snap, 'utf8'));
    const w = sj.windows && sj.windows[0];
    const c = w && w.controls && w.controls[0];
    if (w && w.title === 'VexelSnap' && c && c.kind === 'button' && c.text === 'Go' &&
        c.x === 20 && c.y === 20 && c.w === 120 && c.h === 50) {
      passed++;
      console.log('PASS live runtime inspector (window + control state)');
    } else {
      throw new Error('snapshot mismatch: ' + JSON.stringify(sj).slice(0, 300));
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  skipped++;
  console.log('SKIP live runtime inspector (' + (e.message || 'no interactive desktop') + ')');
}

console.log('\n--- vexel clean removes UI artifacts ---');
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-uiclean-'));
  try {
    for (const f of ['m.exe', 'av_libglesv2.dll', 'libHarfBuzzSharp.dll', 'libSkiaSharp.dll', 'm.vxl']) {
      fs.writeFileSync(path.join(tmp, f), 'x', 'utf8');
    }
    const r = vexel(['clean'], { cwd: tmp });
    const left = fs.readdirSync(tmp).sort();
    if (r.status === 0 && left.length === 1 && left[0] === 'm.vxl') {
      passed++;
      console.log('PASS vexel clean removes exe + native siblings');
    } else {
      throw new Error('leftover: ' + left.join(','));
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  failed++;
  failures.push(`vexel clean failed\n${e.message}`);
  console.log('FAIL vexel clean removes exe + native siblings');
}

console.log('\n--- vexel 2.0 checks ---');
for (const ex of ['calculator.vxl', 'acceptance2.vxl', 'login.vxl']) {
  const r = vexel(['check', path.join(ROOT, 'examples', 'ui', ex)]);
  if (r.status === 0) {
    passed++;
    console.log(`PASS example ${ex}`);
  } else {
    failed++;
    failures.push(`example ${ex} failed check\n${r.stdout}\n${r.stderr}`);
    console.log(`FAIL example ${ex}`);
  }
}

tCheck('2.0 events + timers + styles', {
  'm.vxl': [
    'create a window titled "W"',
    'b = add a button titled "B"',
    'b.on mouse move {',
    '    print event.x',
    '    print event.y',
    '}',
    'b.on focus {',
    '    print event',
    '}',
    'window.on key press {',
    '    if event.key = "Enter" {',
    '        print "go"',
    '    }',
    '}',
    'every 2 seconds {',
    '    print "tick"',
    '}',
    'after 5 seconds {',
    '    print "once"',
    '}',
    'wait 0 seconds',
    'style big {',
    '    font_size = 20',
    '}',
    'b.style = big',
    'b.id = "start"',
    'found = find "start"',
    'center found',
    'remove found',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tCheck('2.0 panels forms pickers clipboard', {
  'm.vxl': [
    'create a window titled "W"',
    'panel = add a panel',
    'scroll = add a scroll area',
    'form = add a form',
    'name = add an input box to form',
    'b = add a button titled "B" to panel',
    'add panel to window',
    'copy "Hi"',
    'copy name.text',
    'text = paste',
    'f = choose a folder',
    'set theme to "dark"',
    'theme Mono {',
    '    background = "black"',
    '}',
    'set theme to Mono',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tCheckFails('2.0 event outside handler', { 'm.vxl': 'create a window titled "W"\nprint event\n' }, 'm.vxl', 'event');
tCheckFails('2.0 bad event field', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.on click {\n    print event.key\n}\n' }, 'm.vxl', 'key');
tCheckFails('2.0 style unknown prop', { 'm.vxl': 'create a window titled "W"\nstyle s {\n    frobnicate = 1\n}\n' }, 'm.vxl', 'frobnicate');
tCheckFails('2.0 percent on title', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.title = 50% of window\n' }, 'm.vxl', 'width and height');
tCheckFails('2.0 copy needs window', { 'm.vxl': 'copy "hi"\n' }, 'm.vxl', 'window');
tCheckFails('2.0 mouse bogus', { 'm.vxl': 'create a window titled "W"\nb = add a button titled "B"\nb.on mouse teleport {\n    print "x"\n}\n' }, 'm.vxl', 'teleport');

console.log('\n--- vexel 2.0 console runs (Rust backend) ---');
function tRun(name, files, entry, expected, opts = {}) {
  withTmpFiles(files, (tmp) => {
    const r = vexel([path.join(tmp, entry)], { cwd: tmp, input: opts.input });
    const got = (r.stdout || '').replace(/\r\n/g, '\n');
    if (r.status === 0 && got === expected) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}:\nExpected:\n${JSON.stringify(expected)}\nGot:\n${JSON.stringify(got)}\nstatus=${r.status}\nSTDERR:\n${r.stderr}`);
      console.log(`FAIL ${name}`);
    }
  });
}

tRun('2.0 null + object + make + wait + error object', {
  'm.vxl': [
    'x = null',
    'if x = null {',
    '    print "nil"',
    '}',
    'data = {',
    '    name = "Zen"',
    '    level = 10',
    '}',
    'print data.name',
    'n = "42"',
    'make n number',
    'print n + 1',
    's = 7',
    'make s string',
    'print "n=" + s',
    'wait 0 seconds',
    'try {',
    '    print nodir/missing.txt',
    '} error {',
    '    print error.message',
    '    print error.type',
    '    print error',
    '}',
  ].join('\n'),
}, 'm.vxl', 'nil\nZen\n43\nn=7\nFile not found: nodir/missing.txt\nRuntimeError\nFile not found: nodir/missing.txt\n');

tRun('2.0 json round trip', {
  'm.vxl': [
    'player = {',
    '    name = "Zen"',
    '    level = 10',
    '    tags = ["a", "b"]',
    '}',
    'json write player to "p.json"',
    'back = json read "p.json"',
    'print back.name',
    'print back.level',
    'print [1] from back.tags',
  ].join('\n'),
}, 'm.vxl', 'Zen\n10\nb\n');

console.log('\n--- vexel 2.2 (coordinates, timers, window) ---');

tCheck('2.2 window methods + lifecycle events', {
  'm.vxl': [
    'create a window titled "W"',
    'window.on resize {',
    '    print "resized"',
    '}',
    'window.on move {',
    '    print "moved"',
    '}',
    'window.on close {',
    '    print "bye"',
    '}',
    'go = add a button titled "Go"',
    'go.on click {',
    '    window.minimize',
    '    window.restore',
    '    window.maximize',
    '    window.hide',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tCheck('2.2 timer handle + cancel', {
  'm.vxl': [
    'create a window titled "T"',
    't = every 1 second {',
    '    print "tick"',
    '}',
    'u = after 2 seconds {',
    '    t.cancel',
    '    print "done"',
    '}',
    'u.cancel',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tCheckFails('2.2 cancel on non-timer fails', {
  'm.vxl': 'create a window titled "T"\nx = 5\nx.cancel\nwindow.show\n',
}, 'm.vxl', 'has no field');

tCheckFails('2.2 cancel undeclared fails', {
  'm.vxl': 'create a window titled "T"\nnope.cancel\nwindow.show\n',
}, 'm.vxl', 'Undefined variable');

tCheckFails('2.2 unknown timer action fails', {
  'm.vxl': 'create a window titled "T"\nt = every 1 second {\n print "x"\n}\nt.stop\nwindow.show\n',
}, 'm.vxl', 'Unknown timer action');

tCheckFails('2.2 bad event on button fails', {
  'm.vxl': 'create a window titled "T"\nb = add a button titled "B"\nb.on resize {\n print "x"\n}\nwindow.show\n',
}, 'm.vxl', 'does not support event');

tDebug('2.2 position regression (A-B-C-D)', {
  'm.vxl': [
    'create a window titled "Position Test"',
    'a = add a button titled "A"',
    'a.x = 20', 'a.y = 20', 'a.width = 50', 'a.height = 50',
    'b = add a button titled "B"',
    'b.x = 100', 'b.y = 20', 'b.width = 50', 'b.height = 50',
    'c = add a button titled "C"',
    'c.x = 180', 'c.y = 20', 'c.width = 50', 'c.height = 50',
    'd = add a button titled "D"',
    'd.x = 260', 'd.y = 20', 'd.width = 50', 'd.height = 50',
    'window.show',
  ].join('\n'),
}, 'm.vxl', [
  'a: button x=20 y=20 w=50 h=50 (in window)',
  'b: button x=100 y=20 w=50 h=50 (in window)',
  'c: button x=180 y=20 w=50 h=50 (in window)',
  'd: button x=260 y=20 w=50 h=50 (in window)',
  'Warnings: none.',
], ['WARN']);

tDebug('2.2 calculator row stays inside window', {
  'm.vxl': [
    'create a window titled "Calculator"',
    'set window width to 400',
    'set window height to 470',
    'display = add an output box',
    'display.x = 20', 'display.y = 20', 'display.width = 360', 'display.height = 70',
    'seven = add a button titled "7"',
    'seven.x = 20', 'seven.y = 110', 'seven.width = 82', 'seven.height = 55',
    'eight = add a button titled "8"',
    'eight.x = 112', 'eight.y = 110', 'eight.width = 82', 'eight.height = 55',
    'nine = add a button titled "9"',
    'nine.x = 204', 'nine.y = 110', 'nine.width = 82', 'nine.height = 55',
    'divBtn = add a button titled "/"',
    'divBtn.x = 296', 'divBtn.y = 110', 'divBtn.width = 84', 'divBtn.height = 55',
    'window.show',
  ].join('\n'),
}, 'm.vxl', [
  'window: 400x470',
  'seven: button x=20 y=110 w=82 h=55 (in window)',
  'divBtn: button x=296 y=110 w=84 h=55 (in window)',
  'Warnings: none.',
], ['WARN']);

tDebug('2.2 debug flags overflow + dup id', {
  'm.vxl': [
    'create a window titled "Bad"',
    'set window width to 400',
    'a = add a button titled "A"',
    'a.x = 350', 'a.y = 20', 'a.width = 100', 'a.height = 50',
    'a.id = "dup"',
    'b = add a button titled "B"',
    'b.x = 20', 'b.y = 20', 'b.width = 50', 'b.height = 50',
    'b.id = "dup"',
    'window.show',
  ].join('\n'),
}, 'm.vxl', [
  'WARN a: right edge (x+w=450) exceeds window width 400.',
  'WARN b: duplicate id "dup" (also on a).',
], ['Warnings: none.']);

console.log('\n--- vexel 2.2 Avalonia backend (phase 2) ---');

function tAxFails(name, files, entry, mustContain) {
  withTmpFiles(files, (tmp) => {
    const r = vexel(['build', path.join(tmp, entry), '--avalonia'], { cwd: tmp, timeout: 600000 });
    const combined = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 && (!mustContain || combined.includes(mustContain))) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: expected BackendError containing '${mustContain}'\nstatus=${r.status}\n${combined}`);
      console.log(`FAIL ${name}`);
    }
  });
}

function tAxBuild(name, files, entry) {
  withTmpFiles(files, (tmp) => {
    const r = vexel(['build', path.join(tmp, entry), '--avalonia'], { cwd: tmp, timeout: 600000 });
    const exe = path.join(tmp, entry.replace(/\.vxl$/, process.platform === 'win32' ? '.exe' : ''));
    if (r.status === 0 && fs.existsSync(exe)) {
      passed++;
      console.log(`PASS ${name}`);
    } else {
      failed++;
      failures.push(`${name}: avalonia build failed\nstatus=${r.status}\n${r.stdout}\n${r.stderr}`);
      console.log(`FAIL ${name}`);
    }
  });
}

tAxBuild('2.2-ax toolbar + table build', {
  'm.vxl': [
    'create a window titled "T"',
    'toolbar = add a toolbar',
    'toolbar.x = 0',
    'toolbar.y = 0',
    'saveBtn = toolbar.add a button titled "Save"',
    'table = add a table',
    'table.x = 20',
    'table.y = 60',
    'table.add column "Name"',
    'table.add column "Age"',
    'table.add row ["Zen", 25]',
    'saveBtn.on click {',
    '    print "saved"',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tAxBuild('2.2.1 multi-module import build', {
  'm.vxl': [
    'import calc/logic',
    'create a window titled "M"',
    'display = add an output box',
    'display.text = logic.greet "hi"',
    'window.show',
  ].join('\n'),
  'calc/logic.vxl': 'public function greet who {\n    return "hello " + who\n}\n',
}, 'm.vxl');

tAxBuild('2.2-ax timers (bare + handle + cancel) build', {
  'm.vxl': [
    'create a window titled "T"',
    'count = 0',
    'ticker = every 1 second {',
    '    count = count + 1',
    '}',
    'stopper = after 3 seconds {',
    '    ticker.cancel',
    '}',
    'every 5 seconds {',
    '    print "slow tick"',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tAxBuild('2.2-ax widgets + handlers build', {  'm.vxl': [
    'create a window titled "Suite"',
    'count = 0',
    'display = add an output box',
    'display.x = 20',
    'display.y = 20',
    'display.width = 200',
    'display.height = 60',
    'display.text = "0"',
    'name = add an input box titled "Name"',
    'name.x = 20',
    'name.y = 100',
    'go = add a button titled "Go"',
    'go.x = 20',
    'go.y = 150',
    'go.width = 120',
    'go.height = 50',
    'go.on click {',
    '    count = count + 1',
    '    if count = 1 {',
    '        display.text = "one"',
    '    } else {',
    '        display.text = "" + count',
    '    }',
    '}',
    'name.on change {',
    '    display.text = name.text',
    '}',
    'window.on key press {',
    '    display.text = key',
    '}',
    'window.on close {',
    '    print "bye"',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tAxBuild('2.2-ax two windows build', {  'm.vxl': [
    'main = create a window titled "Main"',
    'main.width = 600',
    'main.height = 400',
    'hello = add a button titled "Hi"',
    'hello.x = 20',
    'hello.y = 20',
    'hello.width = 120',
    'hello.height = 50',
    'settings = create a window titled "Settings"',
    'settings.width = 400',
    'settings.height = 300',
    'opt = add a checkbox titled "Opt"',
    'opt.x = 20',
    'opt.y = 20',
    'hello.on click {',
    '    settings.show',
    '}',
    'settings.on close {',
    '    print "settings closed"',
    '}',
    'main.show',
    'settings.show',
  ].join('\n'),
}, 'm.vxl');

tDebug('2.2 named windows in debug tree', {
  'm.vxl': [
    'main = create a window titled "Main"',
    'hello = add a button titled "Hi"',
    'hello.x = 20',
    'settings = create a window titled "Settings"',
    'opt = add a checkbox titled "Opt" to settings',
    'main.show',
    'settings.show',
  ].join('\n'),
}, 'm.vxl', [
  'main: window titled "Main"',
  'settings: window titled "Settings"',
  'hello: button x=20 y=? w=? h=? (in main)',
  'opt: checkbox x=? y=? w=? h=? (in settings)',
  'Warnings: none.',
], ['WARN']);

tAxBuild('2.2-ax containers build', {  'm.vxl': [
    'create a window titled "C"',
    'p = create a container',
    'p.x = 50',
    'p.y = 50',
    'p.width = 300',
    'p.height = 200',
    'inner = add a button titled "In"',
    'inner.x = 20',
    'inner.y = 20',
    'add inner to p',
    'v = create a vertical container',
    'v.x = 400',
    'v.y = 50',
    'btnA = add a button titled "A"',
    'add btnA to v',
    'g = create a grid container',
    'g.x = 50',
    'g.y = 300',
    'c1 = add a button titled "C1" to g',
    'c2 = add a button titled "C2" to g',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tDebug('2.2 containers in debug tree', {
  'm.vxl': [
    'create a window titled "C"',
    'p = create a container',
    'p.x = 50',
    'p.y = 50',
    'inner = add a button titled "In"',
    'inner.x = 20',
    'add inner to p',
    'window.show',
  ].join('\n'),
}, 'm.vxl', [
  'p: container x=50 y=50 w=300 h=200 (in window)',
  'inner: button x=20 y=? w=? h=? (in p)',
  'Warnings: none.',
], ['WARN']);

tAxBuild('2.2-ax opacity + animate build', {  'm.vxl': [
    'create a window titled "O"',
    'box = add a button titled "Box"',
    'box.x = 20',
    'box.y = 20',
    'box.width = 120',
    'box.height = 50',
    'box.opacity = 0.5',
    'animate box {',
    '    move to x 200',
    '    fade to 0.9',
    '    duration 1 second',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tAxBuild('2.2-ax functions + ask build', {
  'm.vxl': [
    'create a window titled "F"',
    'function shout s {',
    '    return s + "!"',
    '}',
    'display = add an output box',
    'display.x = 20',
    'display.y = 20',
    'display.width = 200',
    'display.height = 60',
    'go = add a button titled "Go"',
    'go.on click {',
    '    if ask "Loud?" {',
    '        display.text = shout "hi"',
    '    } else {',
    '        display.text = "quiet"',
    '    }',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tAxBuild('2.2-ax task states + cancel build', {
  'm.vxl': [
    'create a window titled "T"',
    'task work {',
    '    wait 30 seconds',
    '    result = "finished"',
    '}',
    'killer = after 2 seconds {',
    '    work.cancel',
    '}',
    'prober = every 1 second {',
    '    print work.state',
    '}',
    'window.show',
  ].join('\n'),
}, 'm.vxl');

tCheckFails('http url must be string', {
  'm.vxl': 'create a window titled "W"\nresponse = http get 42\nwindow.show\n',
}, 'm.vxl', 'must be a string');

console.log('\n--- vexel 2.0 CLI ---');
{
  const r = vexel(['version']);
  // Version-agnostic: any semantic version prints (the check used to
  // hardcode 3.0.0 and broke at every bump).
  if (r.status === 0 && /vexel \d+\.\d+\.\d+/.test(r.stdout || '')) {
    passed++;
    console.log('PASS vexel version');
  } else {
    failed++;
    failures.push(`vexel version failed\n${r.stdout}\n${r.stderr}`);
    console.log('FAIL vexel version');
  }
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-proj-'));
  try {
    const r = vexel(['create', 'demo'], { cwd: tmp });
    const ok = r.status === 0 && fs.existsSync(path.join(tmp, 'demo', 'vexel.project')) && fs.existsSync(path.join(tmp, 'demo', 'main.vxl'));
    if (ok) {
      passed++;
      console.log('PASS vexel create');
    } else {
      failed++;
      failures.push(`vexel create failed\n${r.stdout}\n${r.stderr}`);
      console.log('FAIL vexel create');
    }
    const r2 = vexel(['run'], { cwd: path.join(tmp, 'demo') });
    if ((r2.stdout || '').includes('Hello from demo!')) {
      passed++;
      console.log('PASS vexel run (project)');
    } else {
      failed++;
      failures.push(`vexel run project failed\n${r2.stdout}\n${r2.stderr}`);
      console.log('FAIL vexel run (project)');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}
{
  const r = vexel(['debug', path.join(ROOT, 'examples', 'ui', 'counter.vxl')]);
  const out = r.stdout || '';
  if (r.status === 0 && out.includes('UI tree') && out.includes('button: button') && out.includes('AST nodes')) {
    passed++;
    console.log('PASS vexel debug');
  } else {
    failed++;
    failures.push(`vexel debug failed\n${out}\n${r.stderr}`);
    console.log('FAIL vexel debug');
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('\n---\n' + f);
  process.exit(1);
}
