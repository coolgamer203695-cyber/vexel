#!/usr/bin/env node
'use strict';

// Vexel v0.1 compiler driver — CLI + native build pipeline.
// Pipeline: .vxl -> Lexer -> Parser -> AST -> Modules -> Semantic/TypeCheck
//           -> Rust IR -> rustc -> native executable -> run.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { loadModules } = require('../compiler/modules/modules.js');
const { analyze } = require('../compiler/semantic/semantic.js');
const { generate, generateTest } = require('../compiler/codegen/codegen.js');
const { generateAX } = require('../compiler/codegen/codegen_ax.js');
const { VexelError } = require('../compiler/diagnostics/diagnostics.js');

const VERSION = '3.7.0';

// UI syntax nodes route a program to the C# (Avalonia) backend.
const UI_NODE_TYPES = new Set([
  'CreateWindow', 'CreateContainer', 'AddWidget', 'AddToContainer', 'ComponentUse',
  'UISetProp', 'UISetMinMax', 'UISetPosition', 'UICenter', 'UIUseTheme',
  'UIShowDialog', 'ShowNotification', 'UIAnimate', 'UIEventHandler', 'ComponentDecl', 'ThemeDecl',
  'UIAddNode', 'UIEventRef', 'AskExpr', 'ChooseFile', 'ChooseColor',
]);

function nodeUsesUI(node, seen) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) {
    for (const n of node) if (nodeUsesUI(n, seen)) return true;
    return false;
  }
  if (typeof node.type === 'string' && UI_NODE_TYPES.has(node.type)) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  const skip = { token: 1, fieldToken: 1, destToken: 1, structToken: 1 };
  for (const k of Object.keys(node)) {
    if (skip[k]) continue;
    if (nodeUsesUI(node[k], seen)) return true;
  }
  return false;
}

function programUsesUI(loadResult) {
  for (const [, mod] of loadResult.modules) {
    if (nodeUsesUI(mod.ast, new Set())) return true;
  }
  return false;
}

function axRuntimeDir() {
  return path.join(__dirname, '..', 'runtime', 'ui', 'backend', 'avalonia');
}

function dotnetEnv() {
  const env = Object.assign({}, process.env);
  const localDotnet = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'dotnet');
  try {
    if (fs.existsSync(path.join(localDotnet, 'dotnet.exe'))) {
      env.PATH = localDotnet + path.delimiter + (env.PATH || '');
      env.DOTNET_ROOT = localDotnet;
    }
  } catch (e) { /* ignore */ }
  env.DOTNET_CLI_TELEMETRY_OPTOUT = '1';
  env.DOTNET_NOLOGO = '1';
  env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1';
  return env;
}

function findDotnet() {
  const cands = ['dotnet'];
  try {
    const local = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'dotnet', 'dotnet.exe');
    if (fs.existsSync(local)) cands.push(local);
  } catch (e) { /* ignore */ }
  for (const c of cands) {
    const r = spawnSync(c, ['--list-sdks'], { encoding: 'utf8', env: dotnetEnv() });
    if (!r.error && r.status === 0 && (r.stdout || '').trim() !== '') return c;
  }
  return null;
}

function checkDotnet() {
  const exe = findDotnet();
  if (!exe) {
    console.error('Vexel Error\n\nType: ToolchainError\n\nAvalonia backend needs the .NET 8 SDK (dotnet --list-sdks is empty). Install it from https://aka.ms/dotnet/download (8.0 LTS) and re-open your terminal.');
    process.exit(1);
  }
  return exe;
}

function printHelp() {
  console.log(`Vexel v${VERSION} — an English-like compiled programming language
`);
  console.log(`Usage:`);
  console.log(`  vexel <program.vxl>        Compile and run a Vexel program`);
  console.log(`  vexel run <program.vxl>    Compile and run a Vexel program`);
  console.log(`  vexel build <program.vxl>  Compile to a native executable`);
  console.log(`  vexel check <program.vxl>  Type-check only (no codegen)`);
  console.log(`  vexel test [program.vxl]   Run test blocks (console programs)`);
  console.log(`  vexel --version            Show version`);
  console.log(`  vexel --help               Show this help`);
  console.log(``);
  console.log(`Examples:`);
  console.log(`  vexel hello.vxl`);
  console.log(`  vexel build hello.vxl`);
  console.log(`  vexel run hello.vxl`);
  console.log(`  vexel app.vxl              (UI programs open a real desktop window)`);
  console.log(``);
  console.log(`Projects:`);
  console.log(`  vexel create my_app        Scaffold my_app/ with vexel.project`);
  console.log(`  vexel run                  Run ./main.vxl (or vexel.project main)`);
  console.log(`  vexel build                Build ./main.vxl to a native executable`);
  console.log(`  vexel clean                Remove built executables and UI dependencies here`);
  console.log(`  vexel debug program.vxl    Static analysis view (AST, symbols, UI tree)`);
  console.log(`  vexel debug --dpi all program.vxl  UI geometry across DPI scales`);
  console.log(`  vexel version | vexel help Show version / help`);
  console.log(``);
console.log(`Console programs compile to native code via the Rust backend (rustc).`);
console.log(`UI programs (create a window ...) compile to native Avalonia apps via the .NET 8 SDK.`);
}

function checkRustc() {
  const r = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error('Vexel Error\n\nType: ToolchainError\n\nrustc not found. Install Rust (https://rustup.rs) to compile Vexel programs.');
    process.exit(1);
  }
  return (r.stdout || '').trim();
}

function compileToRust(entryFile) {
  const loadResult = loadModules(entryFile);
  const analyzeResult = analyze(loadResult);
  const rust = generate(loadResult, analyzeResult);
  return { loadResult, analyzeResult, rust };
}

function compileToTest(entryFile) {
  const loadResult = loadModules(entryFile);
  const analyzeResult = analyze(loadResult);
  const testSrc = generateTest(loadResult, analyzeResult);
  return { loadResult, analyzeResult, testSrc };
}

// Atlas v0.4: build the GPU backend (gpu/ crate) on demand and place it
// beside every compiled program. Entirely non-fatal: when cargo or the
// backend is missing, programs still build and simply report
// "GPU unavailable" at runtime.
function ensureGpuBackend(outExe) {
  try {
    const here = path.join(__dirname, '..');
    const candidates = [
      path.join(here, 'gpu'),
      path.join(process.cwd(), 'vexel', 'gpu'),
      path.join(process.cwd(), 'gpu'),
    ];
    const crateDir = candidates.find((p) => fs.existsSync(path.join(p, 'Cargo.toml')));
    if (!crateDir) return;
    const libName = process.platform === 'win32' ? 'vex_gpu.dll'
      : process.platform === 'darwin' ? 'libvex_gpu.dylib' : 'libvex_gpu.so';
    const built = path.join(crateDir, 'target', 'release', libName);
    // Rebuild when missing or older than any crate source (mtime walk).
    const srcFiles = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'target' || e.name.startsWith('.')) continue;
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else srcFiles.push(fp);
      }
    };
    walk(crateDir);
    let stale = !fs.existsSync(built);
    if (!stale) {
      const dllM = fs.statSync(built).mtimeMs;
      stale = srcFiles.some((f) => {
        try { return fs.statSync(f).mtimeMs > dllM; } catch (e) { return false; }
      });
    }
    if (stale) {
      const r = spawnSync('cargo', ['build', '--release'], { cwd: crateDir, encoding: 'utf8' });
      if (r.error || r.status !== 0) return; // backend stays unavailable (honest)
    }
    if (fs.existsSync(built) && outExe) {
      const dst = path.join(path.dirname(outExe), libName);
      try {
        const need = !fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(built).mtimeMs;
        if (need) fs.copyFileSync(built, dst);
      } catch (e) { /* non-fatal */ }
    }
    // Refresh the cache copy too (loader fallback for in-place runs).
    try {
      const cacheDir = path.join(process.cwd(), '.vexel-cache', 'gpu');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, libName);
      if (fs.existsSync(built) && (!fs.existsSync(cacheFile) || fs.statSync(cacheFile).mtimeMs < fs.statSync(built).mtimeMs)) {
        fs.copyFileSync(built, cacheFile);
      }
    } catch (e) { /* non-fatal */ }
  } catch (e) { /* never break a build over the optional backend */ }
}

function rustcBuild(rustSource, outExe, extraArgs = []) {
  checkRustc();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-'));
  const rsPath = path.join(tmpDir, 'program.rs');
  fs.writeFileSync(rsPath, rustSource, 'utf8');
  const args = ['--edition=2021', '-O', rsPath, '-o', outExe, ...extraArgs];
  const r = spawnSync('rustc', args, { encoding: 'utf8' });
  // Clean temp rs (keep dir for debugging? remove)
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (r.status !== 0) {
    console.error('Vexel Error\n\nType: CodegenError\n\nNative backend (rustc) failed:\n' + (r.stderr || r.stdout || 'unknown error'));
    process.exit(1);
  }
  // Atlas v0.4: make the GPU backend reachable beside the program.
  ensureGpuBackend(outExe);
}

function exeNameFor(sourceFile, outDir) {
  const base = path.basename(sourceFile, path.extname(sourceFile));
  const exe = process.platform === 'win32' ? base + '.exe' : base;
  return path.join(outDir, exe);
}

// ---------- Vexel 2.9 incremental builds ----------
// Content-hash cache: <outDir>/.vexel-cache/<key>/ holds exact copies of
// emitted files. A hit copies them back and skips the backend entirely.
// The key covers the compiler fingerprint + backend + every transitive
// source's bytes, so stale outputs are impossible by construction.

function compilerFingerprint() {
  const h = crypto.createHash('sha1');
  const roots = [
    path.join(__dirname, '..', 'compiler'),
    path.join(__dirname, '..', 'runtime'),
    path.join(__dirname),
  ];
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && (p.endsWith('.js') || p.endsWith('.rs') || p.endsWith('.cs') || p.endsWith('.json'))) files.push(p);
    }
  };
  for (const r of roots) walk(r);
  for (const f of files) {
    h.update(path.relative(path.join(__dirname, '..'), f));
    h.update('\0');
    try { h.update(fs.readFileSync(f)); } catch (e) { /* ignore */ }
    h.update('\0');
  }
  return h.digest('hex');
}

let cachedFingerprint = null;
function getFingerprint() {
  if (!cachedFingerprint) cachedFingerprint = compilerFingerprint();
  return cachedFingerprint;
}

function buildCacheKey(loadResult, backend) {
  const h = crypto.createHash('sha1');
  h.update(`vexel-inc-1|${VERSION}|${getFingerprint()}|${backend}|`);
  for (const absPath of loadResult.order) {
    h.update(absPath);
    h.update('\0');
    h.update(fs.readFileSync(absPath));
    h.update('\0');
  }
  return h.digest('hex');
}

function cacheLookup(cacheDir, key) {
  const dir = path.join(cacheDir, key);
  const manifest = path.join(dir, 'files.json');
  try {
    const names = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const files = [];
    for (const name of names) {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) return null;
      files.push({ name, src: p });
    }
    return files;
  } catch (e) {
    return null;
  }
}

function cacheStore(cacheDir, key, emitted) {
  // emitted: [{ name, src }] — copies stored under keyed dir + manifest.
  const dir = path.join(cacheDir, key);
  fs.mkdirSync(dir, { recursive: true });
  const names = [];
  for (const f of emitted) {
    fs.copyFileSync(f.src, path.join(dir, f.name));
    names.push(f.name);
  }
  fs.writeFileSync(path.join(dir, 'files.json'), JSON.stringify(names), 'utf8');
}

function compileToAX(file) {
  const loadResult = loadModules(file);
  const analyzeResult = analyze(loadResult);
  const ax = generateAX(loadResult, analyzeResult);
  const isUI = programUsesUI(loadResult);
  return { loadResult, analyzeResult, ax, isUI };
}

function axPublish(ax, outExe) {
  const dotnet = checkDotnet();
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexel-ax-'));
  try {
    fs.writeFileSync(path.join(projDir, 'VexApp.csproj'), ax.csproj, 'utf8');
    fs.writeFileSync(path.join(projDir, 'Program.cs'), '﻿' + ax.programCs, 'utf8');
    fs.copyFileSync(path.join(axRuntimeDir(), 'VexAx.cs'), path.join(projDir, 'VexAx.cs'));
    // Vexel 3.0 Praxis engine files ride along with the backend.
    for (const f of fs.readdirSync(axRuntimeDir())) {
      if (/^Praxis.*\.cs$/.test(f)) {
        fs.copyFileSync(path.join(axRuntimeDir(), f), path.join(projDir, f));
      }
    }
    const pubDir = path.join(projDir, 'publish');
    const args = ['publish', path.join(projDir, 'VexApp.csproj'), '-c', 'Release', '-r', 'win-x64',
      '--self-contained', 'false', '/p:PublishSingleFile=true', '-o', pubDir, '-v', 'minimal', '--nologo'];
    const r = spawnSync(dotnet, args, { encoding: 'utf8', env: dotnetEnv(), timeout: 900000 });
    const built = path.join(pubDir, 'VexApp.exe');
    if (r.status !== 0 || !fs.existsSync(built)) {
      console.error('Vexel Error\n\nType: CodegenError\n\nAvalonia backend (dotnet publish) failed:\n' + ((r.stdout || '') + '\n' + (r.stderr || '')).trim().slice(-4000));
      process.exit(1);
    }
    // Single-file publish still emits native siblings (Skia/HarfBuzz/ANGLE)
    // that must sit next to the exe — copy them all (except symbols),
    // renaming only the exe itself to the target name.
    const outBase = path.basename(outExe, path.extname(outExe));
    const emitted = [];
    for (const f of fs.readdirSync(pubDir)) {
      if (f.toLowerCase().endsWith('.pdb')) continue;
      const src = path.join(pubDir, f);
      if (!fs.statSync(src).isFile()) continue;
      const dst = (f === 'VexApp.exe') ? outExe : path.join(path.dirname(outExe), f === 'VexApp' ? outBase : f);
      fs.copyFileSync(src, dst);
      emitted.push({ name: path.basename(dst), src: dst });
    }
    return emitted;
  } finally {
    try { fs.rmSync(projDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function isUIProgram(file) {
  const loadResult = loadModules(file);
  return { loadResult, isUI: programUsesUI(loadResult) };
}

function collectCheckWarnings(loadResult, analyzeResult, isUI) {
  // Real detectors only — every warning below was actually computed.
  const warnings = [];
  // Duplicate imports run once; importing twice is almost always a slip.
  for (const absPath of loadResult.order) {
    const mod = loadResult.modules.get(absPath);
    const seen = new Map();
    for (const st of mod.ast.body) {
      if (st.type !== 'ImportDecl') continue;
      const key = path.normalize(path.resolve(mod.dir, st.path + '.vxl'));
      if (seen.has(key)) {
        warnings.push(`${path.basename(absPath)}: '${st.path}' is imported twice (modules run once).`);
      } else {
        seen.set(key, true);
      }
    }
  }
  // Static UI geometry validation (overflow, negative sizes, dup ids).
  if (isUI) {
    try {
      const tree = cmdDebugUITree(loadResult, analyzeResult);
      for (const line of tree.split('\n')) {
        const t = line.trim();
        if (t.startsWith('WARN ')) warnings.push(t);
      }
    } catch (e) { /* geometry view is best-effort; analysis already passed */ }
  }
  return warnings;
}

function cmdCheck(file) {
  try {
    // Vexel 2.9 staged check — every stage actually runs.
    const loadResult = loadModules(file);
    console.log('Vexel Check');
    console.log(`✓ Parsing (${loadResult.order.length} file${loadResult.order.length === 1 ? '' : 's'})`);
    const analyzeResult = analyze(loadResult);
    console.log('✓ Type checking');
    console.log(`✓ Modules (${loadResult.order.length} module${loadResult.order.length === 1 ? '' : 's'})`);
    const isUI = programUsesUI(loadResult);
    const backendName = isUI ? 'UI validation' : 'Code generation';
    try {
      if (isUI) {
        // 2.2.1: Avalonia is the only UI backend — validate it directly.
        generateAX(loadResult, analyzeResult);
      } else {
        generate(loadResult, analyzeResult);
      }
    } catch (e) {
      if (e && e.name === 'VexelError') throw e;
      throw new VexelError({
        type: 'CodegenError',
        message: `${backendName} failed: ${(e && e.message) || e}`,
        file, line: 1, column: 1, sourceLine: '',
      });
    }
    console.log(`✓ ${backendName}`);
    const warnings = collectCheckWarnings(loadResult, analyzeResult, isUI);
    console.log('0 errors');
    console.log(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
    console.log(`OK: ${file} — no errors.`);
  } catch (e) {
    if (e && e.name === 'VexelError') {
      console.error(e.format());
      process.exit(1);
    }
    throw e;
  }
}

function cmdTest(file) {
  // Vexel 2.9: compile in test mode and run the suite headlessly.
  try {
    const { isUI } = isUIProgram(file);
    if (isUI) {
      console.error('Vexel Error\n\nType: BackendError\n\nvexel test needs a console program. UI programs cannot run headless tests — move testable logic into console modules without windows.');
      process.exit(1);
    }
    const { testSrc } = compileToTest(file);
    const hash = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vexel-test-${hash}-`));
    const outExe = path.join(tmpDir, process.platform === 'win32' ? 'program.exe' : 'program');
    rustcBuild(testSrc, outExe);
    const cwd = path.dirname(path.resolve(file));
    const result = spawnSync(outExe, [], { cwd, stdio: 'inherit', encoding: 'utf8' });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (result.error) {
      console.error(`Failed to run tests: ${result.error.message}`);
      process.exit(1);
    }
    process.exit(result.status != null ? result.status : 0);
  } catch (e) {
    if (e && e.name === 'VexelError') {
      console.error(e.format());
      process.exit(1);
    }
    throw e;
  }
}

function cmdBuild(file, opts = {}) {
  const { keepRust = false } = opts;
  try {
    const { loadResult, isUI } = isUIProgram(file);
    const outDir = path.dirname(path.resolve(file));
    const outExe = exeNameFor(file, outDir);
    const backend = isUI ? 'ax' : 'rust';
    const cacheDir = path.join(outDir, '.vexel-cache');
    const key = buildCacheKey(loadResult, backend);
    const hit = cacheLookup(cacheDir, key);
    if (hit && hit.length > 0) {
      let restored = true;
      for (const f of hit) {
        try {
          const dst = f.name === path.basename(outExe) ? outExe : path.join(outDir, f.name);
          fs.copyFileSync(f.src, dst);
          if (!fs.existsSync(dst) || fs.statSync(dst).size === 0) restored = false;
        } catch (e) {
          restored = false;
        }
      }
      if (restored) {
        console.log(`Up to date: ${outExe} (sources unchanged, build skipped)`);
        return outExe;
      }
      // Corrupt cache entry: fall through to a full rebuild.
    }
    let emitted;
    if (isUI) {
      // 2.2.1: Avalonia is the only UI backend.
      const { ax } = compileToAX(file);
      emitted = axPublish(ax, outExe) || [{ name: path.basename(outExe), src: outExe }];
      console.log(`Built ${outExe} (Avalonia app)`);
    } else {
      const { rust } = compileToRust(file);
      if (keepRust) {
        const rsOut = path.join(outDir, path.basename(file, path.extname(file)) + '.rs');
        fs.writeFileSync(rsOut, rust, 'utf8');
      }
      rustcBuild(rust, outExe);
      emitted = [{ name: path.basename(outExe), src: outExe }];
      console.log(`Built ${outExe}`);
    }
    try {
      cacheStore(cacheDir, key, emitted);
    } catch (e) { /* cache is best-effort */ }
    return outExe;
  } catch (e) {
    if (e && e.name === 'VexelError') {
      console.error(e.format());
      process.exit(1);
    }
    throw e;
  }
}

function cmdRun(file, opts = {}) {
  // Vexel 2.9: programArgs are forwarded to the built program (see `args`).
  const { stdinInput = null, capture = false, programArgs = [] } = opts;
  try {
    const { loadResult, isUI } = isUIProgram(file);
    // Vexel 2.9: runs reuse the incremental cache too (keyed by sources).
    const srcDir = path.dirname(path.resolve(file));
    const cacheDir = path.join(srcDir, '.vexel-cache');
    const runKey = buildCacheKey(loadResult, isUI ? 'ax' : 'rust');
    if (isUI) {
      // 2.2.1: Avalonia is the only UI backend.
      const { ax } = compileToAX(file);
      const hash = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vexel-axrun-${hash}-`));
      const outExe = path.join(tmpDir, 'program.exe');
      const hit = cacheLookup(cacheDir, runKey);
      let restored = false;
      if (hit && hit.length > 0) {
        try {
          for (const f of hit) fs.copyFileSync(f.src, path.join(tmpDir, f.name));
          restored = fs.existsSync(outExe) && fs.statSync(outExe).size > 0;
        } catch (e) {
          restored = false;
        }
      }
      if (!restored) {
        const emitted = axPublish(ax, outExe) || [{ name: 'program.exe', src: outExe }];
        try { cacheStore(cacheDir, runKey, emitted); } catch (e) { /* best-effort */ }
      }
      const cwd = path.dirname(path.resolve(file));
      const result = spawnSync(outExe, programArgs, { cwd, stdio: 'inherit', encoding: 'utf8' });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      if (result.error) {
        console.error(`Failed to run compiled program: ${result.error.message}`);
        process.exit(1);
      }
      process.exit(result.status != null ? result.status : 0);
    }
    const { rust } = compileToRust(file);
    const hash = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vexel-run-${hash}-`));
    const exeName = process.platform === 'win32' ? 'program.exe' : 'program';
    const outExe = path.join(tmpDir, exeName);
    const runHit = cacheLookup(cacheDir, runKey);
    let runRestored = false;
    if (runHit && runHit.length > 0) {
      try {
        for (const f of runHit) fs.copyFileSync(f.src, path.join(tmpDir, f.name));
        runRestored = fs.existsSync(outExe) && fs.statSync(outExe).size > 0;
      } catch (e) {
        runRestored = false;
      }
    }
    if (!runRestored) {
      rustcBuild(rust, outExe);
      try { cacheStore(cacheDir, runKey, [{ name: exeName, src: outExe }]); } catch (e) { /* best-effort */ }
    }
    // Run with CWD = source dir so relative file reads (data/info.txt) work.
    const cwd = path.dirname(path.resolve(file));
    const runOpts = { cwd, encoding: 'utf8' };
    let result;
    if (capture) {
      result = spawnSync(outExe, programArgs, {
        cwd,
        encoding: 'utf8',
        input: stdinInput != null ? stdinInput : undefined,
      });
    } else {
      result = spawnSync(outExe, programArgs, {
        cwd,
        stdio: stdinInput != null ? ['pipe', 'inherit', 'inherit'] : 'inherit',
        input: stdinInput != null ? stdinInput : undefined,
        encoding: 'utf8',
      });
    }
    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (result.error) {
      console.error(`Failed to run compiled program: ${result.error.message}`);
      process.exit(1);
    }
    if (capture) {
      return result;
    }
    process.exit(result.status != null ? result.status : 0);
  } catch (e) {
    if (e && e.name === 'VexelError') {
      console.error(e.format());
      process.exit(1);
    }
    throw e;
  }
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    if (args.length === 0) {
      printHelp();
      process.exit(0);
    }
    printHelp();
    process.exit(0);
  }
  if (args.includes('--version') || args.includes('-V')) {
    console.log(`vexel ${VERSION}`);
    process.exit(0);
  }
  const cmd = args[0];
  if (cmd === 'create') {
    cmdCreate(args[1]);
    return;
  }
  if (cmd === 'clean') {
    cmdClean();
    return;
  }
  if (cmd === 'debug') {
    // Vexel 2.9: vexel debug [--dpi all|100|125|150|175|200] <program.vxl>
    let dpiOpt = null;
    let file = args[1];
    if (file === '--dpi') {
      const scale = args[2];
      if (!['all', '100', '125', '150', '175', '200'].includes(scale)) {
        console.error('Usage: vexel debug [--dpi all|100|125|150|175|200] <program.vxl>');
        process.exit(1);
      }
      dpiOpt = scale === 'all' ? 'all' : Number(scale);
      file = args[3];
    }
    if (!file) {
      console.error('Usage: vexel debug [--dpi all|100|125|150|175|200] <program.vxl>');
      process.exit(1);
    }
    cmdDebug(file, dpiOpt);
    return;
  }
  if (cmd === 'version') {
    console.log(`vexel ${VERSION}`);
    process.exit(0);
  }
  if (cmd === 'help') {
    printHelp();
    process.exit(0);
  }
  if (cmd === 'build') {
    // Vexel 2.0: bare `vexel build` builds the project entry point.
    // 2.2.1: `--avalonia` is accepted and ignored (Avalonia is the UI backend).
    const rest = args.filter((a) => a !== '--avalonia');
    cmdBuild(rest[1] || resolveProjectEntry(process.cwd()));
    return;
  }
  if (cmd === 'run') {
    // Vexel 2.0: bare `vexel run` runs the project entry point.
    // Vexel 2.9: trailing arguments reach the program via `args`.
    const rest = args.filter((a) => a !== '--avalonia');
    if (rest[1]) {
      cmdRun(rest[1], { programArgs: rest.slice(2) });
    } else {
      cmdRun(resolveProjectEntry(process.cwd()), { programArgs: rest.slice(1) });
    }
    return;
  }
  if (cmd === 'check') {
    // Vexel 2.9: bare `vexel check` checks the project entry point.
    const file = args[1] || resolveProjectEntry(process.cwd());
    cmdCheck(file);
    return;
  }
  if (cmd === 'test') {
    // Vexel 2.9: run the test suite (bare form uses the project entry).
    cmdTest(args[1] || resolveProjectEntry(process.cwd()));
    return;
  }
  // Bare file: vexel program.vxl [program args...]
  const file = cmd;
  if (file.endsWith('.vxl')) {
    if (!fs.existsSync(file)) {
      console.error(`Vexel Error\n\nType: FileError\nFile: ${file}\n\nFile not found: ${file}`);
      process.exit(1);
    }
    // Vexel 2.9: arguments after the file reach the program via `args`.
    cmdRun(file, { programArgs: args.slice(1) });
    return;
  }
  console.error(`Unknown command '${cmd}'. Use vexel --help.`);
  process.exit(1);
}

// ---------- Vexel 2.0 project commands ----------

function readProject(dir) {
  const pf = path.join(dir, 'vexel.project');
  try {
    if (!fs.existsSync(pf)) return null;
    return JSON.parse(fs.readFileSync(pf, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Vexel 2.9: project-aware commands work from any subdirectory — walk up
// to the nearest vexel.project and resolve the entry from the root.
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'vexel.project'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveProjectEntry(cwd) {
  const root = findProjectRoot(cwd) || path.resolve(cwd);
  const proj = readProject(root);
  if (proj && proj.main) {
    const p = path.isAbsolute(proj.main) ? proj.main : path.join(root, proj.main);
    if (fs.existsSync(p)) return p;
    console.error(`Vexel Error\n\nProject main not found: ${p} (from vexel.project).`);
    process.exit(1);
  }
  for (const cand of [path.join(root, 'main.vxl'), path.join(root, 'src', 'main.vxl')]) {
    if (fs.existsSync(cand)) return cand;
  }
  console.error('Usage: vexel run|build|check [program.vxl]\nNo program given and no main.vxl, src/main.vxl or vexel.project found here.');
  process.exit(1);
}

function cmdCreate(name) {
  if (!name || name.endsWith('.vxl')) {
    console.error('Usage: vexel create <project-name>');
    process.exit(1);
  }
  const root = path.join(process.cwd(), name);
  if (fs.existsSync(root)) {
    console.error(`Vexel Error\n\nDirectory already exists: ${root}`);
    process.exit(1);
  }
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'libraries'), { recursive: true });
  fs.writeFileSync(path.join(root, 'vexel.project'), JSON.stringify({ name, version: '1.0.0', main: 'main.vxl' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'main.vxl'), 'print "Hello from ' + name + '!"\n', 'utf8');
  console.log(`Created ${root}`);
  console.log('Next: cd ' + name + ' then vexel run');
}

function cmdClean() {
  const cwd = process.cwd();
  let removed = 0;
  // 2.2.1: UI builds emit the exe plus Avalonia native siblings beside it.
  const siblings = new Set(['av_libglesv2.dll', 'libharfbuzzsharp.dll', 'libskiasharp.dll']);
  for (const f of fs.readdirSync(cwd)) {
    const low = f.toLowerCase();
    // .pdb next to an .exe is a build artifact too (native backends emit it).
    if (low.endsWith('.exe') || low.endsWith('.pdb') || siblings.has(low)) {
      try {
        fs.unlinkSync(path.join(cwd, f));
        removed++;
        console.log(`Removed ${f}`);
      } catch (e) { /* ignore */ }
    }
  }
  // Vexel 2.9: drop the incremental build cache as well.
  const cacheDir = path.join(cwd, '.vexel-cache');
  try {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      removed++;
      console.log('Removed .vexel-cache');
    }
  } catch (e) { /* ignore */ }
  if (removed === 0) console.log('Nothing to clean (no build artifacts here).');
}

function cmdDebug(file, dpiOpt) {
  try {
    const Types = require('../compiler/types/types.js');
    const loadResult = loadModules(file);
    const analyzeResult = analyze(loadResult);
    const isUI = programUsesUI(loadResult);
    console.log(`Vexel ${VERSION} debug view (static analysis — no code runs)`);
    console.log(`File: ${path.resolve(file)}`);
    console.log(`Backend: ${isUI ? 'C# Avalonia (UI program)' : 'Rust (console program)'}`);
    console.log('');
    console.log('Modules:');
    for (const absPath of loadResult.order) {
      const mod = loadResult.modules.get(absPath);
      const imps = [];
      for (const st of mod.ast.body) {
        if (st.type === 'ImportDecl') imps.push(`${st.path} as ${st.moduleName}`);
      }
      console.log(`  ${path.basename(absPath)}${absPath === loadResult.entryAbs ? ' (entry)' : ''}${imps.length > 0 ? ' imports: ' + imps.join(', ') : ''}`);
    }
    const counts = {};
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node.type === 'string' && !['Program'].includes(node.type)) {
        const tokenish = ['IDENT', 'INT', 'DECIMAL', 'STRING', 'KEYWORD', 'OP', 'SLASH', 'COMMA', 'DOT', 'NEWLINE', 'EOF', 'LBRACE', 'RBRACE', 'LBRACKET', 'RBRACKET', 'LPAREN', 'RPAREN'];
        if (!tokenish.includes(node.type)) counts[node.type] = (counts[node.type] || 0) + 1;
      }
      for (const k of Object.keys(node)) {
        if (k === 'token' || k === 'fieldToken' || k === 'destToken' || k === 'structToken') continue;
        walk(node[k]);
      }
    };
    for (const absPath of loadResult.order) walk(loadResult.modules.get(absPath).ast);
    console.log('');
    console.log('AST nodes:');
    for (const k of Object.keys(counts).sort()) console.log(`  ${k}: ${counts[k]}`);
    console.log('');
    console.log('Symbols:');
    for (const absPath of loadResult.order) {
      const scope = analyzeResult.scopes.get(path.normalize(absPath));
      console.log(`  [${scope.name}]`);
      for (const [n, v] of scope.variables) console.log(`    var ${n}: ${Types.typeName(v.type)}${v.isPublic ? ' (public)' : ''}`);
      for (const [n, f] of scope.functions) console.log(`    function ${n}(${f.params.length})`);
      for (const [n, s] of scope.structs) console.log(`    struct ${n} { ${s.fields.join(', ')} }`);
      if (scope.enums) for (const [n, e] of scope.enums) console.log(`    enum ${n} { ${e.values.join(', ')} }`);
      for (const [n] of scope.components) console.log(`    component ${n}`);
      for (const [n] of scope.themes) console.log(`    theme ${n}`);
      if (scope.styles) for (const [n] of scope.styles) console.log(`    style ${n}`);
    }
    if (isUI) {
      console.log('');
      console.log('UI tree (static view — conditional code may differ at runtime):');
      console.log(cmdDebugUITree(loadResult, analyzeResult, dpiOpt || null));
    }
  } catch (e) {
    if (e && e.name === 'VexelError') {
      console.error(e.format());
      process.exit(1);
    }
    throw e;
  }
}

function cmdDebugUITree(loadResult, analyzeResult, dpiOpt) {
  // Best-effort static UI tree: window, widgets in order, containers with
  // members (via `to` targets), props set, events subscribed.
  // Vexel 2.2: plus a Geometry section (static x/y/width/height per
  // control) and a Warnings section (outside parent, negative sizes,
  // duplicate ids). Conditional code may differ at runtime.
  const lines = [];
  const fmtTarget = (t) => {
    if (!t) return '?';
    if (t.type === 'VarRef') return t.name;
    if (t.type === 'OutputRef') return 'output';
    if (t.type === 'FieldAccess') return fmtTarget(t.object) + '.' + t.field;
    return '?';
  };
  const numVal = (v) => {
    if (!v) return null;
    if (v.type === 'IntLit' || v.type === 'FloatLit') return Number(v.value);
    if (v.type === 'UnaryExpr' && v.op === '-' && v.expr && (v.expr.type === 'IntLit' || v.expr.type === 'FloatLit')) {
      return -Number(v.expr.value);
    }
    return null;
  };
  const strVal = (v) => (v && v.type === 'StrLit' ? v.value : null);
  // geom: name -> { kind, title, x, y, w, h, parent, id }
  const geom = {};
  const widget = (name) => {
    if (!geom[name]) geom[name] = { kind: '?', title: null, x: null, y: null, w: null, h: null, parent: 'window', id: null };
    return geom[name];
  };
  const win = widget('window');
  win.kind = 'window';
  win.w = 800;
  win.h = 600;
  const timers = [];
  const setGeom = (name, prop, v) => {
    const g = widget(name);
    if (prop === 'x') g.x = v;
    else if (prop === 'y') g.y = v;
    else if (prop === 'width') g.w = v;
    else if (prop === 'height') g.h = v;
  };
  // Linear scan per module (indented inside functions/components).
  for (const absPath of loadResult.order) {
    const mod = loadResult.modules.get(absPath);
    let currentWindow = 'window';
    const scan = (stmts, depth) => {
      for (const st of stmts || []) {
        if (!st) continue;
        if (st.type === 'CreateWindow' && !st.handle) {
          const t = st.title && st.title.type === 'StrLit' ? st.title.value : '…';
          lines.push(`window titled ${JSON.stringify(t)}`);
          currentWindow = 'window';
        } else if (st.type === 'VarAssign' && st.value && st.value.type === 'CreateWindow' && st.value.handle) {
          const t = st.value.title && st.value.title.type === 'StrLit' ? st.value.title.value : '…';
          lines.push(`${'  '.repeat(depth)}${st.value.handle}: window titled ${JSON.stringify(t)}`);
          currentWindow = st.value.handle;
          const g = widget(st.value.handle);
          g.kind = 'window';
          g.parent = '(root)';
          g.w = 800;
          g.h = 600;
        } else if (st.type === 'VarAssign' && st.value && st.value.type === 'AddWidget') {
          const nm = st.target.type === 'VarRef' ? st.target.name : st.target.type === 'OutputRef' ? 'output' : '?';
          const ti = st.value.title && st.value.title.type === 'StrLit' ? ` titled ${JSON.stringify(st.value.title.value)}` : '';
          const to = st.value.to ? ` -> ${fmtTarget(st.value.to)}` : '';
          lines.push(`${'  '.repeat(depth)}${nm || '?'}: ${st.value.kind}${ti}${to}`);
          if (nm && nm !== '?') {
            const g = widget(nm);
            g.kind = st.value.kind;
            if (st.value.title && st.value.title.type === 'StrLit') g.title = st.value.title.value;
            g.parent = st.value.to && st.value.to.type === 'VarRef' ? st.value.to.name : currentWindow;
          }
        } else if (st.type === 'ExprStmt' && st.expr && st.expr.type === 'AddWidget') {
          const ti = st.expr.title && st.expr.title.type === 'StrLit' ? ` titled ${JSON.stringify(st.expr.title.value)}` : '';
          const to = st.expr.to ? ` -> ${fmtTarget(st.expr.to)}` : '';
          lines.push(`${'  '.repeat(depth)}(anon): ${st.expr.kind}${ti}${to}`);
        } else if (st.type === 'VarAssign' && st.value && st.value.type === 'CreateContainer') {
          const nm = st.target.type === 'VarRef' ? st.target.name : '?';
          const lay = st.value.layout && st.value.layout !== 'plain' ? st.value.layout + ' ' : '';
          lines.push(`${'  '.repeat(depth)}${nm}: ${lay}container`);
          const g = widget(nm);
          g.kind = (st.value.layout && st.value.layout !== 'plain' ? st.value.layout + ' ' : '') + 'container';
          g.parent = currentWindow;
          // Vexel 2.2 phase 5: static defaults mirror the runtime factories.
          const clay = st.value.layout || 'plain';
          if (clay === 'horizontal') { g.w = 360; g.h = 34; }
          else if (clay === 'vertical') { g.w = 300; g.h = 250; }
          else { g.w = 300; g.h = 200; }
        } else if (st.type === 'TimerStmt' && st.handle) {
          const secs = numVal(st.value);
          timers.push(`${'  '.repeat(depth)}${st.handle}: timer (${st.once ? 'after' : 'every'} ${secs === null ? '?' : secs}s)`);
        } else if (st.type === 'TimerStmt') {
          timers.push(`${'  '.repeat(depth)}(anon timer: ${st.once ? 'after' : 'every'})`);
        } else if (st.type === 'VarAssign' && st.value && st.value.type === 'TimerStmt' && st.value.handle) {
          // Vexel 2.2: `ticker = every 1 second { ... }` parses as an
          // assignment holding a timer (parser attaches the handle name).
          const secs = numVal(st.value.value);
          timers.push(`${'  '.repeat(depth)}${st.value.handle}: timer (${st.value.once ? 'after' : 'every'} ${secs === null ? '?' : secs}s)`);
        } else if (st.type === 'TaskStmt') {
          // Vexel 2.2 phase 7: `task name { ... }` declares a task handle.
          timers.push(`${'  '.repeat(depth)}${st.name}: task (background)`);
        } else if (st.type === 'VarAssign' && st.target && st.target.type === 'FieldAccess' && st.target.object && st.target.object.type === 'VarRef') {
          // Vexel 2.2: `a.x = 20` / `window.width = 400` feed geometry.
          const nm = st.target.object.name;
          const nv = numVal(st.value);
          if (nv !== null && ['x', 'y', 'width', 'height'].includes(st.target.field)) setGeom(nm, st.target.field, nv);
          const sv = strVal(st.value);
          if (sv !== null && st.target.field === 'id') widget(nm).id = sv;
        } else if (st.type === 'UISetProp' && st.target) {
          lines.push(`${'  '.repeat(depth)}${fmtTarget(st.target)}.${st.prop} = …`);
          // Vexel 2.2: `set window width to 900` feeds geometry too.
          if (st.target.type === 'VarRef') {
            const nv = numVal(st.value);
            if (nv !== null && ['x', 'y', 'width', 'height'].includes(st.prop)) setGeom(st.target.name, st.prop, nv);
            const sv = strVal(st.value);
            if (sv !== null && st.prop === 'id') widget(st.target.name).id = sv;
          }
        } else if (st.type === 'UISetPosition' && st.target && st.target.type === 'VarRef') {
          const nx = numVal(st.x);
          const ny = numVal(st.y);
          if (nx !== null) setGeom(st.target.name, 'x', nx);
          if (ny !== null) setGeom(st.target.name, 'y', ny);
        } else if (st.type === 'AddToContainer') {
          lines.push(`${'  '.repeat(depth)}add ${fmtTarget(st.value)} to ${fmtTarget(st.target)}`);
          if (st.value && st.value.type === 'VarRef' && st.target && st.target.type === 'VarRef') {
            widget(st.value.name).parent = st.target.name;
          }
        } else if (st.type === 'IfStmt') {
          (st.branches || []).forEach((b) => scan(b.body, depth));
          scan(st.elseBody, depth);
        } else if (st.type === 'TryStmt') {
          scan(st.tryBody, depth);
          scan(st.catchBody, depth);
        } else if (st.type === 'RepeatCount' || st.type === 'RepeatTill') {
          scan(st.body, depth);
        } else if (st.type === 'FuncDecl' || st.type === 'ComponentDecl') {
          scan(st.body, depth + 1);
        }
      }
    };
    scan(mod.ast.body, 0);
  }
  // Vexel 2.2: static geometry + validation warnings (additive).
  const q = (v) => (v === null || v === undefined ? '?' : String(v));
  const geoLines = [];
  geoLines.push(`window: ${q(win.w)}x${q(win.h)}`);
  for (const name of Object.keys(geom)) {
    if (name === 'window') continue;
    const g = geom[name];
    geoLines.push(`${name}: ${g.kind} x=${q(g.x)} y=${q(g.y)} w=${q(g.w)} h=${q(g.h)} (in ${g.parent})`);
  }
  for (const t of timers) geoLines.push(t);
  const warnings = [];
  const seenIds = {};
  for (const name of Object.keys(geom)) {
    if (name === 'window') continue;
    const g = geom[name];
    for (const [prop, v] of [['x', g.x], ['y', g.y], ['width', g.w], ['height', g.h]]) {
      if (v !== null && v < 0) warnings.push(`WARN ${name}: ${prop} is negative (${v}).`);
    }
    const p = geom[g.parent];
    if (p && g.x !== null && g.w !== null && p.w !== null && g.x + g.w > p.w) {
      warnings.push(`WARN ${name}: right edge (x+w=${g.x + g.w}) exceeds ${g.parent} width ${p.w}.`);
    }
    if (p && g.y !== null && g.h !== null && p.h !== null && g.y + g.h > p.h) {
      warnings.push(`WARN ${name}: bottom edge (y+h=${g.y + g.h}) exceeds ${g.parent} height ${p.h}.`);
    }
    if (g.id) {
      if (seenIds[g.id]) warnings.push(`WARN ${name}: duplicate id "${g.id}" (also on ${seenIds[g.id]}).`);
      else seenIds[g.id] = name;
    }
  }
  // Vexel 2.9: zero-area controls and same-parent overlaps.
  for (const name of Object.keys(geom)) {
    if (name === 'window') continue;
    const g = geom[name];
    if ((g.w === 0 || g.h === 0) && g.w !== null && g.h !== null) {
      warnings.push(`WARN ${name}: zero ${g.w === 0 ? 'width' : 'height'} — the control will be invisible.`);
    }
  }
  const rects = Object.keys(geom).filter((n) => {
    if (n === 'window') return false;
    const g = geom[n];
    return g.x !== null && g.y !== null && g.w !== null && g.h !== null && g.w > 0 && g.h > 0;
  });
  let overlapCount = 0;
  for (let i = 0; i < rects.length && overlapCount < 8; i++) {
    for (let j = i + 1; j < rects.length && overlapCount < 8; j++) {
      const a = geom[rects[i]];
      const b = geom[rects[j]];
      if (a.parent !== b.parent) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlap) {
        warnings.push(`WARN ${rects[i]} overlaps ${rects[j]} (both in ${a.parent}).`);
        overlapCount++;
      }
    }
  }
  if (lines.length === 0 && geoLines.length === 0) return '  (no UI statements found)';
  const out = lines.map((l) => '  ' + l);
  out.push('  Geometry (static — conditional code may differ at runtime):');
  for (const g of geoLines) out.push('    ' + g);
  // Vexel 2.9: DPI matrix — device pixels per scale plus fractional
  // (blur-risk) warnings. Scaling is uniform, so this validates absolute
  // rendering geometry without screenshots.
  if (dpiOpt) {
    const scales = dpiOpt === 'all' ? [100, 125, 150, 175, 200] : [dpiOpt];
    const full = (g) => g.x !== null && g.y !== null && g.w !== null && g.h !== null;
    for (const pct of scales) {
      const s = pct / 100;
      out.push(`  DPI ${pct}% (scale ${s}):`);
      const names = ['window', ...Object.keys(geom).filter((n) => n !== 'window')];
      for (const name of names) {
        const g = geom[name];
        if (!g || !full(g)) continue;
        const dx = g.x * s, dy = g.y * s, dw = g.w * s, dh = g.h * s;
        const frac = [dx, dy, dw, dh].some((v) => Math.abs(v - Math.round(v)) > 1e-9);
        out.push(`    ${name}: ${dx.toFixed(1)} ${dy.toFixed(1)} ${dw.toFixed(1)} ${dh.toFixed(1)}${frac ? ' (fractional — blur risk)' : ''}`);
      }
    }
  }
  if (warnings.length > 0) {
    out.push('  Warnings:');
    for (const w of warnings) out.push('    ' + w);
  } else {
    out.push('  Warnings: none.');
  }
  return out.join('\n');
}

module.exports = { compileToRust, compileToAX, programUsesUI, cmdBuild, cmdRun, cmdCheck, VERSION };

if (require.main === module) {
  main(process.argv);
}
