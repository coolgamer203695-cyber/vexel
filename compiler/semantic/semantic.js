'use strict';

// Vexel semantic analysis + type checking.
// Enforces: undefined vars/functions, duplicates, field validation,
// arity, type mismatches, visibility, module rules, return placement.

const path = require('path');
const { VexelError } = require('../diagnostics/diagnostics.js');
const Types = require('../types/types.js');
const { resolveImport } = require('../modules/modules.js');

function err(type, message, token, mod) {
  const line = token ? token.line : 1;
  return new VexelError({
    type,
    message,
    file: mod ? mod.file : '<unknown>',
    line,
    column: token ? token.column : 1,
    sourceLine: mod && mod.lines && mod.lines[line - 1] ? mod.lines[line - 1] : '',
    endColumn: token ? token.endColumn : null,
  });
}

function analyze(loadResult) {
  const { modules, order } = loadResult;
  const scopes = new Map(); // absPath -> scope

  // First: create scope shells with imports/structs/functions collected
  for (const absPath of order) {
    const mod = modules.get(absPath);
    const scope = {
      file: mod.file,
      absPath,
      dir: mod.dir,
      name: mod.name,
      structs: new Map(),
      functions: new Map(),
      enums: new Map(),
      tests: new Set(),
      variables: new Map(), // top-level vars in order
      imports: [], // { path, moduleName, absPath, token }
      components: new Map(), // Vexel 1.1.0 reusable UI blocks
      themes: new Map(), // Vexel 1.1.0 custom themes
      styles: new Map(), // Vexel 2.0 reusable style objects
      hasWindow: false, // set when a top-level CreateWindow exists
      outputMode: 'unset', // 'unset' | 'buffer' | 'ui' (special `output` name)
      windowCount: 0,
      mod,
    };
    scopes.set(absPath, scope);

    // Imports
    for (const st of mod.ast.body) {
      if (st.type === 'ImportDecl') {
        // One resolution path for loadModules and semantic (Atlas v0.5:
        // the `import atlas` root fallback must agree in both places).
        const target = path.normalize(resolveImport(mod.dir, st.path));
        scope.imports.push({ path: st.path, moduleName: st.moduleName, absPath: target, token: st.token, node: st });
        // Check module name collisions: same name from DIFFERENT files is ambiguous.
        // Importing the exact same file twice is allowed (executes once).
        const same = scope.imports.filter((im) => im.moduleName === st.moduleName && im.absPath !== target);
        // Also include current if another different-path import exists
        const allSameName = scope.imports.filter((im) => im.moduleName === st.moduleName);
        const distinctPaths = new Set(allSameName.map((im) => im.absPath));
        if (distinctPaths.size > 1) {
          throw err('ModuleError', `Duplicate module name '${st.moduleName}' imported from different paths. Use distinct filenames to avoid collision.`, st.token, mod);
        }
      }
    }

    // Structs (including public)
    for (const st of mod.ast.body) {
      if (st.type === 'StructDecl') {
        defineStruct(scope, st.name, st.fields, false, st.token, mod);
      } else if (st.type === 'PublicDecl' && st.decl && st.decl.type === 'StructDecl') {
        defineStruct(scope, st.decl.name, st.decl.fields, true, st.token, mod);
      }
    }

    // Vexel 2.9: enums (including public)
    for (const st of mod.ast.body) {
      if (st.type === 'EnumDecl') {
        defineEnum(scope, st.name, st.values, !!st.isPublic, st.token, mod);
      } else if (st.type === 'PublicDecl' && st.decl && st.decl.type === 'EnumDecl') {
        defineEnum(scope, st.decl.name, st.decl.values, true, st.token, mod);
      }
    }

    // Vexel 2.9: test names must be unique per module.
    for (const st of mod.ast.body) {
      if (st.type === 'TestBlock') {
        if (scope.tests.has(st.name)) {
          throw err('NameError', `Duplicate test '${st.name}'. Give each test a unique name.`, st.nameToken || st.token, mod);
        }
        scope.tests.add(st.name);
      }
    }

    // Functions (including public)
    for (const st of mod.ast.body) {
      if (st.type === 'FuncDecl') {
        defineFunction(scope, st, false, mod);
      } else if (st.type === 'PublicDecl' && st.decl && st.decl.type === 'FuncDecl') {
        defineFunction(scope, st.decl, true, mod);
      }
    }

    // Vexel 1.1.0: components, themes, window presence (top level only)
    for (const st of mod.ast.body) {
      if (st.type === 'ComponentDecl') {
        if (scope.components.has(st.name) || scope.functions.has(st.name) || scope.structs.has(st.name)) {
          throw err('NameError', `Duplicate declaration '${st.name}'.`, st.token, mod);
        }
        scope.components.set(st.name, { name: st.name, body: st.body, token: st.token });
      } else if (st.type === 'StyleDecl') {
        if (scope.styles.has(st.name) || scope.themes.has(st.name) || scope.functions.has(st.name) || scope.structs.has(st.name) || scope.components.has(st.name)) {
          throw err('NameError', `Duplicate declaration '${st.name}'.`, st.token, mod);
        }
        for (const f of st.fields) {
          if (!UI_STYLE_PROPS[f.name]) {
            throw err('UIError', `Unknown style '${f.name}'. Valid: ${Object.keys(UI_STYLE_PROPS).join(', ')}.`, f.token, mod);
          }
        }
        scope.styles.set(st.name, { name: st.name, fields: st.fields, token: st.token });
      } else if (st.type === 'ThemeDecl') {
        if (scope.themes.has(st.name)) {
          throw err('NameError', `Duplicate theme '${st.name}'.`, st.token, mod);
        }
        for (const f of st.fields) {
          if (!UI_THEME_PROPS[f.name]) {
            throw err('UIError', `Unknown theme style '${f.name}'. Valid: ${Object.keys(UI_THEME_PROPS).join(', ')}.`, f.token, mod);
          }
        }
        scope.themes.set(st.name, { name: st.name, fields: st.fields, token: st.token });
      } else if (st.type === 'CreateWindow') {
        scope.hasWindow = true;
      } else if (st.type === 'VarAssign' && st.value && st.value.type === 'CreateWindow') {
        // Vexel 2.2: a named window (`main = create a window ...`) also
        // establishes the module's window. Function bodies are checked in
        // pass 2, before pass 3 reaches this assignment, so set it here.
        scope.hasWindow = true;
      }
    }
    // Theme field value types are checked with the rest of the program.
    // (Unknown names are skipped here — they may be defined later in the
    // module; genuine type mismatches still error.)
    for (const [, th] of scope.themes) {
      for (const f of th.fields) {
        const decl = UI_THEME_PROPS[f.name];
        let vt = null;
        try {
          vt = inferThemeFieldType(f, scope, mod, scopes, modules);
        } catch (e) {
          if (!(e && e.vexType === 'NameError')) throw e;
          continue;
        }
        if (!uiPropTypeMatches(decl, vt)) {
          throw err('UIError', `Theme style '${f.name}' needs ${decl === 'int' ? 'an integer' : decl === 'bool' ? 'a boolean' : 'a string'}.`, f.token, mod);
        }
        if (f.value && f.value.type === 'StrLit' && (f.name === 'background' || f.name === 'text_color')) {
          checkUIColorLiteral(f.value.value, f.value.token, mod);
        }
      }
    }
  }

  function inferThemeFieldType(f, scope, mod, scopes, modules) {
    const ctx = { scope, mod, scopes, modules, locals: null, inFunction: false, inCatch: false, currentFunction: null };
    return inferExpr(f.value, ctx);
  }

  function defineStruct(scope, name, fields, isPublic, token, mod) {
    if (scope.structs.has(name)) {
      throw err('NameError', `Duplicate struct '${name}'.`, token, mod);
    }
    if (scope.functions.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as function).`, token, mod);
    }
    if (scope.enums.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as enum).`, token, mod);
    }
    scope.structs.set(name, { name, fields: fields.map((f) => f.name), fieldTokens: fields, isPublic, token });
  }

  // Vexel 2.9: enums live beside structs/functions in the declaration space.
  function defineEnum(scope, name, values, isPublic, token, mod) {
    if (scope.enums.has(name)) {
      throw err('NameError', `Duplicate enum '${name}'.`, token, mod);
    }
    if (scope.functions.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as function).`, token, mod);
    }
    if (scope.structs.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as struct).`, token, mod);
    }
    scope.enums.set(name, { name, values: values.map((v) => v.name), valueTokens: values, isPublic, token });
  }

  function defineFunction(scope, decl, isPublic, mod) {
    const name = decl.name;
    if (scope.functions.has(name)) {
      throw err('NameError', `Duplicate function '${name}'.`, decl.token, mod);
    }
    if (scope.structs.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as struct).`, decl.token, mod);
    }
    if (scope.enums.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as enum).`, decl.token, mod);
    }
    scope.functions.set(name, {
      name,
      params: decl.params.map((p) => p.name),
      paramTokens: decl.params,
      body: decl.body,
      isPublic,
      token: decl.token,
      node: decl,
    });
  }

  // Second: analyze function bodies (to catch errors inside, locals don't leak)
  for (const absPath of order) {
    const scope = scopes.get(absPath);
    const mod = modules.get(absPath);
    for (const [, fn] of scope.functions) {
      checkFunctionBody(scope, fn, mod, scopes, modules);
    }
  }

  // Third: analyze top-level statements sequentially
  for (const absPath of order) {
    const scope = scopes.get(absPath);
    const mod = modules.get(absPath);
    checkTopLevel(scope, mod, scopes, modules);
  }

  // Fourth (Vexel 1.1.0): check component bodies with fresh locals.
  // Runs after top-level so globals are all known.
  for (const absPath of order) {
    const scope = scopes.get(absPath);
    const mod = modules.get(absPath);
    for (const [, comp] of scope.components) {
      const ctx = {
        scope, mod, scopes, modules,
        locals: new Map(), inFunction: false, inCatch: false,
        inHandler: false, inComponent: true, inKeyHandler: false,
        inEvent: null,
        currentFunction: null, outerLocals: null,
      };
      for (const st of comp.body) {
        if (st.type === 'FuncDecl' || st.type === 'StructDecl' || st.type === 'EnumDecl' || st.type === 'TestBlock' || st.type === 'ImportDecl' || st.type === 'ComponentDecl' || st.type === 'ThemeDecl' || st.type === 'StyleDecl' || st.type === 'CreateWindow' || st.type === 'PublicDecl') {
          throw err('SyntaxError', `Declaration '${st.type}' is not allowed inside a component.`, st.token, mod);
        }
        checkStatement(st, ctx);
      }
    }
  }

  // Fifth (Vexel 2.9): check test bodies with full module globals known.
  // Tests may use any global regardless of source position; each body
  // runs with inTest set (no return inside tests).
  const collectTests = (stmts, into) => {
    for (const st of stmts || []) {
      if (!st || typeof st !== 'object') continue;
      if (st.type === 'TestBlock') { into.push(st); continue; }
      if (st.type === 'IfStmt') {
        for (const br of st.branches || []) collectTests(br.body, into);
        collectTests(st.elseBody, into);
      } else if (st.type === 'TryStmt') {
        collectTests(st.tryBody, into);
        collectTests(st.catchBody, into);
      } else if (st.type === 'RepeatCount' || st.type === 'RepeatTill') {
        collectTests(st.body, into);
      } else if (st.type === 'MatchStmt') {
        for (const arm of st.arms || []) collectTests(arm.body, into);
      }
    }
  };
  for (const absPath of order) {
    const scope = scopes.get(absPath);
    const mod = modules.get(absPath);
    const found = [];
    collectTests(mod.ast.body, found);
    for (const tb of found) {
      const ctx = {
        scope, mod, scopes, modules,
        locals: null, inFunction: false, inTest: true, inCatch: false,
        inHandler: false, inComponent: false, inKeyHandler: false,
        inEvent: null, currentFunction: null,
      };
      for (const s of tb.body) checkStatement(s, ctx);
    }
  }

  return { scopes };
}

function isModuleName(scope, name) {
  return scope.imports.some((im) => im.moduleName === name);
}

// Atlas v0.5: the model syntax (load/create/save/info/inference) needs
// `import atlas` — the module that ships default_config and helpers.
function requireAtlasImport(scope, token, mod, what) {
  if (!isModuleName(scope, 'atlas')) {
    throw err('NameError', `${what} needs the Atlas model library. Add: import atlas`, token, mod);
  }
}

function getImportedScope(scope, moduleName, scopes) {
  const imp = scope.imports.find((im) => im.moduleName === moduleName);
  if (!imp) return null;
  return scopes.get(imp.absPath) || null;
}

function checkTopLevel(scope, mod, scopes, modules) {
  const ctx = {
    scope,
    mod,
    scopes,
    modules,
    locals: null, // top-level: no locals
    inFunction: false,
    inCatch: false,
    inHandler: false,
    inComponent: false,
    inKeyHandler: false,
    inEvent: null,
    currentFunction: null,
  };
  for (const st of mod.ast.body) {
    checkStatement(st, ctx);
  }
}

function checkFunctionBody(scope, fn, mod, scopes, modules) {
  const locals = new Map(); // name -> { type, token }
  for (const p of fn.params) {
    locals.set(p, { type: Types.TAny(), token: fn.token });
  }
  // Also track param tokens for duplicate already checked
  const ctx = {
    scope,
    mod,
    scopes,
    modules,
    locals,
    inFunction: true,
    inCatch: false,
    inHandler: false,
    inComponent: false,
    inKeyHandler: false,
    inEvent: null,
    currentFunction: fn,
  };
  // Disallow nested func/struct/enum/import inside function
  for (const st of fn.body) {
    if (st.type === 'FuncDecl' || st.type === 'StructDecl' || st.type === 'EnumDecl' || st.type === 'TestBlock' || st.type === 'ImportDecl' || st.type === 'ComponentDecl' || st.type === 'ThemeDecl' || st.type === 'StyleDecl' || st.type === 'CreateWindow') {
      throw err('SyntaxError', `Declaration '${st.type}' is not allowed inside a function.`, st.token, mod);
    }
    if (st.type === 'PublicDecl') {
      throw err('SyntaxError', `Public declaration is not allowed inside a function.`, st.token, mod);
    }
    checkStatement(st, ctx);
  }
}

function checkStatement(st, ctx) {
  const { scope, mod } = ctx;
  switch (st.type) {
    case 'ImportDecl':
      // Already resolved; check file exists via scopes (loadModules guarantees)
      return;
    case 'PublicDecl': {
      const inner = st.decl;
      if (!inner) throw err('SyntaxError', 'Invalid public declaration.', st.token, mod);
      if (inner.type === 'FuncDecl' || inner.type === 'StructDecl' || inner.type === 'EnumDecl') {
        // Already collected; check body for functions
        // Function bodies already checked globally; nothing more here.
        return;
      }
      if (inner.type === 'VarAssign') {
        // public var: process as assignment with public flag
        checkVarAssign(inner, ctx, true);
        return;
      }
      throw err('SyntaxError', 'Public can only expose variables, functions, or structs.', st.token, mod);
    }
    case 'StructDecl':
    case 'FuncDecl':
    case 'EnumDecl':
      return; // already handled
    case 'VarAssign':
      checkVarAssign(st, ctx, !!st.isPublic);
      return;
    case 'PrintStmt':
      if (st.isFile) return; // runtime file read, no compile check
      inferExpr(st.arg, ctx);
      return;
    case 'IfStmt': {
      for (const br of st.branches) {
        const t = inferExpr(br.cond, ctx);
        if (!Types.isAny(t) && t.kind !== 'boolean') {
          throw err('TypeError', `If condition must be a boolean, got ${Types.typeName(t)}.`, br.cond.token || st.token, mod);
        }
        for (const s of br.body) checkStatement(s, ctx);
      }
      if (st.elseBody) {
        for (const s of st.elseBody) checkStatement(s, ctx);
      }
      return;
    }
    case 'RepeatCount': {
      const t = inferExpr(st.count, ctx);
      if (!Types.isAny(t) && t.kind !== 'integer') {
        throw err('TypeError', `Repeat count must be an integer, got ${Types.typeName(t)}.`, st.count.token || st.token, mod);
      }
      for (const s of st.body) checkStatement(s, ctx);
      return;
    }
    case 'MatchStmt': {
      checkMatch(st, ctx);
      return;
    }
    case 'WaitTaskStmt': {
      // Vexel 2.9: `wait <task handle>` blocks until the task finishes.
      // Console programs wait on the worker; UI programs must poll
      // handle.state from a timer instead (enforced by the backend).
      if (!st.handle || st.handle.type !== 'VarRef' || !scope.taskHandles || !scope.taskHandles.has(st.handle.name)) {
        throw err('TypeError', `wait needs a number of seconds or a task handle (e.g. wait 2 seconds, wait fetch).`, st.handle ? st.handle.token || st.token : st.token, mod);
      }
      return;
    }
    case 'HttpTimeoutStmt': {
      // Vexel 2.9: default request timeout in seconds (30 when untouched).
      const t = inferExpr(st.secs, ctx);
      if (!Types.isAny(t) && t.kind !== 'integer' && t.kind !== 'decimal') {
        throw err('TypeError', `http timeout needs seconds, got ${Types.typeName(t)}.`, st.secs.token || st.token, mod);
      }
      return;
    }
    case 'TerminalStmt': {
      // Vexel 2.9: a persistent shell session; only cd/run inside.
      // (The parser already restricts the body shape.)
      const sub = Object.assign({}, ctx, { inTerminal: true });
      for (const s of st.body) checkStatement(s, sub);
      return;
    }
    case 'CdStmt': {
      if (!ctx.inTerminal) {
        throw err('SyntaxError', `cd only changes a terminal session. Use it inside terminal { ... } (e.g. terminal { cd "docs" }).`, st.token, mod);
      }
      const t = inferExpr(st.dir, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `cd needs a directory path string, got ${Types.typeName(t)}.`, st.dir.token || st.token, mod);
      }
      return;
    }
    case 'RunStmt': {
      const t = inferExpr(st.cmd, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `run needs a command string, got ${Types.typeName(t)}.`, st.cmd.token || st.token, mod);
      }
      return;
    }
    case 'FileWriteStmt':
    case 'FileAppendStmt': {
      const vt = inferExpr(st.value, ctx);
      if (!Types.isAny(vt) && vt.kind !== 'string') {
        throw err('TypeError', `file ${st.type === 'FileWriteStmt' ? 'write' : 'append'} needs text, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
      }
      const pt = inferExpr(st.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `File path must be a string, got ${Types.typeName(pt)}.`, st.path.token || st.token, mod);
      }
      return;
    }
    case 'FileDeleteStmt':
    case 'DirDeleteStmt':
    case 'DirCreateStmt': {
      const pt = inferExpr(st.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `Path must be a string, got ${Types.typeName(pt)}.`, st.path.token || st.token, mod);
      }
      return;
    }
    case 'FileCopyStmt':
    case 'FileMoveStmt':
    case 'DirCopyStmt':
    case 'DirMoveStmt': {
      for (const side of [st.from, st.to]) {
        const pt = inferExpr(side, ctx);
        if (!Types.isAny(pt) && pt.kind !== 'string') {
          throw err('TypeError', `Path must be a string, got ${Types.typeName(pt)}.`, side.token || st.token, mod);
        }
      }
      return;
    }
    case 'RepeatTill': {
      const t = inferExpr(st.cond, ctx);
      if (!Types.isAny(t) && t.kind !== 'boolean') {
        throw err('TypeError', `Repeat till condition must be a boolean, got ${Types.typeName(t)}.`, st.cond.token || st.token, mod);
      }
      for (const s of st.body) checkStatement(s, ctx);
      return;
    }
    case 'TestBlock':
      // Bodies are checked after top-level analysis so tests can use
      // any module global regardless of position. Rejected inside
      // functions, handlers, tasks and components by those paths.
      return;
    case 'AssertStmt': {
      // Vexel 2.9: runtime boolean check for tests and preconditions.
      const t = inferExpr(st.cond, ctx);
      if (!Types.isAny(t) && t.kind !== 'boolean') {
        throw err('TypeError', `Assert needs a boolean condition, got ${Types.typeName(t)}.`, st.cond.token || st.token, mod);
      }
      return;
    }
    case 'ReturnStmt': {
      if (ctx.inTest) {
        throw err('SyntaxError', 'Cannot return from a test. End the test with assert checks instead.', st.token, mod);
      }
      if (ctx.inHandler) {
        throw err('SyntaxError', 'Cannot return from an event handler.', st.token, mod);
      }
      if (ctx.inComponent) {
        throw err('SyntaxError', 'Cannot return from a component.', st.token, mod);
      }
      if (!ctx.inFunction) {
        throw err('SyntaxError', 'Return statement outside function.', st.token, mod);
      }
      if (st.value) {
        const t = inferExpr(st.value, ctx);
        if (ctx.currentFunction) {
          ctx.currentFunction.returnTypes = ctx.currentFunction.returnTypes || [];
          ctx.currentFunction.returnTypes.push(t);
        }
      } else {
        if (ctx.currentFunction) {
          ctx.currentFunction.returnTypes = ctx.currentFunction.returnTypes || [];
          ctx.currentFunction.returnTypes.push(Types.TVoid());
        }
      }
      return;
    }
    case 'RaiseStmt': {
      inferExpr(st.value, ctx);
      return;
    }
    case 'InputStmt': {
      inferExpr(st.prompt, ctx);
      return;
    }
    case 'SetOutputStmt': {
      // Vexel 1.1.0: `output` may hold a UI box — then set output is meaningless.
      if (scope.outputMode === 'ui') {
        throw err('UIError', `'output' holds a UI output box in this module. Store input text in another variable.`, st.token, mod);
      }
      if (scope.outputMode === 'unset') scope.outputMode = 'buffer';
      // dest becomes string (input is string)
      const destType = Types.TStr();
      if (ctx.locals) {
        // inside function: dest is local
        if (!ctx.locals.has(st.dest)) {
          ctx.locals.set(st.dest, { type: destType, token: st.destToken });
        } else {
          const existing = ctx.locals.get(st.dest).type;
          if (!Types.sameType(existing, destType) && !Types.isAny(existing)) {
            throw err('TypeError', `Type mismatch: variable '${st.dest}' is ${Types.typeName(existing)} but input is string.`, st.destToken, mod);
          }
        }
      } else {
        if (!scope.variables.has(st.dest)) {
          // Check collisions
          if (scope.functions.has(st.dest)) {
            throw err('NameError', `Duplicate declaration '${st.dest}' (already defined as function).`, st.destToken, mod);
          }
          if (scope.structs.has(st.dest)) {
            throw err('NameError', `Duplicate declaration '${st.dest}' (already defined as struct).`, st.destToken, mod);
          }
          if (isModuleName(scope, st.dest)) {
            throw err('NameError', `Name '${st.dest}' collides with imported module.`, st.destToken, mod);
          }
          scope.variables.set(st.dest, { type: destType, isPublic: false, token: st.destToken });
        } else {
          const existing = scope.variables.get(st.dest).type;
          if (!Types.sameType(existing, destType) && !Types.isAny(existing)) {
            throw err('TypeError', `Type mismatch: variable '${st.dest}' is ${Types.typeName(existing)} but input is string.`, st.destToken, mod);
          }
        }
      }
      st._destIsLocal = !!ctx.locals;
      return;
    }
    case 'MakeStmt': {
      // Vexel 2.0: upper | lower | number | string | boolean.
      // Vexel 2.9: converting a definitely-null variable is a static error.
      if (nullOriginToken(st.target, ctx)) {
        nullUseError(st.target, st.targetToken || st.token, mod, ctx);
      }
      const setTypeOf = (ty) => {
        if (ctx.locals && ctx.locals.has(st.target)) {
          ctx.locals.get(st.target).type = ty;
        } else if (ctx.outerLocals && ctx.outerLocals.has(st.target)) {
          ctx.outerLocals.get(st.target).type = ty;
        } else if (!ctx.locals && scope.variables.has(st.target)) {
          scope.variables.get(st.target).type = ty;
        }
      };
      if (st.mode === 'upper' || st.mode === 'lower') {
        const t = lookupVar(st.target, ctx, st.targetToken);
        if (!Types.isAny(t) && t.kind !== 'string') {
          throw err('TypeError', `Make ${st.mode} requires a string variable, '${st.target}' is ${Types.typeName(t)}.`, st.targetToken, mod);
        }
        return;
      }
      if (st.mode === 'number') {
        const t = lookupVar(st.target, ctx, st.targetToken);
        if (!Types.isAny(t) && t.kind !== 'string' && t.kind !== 'integer' && t.kind !== 'decimal') {
          throw err('TypeError', `Make number needs text or a number, '${st.target}' is ${Types.typeName(t)}.`, st.targetToken, mod);
        }
        setTypeOf(Types.TAny());
        return;
      }
      if (st.mode === 'string') {
        lookupVar(st.target, ctx, st.targetToken);
        setTypeOf(Types.TStr());
        return;
      }
      if (st.mode === 'boolean') {
        const t = lookupVar(st.target, ctx, st.targetToken);
        if (!Types.isAny(t) && t.kind !== 'string' && t.kind !== 'boolean') {
          throw err('TypeError', `Make boolean needs text ("true"/"false") or a boolean, '${st.target}' is ${Types.typeName(t)}.`, st.targetToken, mod);
        }
        setTypeOf(Types.TBool());
        return;
      }
      if (st.mode === 'require-gradients') {
        // Vexel 3.5 Atlas: flag a tensor for gradient tracking. The
        // variable keeps its type; only the runtime flag changes.
        const t = lookupVar(st.target, ctx, st.targetToken);
        if (!Types.isAny(t) && t.kind !== 'tensor') {
          throw err('TypeError', `Make require gradients needs a tensor, '${st.target}' is ${Types.typeName(t)}.`, st.targetToken, mod);
        }
        return;
      }
      throw err('SyntaxError', `Unknown make mode '${st.mode}'.`, st.token, mod);
    }
    case 'TryStmt': {
      for (const s of st.tryBody) checkStatement(s, ctx);
      const catchCtx = Object.assign({}, ctx, { inCatch: true });
      for (const s of st.catchBody) checkStatement(s, catchCtx);
      return;
    }
    case 'ComponentDecl':
    case 'ThemeDecl':
    case 'StyleDecl':
      return; // collected in analyze(); bodies checked via use sites below
    case 'RemoveStmt': {
      // Vexel 2.0: remove button — detach and dispose a UI element.
      const t = inferRemoveTarget(st.target, ctx);
      void t;
      return;
    }
    case 'WaitStmt': {
      // Vexel 2.0: wait 2 seconds — blocking sleep (also works in console).
      const vt = inferExpr(st.value, ctx);
      if (!Types.isAny(vt) && vt.kind !== 'integer' && vt.kind !== 'decimal') {
        throw err('TypeError', `Wait needs a number of seconds, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
      }
      return;
    }
    case 'TimerStmt': {
      // Vexel 2.0: every/after blocks run on the UI loop (window required).
      checkTimerBlock(st, ctx);
      return;
    }
    case 'TaskStmt': {
      // Vexel 2.2 phase 7: background tasks (window required: the
      // only backends with a task runtime are UI programs).
      checkTask(st, ctx);
      return;
    }
    case 'CopyStmt': {
      // Vexel 2.0: copy text to the clipboard (window required for STA).
      if (!scope.hasWindow) {
        throw err('UIError', 'Clipboard needs a window. Add: create a window titled "...".', st.token, mod);
      }
      inferExpr(st.value, ctx);
      return;
    }
    case 'JsonWriteStmt': {
      // Vexel 2.0: json write data to "player.json".
      const vt = inferExpr(st.value, ctx);
      if (vt.kind === 'ui') {
        throw err('TypeError', `Cannot write a UI element to JSON.`, st.value.token || st.token, mod);
      }
      const pt = inferExpr(st.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `JSON path must be a string, got ${Types.typeName(pt)}.`, st.path.token || st.token, mod);
      }
      return;
    }
    case 'CreateWindow': {
      scope.windowCount = (scope.windowCount || 0) + 1;
      if (scope.windowCount > 1) {
        throw err('UIError', 'Only one anonymous window per program. Give each window a name: main = create a window titled "Main".', st.token, mod);
      }
      scope._windowBuilt = true;
      if (st.title) {
        const t = inferExpr(st.title, ctx);
        if (!Types.isAny(t) && t.kind !== 'string') {
          throw err('UIError', `Window title must be a string, got ${Types.typeName(t)}.`, st.title.token || st.token, mod);
        }
      }
      return;
    }
    case 'CreateContainer': {
      if (!scope.hasWindow) {
        throw err('UIError', 'UI elements need a window. Add: create a window titled "...".', st.token, mod);
      }
      requireWindowBuilt(ctx, st.token);
      return;
    }
    case 'AddToContainer': {
      requireHasWindow(ctx, st.token, 'Adding UI elements to containers');
      requireWindowBuilt(ctx, st.token);
      const vt = inferExpr(st.value, ctx);
      if (vt.kind !== 'ui' && !Types.isAny(vt)) {
        throw err('UIError', `Can only add UI elements to containers, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
      }
      const tgt = resolveUITargetInfo(st.target, ctx);
      if (tgt.kind !== 'container' && tgt.kind !== 'tabpage' && tgt.kind !== 'window' && tgt.kind !== 'card') {
        throw err('UIError', `Cannot add this element to ${tgt.kind === 'window' ? 'a window' : 'a ' + tgt.kind}. Add to a container, tab, card, or the window.`, st.target.token || st.token, mod);
      }
      return;
    }
    case 'ComponentUse': {
      if (!scope.components.has(st.name)) {
        throw err('NameError', `Unknown component '${st.name}'. Define it with: component ${st.name} { ... }.`, st.token, mod);
      }
      if (!scope.hasWindow) {
        throw err('UIError', 'UI elements need a window. Add: create a window titled "...".', st.token, mod);
      }
      requireWindowBuilt(ctx, st.token);
      return;
    }
    case 'UISetProp': {
      requireHasWindow(ctx, st.token, 'Setting UI properties');
      requireWindowBuilt(ctx, st.token);
      const tgt = resolveUITargetInfo(st.target, ctx);
      if (tgt.kind === 'any') {
        // Dynamic handle — validated at runtime.
        if (st.value) inferExpr(st.value, ctx);
        st._anyTarget = true;
        return;
      }
      if (st.prop === 'spacing') {
        // `set container spacing to N` — layout helper, not a plain property.
        if (tgt.kind !== 'container' && tgt.kind !== 'tabpage') {
          throw err('UIError', `Spacing can only be set on a container.`, st.token, mod);
        }
        if (!st.value) {
          throw err('UIError', `Spacing needs a number, e.g. set ${tgt.label} spacing to 10.`, st.token, mod);
        }
        const vt = inferExpr(st.value, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'integer') {
          throw err('UIError', `Spacing needs an integer, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
        }
        st._spacing = true;
        return;
      }
      const decl = lookupUIProp(tgt.kind, st.prop, st.token, mod, true);
      if (st.unit === 'fill' || st.unit === 'percent') {
        if (st.prop !== 'width' && st.prop !== 'height') {
          throw err('UIError', `'${st.unit}' only applies to width and height, not '${st.prop}'.`, st.token, mod);
        }
      }
      if (st.value) {
        const vt = inferExpr(st.value, ctx);
        if (st.value.type === 'PercentOf') {
          if (st.prop !== 'width' && st.prop !== 'height') {
            throw err('UIError', `Percent sizes only apply to width and height, not '${st.prop}'.`, st.token, mod);
          }
        } else {
          checkUIPropValue(tgt.kind, st.prop, decl, st.value, vt, mod);
          if (st.unit === 'percent' && st.value.type !== 'IntLit' && st.value.type !== 'FloatLit' && !Types.isAny(vt)) {
            throw err('UIError', 'Percent width/height needs a number.', st.value.token || st.token, mod);
          }
        }
      }
      return;
    }
    case 'UISetMinMax': {
      requireHasWindow(ctx, st.token, 'Setting minimum/maximum sizes');
      requireWindowBuilt(ctx, st.token);
      const tgt = resolveUITargetInfo(st.target, ctx);
      if (tgt.kind === 'any') {
        if (st.value) inferExpr(st.value, ctx);
        st._anyTarget = true;
        return;
      }
      const table = UI_PROPS[tgt.kind] || {};
      if (!table.width || !table.height) {
        throw err('UIError', `Cannot set minimum/maximum size on ${tgt.kind === 'window' ? 'a window' : 'a ' + tgt.kind}.`, st.token, mod);
      }
      const vt = inferExpr(st.value, ctx);
      if (!Types.isAny(vt) && vt.kind !== 'integer') {
        throw err('UIError', `Minimum/maximum ${st.dim} needs an integer, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
      }
      return;
    }
    case 'UISetPosition': {
      requireHasWindow(ctx, st.token, 'Setting the window position');
      requireWindowBuilt(ctx, st.token);
      const tgt = resolveUITargetInfo(st.target, ctx);
      if (tgt.kind === 'any') {
        inferExpr(st.x, ctx);
        inferExpr(st.y, ctx);
        st._anyTarget = true;
        return;
      }
      if (tgt.kind !== 'window') {
        throw err('UIError', 'Position can only be set on the window. Place widgets with containers and x/y instead.', st.token, mod);
      }
      for (const v of [st.x, st.y]) {
        const vt = inferExpr(v, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'integer') {
          throw err('UIError', `Window position needs integers, got ${Types.typeName(vt)}.`, (v && v.token) || st.token, mod);
        }
      }
      return;
    }
    case 'UICenter': {
      requireHasWindow(ctx, st.token, 'Centering UI elements');
      requireWindowBuilt(ctx, st.token);
      resolveUITargetInfo(st.target, ctx);
      if (st.inTarget) resolveUITargetInfo(st.inTarget, ctx);
      return;
    }
    case 'UIUseTheme': {
      if (!scope.hasWindow) {
        throw err('UIError', 'Themes need a window. Add: create a window titled "...".', st.token, mod);
      }
      // Vexel 2.0: `set theme to Mono` — bare declared theme name.
      if (st.name && st.name.type === 'VarRef' && scope.themes.has(st.name.name)) {
        st._themeRef = st.name.name;
        return;
      }
      if (st.name && st.name.type === 'StrLit') {
        const n = st.name.value;
        if (n !== 'dark' && n !== 'light' && !scope.themes.has(n)) {
          const avail = ['dark', 'light', ...scope.themes.keys()].join(', ');
          throw err('UIError', `Unknown theme '${n}'. Available: ${avail}.`, st.name.token, mod);
        }
      } else if (st.name) {
        const vt = inferExpr(st.name, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'string') {
          throw err('UIError', `Theme name must be a string, got ${Types.typeName(vt)}.`, st.name.token || st.token, mod);
        }
      }
      return;
    }
    case 'UIShowDialog': {
      if (!scope.hasWindow) {
        throw err('UIError', 'Dialogs need a window. Add: create a window titled "...".', st.token, mod);
      }
      if (st.value) {
        const vt = inferExpr(st.value, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'string') {
          throw err('UIError', `Dialog text must be a string, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
        }
      }
      return;
    }
    case 'ShowNotification': {
      // Vexel 3.0 Praxis: show notification [kind] "text" [for N seconds].
      if (!scope.hasWindow) {
        throw err('UIError', 'Notifications need a window. Add: create a window titled "...".', st.token, mod);
      }
      const vt = inferExpr(st.value, ctx);
      if (!Types.isAny(vt) && vt.kind !== 'string') {
        throw err('UIError', `Notification text must be a string, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
      }
      if (st.secs) {
        if (st.secs.type !== 'INT' && st.secs.type !== 'DECIMAL') {
          throw err('UIError', `Notification duration needs a number of seconds.`, st.secs.token || st.token, mod);
        }
        if (Number(st.secs.value) <= 0) {
          throw err('UIError', `Notification duration must be positive.`, st.secs.token || st.token, mod);
        }
      }
      return;
    }
    case 'UIAnimate': {
      requireHasWindow(ctx, st.token, 'Animating UI elements');
      requireWindowBuilt(ctx, st.token);
      const tgt = resolveUITargetInfo(st.target, ctx);
      if (tgt.kind === 'any') {
        for (const s of st.steps) {
          if (s.op === 'move-x' || s.op === 'move-y' || s.op === 'fade-to' || s.op === 'duration') {
            if (s.value) inferExpr(s.value, ctx);
          } else if (s.op === 'size') {
            inferExpr(s.w, ctx);
            inferExpr(s.h, ctx);
          } else if (s.op === 'ease') {
            if (s.value !== 'linear' && s.value !== 'smooth') {
              throw err('UIError', `Unknown easing '${s.value}'. Use linear or smooth.`, s.token || st.token, mod);
            }
          }
        }
        st._hasDuration = st.steps.some((s) => s.op === 'duration');
        st._anyTarget = true;
        return;
      }
      let hasDuration = false;
      for (const s of st.steps) {
        if (s.op === 'move-x' || s.op === 'move-y') {
          const vt = inferExpr(s.value, ctx);
          if (!Types.isAny(vt) && vt.kind !== 'integer') {
            throw err('UIError', `Animation move needs an integer position, got ${Types.typeName(vt)}.`, (s.value && s.value.token) || st.token, mod);
          }
        } else if (s.op === 'fade-to') {
          // Vexel 2.2: control fade is real on capable backends
          // (Avalonia); incapable ones reject it at codegen with a
          // clear backend error instead of a generic failure.
          if (s.value) {
            const vt = inferExpr(s.value, ctx);
            if (!Types.isAny(vt) && vt.kind !== 'decimal' && vt.kind !== 'integer') {
              throw err('UIError', `Fade target needs a number between 0 and 1, got ${Types.typeName(vt)}.`, (s.value && s.value.token) || st.token, mod);
            }
          }
        } else if (s.op === 'size') {
          for (const v of [s.w, s.h]) {
            const vt = inferExpr(v, ctx);
            if (!Types.isAny(vt) && vt.kind !== 'integer') {
              throw err('UIError', `Animation size needs integers, got ${Types.typeName(vt)}.`, (v && v.token) || st.token, mod);
            }
          }
        } else if (s.op === 'duration') {
          hasDuration = true;
          const vt = inferExpr(s.value, ctx);
          if (!Types.isAny(vt) && vt.kind !== 'decimal' && vt.kind !== 'integer') {
            throw err('TypeError', `Duration needs a number of seconds, got ${Types.typeName(vt)}.`, (s.value && s.value.token) || st.token, mod);
          }
        } else if (s.op === 'ease') {
          if (s.value !== 'linear' && s.value !== 'smooth') {
            throw err('UIError', `Unknown easing '${s.value}'. Use linear or smooth.`, s.token || st.token, mod);
          }
        }
      }
      st._hasDuration = hasDuration;
      return;
    }
    case 'UIEventHandler': {
      requireHasWindow(ctx, st.token, 'Event handlers');
      requireWindowBuilt(ctx, st.token);
      const tgt = resolveUITargetInfo(st.target, ctx);
      if (tgt.kind === 'any') {
        throw err('UIError', `Events need a known element type (this one is dynamic). Store it from add ... first.`, st.token, mod);
      }
      const allowed = UI_EVENTS[tgt.kind] || [];
      if (!allowed.includes(st.event)) {
        const list = allowed.length > 0 ? allowed.join(', ') : 'no events';
        throw err('UIError', `${tgt.kind === 'window' ? 'The window' : 'A ' + tgt.kind} does not support event '${st.event}'. Valid: ${list}.`, st.token, mod);
      }
      if (ctx.inFunction || ctx.locals) {
        // Handlers inside functions capture surrounding locals — allowed.
      }
      const sub = Object.assign({}, ctx, {
        inHandler: true,
        inKeyHandler: st.event === 'key press' || st.event === 'key release',
        inEvent: st.event,
        locals: new Map(),
        outerLocals: ctx.locals || null,
      });
      for (const s of st.body) {
        if (s.type === 'FuncDecl' || s.type === 'StructDecl' || s.type === 'EnumDecl' || s.type === 'TestBlock' || s.type === 'ImportDecl' || s.type === 'ComponentDecl' || s.type === 'ThemeDecl' || s.type === 'StyleDecl' || s.type === 'CreateWindow' || s.type === 'PublicDecl') {
          throw err('SyntaxError', `Declaration '${s.type}' is not allowed inside an event handler.`, s.token, mod);
        }
        checkStatement(s, sub);
      }
      return;
    }
    case 'MoveStmt': {
      // Vexel 3.6 Atlas: `move x to gpu|cpu` — tensors, structs, and
      // lists transfer (their tensors move); other top-level values are
      // a user error. `any` defers to runtime. Atlas v0.5: models move
      // too (their parameter tensors transfer).
      const t = inferExpr(st.expr, ctx);
      if (!Types.isAny(t) && t.kind !== 'tensor' && t.kind !== 'list' && t.kind !== 'struct' && t.kind !== 'model') {
        throw err('TypeError', `move expects a tensor, struct, list, or model, got ${Types.typeName(t)}.`, (st.expr && st.expr.token) || st.token, mod);
      }
      return;
    }
    case 'SaveModelStmt': {
      // Atlas v0.5: `save model <m> to "<dir>"`.
      requireAtlasImport(scope, st.token, mod, 'save model');
      const vt = inferExpr(st.value, ctx);
      if (!Types.isAny(vt) && vt.kind !== 'model') {
        throw err('TypeError', `save model expects a Model, got ${Types.typeName(vt)}.`, (st.value && st.value.token) || st.token, mod);
      }
      const pt = inferExpr(st.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `save path must be a string, got ${Types.typeName(pt)}.`, (st.path && st.path.token) || st.token, mod);
      }
      return;
    }
    case 'InferenceStmt': {
      // Atlas v0.5: `with inference { ... }` — suppresses gradient
      // tracking inside the block (runtime RAII guard).
      requireAtlasImport(scope, st.token, mod, 'with inference');
      for (const s of st.body || []) checkStatement(s, ctx);
      return;
    }
    case 'ExprStmt': {
      inferExpr(st.expr, ctx);
      return;
    }
    default:
      throw err('SyntaxError', `Unknown statement type '${st.type}'.`, st.token, mod);
  }
}

function lookupVar(name, ctx, token) {
  const { scope, mod } = ctx;
  // Vexel 1.1.0: `key` only exists inside key event handlers.
  if (name === 'key' && !ctx.inKeyHandler) {
    if (!(ctx.locals && ctx.locals.has(name)) && !(ctx.outerLocals && ctx.outerLocals.has(name)) && !scope.variables.has(name)) {
      throw err('NameError', `'key' is only available inside a key press / key release handler.`, token, mod);
    }
  }
  if (ctx.locals && ctx.locals.has(name)) {
    return ctx.locals.get(name).type;
  }
  if (ctx.outerLocals && ctx.outerLocals.has(name)) {
    return ctx.outerLocals.get(name).type;
  }
  if (scope.variables.has(name)) {
    return scope.variables.get(name).type;
  }
  if (name === 'output') {
    return Types.TAny(); // fresh input buffer
  }
  // Check if it's a function name used as var? Let caller handle.
  // Check module names?
  if (isModuleName(scope, name)) {
    throw err('TypeError', `Module '${name}' cannot be used as a value. Use ${name}.<member> to access its public declarations.`, token, mod);
  }
  if (scope.functions.has(name)) {
    // Bare function name as expression — handled in inferExpr (zero-arg call).
    // Return function type marker
    return Types.TFunc(scope.functions.get(name).params.length);
  }
  if (scope.structs.has(name)) {
    throw err('TypeError', `Struct '${name}' cannot be used as a value. Instantiate it with ${name} { ... }.`, token, mod);
  }
  if (scope.enums && scope.enums.has(name)) {
    const info = scope.enums.get(name);
    throw err('TypeError', `Enum '${name}' cannot be used as a value. Use ${name}.${info.values[0]} (available: ${info.values.join(', ')}).`, token, mod);
  }
  throw err('NameError', undefinedVarMessage(name, ctx), token, mod);
}

// Vexel 2.9: unknown names get a closest-match hint within a tight
// threshold; otherwise the plain message (no guessing).
function undefinedVarMessage(name, ctx) {
  const sug = suggestName(name, ctx);
  if (sug) return `Undefined variable '${name}'. Did you mean '${sug}'?`;
  return `Undefined variable '${name}'.`;
}

function inferRemoveTarget(node, ctx) {
  const { scope, mod } = ctx;
  // Must name a UI element (any-typed values pass with runtime checking).
  if (node.type === 'VarRef' && node.name === 'window') {
    throw err('UIError', `Cannot remove the window. Use window.close or window.hide instead.`, node.token, mod);
  }
  const t = inferExpr(node, ctx);
  if (t.kind !== 'ui' && !Types.isAny(t)) {
    throw err('UIError', `Can only remove UI elements, got ${Types.typeName(t)}.`, node.token || null, mod);
  }
  node._resolvedRemove = true;
  return t;
}

function checkTimerBlock(st, ctx) {
  // Shared by bare `every/after` blocks and `timer = every/after` handles.
  const { scope, mod } = ctx;
  if (!scope.hasWindow) {
    throw err('UIError', 'Timers need a window. Add: create a window titled "...".', st.token, mod);
  }
  const vt = inferExpr(st.value, ctx);
  if (!Types.isAny(vt) && vt.kind !== 'integer' && vt.kind !== 'decimal') {
    throw err('TypeError', `Timer interval needs a number of seconds, got ${Types.typeName(vt)}.`, st.value.token || st.token, mod);
  }
  if (st.value.type === 'IntLit' || st.value.type === 'FloatLit') {
    if (Number(st.value.value) <= 0) {
      throw err('UIError', 'Timer interval must be positive.', st.value.token, mod);
    }
  }
  const sub = Object.assign({}, ctx, {
    inHandler: true,
    inKeyHandler: false,
    inEvent: null,
    locals: new Map(),
    outerLocals: ctx.locals || null,
  });
  for (const s of st.body) {
    if (s.type === 'FuncDecl' || s.type === 'StructDecl' || s.type === 'ImportDecl' || s.type === 'ComponentDecl' || s.type === 'ThemeDecl' || s.type === 'StyleDecl' || s.type === 'CreateWindow' || s.type === 'PublicDecl') {
      throw err('SyntaxError', `Declaration '${s.type}' is not allowed inside a timer block.`, s.token, mod);
    }
    checkStatement(s, sub);
  }
}

function checkWindowHandleAssign(st, ctx, isPublic) {  // Vexel 2.2: `main = create a window titled "Main"` declares a
  // window-typed variable. Methods, events, props and targets all work
  // through the shared UI machinery (uiKind 'window').
  const { scope, mod } = ctx;
  const name = st.target.name;
  const token = st.target.token;
  if (st.value.title) {
    const t = inferExpr(st.value.title, ctx);
    if (!Types.isAny(t) && t.kind !== 'string') {
      throw err('UIError', `Window title must be a string, got ${Types.typeName(t)}.`, st.value.title.token || st.value.token || token, mod);
    }
  }
  scope.hasWindow = true;
  scope._windowBuilt = true;
  const winType = Types.TUi('window');
  if (ctx.locals) {
    if (ctx.locals.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}'.`, token, mod);
    }
    ctx.locals.set(name, { type: winType, token });
    st._targetKind = 'local';
    st._isLocal = true;
    return;
  }
  if (scope.variables.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}'.`, token, mod);
  }
  if (scope.functions.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}' (already defined as function).`, token, mod);
  }
  scope.variables.set(name, { type: winType, isPublic: !!isPublic, token });
  st._targetKind = 'global';
  st._isLocal = false;
  st._isPublic = !!isPublic;
}

function checkTask(st, ctx) {
  // Vexel 2.2 phase 7: `task name { ... }` declares a background-task
  // handle (any-typed at compile time; a VexTask object at runtime).
  // The body runs OFF the UI thread in isolated scope: fresh locals,
  // no outer locals (module globals stay visible), and a pre-declared
  // `result` implicit where the outcome goes.
  // Vexel 2.9: tasks also run in console programs (worker threads with
  // a read-only globals snapshot); UI programs keep the VexTask model.
  const { scope, mod } = ctx;
  const name = st.name;
  const token = st.nameToken || st.token;
  if (scope.functions.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}' (already defined as function).`, token, mod);
  }
  if (scope.structs.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}' (already defined as struct).`, token, mod);
  }
  if (scope.enums.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}' (already defined as enum).`, token, mod);
  }
  if (isModuleName(scope, name)) {
    throw err('NameError', `Name '${name}' collides with imported module '${name}'.`, token, mod);
  }
  if (ctx.locals && ctx.locals.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}'.`, token, mod);
  }
  if (!ctx.locals && scope.variables.has(name)) {
    throw err('NameError', `Duplicate declaration '${name}'.`, token, mod);
  }
  scope.taskHandles = scope.taskHandles || new Set();
  scope.taskHandles.add(name);
  const handleType = Types.TAny();
  if (ctx.locals) {
    ctx.locals.set(name, { type: handleType, token });
    st._targetKind = 'local';
    st._isLocal = true;
  } else {
    scope.variables.set(name, { type: handleType, isPublic: false, token });
    st._targetKind = 'global';
    st._isLocal = false;
    st._isPublic = false;
  }
  const sub = Object.assign({}, ctx, {
    locals: new Map(),
    outerLocals: null,
    inHandler: false,
    inKeyHandler: false,
    inEvent: null,
  });
  sub.locals.set('result', { type: Types.TAny(), token });
  for (const s of st.body) {
    if (s.type === 'FuncDecl' || s.type === 'StructDecl' || s.type === 'EnumDecl' || s.type === 'TestBlock' || s.type === 'ImportDecl' || s.type === 'ComponentDecl' || s.type === 'ThemeDecl' || s.type === 'StyleDecl' || s.type === 'CreateWindow' || s.type === 'PublicDecl') {
      throw err('SyntaxError', `Declaration '${s.type}' is not allowed inside a task.`, s.token, mod);
    }
    if (s.type === 'ReturnStmt') {
      throw err('SyntaxError', 'Cannot return from a task. Assign the outcome to result instead.', s.token, mod);
    }
    if (s.type === 'TimerStmt') {
      throw err('UIError', 'Timers cannot be created inside a task. Poll the task from a timer instead.', s.token, mod);
    }
    if (s.type === 'UIEventHandler') {
      throw err('UIError', 'Event handlers cannot be attached inside a task.', s.token, mod);
    }
    checkStatement(s, sub);
    // Showing the window from a worker would hijack the message loop.
    if (s.type === 'ExprStmt' && s.expr && s.expr.type === 'FieldAccess' && s.expr._resolved &&
        s.expr._resolved.kind === 'ui-method' && s.expr._resolved.method === 'show') {
      throw err('UIError', 'A task cannot show the window. Update UI by polling handle.state from a timer instead.', s.expr.token || s.token, mod);
    }
  }
}

function checkTimerHandleAssign(st, ctx, isPublic) {  // Vexel 2.2: `timer = every 1 second { ... }` declares a timer handle
  // (any-typed at compile time; a VexTimer object at runtime).
  const { scope, mod } = ctx;
  const name = st.target.name;
  const token = st.target.token;
  scope.timerHandles = scope.timerHandles || new Set();
  scope.timerHandles.add(name);
  const handleType = Types.TAny();
  if (ctx.locals) {
    if (ctx.locals.has(name)) upsertLocalType(ctx.locals, name, handleType, token, mod);
    else ctx.locals.set(name, { type: handleType, token });
    st._targetKind = 'local';
    st._isLocal = true;
  } else if (scope.variables.has(name)) {
    const existing = scope.variables.get(name).type;
    if (!Types.sameType(existing, handleType) && !Types.isAny(existing) && !Types.isAny(handleType)) {
      throw err('TypeError', `Type mismatch: variable '${name}' is ${Types.typeName(existing)} but assigned a timer.`, token, mod);
    }
    st._targetKind = 'global';
    st._isLocal = false;
    st._isPublic = false;
  } else {
    if (scope.functions.has(name)) {
      throw err('NameError', `Duplicate declaration '${name}' (already defined as function).`, token, mod);
    }
    scope.variables.set(name, { type: handleType, isPublic: !!isPublic, token });
    st._targetKind = 'global';
    st._isLocal = false;
    st._isPublic = !!isPublic;
  }
  checkTimerBlock(st.value, ctx);
}

function upsertLocalType(map, name, valueType, token, mod) {
  const existing = map.get(name).type;
  // Vexel 3.4 Atlas: track the latest tensor shape, widening to
  // unknown on disagreement (branches may diverge; runtime decides).
  if (existing.kind === 'tensor' && (valueType.kind === 'tensor' || Types.isAny(valueType))) {
    map.set(name, { type: Types.TTensor(mergedTensorShape(existing, valueType)), token });
    return;
  }
  if (!Types.sameType(existing, valueType)) {
    if (!Types.isAny(existing) && !Types.isAny(valueType)) {
      throw err('TypeError', reassignMessage(name, existing, valueType, map.get(name).token), token, mod);
    }
    if (Types.isAny(existing) && !Types.isAny(valueType)) {
      map.set(name, { type: valueType, token });
    }
  }
}

// Vexel 2.9: reassignment errors name the previous type and location,
// plus one safe suggestion (a separate variable always works).
function reassignMessage(name, existing, valueType, firstToken) {
  let msg = `Type mismatch: variable '${name}' is ${Types.typeName(existing)} but assigned ${Types.typeName(valueType)}. Cannot assign ${Types.typeName(valueType)} to ${Types.typeName(existing)}.`;
  if (firstToken && firstToken.line) {
    msg += `\n\n'${name}' was previously inferred as ${Types.typeName(existing)} at line ${firstToken.line}.`;
  }
  msg += `\n\nSuggestion:\nUse a separate variable for the ${Types.typeName(valueType)} value.`;
  return msg;
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

// Vexel 2.9: closest declared name within a tight threshold, or null.
function suggestName(name, ctx) {
  const { scope } = ctx;
  const cands = new Set();
  if (ctx.locals) for (const k of ctx.locals.keys()) cands.add(k);
  if (ctx.outerLocals) for (const k of ctx.outerLocals.keys()) cands.add(k);
  for (const k of scope.variables.keys()) cands.add(k);
  for (const k of scope.functions.keys()) cands.add(k);
  for (const k of scope.structs.keys()) cands.add(k);
  if (scope.enums) for (const k of scope.enums.keys()) cands.add(k);
  for (const im of scope.imports) cands.add(im.moduleName);
  let best = null, bestDist = 4;
  for (const c of cands) {
    if (c === name || c.length < 2) continue;
    const d = editDistance(name, c);
    const limit = c.length <= 5 ? 2 : 3;
    if (d <= limit && d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

// Vexel 2.9: definite-null tracking. Entries remember the token of a
// `= null` assignment (locals and same-module globals); any other
// assignment clears it. JSON reads, params and calls are untyped (any)
// and never count as definitely null.
function nullOriginToken(name, ctx) {
  const { scope } = ctx;
  if (ctx.locals && ctx.locals.has(name)) return ctx.locals.get(name).nullToken || null;
  if (ctx.outerLocals && ctx.outerLocals.has(name)) return ctx.outerLocals.get(name).nullToken || null;
  if (scope.variables.has(name)) return scope.variables.get(name).nullToken || null;
  return null;
}

function nullHint(name, ctx) {
  const tok = name ? nullOriginToken(name, ctx) : null;
  if (tok) return ` '${name}' was assigned null at line ${tok.line}. Check it first (if ${name} = null { ... }).`;
  return '';
}

function nullUseError(name, token, mod, ctx) {
  const hint = ctx ? nullHint(name, ctx) : '';
  const tail = hint || ` Check it first (if ${name} = null { ... }).`;
  throw err('NullSafetyError', `Cannot use '${name}' here because it holds null.${tail} Give it a value before this line to proceed.`, token, mod);
}

function checkMatch(st, ctx) {
  // Vexel 2.9: match subject { literal arms, Enum.value arms, bare enum
  // value arms, null arms, trailing _ default }. Checked here; both
  // backends emit an == chain.
  const { scope, mod } = ctx;
  const subjType = inferExpr(st.subject, ctx);
  const subjEnum = subjType.kind === 'enum' ? subjType.enumName : null;
  const subjAny = Types.isAny(subjType);
  const subjKind = subjType.kind;
  if (!subjAny && !subjEnum && subjKind !== 'integer' && subjKind !== 'decimal' && subjKind !== 'string' && subjKind !== 'boolean' && subjKind !== 'null') {
    throw err('TypeError', `match needs a number, string, boolean, enum or null value, got ${Types.typeName(subjType)}.`, st.subject.token || st.token, mod);
  }
  const seen = new Set();
  const dup = (key, token, label) => {
    if (seen.has(key)) throw err('TypeError', `Duplicate match arm for ${label}.`, token, mod);
    seen.add(key);
  };
  st.arms.forEach((arm, idx) => {
    const p = arm.pattern;
    const last = idx === st.arms.length - 1;
    if (p.type === 'MatchDefault') {
      if (!last) throw err('SyntaxError', `The default arm '_' must be last in match.`, p.token, mod);
    } else if (p.type === 'MatchLit') {
      const k = p.litType === 'BOOL' ? 'boolean' : p.litType === 'STRING' ? 'string' : 'number';
      if (subjEnum) {
        throw err('TypeError', `match on enum ${subjEnum} needs Enum.value arms (e.g. ${subjEnum}.${scope.enums.get(subjEnum).values[0]}), not literals.`, p.token, mod);
      }
      if (!subjAny && subjKind !== 'null') {
        const ok = (k === 'number' && (subjKind === 'integer' || subjKind === 'decimal')) ||
          (k === 'string' && subjKind === 'string') ||
          (k === 'boolean' && subjKind === 'boolean');
        if (!ok) throw err('TypeError', `A ${k} arm can never match ${Types.typeName(subjType)} subject.`, p.token, mod);
      }
      dup(`lit:${k}:${p.value}`, p.token, `'${p.value}'`);
    } else if (p.type === 'MatchNull') {
      dup('null', p.token, 'null');
    } else if (p.type === 'MatchEnum') {
      const def = scope.enums.get(p.enumName);
      if (!def) throw err('NameError', `Unknown enum '${p.enumName}' in match.`, p.token, mod);
      if (!def.values.includes(p.value)) {
        throw err('TypeError', `Enum '${p.enumName}' has no value '${p.value}'. Available: ${def.values.join(', ')}.`, p.token, mod);
      }
      if (!subjAny && subjEnum !== p.enumName) {
        throw err('TypeError', `Arm ${p.enumName}.${p.value} cannot match ${subjEnum ? 'enum ' + subjEnum : Types.typeName(subjType)} subject.`, p.token, mod);
      }
      dup(`enum:${p.enumName}.${p.value}`, p.token, `${p.enumName}.${p.value}`);
    } else if (p.type === 'MatchBare') {
      if (!subjEnum) {
        throw err('TypeError', `Bare name '${p.name}' in match only matches enum values, but the subject is ${subjAny ? 'unknown' : Types.typeName(subjType)}. Use a literal, null or _.`, p.token, mod);
      }
      const def = scope.enums.get(subjEnum);
      if (!def.values.includes(p.name)) {
        throw err('TypeError', `Enum '${subjEnum}' has no value '${p.name}'. Available: ${def.values.join(', ')}.`, p.token, mod);
      }
      dup(`enum:${subjEnum}.${p.name}`, p.token, `${subjEnum}.${p.name}`);
      p.type = 'MatchEnum';
      p.enumName = subjEnum;
      p.value = p.name;
    } else {
      throw err('SyntaxError', 'Unknown match pattern.', p.token || st.token, mod);
    }
    for (const s of arm.body) checkStatement(s, ctx);
  });
}

function checkVarAssign(st, ctx, isPublic) {
  const { scope, mod } = ctx;
  const target = st.target;
  // A style name (button.style = main_button) is a declaration reference,
  // not a value — do not infer it as an expression.
  const isStyleAssign = target.type === 'FieldAccess' && target.field === 'style';
  // Vexel 2.2: `timer = every/after ...` declares a timer handle.
  // TimerStmt is a statement shape, not an expression — handle it here.
  if (!isStyleAssign && st.value && st.value.type === 'TimerStmt' && st.value.handle) {
    if (target.type !== 'VarRef') {
      throw err('SyntaxError', 'A timer handle needs a plain variable (e.g. timer = every 1 second { ... }).', target.token || st.token, mod);
    }
    checkTimerHandleAssign(st, ctx, isPublic);
    return;
  }
  // Vexel 2.2: `main = create a window titled "Main"` declares a window handle.
  // CreateWindow is a statement shape, not an expression — handle it here.
  if (!isStyleAssign && st.value && st.value.type === 'CreateWindow' && st.value.handle) {
    if (target.type !== 'VarRef') {
      throw err('SyntaxError', 'A window handle needs a plain variable (e.g. main = create a window titled "Main").', target.token || st.token, mod);
    }
    checkWindowHandleAssign(st, ctx, isPublic);
    return;
  }
  const valueType = isStyleAssign ? null : inferExpr(st.value, ctx);
  // Vexel 2.2.1: remember process handles for `.kill` resolution below.
  // Binding itself stays a plain variable (no behavior change).
  if (!isStyleAssign && st.value && st.value._resolved && st.value._resolved.kind === 'proc-start' &&
      target.type === 'VarRef') {
    scope.procHandles = scope.procHandles || new Set();
    scope.procHandles.add(target.name);
  }

  if (target.type === 'VarRef' || target.type === 'OutputRef') {
    const name = target.type === 'OutputRef' ? 'output' : target.name;
    const token = target.token;
    // Vexel 2.0: handler implicits are read-only.
    if (name === 'event' && ctx.inHandler) {
      throw err('SyntaxError', `'event' is read-only inside event handlers.`, token, mod);
    }
    if (name === 'key' && ctx.inKeyHandler) {
      throw err('SyntaxError', `'key' is read-only inside key handlers.`, token, mod);
    }
    if (st.value && st.value._voidUI) {
      throw err('TypeError', `This operation returns nothing and cannot be stored in '${name}'.`, token, mod);
    }
    const valueIsUI = valueType.kind === 'ui';
    if (name === 'window' && scope.hasWindow) {
      throw err('UIError', `'window' is reserved for the application window.`, token, mod);
    }
    if (name === 'output') {
      // Vexel 1.1.0: `output` is either the input buffer or a UI output box.
      if (valueIsUI) {
        if (scope.outputMode === 'buffer') {
          throw err('UIError', `'output' is already used for console input here. Name the output box differently (e.g. out).`, token, mod);
        }
        scope.outputMode = 'ui';
        if (ctx.locals) {
          upsertLocalType(ctx.locals, name, valueType, token, mod);
          st._targetKind = 'local';
          st._isLocal = true;
        } else {
          scope.variables.set(name, { type: valueType, isPublic: false, token });
          st._targetKind = 'global';
          st._isLocal = false;
          st._isPublic = false;
        }
        return;
      }
      if (scope.outputMode === 'ui') {
        throw err('UIError', `'output' holds a UI output box in this module. Store input text in another variable.`, token, mod);
      }
      if (scope.outputMode === 'unset') scope.outputMode = 'buffer';
      // Special: output buffer can hold anything, no type error on reassignment.
      if (ctx.locals) {
        // Inside function: `output = ...` sets the shared buffer (any).
        st._targetKind = 'output-global';
      } else {
        if (!scope.variables.has('output')) {
          scope.variables.set('output', { type: Types.TAny(), isPublic: false, token });
        }
        st._targetKind = 'output-global';
      }
      st._isLocal = false;
      st._isPublic = false;
      return;
    }
    // Binding choice (event handlers prefer existing bindings over shadowing).
    const inHandlerFresh = ctx.inHandler && ctx.locals && !ctx.locals.has(name);
    let bind = null;
    if (ctx.locals && ctx.locals.has(name)) bind = 'local';
    else if (inHandlerFresh && ctx.outerLocals && ctx.outerLocals.has(name)) bind = 'outer';
    else if (inHandlerFresh && ctx.outerLocals) bind = 'new-outer';
    else if (inHandlerFresh && scope.variables.has(name)) bind = 'global';
    else if (inHandlerFresh) bind = 'new-handler';
    else if (ctx.locals) bind = 'new-local';
    else if (scope.variables.has(name)) bind = 'global';
    else bind = 'new-global';
    // Vexel 2.9: track definite-null assignments for null safety.
    const assignedNullLit = !!(st.value && st.value.type === 'NullLit');
    const copiedNullTok = (st.value && st.value.type === 'VarRef') ? nullOriginToken(st.value.name, ctx) : null;
    const newNullToken = assignedNullLit ? token : (copiedNullTok || null);
    if (bind === 'local' || bind === 'outer' || bind === 'new-local' || bind === 'new-outer' || bind === 'new-handler') {
      const map = (bind === 'outer' || bind === 'new-outer') ? ctx.outerLocals : ctx.locals;
      if (bind === 'local' || bind === 'outer') {
        upsertLocalType(map, name, valueType, token, mod);
        map.get(name).nullToken = newNullToken;
      } else {
        map.set(name, { type: valueType, token, nullToken: newNullToken });
      }
      st._targetKind = 'local';
      st._isLocal = true;
    } else if (bind === 'global') {
      const existing = scope.variables.get(name).type;
      // Vexel 3.4 Atlas: track the latest tensor shape (see upsert).
      if (existing.kind === 'tensor' && (valueType.kind === 'tensor' || Types.isAny(valueType))) {
        scope.variables.get(name).type = Types.TTensor(mergedTensorShape(existing, valueType));
        scope.variables.get(name).nullToken = newNullToken;
        if (isPublic && !scope.variables.get(name).isPublic) {
          scope.variables.get(name).isPublic = true;
        }
        st._targetKind = 'global';
        st._isLocal = false;
        st._isPublic = !!isPublic;
        return;
      }
      if (!Types.sameType(existing, valueType)) {
        if (!Types.isAny(existing) && !Types.isAny(valueType)) {
          throw err('TypeError', reassignMessage(name, existing, valueType, scope.variables.get(name).token), token, mod);
        }
        if (Types.isAny(existing) && !Types.isAny(valueType)) {
          scope.variables.get(name).type = valueType;
        }
      }
      scope.variables.get(name).nullToken = newNullToken;
      if (isPublic && !scope.variables.get(name).isPublic) {
        scope.variables.get(name).isPublic = true;
      }
      st._targetKind = 'global';
      st._isLocal = false;
      st._isPublic = !!isPublic;
    } else {
      // new-global
      if (scope.functions.has(name)) {
        throw err('NameError', `Duplicate declaration '${name}' (already defined as function).`, token, mod);
      }
      if (scope.structs.has(name)) {
        throw err('NameError', `Duplicate declaration '${name}' (already defined as struct).`, token, mod);
      }
      if (scope.enums.has(name)) {
        throw err('NameError', `Duplicate declaration '${name}' (already defined as enum).`, token, mod);
      }
      if (scope.components.has(name)) {
        throw err('NameError', `Duplicate declaration '${name}' (already defined as component).`, token, mod);
      }
      if (isModuleName(scope, name)) {
        throw err('NameError', `Name '${name}' collides with imported module '${name}'.`, token, mod);
      }
      const freshNull = (st.value && st.value.type === 'NullLit') ? token : null;
      const freshCopy = (st.value && st.value.type === 'VarRef') ? nullOriginToken(st.value.name, ctx) : null;
      scope.variables.set(name, { type: valueType, isPublic: !!isPublic, token, nullToken: freshNull || freshCopy || null });
      st._targetKind = 'global';
      st._isLocal = false;
      st._isPublic = !!isPublic;
    }
    return;
  }

  if (target.type === 'FieldAccess') {
    // Vexel 2.9: writing through a definitely-null base is a static error.
    if (target.object.type === 'VarRef' && nullOriginToken(target.object.name, ctx)) {
      nullUseError(target.object.name, target.object.token || token, mod, ctx);
    }
    // Validate base + field, check value compatibility loosely
    const baseType = inferFieldBase(target.object, ctx);
    const field = target.field;
    // Module member assignment? e.g., player.name = ... where player is module?
    if (target.object.type === 'VarRef' && isModuleName(ctx.scope, target.object.name)) {
      const modScope = getImportedScope(ctx.scope, target.object.name, ctx.scopes);
      if (!modScope) throw err('ModuleError', `Unknown module '${target.object.name}'.`, target.object.token, mod);
      // Must be public var in that module
      if (modScope.variables.has(field)) {
        const info = modScope.variables.get(field);
        if (!info.isPublic) {
          throw err('VisibilityError', `'${field}' is private in module '${target.object.name}'.`, target.fieldToken || target.token, mod);
        }
        // Check value type vs field type?
        if (!Types.sameType(info.type, valueType) && !Types.isAny(info.type) && !Types.isAny(valueType)) {
          throw err('TypeError', `Type mismatch: ${target.object.name}.${field} is ${Types.typeName(info.type)} but assigned ${Types.typeName(valueType)}.`, target.token, mod);
        }
        target._resolved = { kind: 'module-var', moduleName: target.object.name };
        return;
      }
      if (modScope.functions.has(field)) {
        throw err('TypeError', `Cannot assign to function '${target.object.name}.${field}'.`, target.token, mod);
      }
      throw err('NameError', `Module '${target.object.name}' has no public member '${field}'.`, target.fieldToken || target.token, mod);
    }
    // Vexel 2.0: reusable styles (button.style = main_button).
    if (field === 'style') {
      let bk = null;
      try {
        bk = resolveUITargetInfo(target.object, ctx).kind;
      } catch (e) {
        throw err('UIError', `Styles only apply to UI elements.`, target.fieldToken || target.token, mod);
      }
      if (bk === 'any') {
        throw err('UIError', `Styles need a known element type (this one is dynamic).`, target.fieldToken || target.token, mod);
      }
      if (!st.value || st.value.type !== 'VarRef' || !scope.styles.has(st.value.name)) {
        throw err('UIError', `Style must be a declared style name. Define one with: style main_button { ... }.`, target.fieldToken || target.token, mod);
      }
      const th = scope.styles.get(st.value.name);
      for (const f of th.fields) {
        const fdecl = lookupUIProp(bk, f.name, f.token, mod, true);
        const fvt = inferExpr(f.value, ctx);
        checkUIPropValue(bk, f.name, fdecl, f.value, fvt, mod);
      }
      target._resolved = { kind: 'ui-style', uiKind: bk, style: st.value.name };
      return;
    }
    // Vexel 1.1.0: UI property assignment (button.title = "Start")
    if (baseType && baseType.kind === 'ui') {
      const decl = lookupUIProp(baseType.uiKind, field, target.fieldToken || target.token, mod, true);
      if (st.value && st.value.type === 'PercentOf') {
        if (field !== 'width' && field !== 'height') {
          throw err('UIError', `Percent sizes only apply to width and height, not '${field}'.`, target.fieldToken || target.token, mod);
        }
      } else {
        checkUIPropValue(baseType.uiKind, field, decl, st.value, valueType, mod);
      }
      target._resolved = { kind: 'ui-prop', uiKind: baseType.uiKind, prop: field };
      return;
    }
    // Struct field assignment
    if (baseType && baseType.kind === 'struct') {
      // Vexel 2.0 anonymous objects validate against inline fields.
      if (!baseType.structName) {
        const known = (baseType.fieldTypes && baseType.fieldTypes[field]) || null;
        if (!known) {
          throw err('TypeError', `Object has no field '${field}'.`, target.fieldToken || target.token, mod);
        }
        if (!Types.isAny(known) && !Types.isAny(valueType) && !Types.sameType(known, valueType)) {
          throw err('TypeError', `Type mismatch: field '${field}' is ${Types.typeName(known)} but assigned ${Types.typeName(valueType)}.`, target.token, mod);
        }
        target._resolved = { kind: 'struct-field', structName: null };
        return;
      }
      const structDef = findStructDef(ctx, baseType.structName);
      if (!structDef) {
        throw err('TypeError', `Unknown struct type '${baseType.structName}'.`, target.token, mod);
      }
      if (!structDef.fields.includes(field)) {
        throw err('TypeError', `${Types.typeName(baseType)} has no field '${field}'.`, target.fieldToken || target.token, mod);
      }
      target._resolved = { kind: 'struct-field', structName: baseType.structName };
      // Optionally check value vs existing field type? Field types tracked per-instance in baseType.fieldTypes
      if (baseType.fieldTypes && baseType.fieldTypes[field] && !Types.isAny(baseType.fieldTypes[field]) && !Types.isAny(valueType)) {
        if (!Types.sameType(baseType.fieldTypes[field], valueType)) {
          throw err('TypeError', `Type mismatch: field '${field}' is ${Types.typeName(baseType.fieldTypes[field])} but assigned ${Types.typeName(valueType)}.`, target.token, mod);
        }
      }
      return;
    }
    if (baseType && baseType.kind === 'list' && field === 'length') {
      throw err('TypeError', `Cannot assign to list length.`, target.token, mod);
    }
    if (baseType && baseType.kind === 'tensor') {
      throw err('TypeError', `Tensor properties are read-only.`, target.token, mod);
    }
    if (baseType && baseType.kind === 'model') {
      throw err('TypeError', `Model fields are read-only. Use m.eval or m.train to switch modes (m.parameters[0] = ... writes into the list).`, target.token, mod);
    }
    if (baseType && (baseType.kind === 'integer' || baseType.kind === 'decimal' || baseType.kind === 'boolean' || baseType.kind === 'string')) {
      throw err('TypeError', `${Types.typeName(baseType)} '${printBase(target.object)}' has no field '${field}'.`, target.fieldToken || target.token, mod);
    }
    if (Types.isAny(baseType)) {
      target._resolved = { kind: 'any-field' };
      return;
    }
    throw err('TypeError', `Invalid field assignment '${field}'.`, target.token, mod);
  }

  if (target.type === 'IndexAccess') {
    // Vexel 2.9: writing through a definitely-null base is a static error.
    if (target.object.type === 'VarRef' && nullOriginToken(target.object.name, ctx)) {
      nullUseError(target.object.name, target.object.token || target.token, mod, ctx);
    }
    const baseType = inferExpr(target.object, ctx);
    const idxType = inferExpr(target.index, ctx);
    if (!Types.isAny(idxType) && idxType.kind !== 'integer') {
      throw err('TypeError', `List index must be an integer, got ${Types.typeName(idxType)}.`, target.index.token || target.token, mod);
    }
    if (baseType && baseType.kind === 'list') {
      target._resolved = { kind: 'list-index' };
      return;
    }
    if (baseType && baseType.kind === 'tensor') {
      throw err('TypeError', `Cannot assign to a tensor index. Tensors are immutable in Atlas v0.1 — build a new one instead.`, target.token, mod);
    }
    if (baseType && baseType.kind === 'string') {
      throw err('TypeError', `Cannot assign to string index. Use make <name> upper/lower or rebuild the string.`, target.token, mod);
    }
    if (Types.isAny(baseType)) {
      target._resolved = { kind: 'any-index' };
      return;
    }
    throw err('TypeError', `Cannot index ${Types.typeName(baseType)}.`, target.token, mod);
  }

  throw err('SyntaxError', 'Invalid assignment target.', target.token, mod);
}

function printBase(node) {
  if (!node) return '';
  if (node.type === 'VarRef') return `'${node.name}'`;
  return '';
}

function findStructDef(ctx, structName) {
  if (ctx.scope.structs.has(structName)) return ctx.scope.structs.get(structName);
  return null;
}

function inferFieldBase(objNode, ctx) {
  // Returns type of object in FieldAccess (for assignment validation)
  // objNode is expression (usually VarRef)
  return inferExpr(objNode, ctx);
}

// Main expression inference. Returns Types object. Annotates nodes with _resolved for codegen.
function inferExpr(node, ctx) {
  const { scope, mod } = ctx;
  if (!node) throw err('SyntaxError', 'Missing expression.', null, mod);
  switch (node.type) {
    case 'IntLit': return Types.TInt();
    case 'FloatLit': return Types.TDec();
    case 'StrLit': return Types.TStr();
    case 'BoolLit': return Types.TBool();
    case 'VarRef': {
      const name = node.name;
      // Locals first
      if (ctx.locals && ctx.locals.has(name)) {
        node._resolved = { kind: 'local', name };
        return ctx.locals.get(name).type;
      }
      if (ctx.outerLocals && ctx.outerLocals.has(name)) {
        node._resolved = { kind: 'local', name };
        return ctx.outerLocals.get(name).type;
      }
      if (scope.variables.has(name)) {
        node._resolved = { kind: 'global', name, module: scope.name };
        return scope.variables.get(name).type;
      }
      if (name === 'output') {
        node._resolved = { kind: 'output' };
        return Types.TAny();
      }
      // Vexel 1.1.0: the implicit application window.
      if (name === 'window' && scope.hasWindow) {
        node._resolved = { kind: 'window-ref' };
        return Types.TUi('window');
      }
      // Vexel 1.1.0: `key` only exists inside key event handlers.
      if (name === 'key') {
        if (ctx.inKeyHandler) {
          node._resolved = { kind: 'key-val' };
          return Types.TStr();
        }
        throw err('NameError', `'key' is only available inside a key press / key release handler.`, node.token, mod);
      }
      if (scope.components.has(name)) {
        throw err('TypeError', `Component '${name}' is not a value. Show it with: add ${name}.`, node.token, mod);
      }
      if (scope.functions.has(name)) {
        const fn = scope.functions.get(name);
        if (fn.params.length === 0) {
          node._resolved = { kind: 'func-call-zero', name, module: scope.name };
          return Types.TAny(); // return type any
        }
        throw err('TypeError', `Function '${name}' expects ${fn.params.length} argument(s).`, node.token, mod);
      }
      if (isModuleName(scope, name)) {
        throw err('TypeError', `Module '${name}' cannot be used as a value. Use ${name}.<member>.`, node.token, mod);
      }
      if (scope.structs.has(name)) {
        throw err('TypeError', `Struct '${name}' cannot be used as a value. Instantiate it with ${name} { ... }.`, node.token, mod);
      }
      // Vexel 2.9: enum types are not values either — pick a value.
      if (scope.enums.has(name)) {
        const info = scope.enums.get(name);
        throw err('TypeError', `Enum '${name}' cannot be used as a value. Use ${name}.${info.values[0]} (available: ${info.values.join(', ')}).`, node.token, mod);
      }
      // Vexel 2.0: `paste` reads the clipboard unless the user defined it.
      if (name === 'paste') {
        node._resolved = { kind: 'paste' };
        return Types.TStr();
      }
      // Vexel 2.9: `args` is the program's command-line argument list
      // (excluding the program itself) unless the user defined it.
      if (name === 'args') {
        node._resolved = { kind: 'args' };
        return Types.TList(Types.TStr());
      }
      throw err('NameError', undefinedVarMessage(name, ctx), node.token, mod);
    }
    case 'OutputRef': {
      // Vexel 1.1.0: `output` may hold a UI output box (output = add ...).
      if (scope.outputMode === 'ui' && scope.variables.has('output')) {
        node._resolved = { kind: 'global', name: 'output', module: scope.name };
        return scope.variables.get('output').type;
      }
      node._resolved = { kind: 'output' };
      return Types.TAny();
    }
    case 'NullLit': {
      // Vexel 2.0: the null literal (mostly for JSON and nil checks).
      node._resolved = { kind: 'null-lit' };
      return Types.TNull();
    }
    case 'EventRef': {
      // A user variable literally named `event` keeps working.
      if ((ctx.locals && ctx.locals.has('event')) || (ctx.outerLocals && ctx.outerLocals.has('event')) || scope.variables.has('event')) {
        node.type = 'VarRef';
        node.name = 'event';
        return inferExpr(node, ctx);
      }
      // Vexel 2.0: `event` (and event.x / event.key) only inside handlers.
      if (!ctx.inEvent) {
        throw err('NameError', `'event' is only available inside an event handler (e.g. button.on click { ... }).`, node.token, mod);
      }
      node._resolved = { kind: 'event-val', event: ctx.inEvent };
      return Types.TStruct('event', {});
    }
    case 'RunExpr': {
      // Vexel 2.9: out = run "cmd" captures stdout as text.
      const t = inferExpr(node.cmd, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `run needs a command string, got ${Types.typeName(t)}.`, node.cmd.token || node.token, mod);
      }
      return Types.TStr();
    }
    case 'HttpRequest': {
      // Vexel 2.9: http <method> url [, body] [, headers].
      const ut = inferExpr(node.url, ctx);
      if (!Types.isAny(ut) && ut.kind !== 'string') {
        throw err('TypeError', `HTTP URL must be a string, got ${Types.typeName(ut)}.`, node.url.token || node.token, mod);
      }
      if ((node.method === 'get' || node.method === 'delete') && node.body && !node.headers) {
        // A single extra argument to get/delete is the headers object.
        node.headers = node.body;
        node.body = null;
      }
      if (node.body) {
        const bt = inferExpr(node.body, ctx);
        const okBody = Types.isAny(bt) || bt.kind === 'string' || bt.kind === 'struct' || bt.kind === 'list';
        if (!okBody) {
          throw err('TypeError', `HTTP body must be text or an object (objects send as JSON), got ${Types.typeName(bt)}.`, node.body.token || node.token, mod);
        }
        if (node.method === 'get' || node.method === 'delete') {
          throw err('TypeError', `http ${node.method} takes a URL and optional headers only (no body).`, node.body.token || node.token, mod);
        }
      }
      if (node.headers) {
        const ht = inferExpr(node.headers, ctx);
        if (!Types.isAny(ht) && ht.kind !== 'struct') {
          throw err('TypeError', `HTTP headers must be an object (e.g. { token = "abc" }), got ${Types.typeName(ht)}.`, node.headers.token || node.token, mod);
        }
      }
      return Types.TAny();
    }
    case 'FileRead': {
      const t = inferExpr(node.path, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `File path must be a string, got ${Types.typeName(t)}.`, node.path.token || node.token, mod);
      }
      return Types.TStr();
    }
    case 'FileExists':
    case 'DirExists': {
      const t = inferExpr(node.path, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `Path must be a string, got ${Types.typeName(t)}.`, node.path.token || node.token, mod);
      }
      return Types.TBool();
    }
    case 'FileSize': {
      const t = inferExpr(node.path, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `Path must be a string, got ${Types.typeName(t)}.`, node.path.token || node.token, mod);
      }
      return Types.TInt();
    }
    case 'DirList': {
      const t = inferExpr(node.path, ctx);
      if (!Types.isAny(t) && t.kind !== 'string') {
        throw err('TypeError', `Path must be a string, got ${Types.typeName(t)}.`, node.path.token || node.token, mod);
      }
      return Types.TList(Types.TStr());
    }
    case 'JsonRead': {
      // Vexel 2.0: data = json read "config.json" (schema unknown statically).
      const pt = inferExpr(node.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `JSON path must be a string, got ${Types.typeName(pt)}.`, node.path.token || node.token, mod);
      }
      node._resolved = { kind: 'json-read' };
      return Types.TAny();
    }
    case 'LoadModelExpr': {
      // Atlas v0.5: m = load model "<dir>".
      requireAtlasImport(scope, node.token, mod, 'load model');
      const pt = inferExpr(node.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `Model path must be a string, got ${Types.typeName(pt)}.`, node.path.token || node.token, mod);
      }
      node._resolved = { kind: 'model-load' };
      return Types.TModel();
    }
    case 'CreateModelExpr': {
      // Atlas v0.5: m = create model <config> — a config object, not a
      // path (a string gets the guidance error immediately).
      requireAtlasImport(scope, node.token, mod, 'create model');
      const ct = inferExpr(node.config, ctx);
      if (!Types.isAny(ct) && ct.kind === 'string') {
        throw err('TypeError', `create model takes a config object, not a path. Use atlas.default_config 4, 8, 2, json read "config.json", or an object literal; to load saved weights use load model "folder".`, node.config.token || node.token, mod);
      }
      if (!Types.isAny(ct) && ct.kind !== 'struct') {
        throw err('TypeError', `create model takes a config object, got ${Types.typeName(ct)}. Use atlas.default_config 4, 8, 2 or json read "config.json".`, node.config.token || node.token, mod);
      }
      node._resolved = { kind: 'model-create' };
      return Types.TModel();
    }
    case 'ModelInfoExpr': {
      // Atlas v0.5: info = model info "<dir>" — config-only inspection.
      requireAtlasImport(scope, node.token, mod, 'model info');
      const pt = inferExpr(node.path, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('TypeError', `Model path must be a string, got ${Types.typeName(pt)}.`, node.path.token || node.token, mod);
      }
      node._resolved = { kind: 'model-info' };
      return Types.TStruct(null, ATLAS_MODEL_INFO_FIELDS);
    }
    case 'HttpGet': {
      // Vexel 2.2 phase 7: response = http get "https://example.com"
      // (response object: status, text, headers, body).
      const ut = inferExpr(node.url, ctx);
      if (!Types.isAny(ut) && ut.kind !== 'string') {
        throw err('TypeError', `HTTP address must be a string, got ${Types.typeName(ut)}.`, node.url.token || node.token, mod);
      }
      node._resolved = { kind: 'http-get' };
      return Types.TAny();
    }
    case 'ObjectLit': {
      // Vexel 2.0: data = { name = "Zen"  level = 10 }.
      const fieldTypes = {};
      for (const f of node.fields) {
        fieldTypes[f.name] = inferExpr(f.value, ctx);
      }
      node._resolved = { kind: 'object-lit' };
      return Types.TStruct(null, fieldTypes);
    }
    case 'PercentOf': {
      // Vexel 2.0: 50% of window — responsive pixel sizes.
      const vt = inferExpr(node.value, ctx);
      if (!Types.isAny(vt) && vt.kind !== 'integer' && vt.kind !== 'decimal') {
        throw err('UIError', `Percent needs a number, got ${Types.typeName(vt)}.`, node.value.token || node.token, mod);
      }
      if ((node.value.type === 'IntLit' || node.value.type === 'FloatLit')) {
        const num = Number(node.value.value);
        if (num < 0 || num > 100) {
          throw err('UIError', `Percent must be between 0 and 100, got ${node.value.value}.`, node.value.token, mod);
        }
      }
      const bt = resolveUITargetInfo(node.base, ctx);
      if (bt.kind !== 'window') {
        throw err('UIError', `Percent sizes are relative to the window (got ${bt.kind}).`, node.base.token || node.token, mod);
      }
      node._resolved = { kind: 'percent-of' };
      return Types.TInt();
    }
    case 'ErrorRef': {
      // Vexel 2.0: `error` is an object { message, type, file, line, column }
      // that still prints as its message.
      if (!ctx.inCatch) {
        throw err('NameError', `'error' value is only available inside an error block.`, node.token, mod);
      }
      node._resolved = { kind: 'error-val' };
      return Types.TStruct('error', {
        message: Types.TStr(),
        type: Types.TStr(),
        file: Types.TStr(),
        line: Types.TInt(),
        column: Types.TInt(),
      });
    }
    case 'AddWidget': {
      // Vexel 1.1.0: add a button titled "Hi" / add an input box / ...
      if (!scope.hasWindow) {
        throw err('UIError', 'UI elements need a window. Add: create a window titled "...".', node.token, mod);
      }
      requireWindowBuilt(ctx, node.token);
      if (node.title) {
        if (!UI_WIDGET_TITLES[node.kind]) {
          throw err('UIError', `Add ${node.kind === 'listbox' ? 'a list' : 'a ' + node.kind} does not take a title.`, node.title.token || node.token, mod);
        }
        const tt = inferExpr(node.title, ctx);
        if (!Types.isAny(tt) && tt.kind !== 'string') {
          throw err('UIError', `Widget title must be a string, got ${Types.typeName(tt)}.`, node.title.token || node.token, mod);
        }
      }
      if (node.source) {
        const st = inferExpr(node.source, ctx);
        if (!Types.isAny(st) && st.kind !== 'string') {
          throw err('UIError', `Image source must be a file path string, got ${Types.typeName(st)}.`, node.source.token || node.token, mod);
        }
      }
      if (node.to) {
        const tgt = resolveUITargetInfo(node.to, ctx);
        if (tgt.kind !== 'container' && tgt.kind !== 'tabpage' && tgt.kind !== 'window' && tgt.kind !== 'card') {
          throw err('UIError', `Cannot add this element to ${tgt.kind === 'window' ? 'a window' : 'a ' + tgt.kind}. Add to a container, tab, card, or the window.`, node.to.token || node.token, mod);
        }
      }
      node._resolved = { kind: 'add-widget', uiKind: node.kind };
      return Types.TUi(node.kind);
    }
    case 'UIAddNode': {
      // table.add column/row, toolbar.add a button — validated against the base kind.
      const bt = inferExpr(node.base, ctx);
      if (bt.kind !== 'ui') {
        if (Types.isAny(bt)) {
          node._resolved = { kind: 'any-ui-add' };
          return Types.TAny();
        }
        throw err('UIError', `Only UI elements support this kind of add (got ${Types.typeName(bt)}).`, node.token, mod);
      }
      const bk = bt.uiKind;
      if (node.op === 'column') {
        if (bk !== 'table') throw err('UIError', `Only a table takes columns (got ${bk}).`, node.token, mod);
        const vt = inferExpr(node.value, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'string') {
          throw err('UIError', `Table column needs a string name, got ${Types.typeName(vt)}.`, node.value.token || node.token, mod);
        }
        node._voidUI = true;
        node._resolved = { kind: 'ui-add-column' };
        return Types.TVoid();
      }
      if (node.op === 'row') {
        if (bk !== 'table') throw err('UIError', `Only a table takes rows (got ${bk}).`, node.token, mod);
        const vt = inferExpr(node.value, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'list') {
          throw err('UIError', `Table row needs a list of values, e.g. table.add row ["Zen", 25]. Got ${Types.typeName(vt)}.`, node.value.token || node.token, mod);
        }
        node._voidUI = true;
        node._resolved = { kind: 'ui-add-row' };
        return Types.TVoid();
      }
      // Vexel 2.9: toolbar.add separator (visual divider, no value).
      if (node.op === 'separator') {
        if (bk !== 'toolbar') throw err('UIError', `Only a toolbar takes separators (got ${bk}).`, node.token, mod);
        node._voidUI = true;
        node._resolved = { kind: 'ui-add-separator' };
        return Types.TVoid();
      }
      // Vexel 2.9: toolbar.add group "Name" (labeled button strip).
      if (node.op === 'group') {
        if (bk !== 'toolbar') throw err('UIError', `Only a toolbar takes groups (got ${bk}).`, node.token, mod);
        const vt = inferExpr(node.value, ctx);
        if (!Types.isAny(vt) && vt.kind !== 'string') {
          throw err('TypeError', `Toolbar group needs a string name, got ${Types.typeName(vt)}.`, node.value.token || node.token, mod);
        }
        node._resolved = { kind: 'ui-add-group' };
        return Types.TUi('toolbar');
      }
      // op === 'widget' (toolbar.add a button titled ...)
      if (bk !== 'toolbar') {
        throw err('UIError', `Only a toolbar takes widget adds like this (got ${bk}).`, node.token, mod);
      }
      if (!node.widget || node.widget.kind !== 'button') {
        throw err('UIError', `A toolbar takes buttons: toolbar.add a button titled "...".`, node.token, mod);
      }
      if (node.widget.title) {
        const tt = inferExpr(node.widget.title, ctx);
        if (!Types.isAny(tt) && tt.kind !== 'string') {
          throw err('UIError', `Button title must be a string, got ${Types.typeName(tt)}.`, node.widget.title.token || node.token, mod);
        }
      }
      node._resolved = { kind: 'ui-add-toolbar-button' };
      return Types.TUi('toolbutton');
    }
    case 'UIEventRef': {
      throw err('SyntaxError', `Event '${node.event}' needs a block: <element>.on ${node.event} { ... }.`, node.token, mod);
    }
    case 'AskExpr': {
      if (!scope.hasWindow) {
        throw err('UIError', 'Dialogs need a window. Add: create a window titled "...".', node.token, mod);
      }
      const pt = inferExpr(node.prompt, ctx);
      if (!Types.isAny(pt) && pt.kind !== 'string') {
        throw err('UIError', `Dialog prompt must be a string, got ${Types.typeName(pt)}.`, node.prompt.token || node.token, mod);
      }
      node._resolved = { kind: 'ask' };
      return Types.TBool();
    }
    case 'ChooseFile':
    case 'ChooseColor':
    case 'ChooseFolder': {
      if (!scope.hasWindow) {
        throw err('UIError', 'Pickers need a window. Add: create a window titled "...".', node.token, mod);
      }
      node._resolved = { kind: node.type === 'ChooseFile' ? 'choose-file' : node.type === 'ChooseFolder' ? 'choose-folder' : 'choose-color' };
      return Types.TStr();
    }
    case 'CreateWindow': {
      throw err('UIError', `The window is used through 'window' (e.g. window.show). It cannot be stored in a variable.`, node.token, mod);
    }
    case 'CreateContainer': {
      if (!scope.hasWindow) {
        throw err('UIError', 'UI elements need a window. Add: create a window titled "...".', node.token, mod);
      }
      node._resolved = { kind: 'create-container', layout: node.layout };
      return Types.TUi('container');
    }

    case 'BinaryExpr': {
      const lt = inferExpr(node.left, ctx);
      const rt = inferExpr(node.right, ctx);
      const op = node.op;
      // Vexel 2.9: definite-null operands fail fast with guidance
      // (equality tests against null stay allowed).
      if (op !== '==' && op !== '!=') {
        for (const side of [node.left, node.right]) {
          if (side.type === 'VarRef' && nullOriginToken(side.name, ctx)) {
            nullUseError(side.name, side.token || node.token, mod, ctx);
          }
        }
      }
      if (op === '@') {
        // Vexel 3.4 Atlas: dedicated matrix multiplication (never `*`).
        const lok = lt.kind === 'tensor' || Types.isAny(lt);
        const rok = rt.kind === 'tensor' || Types.isAny(rt);
        if (!lok || !rok) {
          throw err('TypeError', `Operator '@' needs tensors, got ${Types.typeName(lt)} and ${Types.typeName(rt)}. Use * for ordinary multiplication.`, node.token, mod);
        }
        node._resolved = { kind: 'tensor-matmul' };
        // Static shapes fail fast at check time; unknowns defer to runtime.
        const ls = lt.kind === 'tensor' ? lt.shape : null;
        const rs = rt.kind === 'tensor' ? rt.shape : null;
        if (ls && rs) {
          if (ls.length !== 2 || rs.length !== 2) {
            throw err('ShapeError', `Matrix multiplication needs 2D tensors.\nLeft shape: ${tensorShapeStr(ls)}\nRight shape: ${tensorShapeStr(rs)}`, node.token, mod);
          }
          if (ls[1] !== rs[0]) {
            throw err('ShapeError', `Matrix shapes do not align: ${tensorShapeStr(ls)} and ${tensorShapeStr(rs)}. Inner sizes ${ls[1]} and ${rs[0]} must match.`, node.token, mod);
          }
          return Types.TTensor([ls[0], rs[1]]);
        }
        return Types.TTensor(null);
      }
      if (op === '+' ) {
        // String concat with coercion if either is string
        const lStr = lt.kind === 'string';
        const rStr = rt.kind === 'string';
        if (lStr || rStr) {
          // Allow string + (int/decimal/bool/string/enum/any)
          // (Vexel 2.9: enums print as their value name, so they join).
          const other = lStr ? rt : lt;
          if (other.kind === 'string' || other.kind === 'integer' || other.kind === 'decimal' || other.kind === 'boolean' || other.kind === 'enum' || Types.isAny(other)) {
            return Types.TStr();
          }
          throw err('TypeError', `Cannot add ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
        }
        // Vexel 3.4 Atlas: element-wise tensor math (tensor/tensor with
        // matching shapes, or tensor with a number). Known shapes fail
        // fast here; anything dynamic defers to runtime validation.
        if (lt.kind === 'tensor' || rt.kind === 'tensor') {
          const okSide = (t) => t.kind === 'tensor' || t.kind === 'integer' || t.kind === 'decimal' || Types.isAny(t);
          if (!okSide(lt) || !okSide(rt)) {
            throw err('TypeError', `Cannot add ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
          }
          const ls = lt.kind === 'tensor' ? lt.shape : null;
          const rs = rt.kind === 'tensor' ? rt.shape : null;
          if (ls && rs && !tensorShapesEqual(ls, rs)) {
            throw err('ShapeError', `Cannot add tensors.\nLeft shape: ${tensorShapeStr(ls)}\nRight shape: ${tensorShapeStr(rs)}`, node.token, mod);
          }
          // Propagate only through certainty: any dynamic side widens.
          const lScl = lt.kind === 'integer' || lt.kind === 'decimal';
          const rScl = rt.kind === 'integer' || rt.kind === 'decimal';
          if (ls && rs) return Types.TTensor(ls.slice());
          if ((ls && rScl) || (rs && lScl)) return Types.TTensor((ls || rs).slice());
          return Types.TTensor(null);
        }
        if (Types.isAny(lt) || Types.isAny(rt)) return Types.TAny();
        if (Types.isNumeric(lt) && Types.isNumeric(rt)) {
          return Types.promoteNumeric(lt, rt);
        }
        throw err('TypeError', `Cannot add ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
      }
      if (op === '-' || op === '*' || op === '/' || op === '%') {
        if (Types.isAny(lt) || Types.isAny(rt)) return op === '/' ? Types.TDec() : Types.TAny();
        // Vexel 3.4 Atlas: element-wise tensor math (see '+' above).
        // (any-typed sides already returned above; only concrete shapes
        // reach here, so propagation below cannot false-positive.)
        if (lt.kind === 'tensor' || rt.kind === 'tensor') {
          if (op === '%') {
            throw err('TypeError', `Operator '%' requires integers, got ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
          }
          const okSide = (t) => t.kind === 'tensor' || t.kind === 'integer' || t.kind === 'decimal';
          if (!okSide(lt) || !okSide(rt)) {
            throw err('TypeError', `Operator '${op}' requires numbers, got ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
          }
          const verb = op === '-' ? 'subtract' : op === '*' ? 'multiply' : 'divide';
          const ls = lt.kind === 'tensor' ? lt.shape : null;
          const rs = rt.kind === 'tensor' ? rt.shape : null;
          if (ls && rs && !tensorShapesEqual(ls, rs)) {
            throw err('ShapeError', `Cannot ${verb} tensors.\nLeft shape: ${tensorShapeStr(ls)}\nRight shape: ${tensorShapeStr(rs)}`, node.token, mod);
          }
          return Types.TTensor(ls && rs ? ls.slice() : (ls || rs || null));
        }
        if (op === '%') {
          if (lt.kind !== 'integer' || rt.kind !== 'integer') {
            throw err('TypeError', `Operator '%' requires integers, got ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
          }
          return Types.TInt();
        }
        if (op === '/') return Types.TDec();
        return Types.promoteNumeric(lt, rt);
      }
      if (op === '==' || op === '!=') {
        // Allow same types, int/decimal mix, any — and null on either side.
        if (Types.isAny(lt) || Types.isAny(rt)) return Types.TBool();
        if (lt.kind === 'null' || rt.kind === 'null') return Types.TBool();
        if (lt.kind !== rt.kind) {
          if (!((lt.kind === 'integer' && rt.kind === 'decimal') || (lt.kind === 'decimal' && rt.kind === 'integer'))) {
            throw err('TypeError', `Cannot compare ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
          }
        }
        return Types.TBool();
      }
      if (op === '>' || op === '<' || op === '>=' || op === '<=') {
        if (Types.isAny(lt) || Types.isAny(rt)) return Types.TBool();
        if (!Types.isNumeric(lt) || !Types.isNumeric(rt)) {
          throw err('TypeError', `Operator '${op}' requires numbers, got ${Types.typeName(lt)} and ${Types.typeName(rt)}.`, node.token, mod);
        }
        return Types.TBool();
      }
      if (op === 'and' || op === 'or') {
        if (!Types.isAny(lt) && lt.kind !== 'boolean') {
          throw err('TypeError', `Operator '${op}' requires booleans, got ${Types.typeName(lt)}.`, node.token, mod);
        }
        if (!Types.isAny(rt) && rt.kind !== 'boolean') {
          throw err('TypeError', `Operator '${op}' requires booleans, got ${Types.typeName(rt)}.`, node.token, mod);
        }
        return Types.TBool();
      }
      throw err('SyntaxError', `Unknown operator '${op}'.`, node.token, mod);
    }
    case 'UnaryExpr': {
      if (node.expr.type === 'VarRef' && nullOriginToken(node.expr.name, ctx)) {
        nullUseError(node.expr.name, node.expr.token || node.token, mod, ctx);
      }
      const t = inferExpr(node.expr, ctx);
      if (node.op === 'not') {
        if (!Types.isAny(t) && t.kind !== 'boolean') {
          throw err('TypeError', `Operator 'not' requires a boolean, got ${Types.typeName(t)}.`, node.token, mod);
        }
        return Types.TBool();
      }
      if (node.op === '-') {
        if (!Types.isAny(t) && !Types.isNumeric(t)) {
          throw err('TypeError', `Unary '-' requires a number, got ${Types.typeName(t)}.`, node.token, mod);
        }
        if (Types.isAny(t)) return Types.TAny();
        return t.kind === 'decimal' ? Types.TDec() : Types.TInt();
      }
      throw err('SyntaxError', `Unknown unary operator '${node.op}'.`, node.token, mod);
    }
    case 'CallExpr': {
      return inferCall(node, ctx);
    }
    case 'FieldAccess': {
      return inferFieldAccess(node, ctx, false);
    }
    case 'IndexAccess': {
      // Vexel 3.4 Atlas constructors: tensor [...] / zeros [...] /
      // ones [...] (brackets bind before call detection). Only when the
      // name is otherwise undefined — user definitions keep working.
      if (node.object.type === 'VarRef' && ATLAS_CTOR_NAMES.includes(node.object.name) &&
          !atlasNameShadowed(node.object.name, ctx)) {
        return inferTensorCons(node, ctx);
      }
      // Vexel 3.4 Atlas: `random [...]` without tensor is a shape error
      // with guidance (the form is random tensor [4,4]).
      if (node.object.type === 'VarRef' && node.object.name === 'random' &&
          !atlasNameShadowed('random', ctx)) {
        throw err('TypeError', `random needs a shape, e.g. random tensor [4,4].`, node.token, mod);
      }
      // Vexel 3.4 Atlas: x.reshape [...] arrives as indexing on a
      // reshape field access.
      if (node.object.type === 'FieldAccess' && node.object.field === 'reshape') {
        return inferTensorReshape(node, ctx);
      }
      if (node.object.type === 'VarRef' && nullOriginToken(node.object.name, ctx)) {
        nullUseError(node.object.name, node.object.token || node.token, mod, ctx);
      }
      const bt = inferExpr(node.object, ctx);
      const it = inferExpr(node.index, ctx);
      if (!Types.isAny(it) && it.kind !== 'integer') {
        throw err('TypeError', `Index must be an integer, got ${Types.typeName(it)}.`, node.index.token || node.token, mod);
      }
      if (bt.kind === 'tensor') {
        // Rank is dynamic (1D gives a number, ND gives a tensor),
        // so indexing a tensor yields any.
        node._resolved = { kind: 'tensor-index' };
        return Types.TAny();
      }
      if (bt.kind === 'list') {
        node._resolved = { kind: 'list-index' };
        return bt.element || Types.TAny();
      }
      if (bt.kind === 'string') {
        node._resolved = { kind: 'string-index' };
        return Types.TStr();
      }
      if (Types.isAny(bt)) {
        node._resolved = { kind: 'any-index' };
        return Types.TAny();
      }
      throw err('TypeError', `Cannot index ${Types.typeName(bt)}.`, node.token, mod);
    }
    case 'TensorCons': {
      // Single element over a user-defined name → plain indexing into
      // their value (`zeros[0]` on your own list keeps working).
      if (node.elements.length === 1 && atlasNameShadowed(node.cons, ctx)) {
        node.type = 'IndexAccess';
        node.object = { type: 'VarRef', name: node.cons, token: node.token };
        node.index = node.elements[0];
        return inferExpr(node, ctx);
      }
      if (node.cons === 'tensor') {
        checkTensorData({ type: 'ListLit', elements: node.elements, token: node.token }, ctx);
        node._resolved = { kind: 'tensor-data' };
        return Types.TTensor(tensorSkeleton({ type: 'ListLit', elements: node.elements }));
      }
      for (const e of node.elements) inferExpr(e, ctx);
      node._resolved = { kind: node.cons === 'zeros' ? 'tensor-zeros' : 'tensor-ones' };
      return Types.TTensor(tensorShapeValues({ type: 'ListLit', elements: node.elements }));
    }
    case 'ListLit': {
      let elem = null;
      for (const e of node.elements) {
        const t = inferExpr(e, ctx);
        if (!elem) elem = t;
        else if (!Types.sameType(elem, t) && !Types.isAny(elem) && !Types.isAny(t)) {
          elem = Types.TAny();
          break;
        } else if (Types.isAny(elem)) {
          // keep any
        } else if (Types.isAny(t)) {
          elem = Types.TAny();
        }
      }
      return Types.TList(elem || Types.TAny());
    }
    case 'LengthOf': {
      if (node.expr.type === 'VarRef' && nullOriginToken(node.expr.name, ctx)) {
        nullUseError(node.expr.name, node.expr.token || node.token, mod, ctx);
      }
      const t = inferExpr(node.expr, ctx);
      if (!Types.isAny(t) && t.kind !== 'string' && t.kind !== 'list') {
        throw err('TypeError', `Length requires a string or list, got ${Types.typeName(t)}.`, node.token, mod);
      }
      node._resolved = { kind: 'length' };
      return Types.TInt();
    }
    case 'NumberOf': {
      if (node.expr.type === 'VarRef' && nullOriginToken(node.expr.name, ctx)) {
        nullUseError(node.expr.name, node.expr.token || node.token, mod, ctx);
      }
      const t = inferExpr(node.expr, ctx);
      if (!Types.isAny(t) && t.kind !== 'string' && t.kind !== 'integer' && t.kind !== 'decimal') {
        throw err('TypeError', `Cannot convert ${Types.typeName(t)} to a number.`, node.token, mod);
      }
      node._resolved = { kind: 'number-of' };
      // The result is integer or decimal depending on the text at runtime.
      return Types.TAny();
    }
    case 'CharAt': {
      if (node.base.type === 'VarRef' && nullOriginToken(node.base.name, ctx)) {
        nullUseError(node.base.name, node.base.token || node.token, mod, ctx);
      }
      const it = inferExpr(node.index, ctx);
      const bt = inferExpr(node.base, ctx);
      if (!Types.isAny(it) && it.kind !== 'integer') {
        throw err('TypeError', `Index must be an integer, got ${Types.typeName(it)}.`, node.index.token || node.token, mod);
      }
      // Vexel 1.1.0: [i] from works on lists too (element access).
      if (bt.kind === 'list') {
        node._resolved = { kind: 'charat' };
        return bt.element || Types.TAny();
      }
      // Unknown (any) base: element type is unknown — defer to runtime,
      // mirroring IndexAccess. (CharAt on a runtime list returns the
      // element; on a string, the character.)
      if (Types.isAny(bt)) {
        node._resolved = { kind: 'charat' };
        return Types.TAny();
      }
      if (bt.kind !== 'string') {
        throw err('TypeError', `Can only get items from a string or list, got ${Types.typeName(bt)}.`, node.token, mod);
      }
      node._resolved = { kind: 'charat' };
      return Types.TStr();
    }
    case 'RandomExpr': {
      const lo = inferExpr(node.low, ctx);
      const hi = inferExpr(node.high, ctx);
      if (!Types.isAny(lo) && lo.kind !== 'integer') {
        throw err('TypeError', `Random bounds must be integers, got ${Types.typeName(lo)}.`, node.low.token || node.token, mod);
      }
      if (!Types.isAny(hi) && hi.kind !== 'integer') {
        throw err('TypeError', `Random bounds must be integers, got ${Types.typeName(hi)}.`, node.high.token || node.token, mod);
      }
      return Types.TInt();
    }
    case 'GpuInfo': {
      // Vexel 3.6 Atlas: gpu available -> boolean, gpu count -> integer,
      // gpu name -> string. Availability is a runtime fact, so the
      // program compiles and runs honestly on machines without a GPU.
      node._resolved = { kind: 'gpu-info', info: node.info };
      if (node.info === 'available') return Types.TBool();
      if (node.info === 'count') return Types.TInt();
      return Types.TStr();
    }
    case 'StructInst': {
      const def = findStructDef(ctx, node.structName);
      if (!def) {
        // Check if struct name is actually something else?
        if (ctx.scope.functions.has(node.structName) || ctx.scope.variables.has(node.structName)) {
          throw err('TypeError', `'${node.structName}' is not a struct.`, node.structToken || node.token, mod);
        }
        throw err('NameError', `Undefined struct '${node.structName}'.`, node.structToken || node.token, mod);
      }
      const given = new Set(node.fields.map((f) => f.name));
      for (const f of def.fields) {
        if (!given.has(f)) {
          throw err('TypeError', `Missing field '${f}' in ${node.structName} instantiation.`, node.token, mod);
        }
      }
      for (const f of node.fields) {
        if (!def.fields.includes(f.name)) {
          throw err('TypeError', `Struct ${node.structName} has no field '${f.name}'.`, f.token, mod);
        }
        inferExpr(f.value, ctx);
      }
      // Build fieldTypes from values
      const fieldTypes = {};
      for (const f of node.fields) {
        // Re-infer? Already inferred; infer again to get type (cheap)
        fieldTypes[f.name] = inferExpr(f.value, ctx);
      }
      node._resolved = { kind: 'struct-inst', structName: node.structName };
      return Types.TStruct(node.structName, fieldTypes);
    }
    default:
      throw err('SyntaxError', `Unknown expression '${node.type}'.`, node.token, mod);
  }
}

// ================= Vexel 3.4 Atlas (tensor type) =================
// Tensors are constructed contextually (no new keywords), mirroring
// how `ask`/`confirm` resolve: a user definition always wins, so
// existing programs keep working.

const ATLAS_CTOR_NAMES = ['tensor', 'zeros', 'ones'];

// Static skeleton shapes: lengths of literal nesting (values may be
// dynamic — only the structure must be literal). Null means unknown;
// the runtime always revalidates, so static checks only fire on
// certain mismatches and can never false-positive.
function tensorSkeleton(node) {
  if (!node || node.type !== 'ListLit') return null;
  if (node.elements.length === 0) return [0];
  if (node.elements[0].type !== 'ListLit') return [node.elements.length];
  const sub = tensorSkeleton(node.elements[0]);
  if (sub === null) return null;
  return [node.elements.length].concat(sub);
}

function tensorDataShape(node) {
  if (!node) return null;
  if (node.type === 'IntLit' || node.type === 'FloatLit') return [];
  if (node.type === 'ListLit') return tensorSkeleton(node);
  return null;
}

// Shape-list literal values (zeros/ones/random/reshape targets).
// Null unless every element is a non-negative integer literal.
function tensorShapeValues(node) {
  if (!node || node.type !== 'ListLit') return null;
  const out = [];
  for (const e of node.elements) {
    if (e.type !== 'IntLit') return null;
    const v = Number(e.value);
    if (v < 0) return null;
    out.push(v);
  }
  return out;
}

function tensorShapeProduct(s) {
  let p = 1;
  for (const d of s) p *= d;
  return p;
}

function tensorShapesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const tensorShapeStr = (s) => '[' + s.join(',') + ']';

// Merge on reassignment: certainty only survives agreement, so
// branches that reshape a variable widen it back to unknown.
function mergedTensorShape(existing, incoming) {
  const s1 = (existing && existing.kind === 'tensor') ? existing.shape : null;
  const s2 = (incoming && incoming.kind === 'tensor') ? incoming.shape : null;
  if (s1 && s2) return tensorShapesEqual(s1, s2) ? s1 : null;
  return s2 || null;
}
const ATLAS_TENSOR_MEMBERS = {
  shape: 'list', rank: 'int', size: 'int', dtype: 'string', device: 'string',
  transpose: 'tensor', flatten: 'tensor',
  sum: 'dual', mean: 'dual', max: 'decimal', min: 'decimal',
  // Vexel 3.5 Atlas autograd: grad is a tensor once backward runs,
  // null before that; backward/zero_grad run for effect (null);
  // detach returns a fresh untracked tensor.
  grad: 'any', backward: 'null', zero_grad: 'null', detach: 'tensor',
};

// ===== Atlas v0.5: pretrained Model objects =====
// The shape of `m.info` / `model info <path>` (computed at runtime).
const ATLAS_MODEL_INFO_FIELDS = {
  path: Types.TStr(), name: Types.TStr(), arch: Types.TStr(),
  layers: Types.TInt(), parameters: Types.TInt(),
  weights: Types.TBool(), format_version: Types.TInt(),
};

// Members that read a Model without side effects. info/eval/train also
// hijack `any` bases (runtime falls back to plain field access for
// non-Model values, so hijacked names on user structs keep working).
const ATLAS_MODEL_READ_MEMBERS = { mode: 'string', path: 'string', parameters: 'list', configuration: 'any', info: 'info' };

// True when the user defined this name (variable, function, module):
// then Atlas stays out of the way and normal rules apply.
function atlasNameShadowed(name, ctx) {
  const { scope } = ctx;
  if (ctx.locals && ctx.locals.has(name)) return true;
  if (ctx.outerLocals && ctx.outerLocals.has(name)) return true;
  if (scope.variables.has(name)) return true;
  if (scope.functions.has(name)) return true;
  if (isModuleName(scope, name)) return true;
  return false;
}

// Validate tensor literal data: nested lists of numbers (literals or
// numeric/any expressions), or a scalar number, or a list value to
// convert. Infers every sub-expression for codegen.
function checkTensorData(node, ctx) {
  const { mod } = ctx;
  const bad = (n) => {
    throw err('TypeError', `Tensor data must be numbers, got ${Types.typeName(inferExpr(n, ctx))}.`, (n && n.token) || (node && node.token) || null, mod);
  };
  const walk = (n) => {
    if (!n) throw err('SyntaxError', 'Missing tensor data.', null, mod);
    if (n.type === 'ListLit') {
      for (const e of n.elements) walk(e);
      return;
    }
    if (n.type === 'IntLit' || n.type === 'FloatLit') {
      inferExpr(n, ctx);
      return;
    }
    const t = inferExpr(n, ctx);
    if (t.kind === 'integer' || t.kind === 'decimal' || t.kind === 'list' || Types.isAny(t)) return;
    throw err('TypeError', `Tensor data must be numbers, got ${Types.typeName(t)}.`, n.token || node.token, mod);
  };
  walk(node);
}

// tensor [...] / zeros [...] / ones [...] arrive as IndexAccess
// (brackets bind before call detection). Returns tensor type.
function inferTensorCons(node, ctx) {
  const { mod } = ctx;
  const name = node.object.name;
  const arg = node.index;
  if (name === 'tensor') {
    checkTensorData(arg, ctx);
    node._resolved = { kind: 'tensor-data' };
    return Types.TTensor(tensorDataShape(arg));
  }
  const st = inferExpr(arg, ctx);
  if (!Types.isAny(st) && st.kind !== 'list') {
    throw err('TypeError', `\`${name}\` needs a shape list, e.g. ${name} [3,3].`, arg.token || node.token, mod);
  }
  node._resolved = { kind: name === 'zeros' ? 'tensor-zeros' : 'tensor-ones' };
  return Types.TTensor(tensorShapeValues(arg));
}

// x.reshape [...] arrives as IndexAccess on a reshape field.
function inferTensorReshape(node, ctx) {
  const { mod } = ctx;
  const baseT = inferExpr(node.object.object, ctx);
  if (!Types.isAny(baseT) && baseT.kind !== 'tensor') {
    throw err('TypeError', `Only a tensor takes reshape, got ${Types.typeName(baseT)}.`, node.object.token || node.token, mod);
  }
  // Postfix brackets hold one expression: `x.reshape [4]` arrives with
  // an IntLit index (a single dimension), `x.reshape [2,3]` with a list.
  const baseShape = baseT.kind === 'tensor' ? baseT.shape : null;
  if (node.index.type === 'IntLit') {
    const dim = Number(node.index.value);
    node._resolved = { kind: 'tensor-reshape' };
    if (baseShape && dim >= 0) {
      if (tensorShapeProduct(baseShape) === dim) {
        return Types.TTensor([dim]);
      }
      throw err('ShapeError', `Cannot reshape ${tensorShapeProduct(baseShape)} elements into shape [${dim}].`, node.token, mod);
    }
    return Types.TTensor(null);
  }
  const st = inferExpr(node.index, ctx);
  if (!Types.isAny(st) && st.kind !== 'list' && st.kind !== 'integer') {
    throw err('TypeError', `reshape needs a shape list, e.g. x.reshape [4].`, node.index.token || node.token, mod);
  }
  node._resolved = { kind: 'tensor-reshape' };
  if (baseShape && node.index.type === 'ListLit') {
    const want = tensorShapeValues(node.index);
    if (want && tensorShapeProduct(baseShape) === tensorShapeProduct(want)) {
      return Types.TTensor(want);
    }
    if (want) {
      throw err('ShapeError', `Cannot reshape ${tensorShapeProduct(baseShape)} elements into shape ${tensorShapeStr(want)}.`, node.token, mod);
    }
  }
  return Types.TTensor(null);
}

function inferCall(node, ctx) {
  const { scope, mod } = ctx;
  const callee = node.callee;
  // Vexel 3.4 Atlas builtins (user definitions win — see atlasNameShadowed).
  // Vexel 3.5 adds relu/sigmoid/tanh the same way.
  if (callee.type === 'VarRef' && !atlasNameShadowed(callee.name, ctx)) {
    if (callee.name === 'relu' || callee.name === 'sigmoid' || callee.name === 'tanh') {
      if (node.args.length !== 1) {
        throw err('TypeError', `\`${callee.name}\` needs one tensor, e.g. ${callee.name} x.`, node.token, mod);
      }
      const at = inferExpr(node.args[0], ctx);
      if (!Types.isAny(at) && at.kind !== 'tensor') {
        throw err('TypeError', `\`${callee.name}\` needs a tensor, got ${Types.typeName(at)}.`, node.args[0].token || node.token, mod);
      }
      callee._resolved = { kind: 'tensor-builtin', name: callee.name };
      node._resolved = { kind: 'tensor-activation', name: callee.name };
      return Types.TTensor(at.kind === 'tensor' ? at.shape : null);
    }
    if (callee.name === 'tensor') {
      if (node.args.length !== 1) {
        throw err('TypeError', `tensor needs one value, e.g. tensor [1,2,3] or tensor 5.`, node.token, mod);
      }
      checkTensorData(node.args[0], ctx);
      callee._resolved = { kind: 'tensor-builtin', name: 'tensor' };
      node._resolved = { kind: 'tensor-scalar' };
      return Types.TTensor(tensorDataShape(node.args[0]));
    }
    if (callee.name === 'zeros' || callee.name === 'ones') {
      throw err('TypeError', `\`${callee.name}\` needs a shape list, e.g. ${callee.name} [3,3].`, node.token, mod);
    }
    if (callee.name === 'random') {
      const a0 = node.args[0];
      // `random tensor [...]` parses the bracket as TensorCons.
      if (node.args.length === 1 && a0 && a0.type === 'TensorCons' &&
          a0.cons === 'tensor' && !atlasNameShadowed('tensor', ctx)) {
        for (const e of a0.elements) inferExpr(e, ctx);
        callee._resolved = { kind: 'tensor-builtin', name: 'random' };
        node._resolved = { kind: 'random-tensor' };
        return Types.TTensor(tensorShapeValues({ type: 'ListLit', elements: a0.elements }));
      }
      throw err('TypeError', `random needs a shape, e.g. random tensor [4,4].`, node.token, mod);
    }
  }
  // Infer args first (for errors inside)
  const argTypes = node.args.map((a) => inferExpr(a, ctx));

  if (callee.type === 'VarRef') {
    const name = callee.name;
    // Vexel 2.0: `find "id"` looks up a UI element unless the user
    // defined their own function called find.
    if (name === 'find' && !scope.functions.has(name)) {
      if (argTypes.length !== 1) {
        throw err('UIError', `find needs one id string, e.g. find "startButton".`, node.token, mod);
      }
      if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'string') {
        throw err('UIError', `UI id must be a string, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
      }
      callee._resolved = { kind: 'find' };
      node._resolved = { kind: 'find-call' };
      return Types.TAny();
    }
    // Vexel 1.1.0: `ask "..."` is a confirmation dialog unless the user
    // defined their own function called ask.
    if (name === 'ask' && !scope.functions.has(name)) {      if (argTypes.length !== 1) {
        throw err('UIError', `ask needs one prompt string, e.g. ask "Are you sure?".`, node.token, mod);
      }
      if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'string') {
        throw err('UIError', `Dialog prompt must be a string, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
      }
      callee._resolved = { kind: 'ask' };
      node._resolved = { kind: 'ask-call' };
      return Types.TBool();
    }
    // Vexel 3.0 Praxis: `confirm "..."` is a Yes/No dialog unless the
    // user defined their own function called confirm.
    if (name === 'confirm' && !scope.functions.has(name)) {
      requireHasWindow(ctx, node.token);
      if (argTypes.length !== 1) {
        throw err('UIError', `confirm needs one prompt string, e.g. confirm "Delete this file?".`, node.token, mod);
      }
      if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'string') {
        throw err('UIError', `Dialog prompt must be a string, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
      }
      callee._resolved = { kind: 'confirm' };
      node._resolved = { kind: 'confirm-call' };
      return Types.TBool();
    }
    // Vexel 3.0 Praxis: `prompt "..."` asks for text unless the user
    // defined their own function called prompt ("" means cancelled).
    if (name === 'prompt' && !scope.functions.has(name)) {
      requireHasWindow(ctx, node.token);
      if (argTypes.length !== 1) {
        throw err('UIError', `prompt needs one prompt string, e.g. prompt "Enter your name".`, node.token, mod);
      }
      if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'string') {
        throw err('UIError', `Dialog prompt must be a string, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
      }
      callee._resolved = { kind: 'prompt' };
      node._resolved = { kind: 'prompt-call' };
      return Types.TStr();
    }
    // Vexel 2.2.1: `process "exe", "args"...` launches a program unless
    // the user defined their own function called process. Returns a
    // handle ({ running, exit, stdout, stderr }) polled like a task.
    if (name === 'process' && !scope.functions.has(name)) {
      requireHasWindow(ctx, node.token);
      if (argTypes.length < 1) {
        throw err('UIError', `process needs a program, e.g. process "cmd.exe", "/c", "echo hi".`, node.token, mod);
      }
      node.args.forEach((a, i) => {
        if (!Types.isAny(argTypes[i]) && argTypes[i].kind !== 'string') {
          throw err('TypeError', `process argument ${i + 1} must be a string, got ${Types.typeName(argTypes[i])}.`, a.token || node.token, mod);
        }
      });
      callee._resolved = { kind: 'proc' };
      node._resolved = { kind: 'proc-start' };
      return Types.TAny();
    }
    if (scope.functions.has(name)) {
      const fn = scope.functions.get(name);
      if (argTypes.length !== fn.params.length) {
        throw err('TypeError', `Function '${name}' expects ${fn.params.length} argument(s) but got ${argTypes.length}.`, node.token, mod);
      }
      callee._resolved = { kind: 'func', name, module: scope.name };
      node._resolved = { kind: 'func-call', name, module: scope.name };
      return Types.TAny();
    }
    // List method called without object? No.
    if (scope.variables.has(name)) {
      throw err('TypeError', `'${name}' is a variable, not a function.`, callee.token, mod);
    }
    throw err('NameError', `Undefined function '${name}'.`, callee.token, mod);
  }

  if (callee.type === 'FieldAccess') {
    // Module function? List method?
    const obj = callee.object;
    const field = callee.field;
    if (obj.type === 'VarRef' && isModuleName(scope, obj.name)) {
      const modScope = getImportedScope(scope, obj.name, ctx.scopes);
      if (!modScope) throw err('ModuleError', `Unknown module '${obj.name}'.`, obj.token, mod);
      if (modScope.functions.has(field)) {
        const fn = modScope.functions.get(field);
        if (!fn.isPublic) {
          throw err('VisibilityError', `'${field}' is private in module '${obj.name}'.`, callee.fieldToken || callee.token, mod);
        }
        if (argTypes.length !== fn.params.length) {
          throw err('TypeError', `Function '${obj.name}.${field}' expects ${fn.params.length} argument(s) but got ${argTypes.length}.`, node.token, mod);
        }
        callee._resolved = { kind: 'module-func', moduleName: obj.name, name: field };
        node._resolved = { kind: 'module-func-call', moduleName: obj.name, name: field };
        return Types.TAny();
      }
      if (modScope.variables.has(field)) {
        throw err('TypeError', `'${obj.name}.${field}' is a variable, not a function.`, callee.token, mod);
      }
      // Check private?
      // If field exists but private, report visibility
      // Search all (including private) — modScope.functions includes private too, handled above.
      throw err('NameError', `Module '${obj.name}' has no public member '${field}'.`, callee.fieldToken || callee.token, mod);
    }
    // Atlas v0.5: model methods — m.forward <tensor> (value) and the
    // bare effect calls m.eval / m.train. A model-typed base gives
    // precise result types; an `any` base defers to runtime (TAny).
    if (field === 'forward' || field === 'eval' || field === 'train') {
      const baseType = inferExpr(obj, ctx);
      if (baseType.kind === 'model' || Types.isAny(baseType)) {
        const isModel = baseType.kind === 'model';
        if (field === 'forward') {
          if (argTypes.length !== 1) {
            throw err('TypeError', `forward expects 1 input tensor but got ${argTypes.length}.`, node.token, mod);
          }
          if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'tensor') {
            throw err('TypeError', `forward needs a tensor input, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
          }
          callee._resolved = { kind: 'model-forward' };
          node._resolved = { kind: 'model-forward' };
          return isModel ? Types.TTensor(null) : Types.TAny();
        }
        if (argTypes.length !== 0) {
          throw err('TypeError', `'${field}' takes no arguments — write it bare, e.g. m.${field}.`, node.token, mod);
        }
        callee._resolved = { kind: 'model-member-call', member: field };
        node._resolved = { kind: 'model-member-call', member: field };
        return isModel ? Types.TNull() : Types.TAny();
      }
      // Not a model and not any — fall through to the generic error.
    }
    // Vexel 1.1.0: UI element adds/removes (dropdown/list/menu/tabs/tree).
    if (field === 'add' || field === 'remove') {
      const baseType = inferExpr(obj, ctx);
      if (baseType.kind === 'ui') {
        const bk = baseType.uiKind;
        if (field === 'add') {
          if (argTypes.length !== 1) {
            throw err('UIError', `UI add expects 1 argument but got ${argTypes.length}.`, node.token, mod);
          }
          if (bk === 'dropdown' || bk === 'listbox') {
            if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'string') {
              throw err('UIError', `Can only add text items to ${bk}, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
            }
            callee._resolved = { kind: 'ui-add-item', uiKind: bk };
            node._resolved = { kind: 'ui-add-item', uiKind: bk };
            node._voidUI = true;
            return Types.TVoid();
          }
          if (bk === 'menu' || bk === 'tabbar' || bk === 'tree' || bk === 'treenode' || bk === 'contextmenu') {
            if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'string') {
              throw err('UIError', `Can only add text to ${bk}, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
            }
            const ret = bk === 'menu' ? 'menuitem' : bk === 'tabbar' ? 'tabpage' : bk === 'contextmenu' ? 'menuitem' : 'treenode';
            callee._resolved = { kind: 'ui-add-named', uiKind: bk, ret };
            node._resolved = { kind: 'ui-add-named', uiKind: bk, ret };
            return Types.TUi(ret);
          }
          if (bk === 'table') {
            throw err('UIError', `A table takes columns and rows: table.add column "Name" or table.add row ["Zen", 25].`, callee.token, mod);
          }
          if (bk === 'toolbar') {
            throw err('UIError', `A toolbar takes buttons: toolbar.add a button titled "Save".`, callee.token, mod);
          }
          throw err('UIError', `A ${bk} does not take adds like this.`, callee.token, mod);
        }
        // remove
        if (bk === 'dropdown' || bk === 'listbox') {
          if (argTypes.length !== 1) {
            throw err('UIError', `Remove expects 1 index argument but got ${argTypes.length}.`, node.token, mod);
          }
          if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'integer') {
            throw err('UIError', `Remove needs an integer index, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
          }
          callee._resolved = { kind: 'ui-remove', uiKind: bk };
          node._resolved = { kind: 'ui-remove', uiKind: bk };
          node._voidUI = true;
          return Types.TVoid();
        }
        throw err('UIError', `A ${bk} does not support remove.`, callee.token, mod);
      }
      if (baseType.kind === 'list' || Types.isAny(baseType)) {
        // Vexel 2.0: dynamic handles resolve add/remove at runtime.
        if (Types.isAny(baseType) && baseType.kind !== 'list') {
          if (argTypes.length !== 1) {
            throw err('TypeError', `Add/remove expects 1 argument but got ${argTypes.length}.`, node.token, mod);
          }
          callee._resolved = { kind: 'any-addremove', method: field };
          node._resolved = { kind: 'any-addremove', method: field };
          return Types.TVoid();
        }
        if (field === 'add') {
          if (argTypes.length !== 1) {
            throw err('TypeError', `List add expects 1 argument but got ${argTypes.length}.`, node.token, mod);
          }
          callee._resolved = { kind: 'list-add' };
          node._resolved = { kind: 'list-add' };
          return Types.TVoid();
        } else {
          if (argTypes.length !== 1) {
            throw err('TypeError', `List remove expects 1 argument but got ${argTypes.length}.`, node.token, mod);
          }
          if (!Types.isAny(argTypes[0]) && argTypes[0].kind !== 'integer') {
            throw err('TypeError', `List remove requires an integer index, got ${Types.typeName(argTypes[0])}.`, node.args[0].token || node.token, mod);
          }
          callee._resolved = { kind: 'list-remove' };
          node._resolved = { kind: 'list-remove' };
          return Types.TVoid();
        }
      }
      // If base is not list, fall through to error
      throw err('TypeError', `Cannot call '${field}' on ${Types.typeName(baseType)}.`, callee.token, mod);
    }
    // Other field calls: not supported
    throw err('TypeError', `'${field}' is not a function.`, callee.token, mod);
  }

  throw err('TypeError', 'Invalid function call target.', callee.token || node.token, mod);
}

function inferFieldAccess(node, ctx, isCall) {
  const { scope, mod } = ctx;
  const obj = node.object;
  const field = node.field;

  // Module member? object is VarRef matching import
  if (obj.type === 'VarRef' && isModuleName(scope, obj.name)) {
    const modScope = getImportedScope(scope, obj.name, ctx.scopes);
    if (!modScope) throw err('ModuleError', `Unknown module '${obj.name}'.`, obj.token, mod);
    if (modScope.variables.has(field)) {
      const info = modScope.variables.get(field);
      if (!info.isPublic) {
        throw err('VisibilityError', `'${field}' is private in module '${obj.name}'.`, node.fieldToken || node.token, mod);
      }
      node._resolved = { kind: 'module-var', moduleName: obj.name, name: field };
      return info.type;
    }
    if (modScope.functions.has(field)) {
      const fn = modScope.functions.get(field);
      if (!fn.isPublic) {
        throw err('VisibilityError', `'${field}' is private in module '${obj.name}'.`, node.fieldToken || node.token, mod);
      }
      if (fn.params.length === 0) {
        node._resolved = { kind: 'module-func-zero', moduleName: obj.name, name: field };
        return Types.TAny();
      }
      throw err('TypeError', `Function '${obj.name}.${field}' expects ${fn.params.length} argument(s). Use ${obj.name}.${field} <args> to call it.`, node.token, mod);
    }
    if (modScope.structs.has(field)) {
      throw err('TypeError', `Struct '${obj.name}.${field}' cannot be used as a value.`, node.token, mod);
    }
    // Vexel 2.9: public enums are types reached as module.Enum.
    if (modScope.enums && modScope.enums.has(field)) {
      const info = modScope.enums.get(field);
      if (!info.isPublic) {
        throw err('VisibilityError', `'${field}' is private in module '${obj.name}'.`, node.fieldToken || node.token, mod);
      }
      node._resolved = { kind: 'module-enum', moduleName: obj.name, name: field };
      return Types.TEnum(field, info.values);
    }
    throw err('NameError', `Module '${obj.name}' has no public member '${field}'.`, node.fieldToken || node.token, mod);
  }
  // Vexel 2.9: Enum.value — a local enum type used as a value source.
  // (A local/param/global variable of the same name shadows the type,
  // mirroring normal lookup priority.)
  if (obj.type === 'VarRef' && scope.enums.has(obj.name) &&
      !(ctx.locals && ctx.locals.has(obj.name)) &&
      !(ctx.outerLocals && ctx.outerLocals.has(obj.name)) &&
      !scope.variables.has(obj.name)) {
    const info = scope.enums.get(obj.name);
    if (!info.values.includes(field)) {
      throw err('TypeError', `Enum '${obj.name}' has no value '${field}'. Available: ${info.values.join(', ')}.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'enum-lit', enumName: obj.name, value: field };
    return Types.TEnum(obj.name, info.values);
  }

  // Vexel 2.0: `event.x` / `event.key` — validated against the handler kind.
  if (obj.type === 'EventRef') {
    const shadow = (ctx.locals && ctx.locals.has('event')) || (ctx.outerLocals && ctx.outerLocals.has('event')) || scope.variables.has('event');
    if (shadow) {
      obj.type = 'VarRef';
      obj.name = 'event';
    } else {
    if (!ctx.inEvent) {
      throw err('NameError', `'event' is only available inside an event handler.`, node.token, mod);
    }
    const fields = uiEventFieldSet(ctx.inEvent);
    if (!Object.prototype.hasOwnProperty.call(fields, field)) {
      throw err('UIError', `This event has no '${field}'. Available: ${Object.keys(fields).join(', ')}.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'event-field', field, event: ctx.inEvent };
    const ft = fields[field];
    if (ft === 'string') return Types.TStr();
    if (ft === 'int') return Types.TInt();
    return Types.TAny();
    }
  }
  // Vexel 2.0: `error.message` etc. — the error object in catch blocks.
  if (obj.type === 'ErrorRef') {
    const et = { message: 'string', type: 'string', file: 'string', line: 'int', column: 'int' };
    if (!Object.prototype.hasOwnProperty.call(et, field)) {
      throw err('TypeError', `Error has no '${field}'. Available: message, type, file, line, column.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'error-field', field };
    const ft = et[field];
    if (ft === 'string') return Types.TStr();
    return Types.TInt();
  }
  // Vexel 2.9: reading through a definitely-null base is a static error.
  if (obj.type === 'VarRef' && nullOriginToken(obj.name, ctx)) {
    nullUseError(obj.name, obj.token || node.token, mod, ctx);
  }
  // Otherwise infer base type
  const baseType = inferExpr(obj, ctx);
  // Vexel 2.9: module.Enum.value — chained access on a module enum type
  // (the inner access resolves to module-enum during base inference).
  if (obj.type === 'FieldAccess' && obj._resolved && obj._resolved.kind === 'module-enum') {
    const modScope = getImportedScope(scope, obj._resolved.moduleName, ctx.scopes);
    const info = modScope && modScope.enums ? modScope.enums.get(obj._resolved.name) : null;
    if (!info || !info.values.includes(field)) {
      const have = info ? info.values.join(', ') : 'none';
      throw err('TypeError', `Enum '${obj._resolved.name}' has no value '${field}'. Available: ${have}.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'enum-lit', enumName: obj._resolved.name, value: field };
    return Types.TEnum(obj._resolved.name, info.values);
  }
  // Anonymous objects (Vexel 2.0 `{...}`) validate against inline fields.
  if (baseType.kind === 'struct' && !baseType.structName) {
    const known = (baseType.fieldTypes && baseType.fieldTypes[field]) || null;
    if (!known) {
      throw err('TypeError', `Object has no field '${field}'.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'struct-field', structName: null };
    return known;
  }
  // Vexel 3.4 Atlas: tensor members (shape/rank/size/dtype/device,
  // transpose/flatten/reductions). reshape takes [...] so it arrives
  // as indexing; a bare x.reshape gets guidance here.
  if (baseType.kind === 'tensor') {
    if (field === 'reshape') {
      throw err('TypeError', `reshape needs a shape, e.g. x.reshape [4].`, node.fieldToken || node.token, mod);
    }
    const mt = ATLAS_TENSOR_MEMBERS[field];
    if (!mt) {
      throw err('TypeError', `Tensor has no '${field}'. Available: shape, rank, size, dtype, device, transpose, reshape, flatten, sum, mean, max, min, grad, backward, zero_grad, detach.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'tensor-member', member: field };
    if (mt === 'list') return Types.TList(Types.TInt());
    if (mt === 'int') return Types.TInt();
    if (mt === 'string') return Types.TStr();
    if (mt === 'any') return Types.TAny();
    if (mt === 'null') return Types.TNull();
    // Vexel 3.5: reductions are tensor-or-number at runtime — a plain
    // Float when nothing tracks, a scalar tensor when it does. The
    // static type stays open so both `loss.backward` and `print loss`
    // type-check; the runtime picks the real one.
    if (mt === 'dual') return Types.TAny();
    if (mt === 'tensor') {
      const bs = baseType.shape || null;
      if (field === 'transpose' && bs) return Types.TTensor(bs.slice().reverse());
      if (field === 'flatten' && bs) return Types.TTensor([tensorShapeProduct(bs)]);
      if (field === 'detach' && bs) return Types.TTensor(bs.slice());
      return Types.TTensor(null);
    }
    return Types.TDec();
  }
  // Atlas v0.5: Model members (mode/path/configuration/parameters/info
  // read; eval/train switch mode for effect; bare forward gets
  // guidance because it needs an input tensor).
  if (baseType.kind === 'model') {
    if (field === 'forward') {
      throw err('TypeError', `forward needs an input tensor, e.g. m.forward x.`, node.fieldToken || node.token, mod);
    }
    if (field === 'eval' || field === 'train') {
      node._resolved = { kind: 'model-member', member: field };
      return Types.TNull();
    }
    const mt = ATLAS_MODEL_READ_MEMBERS[field];
    if (!mt) {
      throw err('TypeError', `Model has no '${field}'. Available: mode, path, configuration, parameters, info, eval, train, forward.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'model-member', member: field };
    if (mt === 'string') return Types.TStr();
    if (mt === 'list') return Types.TList(Types.TTensor(null));
    if (mt === 'info') return Types.TStruct(null, ATLAS_MODEL_INFO_FIELDS);
    return Types.TAny();
  }
  // Vexel 1.1.0: UI property reads and zero-argument UI method calls.
  if (baseType.kind === 'ui') {
    const kind = baseType.uiKind;
    const methods = UI_METHODS[kind] || [];
    if (methods.includes(field)) {
      node._resolved = { kind: 'ui-method', uiKind: kind, method: field };
      node._voidUI = true;
      return Types.TVoid();
    }
    const decl = lookupUIProp(kind, field, node.fieldToken || node.token, mod, false);
    node._resolved = { kind: 'ui-prop', uiKind: kind, prop: field };
    if (decl.t === 'string') return Types.TStr();
    if (decl.t === 'int') return Types.TInt();
    if (decl.t === 'bool') return Types.TBool();
    if (decl.t === 'list') return Types.TList(Types.TStr());
    return Types.TDec();
  }
  if (baseType.kind === 'struct') {
    const def = findStructDef(ctx, baseType.structName);
    if (!def) throw err('TypeError', `Unknown struct type '${baseType.structName}'.`, node.token, mod);
    if (!def.fields.includes(field)) {
      throw err('TypeError', `${Types.typeName(baseType)} has no field '${field}'.`, node.fieldToken || node.token, mod);
    }
    node._resolved = { kind: 'struct-field', structName: baseType.structName };
    if (baseType.fieldTypes && baseType.fieldTypes[field]) return baseType.fieldTypes[field];
    return Types.TAny();
  }
  if ((baseType.kind === 'list' || baseType.kind === 'string') && field === 'length') {
    node._resolved = { kind: 'length-prop' };
    return Types.TInt();
  }
  if (baseType.kind === 'list' && (field === 'add' || field === 'remove')) {
    throw err('TypeError', `List method '${field}' must be called (e.g. names.${field} ...).`, node.token, mod);
  }
  if (baseType.kind === 'integer' || baseType.kind === 'decimal' || baseType.kind === 'boolean' || baseType.kind === 'string') {
    // string.length already handled; other fields invalid
    if (baseType.kind === 'string') {
      throw err('TypeError', `String has no field '${field}'. Did you mean 'length of <var>' or '[i] from <var>'?`, node.fieldToken || node.token, mod);
    }
    const baseName = obj.type === 'VarRef' ? ` '${obj.name}'` : '';
    throw err('TypeError', `${Types.typeName(baseType)}${baseName} has no field '${field}'.`, node.fieldToken || node.token, mod);
  }
  // Vexel 2.2: timer handles (from `timer = every/after ...`).
  // Checked before the generic any-fallback so `timer.cancel`
  // resolves to a real runtime call with a clear error otherwise.
  // Skipped when the name currently holds a UI element or was never
  // declared (those keep their normal UI/undefined-variable errors).
  if (obj.type === 'VarRef' && scope.timerHandles && scope.timerHandles.has(obj.name)) {
    let vt = null;
    if (ctx.locals && ctx.locals.has(obj.name)) vt = ctx.locals.get(obj.name).type;
    else if (ctx.outerLocals && ctx.outerLocals.has(obj.name)) vt = ctx.outerLocals.get(obj.name).type;
    else if (scope.variables.has(obj.name)) vt = scope.variables.get(obj.name).type;
    if (!vt || vt.kind !== 'ui') {
      if (field === 'cancel') {
        node._resolved = { kind: 'timer-cancel' };
        node._voidUI = true;
        return Types.TVoid();
      }
      throw err('UIError', `Timers support cancel (e.g. ${obj.name}.cancel). Unknown timer action '${field}'.`, node.fieldToken || node.token, mod);
    }
  }
  // Vexel 2.2 phase 7: task handles (from `task name { ... }`).
  // Same placement rules as timers: real handles resolve here, UI
  // elements and undeclared names keep their normal errors.
  if (obj.type === 'VarRef' && scope.taskHandles && scope.taskHandles.has(obj.name)) {
    let vt = null;
    if (ctx.locals && ctx.locals.has(obj.name)) vt = ctx.locals.get(obj.name).type;
    else if (ctx.outerLocals && ctx.outerLocals.has(obj.name)) vt = ctx.outerLocals.get(obj.name).type;
    else if (scope.variables.has(obj.name)) vt = scope.variables.get(obj.name).type;
    if (!vt || vt.kind !== 'ui') {
      if (field === 'cancel') {
        node._resolved = { kind: 'task-cancel' };
        node._voidUI = true;
        return Types.TVoid();
      }
      if (field === 'state') {
        node._resolved = { kind: 'task-state' };
        return Types.TStr();
      }
      if (field === 'result') {
        node._resolved = { kind: 'task-result' };
        return Types.TAny();
      }
      if (field === 'error') {
        node._resolved = { kind: 'task-error' };
        return Types.TAny();
      }
      throw err('UIError', `Tasks support cancel, state, result and error (e.g. ${obj.name}.cancel). Unknown task action '${field}'.`, node.fieldToken || node.token, mod);
    }
  }
  // Vexel 2.2.1: process handles (from `p = process "exe", ...`).
  // Only `kill` is a call; running/exit/stdout/stderr read through the
  // generic any-field path with runtime checking.
  if (obj.type === 'VarRef' && scope.procHandles && scope.procHandles.has(obj.name)) {
    let vt = null;
    if (ctx.locals && ctx.locals.has(obj.name)) vt = ctx.locals.get(obj.name).type;
    else if (ctx.outerLocals && ctx.outerLocals.has(obj.name)) vt = ctx.outerLocals.get(obj.name).type;
    else if (scope.variables.has(obj.name)) vt = scope.variables.get(obj.name).type;
    if (!vt || vt.kind !== 'ui') {
      if (field === 'kill') {
        node._resolved = { kind: 'proc-kill' };
        node._voidUI = true;
        return Types.TVoid();
      }
    }
  }
  // Vexel 2.0: known UI method names on dynamic handles resolve late.
  if (Types.isAny(baseType)) {
    // Atlas v0.5: model members also resolve on `any` bases (values
    // from json read, functions of unknown type). Conservative TAny
    // result — precise types only flow from model-typed values. The
    // runtime falls back to plain field access for non-Model structs,
    // so user fields named info/eval/train keep working unchanged.
    if (field === 'info' || field === 'eval' || field === 'train') {
      node._resolved = { kind: 'model-member', member: field, anyFlow: true };
      return Types.TAny();
    }
    const allMethods = {};
    for (const k of Object.keys(UI_METHODS)) {
      for (const m of UI_METHODS[k]) allMethods[m] = true;
    }
    if (allMethods[field]) {
      requireHasWindow(ctx, node.token, 'UI methods');
      node._resolved = { kind: 'ui-method-any', method: field };
      node._voidUI = true;
      return Types.TVoid();
    }
    node._resolved = { kind: 'any-field' };
    return Types.TAny();
  }
  throw err('TypeError', `Cannot access field '${field}' on ${Types.typeName(baseType)}.`, node.token, mod);
}

// ================= Vexel 1.1.0 UI model =================
// Property tables: prop -> { t: 'string'|'int'|'bool'|'decimal', set: bool }.
// `set: false` means read-only. Anything absent is not a property of
// that element (compile-time UI Error).

function P(t, set) {
  return { t, set: set !== false };
}

const UI_PROPS = {
  window: {
    title: P('string'), width: P('int'), height: P('int'), x: P('int'), y: P('int'),
    visible: P('bool'), resizable: P('bool'), fullscreen: P('bool'),
    min_width: P('int'), max_width: P('int'), min_height: P('int'), max_height: P('int'),
    background: P('string'), text_color: P('string'), opacity: P('decimal'),
  },
  button: {
    title: P('string'), text: P('string'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), enabled: P('bool'), visible: P('bool'),
    font: P('string'), font_size: P('int'), bold: P('bool'), italic: P('bool'),
    background: P('string'), text_color: P('string'), opacity: P('decimal'), border: P('bool'),
    border_width: P('int'), border_radius: P('int'), padding: P('int'), margin: P('int'),
    shortcut: P('string'),
  },
  text: {
    text: P('string'), title: P('string'), font: P('string'), font_size: P('int'),
    bold: P('bool'), italic: P('bool'), text_color: P('string'), opacity: P('decimal'), background: P('string'),
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), padding: P('int'), margin: P('int'),
    alignment: P('string'),
  },
  input: {
    text: P('string'), placeholder: P('string'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), enabled: P('bool'), visible: P('bool'), password: P('bool'),
    font: P('string'), font_size: P('int'), bold: P('bool'), italic: P('bool'),
    background: P('string'), text_color: P('string'), opacity: P('decimal'), border: P('bool'),
    border_width: P('int'), padding: P('int'), margin: P('int'),
  },
  output: {
    text: P('string'), width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), font: P('string'), font_size: P('int'),
    bold: P('bool'), italic: P('bool'), background: P('string'), text_color: P('string'), opacity: P('decimal'),
    border: P('bool'), border_width: P('int'), padding: P('int'), margin: P('int'),
  },
  checkbox: {
    checked: P('bool'), enabled: P('bool'), visible: P('bool'), title: P('string'),
    text: P('string'), width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    font: P('string'), font_size: P('int'), bold: P('bool'), italic: P('bool'),
    background: P('string'), text_color: P('string'), opacity: P('decimal'), padding: P('int'), margin: P('int'),
  },
  slider: {
    value: P('int'), minimum: P('int'), maximum: P('int'), step: P('int'),
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    enabled: P('bool'), visible: P('bool'), opacity: P('decimal'),
  },
  progress: {
    value: P('int'), minimum: P('int'), maximum: P('int'),
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), opacity: P('decimal'),
  },
  dropdown: {
    selected: P('string'), selected_index: P('int'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), enabled: P('bool'), visible: P('bool'),
    font: P('string'), font_size: P('int'), background: P('string'), text_color: P('string'), opacity: P('decimal'),
    padding: P('int'), margin: P('int'),
  },
  listbox: {
    selected: P('string'), selected_index: P('int'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), enabled: P('bool'), visible: P('bool'),
    font: P('string'), font_size: P('int'), background: P('string'), text_color: P('string'),
    padding: P('int'), margin: P('int'), multiple: P('bool'), selected_items: P('list', false),
  },
  image: {
    source: P('string'), width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), opacity: P('decimal'),
  },
  menu: {
    title: P('string'), visible: P('bool'), enabled: P('bool'),
    font: P('string'), font_size: P('int'), background: P('string'), text_color: P('string'), opacity: P('decimal'),
  },
  menuitem: {
    title: P('string'), enabled: P('bool'), visible: P('bool'),
    shortcut: P('string'),
  },
  toolbar: {
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), background: P('string'),
  },
  toolbutton: {
    title: P('string'), enabled: P('bool'), visible: P('bool'),
    shortcut: P('string'),
  },
  tabbar: {
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), font: P('string'), font_size: P('int'),
    selected: P('string', false), selected_index: P('int', false),
  },
  tabpage: {
    title: P('string'), visible: P('bool'), enabled: P('bool'), background: P('string'),
    font: P('string'), font_size: P('int'), bold: P('bool'), italic: P('bool'),
    text_color: P('string'), opacity: P('decimal'), padding: P('int'),
  },
  table: {
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), font: P('string'), font_size: P('int'),
    background: P('string'), text_color: P('string'), opacity: P('decimal'),
    selected: P('int'), selected_index: P('int', false),
  },
  tree: {
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), font: P('string'), font_size: P('int'),
    background: P('string'), text_color: P('string'), opacity: P('decimal'), selected: P('string', false),
  },
  treenode: {
    title: P('string'),
  },
  spinner: {
    visible: P('bool'), enabled: P('bool'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), opacity: P('decimal'), anchor: P('string'),
  },
  container: {
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), enabled: P('bool'), background: P('string'),
    font: P('string'), font_size: P('int'), bold: P('bool'), italic: P('bool'),
    text_color: P('string'), opacity: P('decimal'), padding: P('int'), border: P('bool'),
    border_width: P('int'), border_radius: P('int'), alignment: P('string'),
  },
  // Vexel 3.0 Praxis controls.
  switch: {
    title: P('string'), checked: P('bool'), enabled: P('bool'), visible: P('bool'),
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    font_size: P('int'), opacity: P('decimal'),
  },
  radio: {
    title: P('string'), checked: P('bool'), group: P('string'), enabled: P('bool'),
    visible: P('bool'), width: P('int'), height: P('int'), x: P('int'), y: P('int'),
    anchor: P('string'), font_size: P('int'), opacity: P('decimal'),
  },
  numeric: {
    value: P('decimal'), minimum: P('decimal'), maximum: P('decimal'), step: P('decimal'),
    enabled: P('bool'), visible: P('bool'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), font_size: P('int'), opacity: P('decimal'),
  },
  search: {
    text: P('string'), placeholder: P('string'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), enabled: P('bool'), visible: P('bool'),
    font: P('string'), font_size: P('int'), background: P('string'), text_color: P('string'),
    opacity: P('decimal'),
  },
  card: {
    title: P('string'), background: P('string'), width: P('int'), height: P('int'),
    x: P('int'), y: P('int'), anchor: P('string'), visible: P('bool'), enabled: P('bool'),
    border_radius: P('int'), padding: P('int'),
  },
  statusbar: {
    text: P('string'), title: P('string'), visible: P('bool'), enabled: P('bool'),
    background: P('string'), text_color: P('string'), font_size: P('int'),
  },
  separator: {
    width: P('int'), height: P('int'), x: P('int'), y: P('int'), anchor: P('string'),
    visible: P('bool'), background: P('string'), opacity: P('decimal'),
  },
  contextmenu: {
  },
};

const UI_EVENTS = {
  container: ['scroll'],
  window: ['click', 'press', 'release', 'hover', 'enter', 'leave', 'exit', 'focus', 'blur', 'key press', 'key release', 'mouse move', 'mouse down', 'mouse up', 'mouse enter', 'mouse leave', 'resize', 'move', 'close'],
  button: ['click', 'double click', 'press', 'release', 'hover', 'enter', 'leave', 'exit', 'focus', 'blur', 'mouse move', 'mouse down', 'mouse up', 'mouse enter', 'mouse leave'],
  text: ['click', 'double click', 'press', 'release', 'hover', 'enter', 'leave', 'exit', 'focus', 'blur', 'mouse move', 'mouse down', 'mouse up', 'mouse enter', 'mouse leave'],
  image: ['click', 'press', 'release', 'hover', 'enter', 'leave', 'exit', 'focus', 'blur', 'mouse move', 'mouse down', 'mouse up', 'mouse enter', 'mouse leave'],
  toolbutton: ['click', 'double click', 'press', 'release', 'hover', 'enter', 'leave', 'exit', 'focus', 'blur', 'mouse move', 'mouse down', 'mouse up', 'mouse enter', 'mouse leave'],
  menuitem: ['click', 'hover', 'enter', 'leave', 'exit'],
  input: ['change', 'key press', 'key release', 'focus', 'blur', 'click', 'mouse move'],
  checkbox: ['change', 'click', 'focus', 'blur'],
  slider: ['change', 'focus', 'blur'],
  dropdown: ['change', 'focus', 'blur'],
  listbox: ['change', 'focus', 'blur'],
  tree: ['change', 'click', 'focus', 'blur'],
  tabbar: ['change', 'click', 'focus', 'blur'],
  table: ['click', 'change'],
  // Vexel 3.0 Praxis events.
  switch: ['change', 'click', 'focus', 'blur'],
  radio: ['change', 'click', 'focus', 'blur'],
  numeric: ['change', 'focus', 'blur'],
  search: ['change', 'key press', 'key release', 'focus', 'blur', 'click', 'mouse move'],
};

// Event object fields per event family (Vexel 2.0 `event` in handlers).
const UI_EVENT_FAMILIES = {
  key: ['key press', 'key release'],
  change: ['change'],
  plain: ['click', 'focus', 'blur', 'resize', 'move', 'close'],
};
function uiEventFamily(ev) {
  if (UI_EVENT_FAMILIES.key.includes(ev)) return 'key';
  if (ev === 'change') return 'change';
  if (UI_EVENT_FAMILIES.plain.includes(ev)) return 'plain';
  return 'mouse';
}
const UI_EVENT_FIELDS = {
  mouse: { x: 'int', y: 'int', button: 'string', target: 'any' },
  key: { key: 'string', target: 'any' },
  change: { value: 'any', target: 'any' },
  plain: { target: 'any' },
};
function uiEventFieldSet(ev) {
  if (ev === 'click' || ev === 'focus' || ev === 'blur' || ev === 'resize' || ev === 'move' || ev === 'close') return UI_EVENT_FIELDS.plain;
  return UI_EVENT_FIELDS[uiEventFamily(ev)];
}

// Zero-argument UI methods usable as bare statements (window.show, input.clear).
// show/hide/center/focus work on every placeable control (Vexel 3.0 Praxis included).
const UI_SHOW_HIDE = ['button', 'text', 'input', 'output', 'checkbox', 'slider', 'progress', 'dropdown', 'listbox', 'image', 'menu', 'toolbar', 'tabbar', 'tabpage', 'table', 'tree', 'spinner', 'container', 'switch', 'radio', 'numeric', 'search', 'card', 'statusbar', 'separator'];
const UI_METHODS = {
  window: ['show', 'hide', 'close', 'minimize', 'maximize', 'restore', 'center', 'focus'],
  input: ['clear', 'show', 'hide', 'center', 'focus'],
  output: ['clear', 'show', 'hide', 'center', 'focus'],
  listbox: ['clear', 'show', 'hide', 'center', 'focus'],
  dropdown: ['clear', 'show', 'hide', 'center', 'focus'],
  tree: ['clear', 'show', 'hide', 'center', 'focus'],
  table: ['clear', 'show', 'hide', 'center', 'focus'],
};
for (const k of UI_SHOW_HIDE) {
  if (!UI_METHODS[k]) UI_METHODS[k] = [];
  for (const m of ['show', 'hide', 'center', 'focus']) {
    if (!UI_METHODS[k].includes(m)) UI_METHODS[k].push(m);
  }
}
// Vexel 3.0 Praxis: context menus show as popups.
UI_METHODS['contextmenu'] = ['show'];

const UI_WIDGET_TITLES = {
  button: true, text: true, checkbox: true, menu: true, input: true, output: true,
  switch: true, radio: true, search: true, card: true, statusbar: true,
};

const UI_ALIGNMENTS = {
  text: ['left', 'center', 'right'],
  container: ['left', 'center', 'right', 'top', 'middle', 'bottom'],
  tabpage: ['left', 'center', 'right', 'top', 'middle', 'bottom'],
};

const UI_THEMES_BUILTIN = ['dark', 'light'];
const UI_THEME_PROPS = {
  background: 'string', text_color: 'string', font: 'string',
  font_size: 'int', bold: 'bool', italic: 'bool',
};

// Vexel 2.0 reusable style objects (button.style = main_button).
const UI_STYLE_PROPS = {
  background: 'string', text_color: 'string', font: 'string',
  font_size: 'int', bold: 'bool', italic: 'bool',
  border: 'bool', border_width: 'int', border_radius: 'int',
  padding: 'int', margin: 'int',
};

const KNOWN_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
  'gray', 'grey', 'pink', 'brown', 'cyan', 'magenta', 'lime', 'navy',
  'teal', 'silver', 'gold', 'beige', 'ivory', 'transparent',
  'dark', 'light', 'darkgray', 'darkgrey', 'lightgray', 'lightgrey',
  'darkred', 'darkgreen', 'darkblue', 'lightblue', 'lightgreen',
]);

function isHexColor(s) {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}

function checkUIColorLiteral(value, token, mod) {
  if (typeof value !== 'string') return;
  const low = value.toLowerCase();
  if (KNOWN_COLORS.has(low) || KNOWN_COLORS.has(value) || isHexColor(value)) return;
  throw err('UIError', `Unknown color '${value}'. Use a color name (e.g. blue, white) or hex (e.g. #FF0000).`, token, mod);
}

function uiPropTypeMatches(decl, t) {
  if (Types.isAny(t)) return true;
  if (decl === 'string') return t.kind === 'string';
  if (decl === 'int') return t.kind === 'integer';
  if (decl === 'bool') return t.kind === 'boolean';
  if (decl === 'decimal') return t.kind === 'decimal' || t.kind === 'integer';
  if (decl === 'list') return t.kind === 'list';
  return false;
}

// Resolve a UI target node (VarRef possibly 'window', or FieldAccess into a
// module namespace) to { kind, label }. Throws UI-flavored errors.
function requireHasWindow(ctx, token, what) {
  const { scope, mod } = ctx;
  if (!scope.hasWindow) {
    throw err('UIError', `${what} needs a window. Add: create a window titled "...".`, token, mod);
  }
}

function requireWindowBuilt(ctx, token) {
  // Top-level UI code runs in order, so the window must be created first.
  // (Inside functions/components/handlers the call time is unknown, so the
  // runtime guards there instead — see VexUI null checks.)
  const { scope, mod } = ctx;
  if (!ctx.inFunction && !ctx.inComponent && !ctx.inHandler && !scope._windowBuilt) {
    throw err('UIError', `Create the window first: create a window titled "...".`, token, mod);
  }
}

function resolveUITargetInfo(node, ctx) {
  const { scope, mod } = ctx;
    if (node.type === 'VarRef') {
    if (node.name === 'window') {
      if (!scope.hasWindow) {
        throw err('UIError', `There is no window in this module. Add: create a window titled "...".`, node.token, mod);
      }
      requireWindowBuilt(ctx, node.token);
      node._resolved = { kind: 'ui-target', binding: 'window', name: 'window', uiKind: 'window' };
      return { kind: 'window', label: 'window' };
    }
    if (ctx.locals && ctx.locals.has(node.name)) {
      const info = ctx.locals.get(node.name);
      if (info.type && info.type.kind === 'ui') {
        node._resolved = { kind: 'ui-target', binding: 'local', name: node.name, uiKind: info.type.uiKind };
        return { kind: info.type.uiKind, label: node.name };
      }
      if (info.type && Types.isAny(info.type)) {
        node._resolved = { kind: 'ui-target', binding: 'local', name: node.name, uiKind: 'any' };
        return { kind: 'any', label: node.name };
      }
      throw err('UIError', `'${node.name}' is a ${Types.typeName(info.type)}, not a UI element.`, node.token, mod);
    }
    if (ctx.outerLocals && ctx.outerLocals.has(node.name)) {
      const info = ctx.outerLocals.get(node.name);
      if (info.type && info.type.kind === 'ui') {
        node._resolved = { kind: 'ui-target', binding: 'local', name: node.name, uiKind: info.type.uiKind };
        return { kind: info.type.uiKind, label: node.name };
      }
      if (info.type && Types.isAny(info.type)) {
        node._resolved = { kind: 'ui-target', binding: 'local', name: node.name, uiKind: 'any' };
        return { kind: 'any', label: node.name };
      }
      throw err('UIError', `'${node.name}' is a ${Types.typeName(info.type)}, not a UI element.`, node.token, mod);
    }
    if (scope.variables.has(node.name)) {
      const info = scope.variables.get(node.name);
      if (info.type && info.type.kind === 'ui') {
        node._resolved = { kind: 'ui-target', binding: 'global', name: node.name, uiKind: info.type.uiKind, module: scope.name };
        return { kind: info.type.uiKind, label: node.name };
      }
      if (info.type && Types.isAny(info.type)) {
        node._resolved = { kind: 'ui-target', binding: 'global', name: node.name, uiKind: 'any', module: scope.name };
        return { kind: 'any', label: node.name };
      }
      throw err('UIError', `'${node.name}' is a ${Types.typeName(info.type)}, not a UI element.`, node.token, mod);
    }
    if (scope.functions.has(node.name) || isModuleName(scope, node.name) || scope.structs.has(node.name)) {
      throw err('UIError', `'${node.name}' is not a UI element.`, node.token, mod);
    }
    throw err('NameError', `Undefined variable '${node.name}'.`, node.token, mod);
  }
  // Dotted (module.member) — infer and require a UI type.
  // `any`-typed values pass with runtime checking (e.g. from find "id").
  const t = inferExpr(node, ctx);
  if (t.kind === 'ui') {
    return { kind: t.uiKind, label: node.field || 'element' };
  }
  if (Types.isAny(t)) {
    return { kind: 'any', label: node.field || 'element' };
  }
  throw err('UIError', `This is a ${Types.typeName(t)}, not a UI element.`, node.token, mod);
}

function checkUIPropValue(kind, prop, decl, valueNode, valueType, mod) {
  if (!uiPropTypeMatches(decl.t, valueType)) {
    throw err('UIError', `Property '${prop}' on ${kind} needs ${decl.t === 'int' ? 'an integer' : decl.t === 'bool' ? 'a boolean' : decl.t === 'decimal' ? 'a number' : 'a string'}, got ${Types.typeName(valueType)}.`, (valueNode && valueNode.token) || null, mod);
  }
  if (valueNode && valueNode.type === 'StrLit') {
    if (prop === 'background' || prop === 'text_color') checkUIColorLiteral(valueNode.value, valueNode.token, mod);
    if (prop === 'alignment') {
      const allowed = UI_ALIGNMENTS[kind] || [];
      if (!allowed.includes(valueNode.value)) {
        throw err('UIError', `Invalid alignment '${valueNode.value}' for ${kind}. Valid: ${allowed.join(', ')}.`, valueNode.token, mod);
      }
    }
    // Vexel 2.9: shortcut specs are validated statically when literal.
    if (prop === 'shortcut') checkUIShortcutLiteral(valueNode.value, valueNode.token, mod);
  }
  if (valueNode && (valueNode.type === 'IntLit' || valueNode.type === 'FloatLit')) {
    const num = Number(valueNode.value);
    if ((prop === 'width' || prop === 'height' || prop === 'font_size') && num <= 0) {
      throw err('UIError', `Property '${prop}' on ${kind} must be positive, got ${valueNode.value}.`, valueNode.token, mod);
    }
    if (prop === 'opacity' && (num < 0 || num > 1)) {
      throw err('UIError', `Opacity must be between 0 and 1, got ${valueNode.value}.`, valueNode.token, mod);
    }
  }
}

// Vexel 2.9: "Ctrl+S", "Ctrl+Shift+O", "Alt+F4", "F5" — modifiers plus a
// non-empty key. Unknown key names still fail at runtime with the key
// named (the Key enum is too large to pin statically).
function checkUIShortcutLiteral(spec, token, mod) {
  const plus = spec.lastIndexOf('+');
  const mods = plus >= 0 ? spec.slice(0, plus).split('+') : [];
  const key = (plus >= 0 ? spec.slice(plus + 1) : spec).trim();
  for (const m of mods) {
    const t = m.trim().toLowerCase();
    if (t !== 'ctrl' && t !== 'control' && t !== 'shift' && t !== 'alt' && t !== 'meta' && t !== 'win' && t !== 'cmd') {
      throw err('UIError', `Unknown shortcut modifier '${m.trim()}' in '${spec}'. Use Ctrl, Shift, Alt or Meta (e.g. "Ctrl+S").`, token, mod);
    }
  }
  if (!key) {
    throw err('UIError', `Shortcut '${spec}' needs a key (e.g. "Ctrl+S", "F5").`, token, mod);
  }
}

function lookupUIProp(kind, prop, token, mod, forWrite) {
  // Vexel 2.0: every element can carry an `id` for find "id".
  if (prop === 'id') return { t: 'string', set: true };
  // Vexel 3.0 Praxis: every element exposes live focus state (read),
  // an accessibility description (read/write) and a tooltip (read/write).
  if (prop === 'focused') {
    if (forWrite) throw err('UIError', `Property 'focused' on ${kind} is read-only. Use focus to move keyboard focus.`, token, mod);
    return { t: 'bool', set: false };
  }
  if (prop === 'description') return { t: 'string', set: true };
  if (prop === 'tooltip') return { t: 'string', set: true };
  // Vexel 3.0 Praxis: vector icons on buttons and menu items.
  if (prop === 'icon') {
    if (kind === 'button' || kind === 'menuitem' || kind === 'toolbutton' || kind === 'any') return { t: 'string', set: true };
  }
  const table = UI_PROPS[kind];
  if (!table) throw err('UIError', `Unknown UI element kind '${kind}'.`, token, mod);
  const decl = table[prop];
  if (!decl) {
    const names = Object.keys(table).join(', ');
    throw err('UIError', `Cannot ${forWrite ? 'set' : 'read'} '${prop}' on ${kind === 'window' ? 'a window' : 'a ' + kind}. Valid: ${names}.`, token, mod);
  }
  if (forWrite && !decl.set) {
    throw err('UIError', `Property '${prop}' on ${kind} is read-only.`, token, mod);
  }
  return decl;
}

module.exports = { analyze };
