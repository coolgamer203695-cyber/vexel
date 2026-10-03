'use strict';

// Vexel module resolution — import graph, circular detection, topo order.

const fs = require('fs');
const path = require('path');
const { lex } = require('../lexer/lexer.js');
const { parse } = require('../parser/parser.js');

function moduleNameFromFile(absPath) {
  return path.basename(absPath, path.extname(absPath));
}

function resolveImport(fromDir, importPath) {
  // importPath like entities/player -> <fromDir>/entities/player.vxl
  const rel = importPath + '.vxl';
  const primary = path.resolve(fromDir, rel);
  if (fs.existsSync(primary)) return primary;
  // Atlas v0.5: the shipped `import atlas` resolves from anywhere by
  // falling back to the package-root atlas.vxl (examples/, tests/, ...).
  // Any other missing import keeps its original error path.
  if (importPath === 'atlas') {
    const rootAtlas = path.resolve(__dirname, '..', '..', 'atlas.vxl');
    if (fs.existsSync(rootAtlas)) return rootAtlas;
  }
  return primary;
}

function loadModules(entryFile) {
  const entryAbs = path.resolve(entryFile);
  if (!fs.existsSync(entryAbs)) {
    const { VexelError } = require('../diagnostics/diagnostics.js');
    throw new VexelError({
      type: 'ModuleError',
      message: `Entry file not found: ${entryFile}`,
      file: entryFile,
      line: 1,
      column: 1,
      sourceLine: '',
    });
  }

  const modules = new Map(); // absPath -> { file, absPath, dir, name, source, lines, tokens, ast }
  const visiting = []; // stack for cycle detection
  const visited = new Set();

  function visit(absPath, importChain) {
    const norm = path.normalize(absPath);
    // Cycle detection
    const idx = visiting.indexOf(norm);
    if (idx !== -1) {
      const cycle = visiting.slice(idx).concat([norm]);
      const chain = cycle.map((p) => path.basename(p)).join(' -> ');
      // Find importing token for position
      const importer = modules.get(visiting[visiting.length - 1]);
      const { VexelError } = require('../diagnostics/diagnostics.js');
      // Try to find the import decl token
      let tok = null;
      let srcLines = [];
      let fileLabel = norm;
      if (importer) {
        srcLines = importer.lines;
        fileLabel = importer.file;
        // Locate import decl that targets norm
        for (const st of importer.ast.body) {
          if (st.type === 'ImportDecl') {
            const target = resolveImport(importer.dir, st.path);
            if (path.normalize(target) === norm) {
              tok = st.token;
              break;
            }
          }
        }
      }
      throw new VexelError({
        type: 'ModuleError',
        message: `Circular import detected: ${chain}. Modules must not import each other in a cycle.`,
        file: fileLabel,
        line: tok ? tok.line : 1,
        column: tok ? tok.column : 1,
        sourceLine: tok && srcLines[tok.line - 1] ? srcLines[tok.line - 1] : '',
        endColumn: tok ? tok.endColumn : null,
      });
    }
    if (visited.has(norm)) return;
    if (!fs.existsSync(norm)) {
      // Missing module file — report at importer
      const importer = visiting.length > 0 ? modules.get(visiting[visiting.length - 1]) : null;
      const { VexelError } = require('../diagnostics/diagnostics.js');
      let tok = null;
      let srcLines = [];
      let fileLabel = importer ? importer.file : entryFile;
      if (importer) {
        srcLines = importer.lines;
        for (const st of importer.ast.body) {
          if (st.type === 'ImportDecl') {
            const target = resolveImport(importer.dir, st.path);
            if (path.normalize(target) === norm) {
              tok = st.token;
              break;
            }
          }
        }
      }
      // Compute display path relative to importer dir or cwd
      let display = norm;
      try {
        display = importer ? path.relative(importer.dir, norm) : path.relative(process.cwd(), norm);
      } catch (e) { /* ignore */ }
      throw new VexelError({
        type: 'ModuleError',
        message: `Cannot find module file: ${display} (imported as '${importChain || ''}').`,
        file: fileLabel,
        line: tok ? tok.line : 1,
        column: tok ? tok.column : 1,
        sourceLine: tok && srcLines[tok.line - 1] ? srcLines[tok.line - 1] : '',
        endColumn: tok ? tok.endColumn : null,
      });
    }

    visiting.push(norm);
    const source = fs.readFileSync(norm, 'utf8');
    const fileLabel = norm;
    const { tokens, lines } = lex(source, fileLabel);
    const ast = parse(tokens, lines, fileLabel);
    const dir = path.dirname(norm);
    const name = moduleNameFromFile(norm);
    modules.set(norm, {
      file: fileLabel,
      absPath: norm,
      dir,
      name,
      source,
      lines,
      tokens,
      ast,
    });

    // Recurse into imports
    for (const st of ast.body) {
      let importPath = null;
      if (st.type === 'ImportDecl') importPath = st.path;
      // PublicDecl wrapping import? Not allowed — public import? Spec doesn't say. Ignore.
      if (importPath) {
        const target = resolveImport(dir, importPath);
        visit(target, importPath);
      }
    }

    visiting.pop();
    visited.add(norm);
  }

  visit(entryAbs, '');

  // Topological order: dependencies first.
  // Our DFS post-order: visited insertion order already has deps before importers?
  // Since we add to `visited` after recursing, iteration order of `modules` is pre-order (parent before child).
  // Build post-order explicitly via DFS.
  const order = [];
  const tempMark = new Set();
  const permMark = new Set();
  function dfs(absPath) {
    const norm = path.normalize(absPath);
    if (permMark.has(norm)) return;
    if (tempMark.has(norm)) return; // cycle already reported
    tempMark.add(norm);
    const mod = modules.get(norm);
    if (mod) {
      for (const st of mod.ast.body) {
        if (st.type === 'ImportDecl') {
          const target = path.normalize(resolveImport(mod.dir, st.path));
          dfs(target);
        }
      }
    }
    tempMark.delete(norm);
    permMark.add(norm);
    order.push(norm);
  }
  dfs(entryAbs);

  return { modules, order, entryAbs };
}

module.exports = { loadModules, resolveImport, moduleNameFromFile };
